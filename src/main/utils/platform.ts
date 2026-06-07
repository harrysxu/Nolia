import fs from "node:fs";
import path from "node:path";
import type { BrowserWindowConstructorOptions } from "electron";

import { APP_NAME } from "../../shared/constants";

interface SavedWindowState {
  bounds?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
}

export function resolveDiagnosticsLogRoot(
  homePath: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): string {
  if (platform === "darwin") {
    return path.join(homePath, "Library", "Logs", APP_NAME);
  }
  if (platform === "linux") {
    return path.join(env.XDG_STATE_HOME || path.join(homePath, ".local", "state"), APP_NAME, "logs");
  }
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA || env.APPDATA || path.join(homePath, "AppData", "Local"), APP_NAME, "Logs");
  }
  return path.join(homePath, `.${APP_NAME.toLowerCase()}`, "logs");
}

export function createMainWindowOptions(
  savedState?: SavedWindowState,
  platform: NodeJS.Platform = process.platform,
  preloadPath = path.join(__dirname, "../preload/index.js"),
  windowIconPath = resolveWindowIconPath(platform)
): BrowserWindowConstructorOptions {
  return {
    title: APP_NAME,
    width: savedState?.bounds?.width ?? 1320,
    height: savedState?.bounds?.height ?? 860,
    x: savedState?.bounds?.x,
    y: savedState?.bounds?.y,
    minWidth: 780,
    minHeight: 520,
    show: false,
    ...(platform === "linux" && windowIconPath ? { icon: windowIconPath } : {}),
    ...(platform === "darwin" ? {
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 16, y: 16 }
    } : {}),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  };
}

export function resolveWindowIconPath(
  platform: NodeJS.Platform = process.platform,
  resourcesPath = process.resourcesPath,
  cwd = process.cwd(),
  exists: (filePath: string) => boolean = fs.existsSync
): string | undefined {
  if (platform !== "linux") {
    return undefined;
  }

  const candidates = [
    path.join(resourcesPath, "assets", "icon.png"),
    path.join(cwd, "build", "icon.png")
  ];
  return candidates.find((candidate) => exists(candidate));
}

export function acceleratorForCommand(command: string | undefined, platform: NodeJS.Platform = process.platform): string | undefined {
  switch (command) {
    case "view.settings":
      return acceleratorForModifier(",", platform);
    case "file.new":
      return acceleratorForModifier("N", platform);
    case "workspace.open":
      return acceleratorForModifier("O", platform);
    case "document.save":
      return acceleratorForModifier("S", platform);
    case "document.export":
      return acceleratorForModifier("Shift+E", platform);
    case "commandPalette.open":
      return acceleratorForModifier("K", platform);
    case "view.recent":
      return acceleratorForModifier("1", platform);
    case "view.files":
      return acceleratorForModifier("2", platform);
    case "view.favorites":
      return acceleratorForModifier("3", platform);
    case "view.search":
      return acceleratorForModifier("4", platform);
    case "view.backlinks":
      return acceleratorForModifier("5", platform);
    case "mode.wysiwyg":
      return acceleratorForModifier("Alt+1", platform);
    case "mode.source":
      return acceleratorForModifier("Alt+2", platform);
    case "mode.split":
      return acceleratorForModifier("Alt+3", platform);
    case "view.immersive.toggle":
      return acceleratorForModifier("Shift+I", platform);
    case "view.toolbar.toggle":
      return acceleratorForModifier("Shift+T", platform);
    case "view.lineNumbers.toggle":
      return acceleratorForModifier("Shift+L", platform);
    default:
      return undefined;
  }
}

export function acceleratorForModifier(keys: string, platform: NodeJS.Platform = process.platform): string {
  return `${platform === "darwin" ? "Command" : "Control"}+${keys}`;
}

export function acceleratorForFullScreen(platform: NodeJS.Platform = process.platform): string {
  return platform === "darwin" ? "Control+Command+F" : "F11";
}
