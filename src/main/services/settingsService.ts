import { readFile, writeFile, mkdir, access, rename, rm } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_SETTINGS, WORKSPACE_CONFIG_FILE, WORKSPACE_META_DIR } from "../../shared/constants";
import { normalizeAiSettings as normalizeSharedAiSettings } from "../../shared/ai";
import type { AppSettings, RecentExternalFile, RecentWorkspace } from "../../shared/types";

interface WindowState {
  bounds?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
  uiState?: Record<string, unknown>;
}

interface GlobalState {
  settings: AppSettings;
  recentWorkspaces: RecentWorkspace[];
  recentExternalFiles: RecentExternalFile[];
  windowState?: WindowState;
}

const defaultSettings: AppSettings = {
  ...DEFAULT_SETTINGS,
  ai: normalizeSharedAiSettings(DEFAULT_SETTINGS.ai)
};

export class SettingsService {
  private readonly statePath: string;
  private state: GlobalState = {
    settings: defaultSettings,
    recentWorkspaces: [],
    recentExternalFiles: []
  };

  constructor(userDataPath: string) {
    this.statePath = path.join(userDataPath, "global-state.json");
  }

  async init(): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    try {
      const raw = await readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<GlobalState>;
      this.state = {
        settings: normalizeAppSettings(parsed.settings),
        recentWorkspaces: parsed.recentWorkspaces ?? [],
        recentExternalFiles: parsed.recentExternalFiles ?? [],
        windowState: parsed.windowState
      };
    } catch {
      await this.persist();
    }
  }

  getSettings(): AppSettings {
    return this.state.settings;
  }

  async setSetting(key: string, value: unknown): Promise<AppSettings> {
    this.state.settings = {
      ...this.state.settings,
      [key]: normalizeSettingValue(key, value)
    } as AppSettings;
    await this.persist();
    return this.getSettings();
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<AppSettings> {
    const existing = this.state.settings.plugins[pluginId] ?? { enabled: false };
    this.state.settings = {
      ...this.state.settings,
      plugins: {
        ...this.state.settings.plugins,
        [pluginId]: {
          ...existing,
          enabled,
          disabledReason: enabled ? undefined : existing.disabledReason
        }
      }
    };
    await this.persist();
    return this.getSettings();
  }

  async acceptPluginPermissions(pluginId: string, acceptedAt = Date.now(), acceptedPermissionHash?: string): Promise<AppSettings> {
    const existing = this.state.settings.plugins[pluginId] ?? { enabled: false };
    this.state.settings = {
      ...this.state.settings,
      plugins: {
        ...this.state.settings.plugins,
        [pluginId]: {
          ...existing,
          permissionsAcceptedAt: acceptedAt,
          acceptedPermissionHash,
          disabledReason: undefined
        }
      }
    };
    await this.persist();
    return this.getSettings();
  }

  async markPluginDisabled(pluginId: string, reason: string): Promise<AppSettings> {
    const existing = this.state.settings.plugins[pluginId] ?? { enabled: false };
    this.state.settings = {
      ...this.state.settings,
      plugins: {
        ...this.state.settings.plugins,
        [pluginId]: {
          ...existing,
          enabled: false,
          disabledReason: reason
        }
      }
    };
    await this.persist();
    return this.getSettings();
  }

  async listRecentWorkspaces(): Promise<RecentWorkspace[]> {
    const items = await Promise.all(
      this.state.recentWorkspaces.map(async (workspace) => {
        const availability = await workspaceAvailability(workspace.path);
        return {
          ...workspace,
          exists: availability === "available",
          availability
        };
      })
    );
    return items.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  async addRecentWorkspace(workspace: RecentWorkspace): Promise<void> {
    const existing = this.state.recentWorkspaces.filter((item) => item.workspaceId !== workspace.workspaceId);
    this.state.recentWorkspaces = [{ ...workspace, exists: true, availability: "available" as const }, ...existing].slice(0, 12);
    await this.persist();
  }

  async removeRecentWorkspace(workspaceId: string): Promise<void> {
    this.state.recentWorkspaces = this.state.recentWorkspaces.filter((workspace) => workspace.workspaceId !== workspaceId);
    await this.persist();
  }

  findRecentById(workspaceId: string): RecentWorkspace | undefined {
    return this.state.recentWorkspaces.find((workspace) => workspace.workspaceId === workspaceId);
  }

  async listRecentExternalFiles(): Promise<RecentExternalFile[]> {
    const items = await Promise.all(this.state.recentExternalFiles.map(async (item): Promise<RecentExternalFile> => ({
      ...item,
      availability: await externalFileAvailability(item.filePath)
    })));
    return items.sort((left, right) => right.lastOpenedAt - left.lastOpenedAt);
  }

  async addRecentExternalFile(filePath: string): Promise<void> {
    const normalized = path.resolve(filePath);
    const existing = this.state.recentExternalFiles.filter((item) => item.filePath !== normalized);
    const recent: RecentExternalFile = {
      filePath: normalized,
      name: path.basename(normalized),
      lastOpenedAt: Date.now(),
      availability: "available"
    };
    this.state.recentExternalFiles = [recent, ...existing].slice(0, 20);
    await this.persist();
  }

  async removeRecentExternalFile(filePath: string): Promise<RecentExternalFile[]> {
    const normalized = path.resolve(filePath);
    this.state.recentExternalFiles = this.state.recentExternalFiles.filter((item) => item.filePath !== normalized);
    await this.persist();
    return this.listRecentExternalFiles();
  }

  getWindowState(): WindowState | undefined {
    return this.state.windowState;
  }

  async saveWindowState(windowState: WindowState): Promise<void> {
    this.state.windowState = windowState;
    await this.persist();
  }

  private async persist(): Promise<void> {
    const temporaryPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
      await rename(temporaryPath, this.statePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function normalizeSettingValue(key: string, value: unknown): unknown {
  if (key === "plugins") {
    return normalizePluginSettings(value);
  }
  if (key === "ai") {
    return normalizeAiSettings(value);
  }
  if (key === "inboxDirectory" || key === "dailyNoteDirectory" || key === "templatesDirectory") {
    return normalizeWorkspaceDirectorySetting(value, DEFAULT_SETTINGS[key]);
  }
  if (key === "quickCaptureFilePattern" || key === "dailyNoteFilePattern") {
    return normalizeDatePatternSetting(value, DEFAULT_SETTINGS[key]);
  }
  return value;
}

function normalizeAppSettings(value: unknown): AppSettings {
  const settings = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<AppSettings>
    : {};
  return {
    ...defaultSettings,
    ...settings,
    inboxDirectory: normalizeWorkspaceDirectorySetting(settings.inboxDirectory, DEFAULT_SETTINGS.inboxDirectory),
    quickCaptureFilePattern: normalizeDatePatternSetting(settings.quickCaptureFilePattern, DEFAULT_SETTINGS.quickCaptureFilePattern),
    dailyNoteDirectory: normalizeWorkspaceDirectorySetting(settings.dailyNoteDirectory, DEFAULT_SETTINGS.dailyNoteDirectory),
    dailyNoteFilePattern: normalizeDatePatternSetting(settings.dailyNoteFilePattern, DEFAULT_SETTINGS.dailyNoteFilePattern),
    templatesDirectory: normalizeWorkspaceDirectorySetting(settings.templatesDirectory, DEFAULT_SETTINGS.templatesDirectory),
    ai: normalizeAiSettings(settings.ai),
    plugins: normalizePluginSettings(settings.plugins)
  };
}

function normalizeWorkspaceDirectorySetting(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const raw = value.trim();
  const slashPath = raw.replace(/\\/g, "/");
  const normalized = slashPath.replace(/^\/+|\/+$/g, "");
  const segments = normalized.split("/").map((segment) => segment.trim()).filter((segment) => segment && segment !== ".");
  const invalidSegment = segments.some((segment) =>
    segment === ".." ||
    /[<>:"|?*]/.test(segment) ||
    Array.from(segment).some((character) => character.charCodeAt(0) < 32) ||
    /[. ]$/.test(segment) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
  );
  if (!normalized || normalized.length > 160 || /^(?:[a-z]:)?\//i.test(slashPath) || /^[a-z]:/i.test(slashPath) || invalidSegment) return fallback;
  return segments.join("/");
}

function normalizeDatePatternSetting(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const pattern = value.trim();
  if (!pattern || pattern.length > 80 || /[\\/:*?"<>|]/.test(pattern) || !/(YYYY|MM|DD)/.test(pattern)) return fallback;
  return pattern;
}

function normalizeAiSettings(value: unknown): AppSettings["ai"] {
  return normalizeSharedAiSettings(value);
}

function normalizePluginSettings(value: unknown): AppSettings["plugins"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const plugins: AppSettings["plugins"] = {};
  for (const [pluginId, rawState] of Object.entries(value)) {
    if (!rawState || typeof rawState !== "object" || Array.isArray(rawState)) {
      continue;
    }
    const state = rawState as Partial<AppSettings["plugins"][string]>;
    plugins[pluginId] = {
      enabled: Boolean(state.enabled),
      permissionsAcceptedAt: typeof state.permissionsAcceptedAt === "number" ? state.permissionsAcceptedAt : undefined,
      acceptedPermissionHash: typeof state.acceptedPermissionHash === "string" ? state.acceptedPermissionHash : undefined,
      disabledReason: typeof state.disabledReason === "string" ? state.disabledReason : undefined,
      settings: state.settings && typeof state.settings === "object" && !Array.isArray(state.settings) ? state.settings : undefined
    };
  }
  return plugins;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function workspaceAvailability(rootPath: string): Promise<RecentWorkspace["availability"]> {
  if (!(await exists(rootPath))) {
    return "missing";
  }
  if (!(await exists(path.join(rootPath, WORKSPACE_META_DIR, WORKSPACE_CONFIG_FILE)))) {
    return "notWorkspace";
  }
  return "available";
}

async function externalFileAvailability(filePath: string): Promise<RecentExternalFile["availability"]> {
  try {
    await access(filePath);
    return "available";
  } catch (error) {
    return error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
  }
}
