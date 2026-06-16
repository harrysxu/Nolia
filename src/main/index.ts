import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import { lookup as lookupMime } from "mime-types";

import { APP_NAME, BUNDLE_IDENTIFIER } from "../shared/constants";
import { IpcChannels } from "../shared/channels";
import { getBuiltInMenuContributions } from "../shared/builtinExtensions";
import { resolveLocale } from "../shared/i18n";
import { AiService } from "./ai/aiService";
import { AiSettingsService } from "./ai/aiSettingsService";
import { AiTaskService } from "./ai/aiTaskService";
import { AiSecretService } from "./ai/security/secretService";
import { AttachmentService } from "./services/attachmentService";
import { DiagnosticsService } from "./services/diagnosticsService";
import { ExportService } from "./services/exportService";
import { FileSystemService } from "./services/fileSystemService";
import { HistoryService } from "./services/historyService";
import { PLUGIN_PROTOCOL, PluginService } from "./services/pluginService";
import { SettingsService } from "./services/settingsService";
import { SemanticIndexService } from "./services/semanticIndexService";
import { WorkspaceService } from "./services/workspaceService";
import { registerIpcHandlers } from "./ipc";
import { createMainWindow } from "./mainWindow";
import { installApplicationMenu } from "./menu";

let mainWindow: BrowserWindow | undefined;
let externalFileReceiverWindowId: number | undefined;
let createMainWindowFromRuntime: (() => BrowserWindow) | undefined;
const pendingFiles: string[] = [];
const RENDERER_PROTOCOL = "nolia";
const ASSET_PROTOCOL = "nolia-asset";
const EXTERNAL_ASSET_HOST = "external";

app.setName(APP_NAME);
app.setAppUserModelId(BUNDLE_IDENTIFIER);
if (process.env.NOLIA_USER_DATA_DIR) {
  app.setPath("userData", process.env.NOLIA_USER_DATA_DIR);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  },
  {
    scheme: ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  },
  {
    scheme: PLUGIN_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

const hasLock = process.env.NOLIA_DISABLE_SINGLE_INSTANCE_LOCK === "1" || app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
}

app.on("second-instance", (_event, argv) => {
  const window = getUsableMainWindow();
  if (window) {
    showAndFocusMainWindow(window);
  }
  collectMarkdownFileArgs(argv).forEach(sendOrQueueExternalFile);
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  sendOrQueueExternalFile(filePath);
});

