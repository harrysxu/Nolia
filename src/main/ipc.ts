import { clipboard, shell, ipcMain } from "electron";
import type { ZodType } from "zod";

import {
  AttachmentImportRequestSchema,
  AttachmentPickImageRequestSchema,
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
import type { MenuContribution } from "../shared/extensions";

interface IpcServices {
  workspaces: WorkspaceService;
  files: FileSystemService;
  attachments: AttachmentService;
  exporter: ExportService;
  settings: SettingsService;
  diagnostics: DiagnosticsService;
  plugins: PluginService;
  syncExtensionMenus: (menus: MenuContribution[]) => void;
}

export function registerIpcHandlers(services: IpcServices): void {
  handle(IpcChannels.workspaceBootstrap, EmptySchema, () => services.workspaces.bootstrap());
  handle(IpcChannels.workspaceOpen, WorkspaceOpenRequestSchema, (request) => services.workspaces.openWorkspace(request));
  handle(IpcChannels.workspaceCreate, WorkspaceOpenRequestSchema, (request) => services.workspaces.createWorkspace(request));
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
  handle(IpcChannels.attachmentPickImage, AttachmentPickImageRequestSchema, (request) => services.attachments.pickImage(request));
  handle(IpcChannels.exportDocument, ExportDocumentRequestSchema, (request) => services.exporter.exportDocument(request));
  handle(IpcChannels.clipboardWriteRich, ClipboardWriteRichRequestSchema, (request) => {
    clipboard.write({ html: request.html, text: request.text });
    return { ok: true };
  });

  handle(IpcChannels.settingsGet, EmptySchema, () => services.settings.getSettings());
  handle(IpcChannels.settingsSet, SettingsSetRequestSchema, (request) => services.settings.setSetting(request.key, request.value));
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
  handler: (input: TInput) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (_event, raw: unknown) => {
    const input = schema.parse(raw ?? {});
    return handler(input);
  });
}
