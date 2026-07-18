import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dialog, type BrowserWindow, type OpenDialogOptions } from "electron";

import {
  WORKSPACE_CONFIG_FILE,
  WORKSPACE_DB_FILE,
  WORKSPACE_DIRECTORIES,
  WORKSPACE_META_DIR
} from "../../shared/constants";
import { createTranslator, type Translator } from "../../shared/i18n";
import type { RecentWorkspace, WorkspaceIndexedEvent, WorkspaceInfo } from "../../shared/types";
import type { WorkspaceHealthSnapshot, WorkspaceProbeResult } from "../../shared/contracts";
import type { ResolvedLocale } from "../../shared/types";
import type { WorkspaceOpenRequest, WorkspaceRemoveRecentRequest, WorkspaceSwitchRequest } from "../../shared/ipc";
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
  treeSequence: number;
  watcherError?: string;
}

export class WorkspaceService {
  private active?: WorkspaceRuntime;
  private readonly indexer = new WorkspaceIndexService();
  private readonly tr: Translator;

  constructor(
    private readonly settings: SettingsService,
    private readonly diagnostics: DiagnosticsService,
    private readonly onIndexed?: (event: WorkspaceIndexedEvent) => void,
    locale: ResolvedLocale = "zh-CN",
    private readonly userDataPath?: string
  ) {
    this.tr = createTranslator(locale);
  }

