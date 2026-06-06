import path from "node:path";
import { app, BrowserWindow, shell } from "electron";

import { APP_NAME } from "../shared/constants";
import { DiagnosticsService } from "./services/diagnosticsService";
import { SettingsService } from "./services/settingsService";

export function createMainWindow(settings: SettingsService, diagnostics?: DiagnosticsService): BrowserWindow {
  const savedState = settings.getWindowState();
  const window = new BrowserWindow({
    title: APP_NAME,
    width: savedState?.bounds?.width ?? 1320,
    height: savedState?.bounds?.height ?? 860,
    x: savedState?.bounds?.x,
    y: savedState?.bounds?.y,
    minWidth: 780,
    minHeight: 520,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  diagnostics?.info("Main window created", {
    windowId: window.id,
    bounds: window.getBounds(),
    restoredBounds: savedState?.bounds
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(?:https?:|mailto:|tel:)/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) {
      return;
    }
    if (url.startsWith("file://")) {
      return;
    }
    event.preventDefault();
  });

  window.once("ready-to-show", () => {
    diagnostics?.info("Main window ready to show", { windowId: window.id, bounds: window.getBounds() });
    revealMainWindow(window, diagnostics, "ready-to-show");
  });

  window.on("show", () => {
    diagnostics?.info("Main window shown", { windowId: window.id, bounds: window.getBounds() });
  });

  window.on("hide", () => {
    diagnostics?.info("Main window hidden", { windowId: window.id, bounds: window.getBounds() });
  });

  window.on("unresponsive", () => {
    diagnostics?.warn("Main window became unresponsive", { windowId: window.id });
  });

  window.on("responsive", () => {
    diagnostics?.info("Main window became responsive", { windowId: window.id });
  });

  window.on("close", () => {
    void settings.saveWindowState({
      bounds: window.getBounds()
    });
  });

  window.on("closed", () => {
    diagnostics?.info("Main window closed", { windowId: window.id });
  });

  window.webContents.on("dom-ready", () => {
    diagnostics?.info("Main window DOM ready", { windowId: window.id, url: window.webContents.getURL() });
  });

  window.webContents.on("did-finish-load", () => {
    diagnostics?.info("Main window finished load", { windowId: window.id, url: window.webContents.getURL() });
    setTimeout(() => {
      revealMainWindow(window, diagnostics, "did-finish-load-fallback");
    }, 300);
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    diagnostics?.error("Main window failed to load", {
      windowId: window.id,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    diagnostics?.error("Main window render process gone", {
      windowId: window.id,
      reason: details.reason,
      exitCode: details.exitCode
    });
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level < 2) {
      return;
    }
    const log = level >= 3 ? diagnostics?.error.bind(diagnostics) : diagnostics?.warn.bind(diagnostics);
    log?.("Renderer console message", {
      windowId: window.id,
      level,
      message,
      line,
      sourceId
    });
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const targetUrl = devServerUrl ?? "nolia://app/index.html";
  diagnostics?.info("Main window loading URL", { windowId: window.id, targetUrl });
  if (devServerUrl && process.env.NOLIA_OPEN_DEVTOOLS === "1") {
    window.webContents.openDevTools({ mode: "detach" });
  }
  void window.loadURL(targetUrl).catch((error: unknown) => {
    diagnostics?.error("Main window loadURL rejected", {
      windowId: window.id,
      targetUrl,
      error: formatError(error)
    });
  });

  return window;
}

function revealMainWindow(window: BrowserWindow, diagnostics: DiagnosticsService | undefined, reason: string): void {
  if (window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  app.focus({ steal: true });
  window.moveTop();
  window.focus();
  diagnostics?.info("Main window show requested", {
    windowId: window.id,
    reason,
    visible: window.isVisible(),
    focused: window.isFocused(),
    bounds: window.getBounds()
  });
}

function formatError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }
  return { message: String(error) };
}
