import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dialog } from "electron";

import {
  WORKSPACE_CONFIG_FILE,
  WORKSPACE_DB_FILE,
  WORKSPACE_DIRECTORIES,
  WORKSPACE_META_DIR
} from "../../shared/constants";
import { createTranslator, type Translator } from "../../shared/i18n";
import type { RecentWorkspace, WorkspaceIndexedEvent, WorkspaceInfo } from "../../shared/types";
import type { ResolvedLocale } from "../../shared/types";
import type { WorkspaceOpenRequest, WorkspaceSwitchRequest } from "../../shared/ipc";
import { ensureDir, pathExists } from "../utils/filePaths";
import { DiagnosticsService } from "./diagnosticsService";
import { SettingsService } from "./settingsService";
import { WorkspaceDb } from "./workspaceDb";
import { WorkspaceIndexService } from "./workspaceIndexService";
import { WorkspaceWatcher } from "./workspaceWatcher";

interface WorkspaceConfig {
  workspaceId: string;
  name: string;
  createdAt: number;
  lastOpenedAt: number;
  version: number;
}

export interface WorkspaceRuntime {
  info: WorkspaceInfo;
  db: WorkspaceDb;
  watcher: WorkspaceWatcher;
  indexAbortController?: AbortController;
  indexTask?: Promise<void>;
}

export class WorkspaceService {
  private active?: WorkspaceRuntime;
  private readonly indexer = new WorkspaceIndexService();
  private readonly tr: Translator;

  constructor(
    private readonly settings: SettingsService,
    private readonly diagnostics: DiagnosticsService,
    private readonly onIndexed?: (event: WorkspaceIndexedEvent) => void,
    locale: ResolvedLocale = "zh-CN"
  ) {
    this.tr = createTranslator(locale);
  }

  async bootstrap(): Promise<{
    activeWorkspace?: WorkspaceInfo;
    recentWorkspaces: RecentWorkspace[];
    settings: ReturnType<SettingsService["getSettings"]>;
  }> {
    return {
      activeWorkspace: this.active?.info,
      recentWorkspaces: await this.settings.listRecentWorkspaces(),
      settings: this.settings.getSettings()
    };
  }

  async openWorkspace(request: WorkspaceOpenRequest): Promise<WorkspaceInfo | undefined> {
    const selectedPath = request.path ?? (await this.pickWorkspaceDirectory(this.tr("打开工作区"), false));
    if (!selectedPath) {
      return undefined;
    }

    if (!(await pathExists(selectedPath))) {
      throw new Error(this.tr("Workspace path does not exist: {path}", { path: selectedPath }));
    }
    if (!(await isInitializedWorkspace(selectedPath))) {
      throw new Error(this.tr("Selected folder is not a Nolia workspace. Use Create Workspace to initialize it."));
    }

    await this.closeActiveWorkspace();
    const runtime = await this.prepareWorkspace(selectedPath, false);
    this.active = runtime;
    this.startBackgroundIndex(runtime);
    await this.settings.addRecentWorkspace({
      workspaceId: runtime.info.workspaceId,
      name: runtime.info.name,
      path: runtime.info.rootPath,
      createdAt: runtime.info.createdAt,
      lastOpenedAt: runtime.info.lastOpenedAt,
      exists: true
    });

    return runtime.info;
  }

  async createWorkspace(request: WorkspaceOpenRequest): Promise<WorkspaceInfo | undefined> {
    const selectedPath = request.path ?? (await this.pickWorkspaceDirectory(this.tr("创建工作区"), true));
    if (!selectedPath) {
      return undefined;
    }
    if (request.createIfMissing) {
      await mkdir(selectedPath, { recursive: true });
    }
    if (!(await pathExists(selectedPath))) {
      await mkdir(selectedPath, { recursive: true });
    }

    await this.closeActiveWorkspace();
    const runtime = await this.prepareWorkspace(selectedPath, true);
    this.active = runtime;
    this.startBackgroundIndex(runtime);
    await this.settings.addRecentWorkspace({
      workspaceId: runtime.info.workspaceId,
      name: runtime.info.name,
      path: runtime.info.rootPath,
      createdAt: runtime.info.createdAt,
      lastOpenedAt: runtime.info.lastOpenedAt,
      exists: true
    });

    return runtime.info;
  }

  async listRecentWorkspaces(): Promise<RecentWorkspace[]> {
    return this.settings.listRecentWorkspaces();
  }

  async switchWorkspace(request: WorkspaceSwitchRequest): Promise<{ ok: boolean; restoredState?: WorkspaceInfo }> {
    const recent = this.settings.findRecentById(request.workspaceId);
    if (!recent) {
      return { ok: false };
    }
    const workspace = await this.openWorkspace({ path: recent.path });
    return { ok: Boolean(workspace), restoredState: workspace };
  }

  async closeActiveWorkspace(): Promise<void> {
    if (!this.active) {
      return;
    }
    this.active.indexAbortController?.abort();
    await this.active.watcher.stop();
    await this.active.indexTask;
    this.active.db.close();
    this.active = undefined;
  }

  requireWorkspace(workspaceId: string): WorkspaceRuntime {
    if (!this.active || this.active.info.workspaceId !== workspaceId) {
      throw new Error(this.tr("Workspace is not open"));
    }
    return this.active;
  }

  getActiveWorkspace(): WorkspaceRuntime | undefined {
    return this.active;
  }

