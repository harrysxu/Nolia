import { BrowserWindow, clipboard, shell, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { ZodType } from "zod";

import {
  AttachmentImportRequestSchema,
  AttachmentPickImageRequestSchema,
  AiAttachmentExtractRequestSchema,
  AiChangePlanApplyRequestSchema,
  AiChangePlanPrepareRequestSchema,
  AiChatCancelRequestSchema,
  AiChatStartRequestSchema,
  AiCommandRunRequestSchema,
  AiCommandsListRequestSchema,
  AiContextPreviewRequestSchema,
  AiCredentialDeleteRequestSchema,
  AiCredentialListRequestSchema,
  AiCredentialSetRequestSchema,
  AiIndexCancelRequestSchema,
  AiIndexClearRequestSchema,
  AiIndexRebuildRequestSchema,
  AiIndexStatusRequestSchema,
  AiInsightsRequestSchema,
  AiModelsListRequestSchema,
  AiProviderTestRequestSchema,
  AiWebSearchRequestSchema,
  ClipboardWriteRichRequestSchema,
  DocumentParseRequestSchema,
  EmptySchema,
  ExportDocumentRequestSchema,
  ExtensionsSyncMenusRequestSchema,
  ExternalFileReadRequestSchema,
  ExternalFileWriteAtomicRequestSchema,
  FileCreateRequestSchema,
  FileListTreeRequestSchema,
  FileReadRequestSchema,
  FileRenameRequestSchema,
  FileResourceActionRequestSchema,
  FileTrashRequestSchema,
  FileWriteBinaryAtomicRequestSchema,
  FileWriteAtomicRequestSchema,
  GraphBacklinksRequestSchema,
  IpcChannels,
  PluginAcceptPermissionsRequestSchema,
  PluginRecordFailureRequestSchema,
  PluginSetEnabledRequestSchema,
  SearchQueryRequestSchema,
  SettingsSetRequestSchema,
  WorkspaceOpenRequestSchema,
  WorkspaceListTagsRequestSchema,
  WorkspaceRemoveRecentRequestSchema,
  WorkspaceSwitchRequestSchema
} from "../shared/ipc";
import { parseMarkdown } from "../shared/markdown";
import { AttachmentService } from "./services/attachmentService";
import { DiagnosticsService } from "./services/diagnosticsService";
import { ExportService } from "./services/exportService";
import { FileSystemService } from "./services/fileSystemService";
import { PluginService } from "./services/pluginService";
import { SettingsService } from "./services/settingsService";
import { WorkspaceService } from "./services/workspaceService";
import { AiService } from "./services/ai/aiService";
import type { MenuContribution } from "../shared/extensions";

interface IpcServices {
  workspaces: WorkspaceService;
  files: FileSystemService;
  attachments: AttachmentService;
  exporter: ExportService;
  settings: SettingsService;
  ai: AiService;
  diagnostics: DiagnosticsService;
  plugins: PluginService;
  syncExtensionMenus: (menus: MenuContribution[]) => void;
}

export function registerIpcHandlers(services: IpcServices): void {
  handle(IpcChannels.workspaceBootstrap, EmptySchema, async () => ({
    ...(await services.workspaces.bootstrap()),
    appInfo: {
      platform: process.platform,
      pluginDirectory: services.plugins.pluginsRoot,
      logsDirectory: services.diagnostics.logRoot
    }
  }));
  handle(IpcChannels.workspaceOpen, WorkspaceOpenRequestSchema, (request, event) =>
    services.workspaces.openWorkspace(request, BrowserWindow.fromWebContents(event.sender) ?? undefined)
  );
  handle(IpcChannels.workspaceCreate, WorkspaceOpenRequestSchema, (request, event) =>
    services.workspaces.createWorkspace(request, BrowserWindow.fromWebContents(event.sender) ?? undefined)
  );
  handle(IpcChannels.workspaceListRecent, EmptySchema, () => services.workspaces.listRecentWorkspaces());
  handle(IpcChannels.workspaceRemoveRecent, WorkspaceRemoveRecentRequestSchema, (request) => services.workspaces.removeRecentWorkspace(request));
  handle(IpcChannels.workspaceListTags, WorkspaceListTagsRequestSchema, (request) => {
    const runtime = services.workspaces.requireWorkspace(request.workspaceId);
    return runtime.db.listTags();
  });
  handle(IpcChannels.workspaceSwitch, WorkspaceSwitchRequestSchema, (request) => services.workspaces.switchWorkspace(request));
  handle(IpcChannels.workspaceClose, EmptySchema, () => services.workspaces.closeActiveWorkspace());

  handle(IpcChannels.fileListTree, FileListTreeRequestSchema, (request) => services.files.listTree(request));
  handle(IpcChannels.fileRead, FileReadRequestSchema, (request) => services.files.readFile(request));
  handle(IpcChannels.fileReadBinary, FileReadRequestSchema, (request) => services.files.readBinaryFile(request));
  handle(IpcChannels.fileWriteAtomic, FileWriteAtomicRequestSchema, (request) => services.files.writeAtomic(request));
  handle(IpcChannels.fileWriteBinaryAtomic, FileWriteBinaryAtomicRequestSchema, (request) => services.files.writeBinaryAtomic(request));
  handle(IpcChannels.fileCreate, FileCreateRequestSchema, (request) => services.files.create(request));
  handle(IpcChannels.fileRename, FileRenameRequestSchema, (request) => services.files.rename(request));
  handle(IpcChannels.fileTrash, FileTrashRequestSchema, (request) => services.files.trash(request));
  handle(IpcChannels.fileOpenExternal, FileResourceActionRequestSchema, (request) => services.files.openExternal(request));
  handle(IpcChannels.fileRevealInFinder, FileResourceActionRequestSchema, (request) => services.files.revealInFinder(request));
  handle(IpcChannels.externalFileRead, ExternalFileReadRequestSchema, (request) => services.files.readExternalFile(request));
  handle(IpcChannels.externalFileWriteAtomic, ExternalFileWriteAtomicRequestSchema, (request) => services.files.writeExternalAtomic(request));

  handle(IpcChannels.documentParse, DocumentParseRequestSchema, (request) => parseMarkdown(request.content, request.pathRel));
  handle(IpcChannels.searchQuery, SearchQueryRequestSchema, (request) => {
    const runtime = services.workspaces.requireWorkspace(request.workspaceId);
    return runtime.db.search(request);
  });
  handle(IpcChannels.graphGetBacklinks, GraphBacklinksRequestSchema, (request) => {
    const runtime = services.workspaces.requireWorkspace(request.workspaceId);
    return runtime.db.getBacklinks(request.pathRel, request.includeUnlinkedMentions);
  });

  handle(IpcChannels.attachmentImport, AttachmentImportRequestSchema, (request) => services.attachments.importAttachment(request));
  handle(IpcChannels.attachmentPickImage, AttachmentPickImageRequestSchema, (request, event) =>
    services.attachments.pickImage(request, BrowserWindow.fromWebContents(event.sender) ?? undefined)
  );
  handle(IpcChannels.exportDocument, ExportDocumentRequestSchema, (request, event) =>
    services.exporter.exportDocument(request, BrowserWindow.fromWebContents(event.sender) ?? undefined)
  );
  handle(IpcChannels.clipboardWriteRich, ClipboardWriteRichRequestSchema, (request) => {
    clipboard.write({ html: request.html, text: request.text });
    return { ok: true };
  });

  handle(IpcChannels.settingsGet, EmptySchema, () => services.settings.getSettings());
  handle(IpcChannels.settingsSet, SettingsSetRequestSchema, (request) => services.settings.setSetting(request.key, request.value));
  handle(IpcChannels.aiCredentialsList, AiCredentialListRequestSchema, () => services.ai.listCredentials());
  handle(IpcChannels.aiCredentialsSet, AiCredentialSetRequestSchema, (request) => services.ai.setCredential(request));
  handle(IpcChannels.aiCredentialsDelete, AiCredentialDeleteRequestSchema, (request) => services.ai.deleteCredential(request.keyRef));
  handle(IpcChannels.aiProviderTest, AiProviderTestRequestSchema, (request) => services.ai.testProvider(request));
  handle(IpcChannels.aiModelsList, AiModelsListRequestSchema, (request) => services.ai.listModels(request));
  handle(IpcChannels.aiContextPreview, AiContextPreviewRequestSchema, (request) => services.ai.previewContext(request));
  handle(IpcChannels.aiChatStart, AiChatStartRequestSchema, (request, event) => services.ai.startChat(request, event.sender));
  handle(IpcChannels.aiChatCancel, AiChatCancelRequestSchema, (request) => services.ai.cancelChat(request));
  handle(IpcChannels.aiCommandsList, AiCommandsListRequestSchema, (request) => services.ai.listCommands(request));
  handle(IpcChannels.aiCommandRun, AiCommandRunRequestSchema, (request, event) => services.ai.runCommand(request, event.sender));
  handle(IpcChannels.aiIndexStatus, AiIndexStatusRequestSchema, (request) => services.ai.indexStatus(request));
  handle(IpcChannels.aiIndexRebuild, AiIndexRebuildRequestSchema, (request) => services.ai.rebuildIndex(request));
  handle(IpcChannels.aiIndexClear, AiIndexClearRequestSchema, (request) => services.ai.clearIndex(request));
  handle(IpcChannels.aiIndexCancel, AiIndexCancelRequestSchema, (request) => services.ai.cancelIndex(request));
  handle(IpcChannels.aiWebSearch, AiWebSearchRequestSchema, () => services.ai.webSearch());
  handle(IpcChannels.aiAttachmentExtract, AiAttachmentExtractRequestSchema, (request) => services.ai.extractAttachment(request));
  handle(IpcChannels.aiChangePlanPrepare, AiChangePlanPrepareRequestSchema, (request) => services.ai.prepareChangePlan(request));
  handle(IpcChannels.aiChangePlanApply, AiChangePlanApplyRequestSchema, (request) => services.ai.applyChangePlan(request));
  handle(IpcChannels.aiInsights, AiInsightsRequestSchema, (request) => services.ai.insights(request));
  handle(IpcChannels.pluginsList, EmptySchema, () => services.plugins.discover());
  handle(IpcChannels.pluginsSetEnabled, PluginSetEnabledRequestSchema, (request) => services.plugins.setEnabled(request.pluginId, request.enabled));
  handle(IpcChannels.pluginsAcceptPermissions, PluginAcceptPermissionsRequestSchema, (request) => services.plugins.acceptPermissions(request.pluginId));
  handle(IpcChannels.pluginsRecordFailure, PluginRecordFailureRequestSchema, (request) => services.plugins.recordFailure(request.pluginId, request.message));
  handle(IpcChannels.extensionsSyncMenus, ExtensionsSyncMenusRequestSchema, (request) => {
    services.syncExtensionMenus(request.menus);
    return { ok: true };
  });
  handle(IpcChannels.diagnosticsOpenLogs, EmptySchema, () => shell.openPath(services.diagnostics.logRoot));
}

function handle<TInput, TResult>(
  channel: string,
  schema: ZodType<TInput>,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    const input = schema.parse(raw ?? {});
    return handler(input, event);
  });
}
