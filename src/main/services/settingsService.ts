import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_SETTINGS } from "../../shared/constants";
import { normalizeAiSettings as normalizeSharedAiSettings } from "../../shared/ai";
import type { AppSettings, RecentWorkspace } from "../../shared/types";

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
    recentWorkspaces: []
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
        settings: {
          ...defaultSettings,
          ...(parsed.settings ?? {}),
          ai: normalizeAiSettings(parsed.settings?.ai),
          plugins: normalizePluginSettings(parsed.settings?.plugins)
        },
        recentWorkspaces: parsed.recentWorkspaces ?? [],
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
      this.state.recentWorkspaces.map(async (workspace) => ({
        ...workspace,
        exists: await exists(workspace.path)
      }))
    );
    return items.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  async addRecentWorkspace(workspace: RecentWorkspace): Promise<void> {
    const existing = this.state.recentWorkspaces.filter((item) => item.workspaceId !== workspace.workspaceId);
    this.state.recentWorkspaces = [workspace, ...existing].slice(0, 12);
    await this.persist();
  }

  async removeRecentWorkspace(workspaceId: string): Promise<void> {
    this.state.recentWorkspaces = this.state.recentWorkspaces.filter((workspace) => workspace.workspaceId !== workspaceId);
    await this.persist();
  }

  findRecentById(workspaceId: string): RecentWorkspace | undefined {
    return this.state.recentWorkspaces.find((workspace) => workspace.workspaceId === workspaceId);
  }

  getWindowState(): WindowState | undefined {
    return this.state.windowState;
  }

  async saveWindowState(windowState: WindowState): Promise<void> {
    this.state.windowState = windowState;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeFile(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }
}

function normalizeSettingValue(key: string, value: unknown): unknown {
  if (key === "plugins") {
    return normalizePluginSettings(value);
  }
  if (key === "ai") {
    return normalizeAiSettings(value);
  }
  return value;
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