  private async prepareWorkspace(rootPath: string, initialize: boolean): Promise<WorkspaceRuntime> {
    const configPath = path.join(rootPath, WORKSPACE_META_DIR);
    if (initialize) {
      await ensureWorkspaceDirs(rootPath);
    }
    const config = initialize ? await readOrCreateWorkspaceConfig(rootPath) : await readWorkspaceConfig(rootPath);
    if (!initialize) {
      await ensureWorkspaceDirs(rootPath);
    }
    const permissions = await readPermissions(rootPath);
    const info: WorkspaceInfo = {
      workspaceId: config.workspaceId,
      name: config.name,
      rootPath,
      configPath,
      createdAt: config.createdAt,
      lastOpenedAt: config.lastOpenedAt,
      permissions,
      indexState: {
        status: "indexing",
        progress: 0,
        version: 0
      }
    };

    const db = await WorkspaceDb.open(path.join(configPath, WORKSPACE_DB_FILE));
    const watcher = new WorkspaceWatcher(rootPath, db, this.indexer, (pathRel) => {
      info.indexState = {
        status: "ready",
        progress: 1,
        version: db.getIndexVersion()
      };
      this.onIndexed?.({ workspaceId: info.workspaceId, pathRel, indexVersion: db.getIndexVersion() });
    });
    watcher.start();
    const indexAbortController = new AbortController();
    const runtime: WorkspaceRuntime = { info, db, watcher, indexAbortController };
    this.diagnostics.info("Workspace opened", { workspaceId: info.workspaceId, rootPath });

    return runtime;
  }

  private startBackgroundIndex(runtime: WorkspaceRuntime): void {
    const { info, db, indexAbortController } = runtime;
    const signal = indexAbortController?.signal;
    runtime.indexTask = this.indexer
      .rebuildWorkspace(
        info.rootPath,
        db,
        ({ indexed, total }) => {
          if (signal?.aborted) {
            return;
          }
          info.indexState = {
            status: "indexing",
            progress: total === 0 ? 1 : indexed / total,
            version: db.getIndexVersion()
          };
        },
        { signal }
      )
      .then(() => {
        if (signal?.aborted || this.active !== runtime) {
          return;
        }
        info.indexState = {
          status: "ready",
          progress: 1,
          version: db.getIndexVersion()
        };
        this.onIndexed?.({ workspaceId: info.workspaceId, pathRel: "", indexVersion: db.getIndexVersion() });
      })
      .catch((error: unknown) => {
        if (signal?.aborted || this.active !== runtime) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        info.indexState = {
          status: "error",
          progress: 0,
          version: db.getIndexVersion(),
          message
        };
        this.diagnostics.error("Workspace indexing failed", { workspaceId: info.workspaceId, rootPath: info.rootPath, error: message });
        this.onIndexed?.({ workspaceId: info.workspaceId, pathRel: "", indexVersion: db.getIndexVersion() });
      });
  }

  private async pickWorkspaceDirectory(title: string, allowCreate: boolean): Promise<string | undefined> {
    const result = await dialog.showOpenDialog({
      title,
      properties: allowCreate ? ["openDirectory", "createDirectory"] : ["openDirectory"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  }
}

async function ensureWorkspaceDirs(rootPath: string): Promise<void> {
  const metaPath = path.join(rootPath, WORKSPACE_META_DIR);
  await ensureDir(metaPath);
  await Promise.all(
    Object.values(WORKSPACE_DIRECTORIES).map((dirName) => ensureDir(path.join(metaPath, dirName)))
  );
}

async function readOrCreateWorkspaceConfig(rootPath: string): Promise<WorkspaceConfig> {
  const configPath = path.join(rootPath, WORKSPACE_META_DIR, WORKSPACE_CONFIG_FILE);
  const now = Date.now();
  try {
    const existing = JSON.parse(await readFile(configPath, "utf8")) as WorkspaceConfig;
    const updated = {
      ...existing,
      name: existing.name || path.basename(rootPath),
      lastOpenedAt: now
    };
    await writeFile(configPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    return updated;
  } catch {
    const created: WorkspaceConfig = {
      workspaceId: `ws_${randomUUID()}`,
      name: path.basename(rootPath) || "Workspace",
      createdAt: now,
      lastOpenedAt: now,
      version: 1
    };
    await writeFile(configPath, `${JSON.stringify(created, null, 2)}\n`, "utf8");
    return created;
  }
}

async function readWorkspaceConfig(rootPath: string): Promise<WorkspaceConfig> {
  const configPath = path.join(rootPath, WORKSPACE_META_DIR, WORKSPACE_CONFIG_FILE);
  const now = Date.now();
  const existing = JSON.parse(await readFile(configPath, "utf8")) as WorkspaceConfig;
  const updated = {
    ...existing,
    name: existing.name || path.basename(rootPath),
    lastOpenedAt: now
  };
  await writeFile(configPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

async function isInitializedWorkspace(rootPath: string): Promise<boolean> {
  return pathExists(path.join(rootPath, WORKSPACE_META_DIR, WORKSPACE_CONFIG_FILE));
}

async function readPermissions(rootPath: string): Promise<{ readable: boolean; writable: boolean }> {
  const readable = await canAccess(rootPath, 4);
  const writable = await canAccess(rootPath, 2);
  return { readable, writable };
}

async function canAccess(filePath: string, mode: number): Promise<boolean> {
  try {
    await access(filePath, mode);
    return true;
  } catch {
    return false;
  }
}