  async probeWorkspace(pathInput?: string, parentWindow?: BrowserWindow): Promise<WorkspaceProbeResult | undefined> {
    const selectedPath = pathInput ?? (await this.pickWorkspaceDirectory(this.tr("打开工作区"), false, parentWindow));
    if (!selectedPath) {
      return undefined;
    }
    const name = path.basename(selectedPath) || "Workspace";
    if (!(await pathExists(selectedPath))) {
      return { path: selectedPath, name, status: "inaccessible", readable: false, writable: false, markdownCount: 0, hasNoliaDirectory: false, message: this.tr("Workspace path does not exist: {path}", { path: selectedPath }) };
    }
    const permissions = await readPermissions(selectedPath);
    if (!permissions.readable) {
      return { path: selectedPath, name, status: "inaccessible", ...permissions, markdownCount: 0, hasNoliaDirectory: false, message: "无法读取所选目录" };
    }
    const hasNoliaDirectory = await pathExists(path.join(selectedPath, WORKSPACE_META_DIR));
    const configPath = path.join(selectedPath, WORKSPACE_META_DIR, WORKSPACE_CONFIG_FILE);
    const markdownCount = await countMarkdownFiles(selectedPath);
    if (await pathExists(configPath)) {
      try {
        const config = parseWorkspaceConfig(await readFile(configPath, "utf8"));
        if (!config.workspaceId || !config.name || !config.version) {
          throw new Error("Invalid workspace config");
        }
        return { path: selectedPath, name: config.name, status: "initialized", ...permissions, markdownCount, hasNoliaDirectory: true };
      } catch (error) {
        return { path: selectedPath, name, status: "corrupt", ...permissions, markdownCount, hasNoliaDirectory: true, message: error instanceof Error ? error.message : String(error) };
      }
    }
    return {
      path: selectedPath,
      name,
      status: permissions.writable ? "initializable" : "read_only",
      ...permissions,
      markdownCount,
      hasNoliaDirectory
    };
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

  async openWorkspace(request: WorkspaceOpenRequest, parentWindow?: BrowserWindow): Promise<WorkspaceInfo | undefined> {
    const selectedPath = request.path ?? (await this.pickWorkspaceDirectory(this.tr("打开工作区"), false, parentWindow));
    if (!selectedPath) {
      return undefined;
    }

    if (!(await pathExists(selectedPath))) {
      throw new Error(this.tr("Workspace path does not exist: {path}", { path: selectedPath }));
    }
    if (!(await isInitializedWorkspace(selectedPath))) {
      const permissions = await readPermissions(selectedPath);
      if (request.createIfMissing && permissions.writable) {
        return this.createWorkspace({ path: selectedPath });
      }
      if (!permissions.writable && permissions.readable && this.userDataPath) {
        await this.closeActiveWorkspace();
        const runtime = await this.prepareReadOnlyWorkspace(selectedPath);
        this.active = runtime;
        this.startBackgroundIndex(runtime);
        return runtime.info;
      }
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

  async createWorkspace(request: WorkspaceOpenRequest, parentWindow?: BrowserWindow): Promise<WorkspaceInfo | undefined> {
    const selectedPath = request.path ?? (await this.pickWorkspaceDirectory(this.tr("创建工作区"), true, parentWindow));
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

  async removeRecentWorkspace(request: WorkspaceRemoveRecentRequest): Promise<RecentWorkspace[]> {
    await this.settings.removeRecentWorkspace(request.workspaceId);
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
    await this.active.db.flush();
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

  getHealth(workspaceId: string): WorkspaceHealthSnapshot {
    const runtime = this.requireWorkspace(workspaceId);
    const issues: WorkspaceHealthSnapshot["issues"] = [];
    if (!runtime.info.permissions.writable) issues.push({ id: "read-only", title: "工作区为只读", message: "正文写入、属性、模板和 AI 修改已禁用。", severity: "warning" });
    if (runtime.watcherError) issues.push({ id: "watcher", title: "文件监控异常", message: runtime.watcherError, severity: "error" });
    if (runtime.info.indexState.status === "error") issues.push({ id: "index", title: "搜索索引异常", message: runtime.info.indexState.message ?? "索引失败", severity: "error" });
    return {
      workspaceId,
      readable: runtime.info.permissions.readable,
      writable: runtime.info.permissions.writable,
      watcher: { status: runtime.watcherError ? "error" : "ready", message: runtime.watcherError },
      index: { status: runtime.info.indexState.status, progress: runtime.info.indexState.progress, message: runtime.info.indexState.message },
      database: { schemaVersion: runtime.db.getSchemaVersion(), status: "ready" },
      history: { bytes: runtime.db.getHistoryBytes() },
      issues
    };
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
    let runtime!: WorkspaceRuntime;
    const watcher = new WorkspaceWatcher(rootPath, db, this.indexer, (pathRel, operation, node) => {
      info.indexState = {
        status: "ready",
        progress: 1,
        version: db.getIndexVersion()
      };
      runtime.treeSequence += 1;
      this.onIndexed?.({ workspaceId: info.workspaceId, pathRel, indexVersion: db.getIndexVersion(), sequence: runtime.treeSequence, operation, node });
    }, (error) => {
      const message = error instanceof Error ? error.message : String(error);
      runtime.watcherError = message;
      this.diagnostics.warn("Workspace watcher failed", { workspaceId: info.workspaceId, rootPath, error: message });
    });
    const indexAbortController = new AbortController();
    runtime = { info, db, watcher, indexAbortController, treeSequence: 0 };
    watcher.start();
    this.diagnostics.info("Workspace opened", { workspaceId: info.workspaceId, rootPath });

    return runtime;
  }

  private async prepareReadOnlyWorkspace(rootPath: string): Promise<WorkspaceRuntime> {
    if (!this.userDataPath) {
      throw new Error("此工作区为只读，无法创建本地缓存");
    }
    const cacheKey = Buffer.from(rootPath).toString("base64url").slice(0, 80);
    const configPath = path.join(this.userDataPath, "workspace-cache", cacheKey);
    await ensureDir(configPath);
    const now = Date.now();
    const configFile = path.join(configPath, WORKSPACE_CONFIG_FILE);
    let config: WorkspaceConfig;
    try {
      config = parseWorkspaceConfig(await readFile(configFile, "utf8"));
    } catch {
      config = { workspaceId: `ws_readonly_${cacheKey}`, name: path.basename(rootPath) || "Workspace", createdAt: now, lastOpenedAt: now, version: 1 };
    }
    config.lastOpenedAt = now;
    await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    const info: WorkspaceInfo = {
      workspaceId: config.workspaceId,
      name: config.name,
      rootPath,
      configPath,
      createdAt: config.createdAt,
      lastOpenedAt: now,
      permissions: { readable: true, writable: false },
      indexState: { status: "indexing", progress: 0, version: 0 }
    };
    const db = await WorkspaceDb.open(path.join(configPath, WORKSPACE_DB_FILE));
    let runtime!: WorkspaceRuntime;
    const watcher = new WorkspaceWatcher(rootPath, db, this.indexer, (pathRel, operation, node) => {
      info.indexState = { status: "ready", progress: 1, version: db.getIndexVersion() };
      runtime.treeSequence += 1;
      this.onIndexed?.({ workspaceId: info.workspaceId, pathRel, indexVersion: db.getIndexVersion(), sequence: runtime.treeSequence, operation, node });
    }, (error) => {
      runtime.watcherError = error instanceof Error ? error.message : String(error);
      this.diagnostics.warn("Read-only workspace watcher failed", { workspaceId: info.workspaceId, error: runtime.watcherError });
    });
    runtime = { info, db, watcher, indexAbortController: new AbortController(), treeSequence: 0 };
    watcher.start();
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

  private async pickWorkspaceDirectory(title: string, allowCreate: boolean, parentWindow?: BrowserWindow): Promise<string | undefined> {
    const options: OpenDialogOptions = {
      title,
      properties: allowCreate ? ["openDirectory", "createDirectory"] : ["openDirectory"]
    };
    const result = parentWindow && !parentWindow.isDestroyed() ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
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
    const existing = parseWorkspaceConfig(await readFile(configPath, "utf8"));
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
  const existing = parseWorkspaceConfig(await readFile(configPath, "utf8"));
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

function parseWorkspaceConfig(raw: string): WorkspaceConfig {
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as WorkspaceConfig;
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

async function countMarkdownFiles(rootPath: string, limit = 100_000): Promise<number> {
  let count = 0;
  async function walk(currentPath: string): Promise<void> {
    if (count >= limit) {
      return;
    }
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === WORKSPACE_META_DIR || entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (/\.(?:md|markdown)$/i.test(entry.name)) {
        count += 1;
      }
    }
  }
  await walk(rootPath);
  return count;
}