app.whenReady().then(async () => {
  collectMarkdownFileArgs(process.argv).forEach(sendOrQueueExternalFile);

  const diagnostics = new DiagnosticsService(app.getPath("home"));
  await diagnostics.init();
  app.setAppLogsPath(diagnostics.logRoot);
  installProcessDiagnostics(diagnostics);

  const settings = new SettingsService(app.getPath("userData"));
  await settings.init();
  const aiSecrets = new AiSecretService(app.getPath("userData"));
  await aiSecrets.init();
  const aiSettings = new AiSettingsService(settings, aiSecrets);
  const startupLocale = resolveLocale(settings.getSettings().language, app.getLocale());
  const plugins = new PluginService(app.getPath("userData"), settings, diagnostics, startupLocale);
  await plugins.init();

  const workspaces = new WorkspaceService(settings, diagnostics, (event) => {
    const window = getUsableMainWindow();
    if (!window) {
      return;
    }
    window.webContents.send("workspace.indexed", event);
  }, startupLocale);
  const history = new HistoryService();
  const files = new FileSystemService(workspaces, history);
  const attachments = new AttachmentService(workspaces, startupLocale);
  const exporter = new ExportService(workspaces, startupLocale);
  const semanticIndex = new SemanticIndexService();
  const aiRuntimeServices = { workspaces, files, settings, aiSettings, diagnostics, semanticIndex };
  let aiTasks: AiTaskService | undefined;
  const emitAiEvent = (event: import("../shared/ai").AiRunEvent) => {
    void aiTasks?.recordEvent(event).catch((error: unknown) => diagnostics.error("Failed to persist AI task event", { error: formatError(error) }));
    mainWindow?.webContents.send(IpcChannels.aiRunEvent, event);
  };
  const ai = new AiService(aiSettings, aiRuntimeServices, () => mainWindow, emitAiEvent);
  aiTasks = new AiTaskService(ai, aiRuntimeServices, emitAiEvent);
  await aiTasks.markInterruptedRunningTasks();

  if (!process.env.VITE_DEV_SERVER_URL) {
    registerRendererProtocol();
  }
  registerAssetProtocol(workspaces, files);
  registerPluginProtocol(plugins);

  createMainWindowFromRuntime = () => createTrackedMainWindow(settings, diagnostics, () => {
    void workspaces.closeActiveWorkspace().catch((error: unknown) => {
      diagnostics.error("Failed to close active workspace after window close", { error: formatError(error) });
    });
  });
  mainWindow = createMainWindowFromRuntime();

  registerIpcHandlers({
    workspaces,
    files,
    attachments,
    exporter,
    settings,
    diagnostics,
    plugins,
    ai,
    aiTasks,
    syncExtensionMenus: (menus) => installApplicationMenu(() => mainWindow, menus, startupLocale)
  });
  installApplicationMenu(() => mainWindow, getBuiltInMenuContributions(startupLocale), startupLocale);

  ipcMain.handle(IpcChannels.externalFileConsumePendingOpen, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const currentWindow = getUsableMainWindow();
    if (window && currentWindow && window.id === currentWindow.id) {
      externalFileReceiverWindowId = window.id;
    }
    return pendingFiles.splice(0);
  });

  app.on("activate", () => {
    const window = getUsableMainWindow();
    if (window) {
      showAndFocusMainWindow(window);
    } else if (BrowserWindow.getAllWindows().length === 0 && createMainWindowFromRuntime) {
      mainWindow = createMainWindowFromRuntime();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerRendererProtocol(): void {
  protocol.handle(RENDERER_PROTOCOL, (request) => {
    const url = new URL(request.url);
    const requestedPath = decodeURIComponent(url.pathname);
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
    const normalizedPath = path.normalize(relativePath);
    if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
      return new Response("Not found", { status: 404 });
    }
    const filePath = path.join(__dirname, "../renderer", normalizedPath);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function registerPluginProtocol(plugins: PluginService): void {
  protocol.handle(PLUGIN_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    const pluginId = decodeURIComponent(url.hostname);
    const requestedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const filePath = plugins.resolvePluginFile(pluginId, requestedPath);
    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }
    return fileResponse(filePath);
  });
}

function registerAssetProtocol(workspaces: WorkspaceService, files: FileSystemService): void {
  protocol.handle(ASSET_PROTOCOL, async (request) => {
    const url = new URL(request.url);
    let filePath: string;
    if (url.hostname === EXTERNAL_ASSET_HOST) {
      const requestedPath = decodeURIComponent(url.pathname);
      filePath = files.resolveExternalAssetPath(requestedPath);
    } else {
      const pathSegments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
      const workspaceId = url.hostname === "workspace" ? decodeURIComponent(pathSegments.shift() ?? "") : url.hostname;
      const runtime = workspaces.requireWorkspace(workspaceId);
      const requestedPath =
        url.hostname === "workspace"
          ? pathSegments.map((segment) => decodeURIComponent(segment)).join("/")
          : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const normalizedPath = path.normalize(requestedPath);
      if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
        return new Response("Not found", { status: 404 });
      }
      filePath = path.join(runtime.info.rootPath, normalizedPath);
    }
    return fileResponse(filePath);
  });
}

async function fileResponse(filePath: string, contentType = lookupMime(filePath) || "application/octet-stream"): Promise<Response> {
  try {
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        "content-type": contentType,
        "access-control-allow-origin": "*"
      }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function collectMarkdownFileArgs(argv: string[]): string[] {
  return argv.filter(isMarkdownFilePath);
}

function isMarkdownFilePath(filePath: string): boolean {
  return /\.(?:md|markdown)$/i.test(filePath);
}

function sendOrQueueExternalFile(filePath: string): void {
  const resolvedPath = path.resolve(filePath);
  let window = getUsableMainWindow();
  if (!window && app.isReady() && createMainWindowFromRuntime) {
    mainWindow = createMainWindowFromRuntime();
    window = mainWindow;
  }
  if (window) {
    showAndFocusMainWindow(window);
  }
  if (window && externalFileReceiverWindowId === window.id && !window.webContents.isLoading()) {
    window.webContents.send("file.openExternal", resolvedPath);
    return;
  }
  queuePendingExternalFile(resolvedPath);
}

function createTrackedMainWindow(settings: SettingsService, diagnostics: DiagnosticsService, onClosed?: () => void): BrowserWindow {
  externalFileReceiverWindowId = undefined;
  const window = createMainWindow(settings, diagnostics);
  window.on("closed", () => {
    if (mainWindow?.id === window.id) {
      mainWindow = undefined;
    }
    if (externalFileReceiverWindowId === window.id) {
      externalFileReceiverWindowId = undefined;
    }
    onClosed?.();
  });
  return window;
}

function getUsableMainWindow(): BrowserWindow | undefined {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    mainWindow = undefined;
    externalFileReceiverWindowId = undefined;
    return undefined;
  }
  return mainWindow;
}

function showAndFocusMainWindow(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  app.focus({ steal: true });
  window.moveTop();
  window.focus();
}

function queuePendingExternalFile(filePath: string): void {
  if (!pendingFiles.includes(filePath)) {
    pendingFiles.push(filePath);
  }
}

function installProcessDiagnostics(diagnostics: DiagnosticsService): void {
  process.on("uncaughtException", (error) => {
    diagnostics.error("Uncaught main process exception", { error: formatError(error) });
  });

  process.on("unhandledRejection", (reason) => {
    diagnostics.error("Unhandled main process rejection", { error: formatError(reason) });
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    diagnostics.error("Render process gone", {
      webContentsId: webContents.id,
      url: webContents.getURL(),
      reason: details.reason,
      exitCode: details.exitCode
    });
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
