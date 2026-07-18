import { BrowserWindow, clipboard, shell, ipcMain, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import type { ZodType } from "zod";
import { ZodError } from "zod";

import {
  AttachmentImportRequestSchema,
  AttachmentPickImageRequestSchema,
  AiModelsListRequestSchema,
  AiEmbeddingTestRequestSchema,
  AiTaskApprovalRequestSchema,
  AiTaskCancelRequestSchema,
  AiTaskReadRequestSchema,
  AiTaskRejectRequestSchema,
  AiTaskResumeRequestSchema,
  AiTaskStartRequestSchema,
  AiTaskUndoWriteRequestSchema,
  AiProviderTestRequestSchema,
  AiRunCancelRequestSchema,
  AiRunStartRequestSchema,
  AiSecretClearRequestSchema,
  AiSecretGetRequestSchema,
  AiSecretSetRequestSchema,
  AiSemanticIndexRequestSchema,
  AiSettingsSetRequestSchema,
  ClipboardWriteRichRequestSchema,
  DocumentParseRequestSchema,
  EmptySchema,
  ExportDocumentRequestSchema,
  ExternalAttachmentImportRequestSchema,
  ExternalDocumentDraftDeleteRequestSchema,
  ExternalDocumentDraftReadRequestSchema,
  ExternalDocumentDraftWriteRequestSchema,
  ExternalDocumentSaveRequestSchema,
  ExternalExportRequestSchema,
  ExtensionsSyncMenusRequestSchema,
  ExternalFilePickRequestSchema,
  ExternalFileReadRequestSchema,
  ExternalFileWriteAtomicRequestSchema,
  ExternalFolderCloseRequestSchema,
  ExternalFolderOpenRequestSchema,
  ExternalLinkResolveRequestSchema,
  ExternalRecentRemoveRequestSchema,
  FileCreateRequestSchema,
  FileHistoryCreateRequestSchema,
  FileHistoryListRequestSchema,
  FileHistoryReadRequestSchema,
  FileListTreeRequestSchema,
  FileReadRequestSchema,
  FileRenameRequestSchema,
  FileRenamePreviewRequestSchema,
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
  WorkspaceSwitchRequestSchema,
  WindowDocumentStateSetRequestSchema
} from "../shared/ipc";
import { applyFrontmatterMutation, parseMarkdown } from "../shared/markdown";
import { AttachmentService } from "./services/attachmentService";
import { AiService } from "./ai/aiService";
import { AiTaskService } from "./ai/aiTaskService";
import { AiEmbeddingService } from "./ai/embeddingService";
import { AiSettingsService } from "./ai/aiSettingsService";
import { DiagnosticsService } from "./services/diagnosticsService";
import { ExportService } from "./services/exportService";
import { ExternalDocumentService } from "./services/externalDocumentService";
import { FileSystemService } from "./services/fileSystemService";
import { PluginService } from "./services/pluginService";
import { PluginBroker } from "./services/pluginBroker";
import { PerformanceLogService } from "./services/performanceLogService";
import { SettingsService } from "./services/settingsService";
import { WorkspaceService } from "./services/workspaceService";
import type { MenuContribution } from "../shared/extensions";
import {
  LocalGraphRequestSchema,
  DocumentDraftDeleteRequestSchema,
  DocumentDraftReadRequestSchema,
  DocumentDraftWriteRequestSchema,
  PropertyMutationRequestSchema,
  SavedSearchDeleteRequestSchema,
  SavedSearchListRequestSchema,
  SavedSearchSaveRequestSchema,
  WorkspaceProbeRequestSchema,
  WorkspaceHealthRequestSchema,
  WorkspaceListLinkTargetsRequestSchema,
  WorkspaceSessionReadRequestSchema,
  WorkspaceSessionWriteRequestSchema,
  UnifiedSearchRequestSchema,
  TagRenameApplyRequestSchema,
  TagRenamePreviewRequestSchema,
  type IpcResult,
  type NoliaErrorCode,
  type SavedSearch,
  type UnifiedSearchResult,
  type WorkspaceSessionSnapshot
} from "../shared/contracts";
import { PluginRpcRequestSchema, PluginSessionCloseRequestSchema, PluginSessionOpenRequestSchema } from "../shared/plugins";

interface IpcServices {
  workspaces: WorkspaceService;
  files: FileSystemService;
  attachments: AttachmentService;
  exporter: ExportService;
  externalDocuments: ExternalDocumentService;
  settings: SettingsService;
  diagnostics: DiagnosticsService;
  performanceLog: PerformanceLogService;
  plugins: PluginService;
  pluginBroker: PluginBroker;
  ai: AiService;
  aiTasks: AiTaskService;
  aiSettings: AiSettingsService;
  syncExtensionMenus: (menus: MenuContribution[]) => void;
  setWindowDocumentState: (event: IpcMainInvokeEvent, state: import("../shared/externalDocuments").WindowDocumentState) => void;
  confirmWindowClose: (event: IpcMainInvokeEvent) => void;
}

export function registerIpcHandlers(services: IpcServices): void {
  const embeddings = new AiEmbeddingService();
  handle(IpcChannels.workspaceBootstrap, EmptySchema, async () => ({
    ...(await services.workspaces.bootstrap()),
    appInfo: {
      platform: process.platform,
      pluginDirectory: services.plugins.pluginsRoot,
      logsDirectory: services.diagnostics.logRoot
    }
  }));
  handle(IpcChannels.workspaceProbe, WorkspaceProbeRequestSchema, (request, event) =>
    services.workspaces.probeWorkspace(request.path, BrowserWindow.fromWebContents(event.sender) ?? undefined)
  );
  handle(IpcChannels.workspaceOpen, WorkspaceOpenRequestSchema, (request, event) =>
    services.workspaces.openWorkspace(request, BrowserWindow.fromWebContents(event.sender) ?? undefined)
  );
  handle(IpcChannels.workspaceCreate, WorkspaceOpenRequestSchema, (request, event) =>
    services.workspaces.createWorkspace(request, BrowserWindow.fromWebContents(event.sender) ?? undefined)
  );
  handle(IpcChannels.workspaceListRecent, EmptySchema, () => services.workspaces.listRecentWorkspaces());
  handle(IpcChannels.workspaceRemoveRecent, WorkspaceRemoveRecentRequestSchema, (request) => services.workspaces.removeRecentWorkspace(request));
  handle(IpcChannels.workspaceListTags, WorkspaceListTagsRequestSchema, async (request) => services.performanceLog.measure("workspace.tags.list", async () => {
    const runtime = services.workspaces.requireWorkspace(request.workspaceId);
    await runtime.indexTask;
    return runtime.db.listTags();
  }));
  handle(IpcChannels.workspaceListLinkTargets, WorkspaceListLinkTargetsRequestSchema, async (request) => services.performanceLog.measure("workspace.linkTargets.list", async () => {
    const runtime = services.workspaces.requireWorkspace(request.workspaceId);
    await runtime.indexTask;
    return runtime.db.listLinkTargets();
  }));
  handle(IpcChannels.workspaceTagRenamePreview, TagRenamePreviewRequestSchema, (request) => services.files.previewTagRename(request));
  handle(IpcChannels.workspaceTagRenameApply, TagRenameApplyRequestSchema, (request) => services.files.applyTagRename(request));
  handle(IpcChannels.workspaceSwitch, WorkspaceSwitchRequestSchema, (request) => services.workspaces.switchWorkspace(request));
  handle(IpcChannels.workspaceClose, EmptySchema, () => services.workspaces.closeActiveWorkspace());
  handle(IpcChannels.workspaceSessionRead, WorkspaceSessionReadRequestSchema, (request) =>
    services.workspaces.requireWorkspace(request.workspaceId).db.readSession()
  );
  handle(IpcChannels.workspaceSessionWrite, WorkspaceSessionWriteRequestSchema, (request) => {
    const session = request.session as WorkspaceSessionSnapshot;
    services.workspaces.requireWorkspace(request.workspaceId).db.writeSession(session);
    return { ok: true };
  });
  handle(IpcChannels.workspaceHealth, WorkspaceHealthRequestSchema, (request) => services.workspaces.getHealth(request.workspaceId));

  handle(IpcChannels.fileListTree, FileListTreeRequestSchema, (request) => services.performanceLog.measure("workspace.tree.list", () => services.files.listTree(request)));
  handle(IpcChannels.fileRead, FileReadRequestSchema, (request) => services.files.readFile(request));
  handle(IpcChannels.fileReadBinary, FileReadRequestSchema, (request) => services.files.readBinaryFile(request));
  handle(IpcChannels.fileWriteAtomic, FileWriteAtomicRequestSchema, (request) => services.files.writeAtomic(request));
  handle(IpcChannels.fileWriteBinaryAtomic, FileWriteBinaryAtomicRequestSchema, (request) => services.files.writeBinaryAtomic(request));
  handle(IpcChannels.fileHistoryList, FileHistoryListRequestSchema, (request) => services.files.listHistory(request));
  handle(IpcChannels.fileHistoryRead, FileHistoryReadRequestSchema, (request) => services.files.readHistory(request));
  handle(IpcChannels.fileHistoryCreate, FileHistoryCreateRequestSchema, (request) => services.files.createHistorySnapshot(request));
  handle(IpcChannels.fileCreate, FileCreateRequestSchema, (request) => services.files.create(request));
  handle(IpcChannels.fileRename, FileRenameRequestSchema, (request) => services.files.rename(request));
  handle(IpcChannels.fileRenamePreview, FileRenamePreviewRequestSchema, (request) => services.files.previewRename(request));
  handle(IpcChannels.fileTrash, FileTrashRequestSchema, (request) => services.files.trash(request));
  handle(IpcChannels.fileOpenExternal, FileResourceActionRequestSchema, (request) => services.files.openExternal(request));
  handle(IpcChannels.fileRevealInFinder, FileResourceActionRequestSchema, (request) => services.files.revealInFinder(request));
  handle(IpcChannels.externalFileRead, ExternalFileReadRequestSchema, (request) => services.externalDocuments.read(request.filePath));
  handle(IpcChannels.externalFileWriteAtomic, ExternalFileWriteAtomicRequestSchema, (request) => services.files.writeExternalAtomic(request));
  handle(IpcChannels.externalFilePick, ExternalFilePickRequestSchema, (_request, event) =>
    services.externalDocuments.pickFile(BrowserWindow.fromWebContents(event.sender) ?? undefined)
  );
  handle(IpcChannels.externalFileSave, ExternalDocumentSaveRequestSchema, (request, event) =>
    services.externalDocuments.save(request, BrowserWindow.fromWebContents(event.sender) ?? undefined)
  );
  handle(IpcChannels.externalFileDraftRead, ExternalDocumentDraftReadRequestSchema, (request) => services.externalDocuments.readDraft(request.filePath));
  handle(IpcChannels.externalFileDraftWrite, ExternalDocumentDraftWriteRequestSchema, (request) => services.externalDocuments.writeDraft(request));
  handle(IpcChannels.externalFileDraftDelete, ExternalDocumentDraftDeleteRequestSchema, (request) => services.externalDocuments.deleteDraft(request.filePath));
  handle(IpcChannels.externalFileRecentList, EmptySchema, () => services.externalDocuments.listRecent());
  handle(IpcChannels.externalFileRecentRemove, ExternalRecentRemoveRequestSchema, (request) => services.externalDocuments.removeRecent(request.filePath));
  handle(IpcChannels.externalFileFolderOpen, ExternalFolderOpenRequestSchema, (request) => services.externalDocuments.openFolder(request.filePath));
  handle(IpcChannels.externalFileFolderClose, ExternalFolderCloseRequestSchema, (request) => services.externalDocuments.closeFolder(request.sessionId));
  handle(IpcChannels.externalFileResolveLink, ExternalLinkResolveRequestSchema, (request) => services.externalDocuments.resolveLink(request.filePath, request.href, request.folderSessionId));
  handle(IpcChannels.externalFileAttachmentPick, EmptySchema, (_request, event) => services.externalDocuments.pickImage(BrowserWindow.fromWebContents(event.sender) ?? undefined));
  handle(IpcChannels.externalFileAttachmentImport, ExternalAttachmentImportRequestSchema, (request) => services.externalDocuments.importAttachment(request.documentPath, request.sourcePath, request.baseHash));
  handle(IpcChannels.externalFileExport, ExternalExportRequestSchema, (request, event) => services.exporter.exportExternalDocument(request, BrowserWindow.fromWebContents(event.sender) ?? undefined));
  handle(IpcChannels.windowDocumentStateSet, WindowDocumentStateSetRequestSchema, (request, event) => {
    services.setWindowDocumentState(event, request);
    return { ok: true };
  });
  handle(IpcChannels.windowCloseConfirm, EmptySchema, (_request, event) => {
    services.confirmWindowClose(event);
    return { ok: true };
  });

  handle(IpcChannels.documentParse, DocumentParseRequestSchema, (request) => parseMarkdown(request.content, request.pathRel));
  handle(IpcChannels.documentMutateProperty, PropertyMutationRequestSchema, async (request) => {
    const current = await services.files.readFile(request);
    if (current.sha256 !== request.baseHash) {
      throw new Error(`Document conflict: ${request.pathRel}`);
    }
    const content = applyFrontmatterMutation(current.content, request.mutation);
    await services.files.createHistorySnapshot({ workspaceId: request.workspaceId, pathRel: request.pathRel, reason: "manual", content: current.content });
    const saved = await services.files.writeAtomic({ workspaceId: request.workspaceId, pathRel: request.pathRel, content, baseHash: current.sha256, createSnapshot: false });
    if (saved.status !== "saved" || !saved.sha256) {
      throw new Error(`Document property update failed: ${saved.status}`);
    }
    return { content, sha256: saved.sha256, parsed: parseMarkdown(content, request.pathRel), revision: request.revision + 1 };
  });
  handle(IpcChannels.documentDraftRead, DocumentDraftReadRequestSchema, (request) => services.workspaces.requireWorkspace(request.workspaceId).db.readDraft(request.pathRel));
  handle(IpcChannels.documentDraftWrite, DocumentDraftWriteRequestSchema, (request) => {
    services.workspaces.requireWorkspace(request.workspaceId).db.writeDraft({ pathRel: request.pathRel, content: request.content, baseHash: request.baseHash, revision: request.revision, updatedAt: Date.now() });
    return { ok: true };
  });
  handle(IpcChannels.documentDraftDelete, DocumentDraftDeleteRequestSchema, (request) => {
    services.workspaces.requireWorkspace(request.workspaceId).db.deleteDraft(request.pathRel);
    return { ok: true };
  });
  handle(IpcChannels.searchQuery, SearchQueryRequestSchema, (request) => services.performanceLog.measure("search.exact", () => {
    const runtime = services.workspaces.requireWorkspace(request.workspaceId);
    return runtime.db.search(request);
  }, () => ({ resultLimit: request.limit ?? 40 })));
  handle(IpcChannels.searchUnified, UnifiedSearchRequestSchema, async (request) => services.performanceLog.measure("search.unified", async () => {
    const runtime = services.workspaces.requireWorkspace(request.workspaceId);
    const limit = request.query.limit ?? 40;
    const exact = runtime.db.search({
      workspaceId: request.workspaceId,
      query: request.query.text,
      filters: { path: request.query.pathPrefix, tag: request.query.tags?.[0] },
      limit: Math.min(200, Math.max(limit, 60)),
      offset: request.query.offset
    });
    const exactItems: UnifiedSearchResult[] = exact.items.map((item) => ({
      ...item,
      source: "exact",
      matchedFields: request.query.scopes ?? ["title", "body", "path", "tags", "properties", "tasks"]
    }));
    if (request.query.mode === "exact" || !request.query.text.trim()) {
      return { items: exactItems.slice(0, limit), mode: request.query.mode, semanticAvailable: false, indexVersion: exact.indexVersion };
    }
    const settings = services.aiSettings.resolvedEmbeddingSettings();
    const status = runtime.db.semanticIndexStatus(settings);
    if (status.state !== "ready") {
      return { items: exactItems.slice(0, limit), mode: "hybrid" as const, semanticAvailable: false, fallbackReason: status.message ?? "语义索引不可用，已使用精确搜索。", indexVersion: exact.indexVersion };
    }
    try {
      const embedding = await embeddings.embedOne(settings, request.query.text);
      const semantic = runtime.db.semanticSearch(embedding, settings, Math.min(20, limit));
      return { items: reciprocalRankFusion(exactItems, semantic, limit), mode: "hybrid" as const, semanticAvailable: true, indexVersion: exact.indexVersion };
    } catch (error) {
      return { items: exactItems.slice(0, limit), mode: "hybrid" as const, semanticAvailable: false, fallbackReason: error instanceof Error ? error.message : "语义搜索失败，已使用精确搜索。", indexVersion: exact.indexVersion };
    }
  }, () => ({ mode: request.query.mode, resultLimit: request.query.limit ?? 40 })));
  handle(IpcChannels.searchSavedList, SavedSearchListRequestSchema, (request) =>
    services.workspaces.requireWorkspace(request.workspaceId).db.listSavedSearches()
  );
  handle(IpcChannels.searchSavedSave, SavedSearchSaveRequestSchema, (request) =>
    services.workspaces.requireWorkspace(request.workspaceId).db.saveSavedSearch(request.search as SavedSearch)
  );
  handle(IpcChannels.searchSavedDelete, SavedSearchDeleteRequestSchema, (request) =>
    services.workspaces.requireWorkspace(request.workspaceId).db.deleteSavedSearch(request.searchId)
  );
  handle(IpcChannels.graphGetBacklinks, GraphBacklinksRequestSchema, (request) => {
    const runtime = services.workspaces.requireWorkspace(request.workspaceId);
    return runtime.db.getBacklinks(request.pathRel, request.includeUnlinkedMentions);
  });
  handle(IpcChannels.graphGetLocal, LocalGraphRequestSchema, (request) =>
    services.workspaces.requireWorkspace(request.workspaceId).db.getLocalGraph(request.pathRel, request.depth, request.limit)
  );

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
  handle(IpcChannels.pluginsList, EmptySchema, () => services.plugins.discover());
  handle(IpcChannels.pluginsSetEnabled, PluginSetEnabledRequestSchema, (request) => services.plugins.setEnabled(request.pluginId, request.enabled));
  handle(IpcChannels.pluginsAcceptPermissions, PluginAcceptPermissionsRequestSchema, (request) => services.plugins.acceptPermissions(request.pluginId));
  handle(IpcChannels.pluginsRecordFailure, PluginRecordFailureRequestSchema, (request) => services.plugins.recordFailure(request.pluginId, request.message));
  handle(IpcChannels.pluginSessionOpen, PluginSessionOpenRequestSchema, (request) => services.pluginBroker.open(request.pluginId));
  handle(IpcChannels.pluginSessionClose, PluginSessionCloseRequestSchema, (request) => services.pluginBroker.close(request.sessionId));
  handle(IpcChannels.pluginRpcRequest, PluginRpcRequestSchema, (request) => services.pluginBroker.request(request));
  handle(IpcChannels.extensionsSyncMenus, ExtensionsSyncMenusRequestSchema, (request) => {
    services.syncExtensionMenus(request.menus);
    return { ok: true };
  });
  handle(IpcChannels.aiSettingsGet, EmptySchema, () => services.ai.getSettings());
  handle(IpcChannels.aiSettingsSet, AiSettingsSetRequestSchema, (request) => services.ai.setSettings(request));
  handle(IpcChannels.aiSecretSet, AiSecretSetRequestSchema, (request) => services.ai.setSecret(request));
  handle(IpcChannels.aiSecretClear, AiSecretClearRequestSchema, (request) => services.ai.clearSecret(request));
  handle(IpcChannels.aiSecretGet, AiSecretGetRequestSchema, (request) => services.ai.getSecret(request));
  handle(IpcChannels.aiProviderTest, AiProviderTestRequestSchema, (request) => services.ai.testProvider(request));
  handle(IpcChannels.aiModelsList, AiModelsListRequestSchema, (request) => services.ai.listModels(request));
  handle(IpcChannels.aiEmbeddingTest, AiEmbeddingTestRequestSchema, (request) => services.ai.testEmbedding(request));
  handle(IpcChannels.aiSemanticIndexStatus, AiSemanticIndexRequestSchema, (request) => services.ai.semanticIndexStatus(request));
  handle(IpcChannels.aiSemanticIndexUpdate, AiSemanticIndexRequestSchema, (request) => services.ai.updateSemanticIndex(request, false));
  handle(IpcChannels.aiSemanticIndexReset, AiSemanticIndexRequestSchema, (request) => services.ai.updateSemanticIndex(request, true));
  handle(IpcChannels.aiRunStart, AiRunStartRequestSchema, (request) => services.ai.startRun(request));
  handle(IpcChannels.aiRunCancel, AiRunCancelRequestSchema, (request) => services.ai.cancelRun(request));
  handle(IpcChannels.aiTaskStart, AiTaskStartRequestSchema, (request) => services.aiTasks.start(request));
  handle(IpcChannels.aiTaskList, EmptySchema, () => services.aiTasks.list());
  handle(IpcChannels.aiTaskRead, AiTaskReadRequestSchema, (request) => services.aiTasks.read(request));
  handle(IpcChannels.aiTaskResume, AiTaskResumeRequestSchema, (request) => services.aiTasks.resume(request));
  handle(IpcChannels.aiTaskCancel, AiTaskCancelRequestSchema, (request) => services.aiTasks.cancel(request));
  handle(IpcChannels.aiTaskApproveProposal, AiTaskApprovalRequestSchema, (request) => services.aiTasks.approveProposal(request));
  handle(IpcChannels.aiTaskRejectProposal, AiTaskRejectRequestSchema, (request) => services.aiTasks.rejectProposal(request));
  handle(IpcChannels.aiTaskUndoWrite, AiTaskUndoWriteRequestSchema, (request) => services.aiTasks.undoWrite(request));
  if (process.env.NOLIA_E2E_TEST_HOOKS === "1") {
    ipcMain.handle("ai.test.emitRunEvent", (event, payload: unknown) => {
      event.sender.send(IpcChannels.aiRunEvent, payload);
      return { ok: true };
    });
  }
  handle(IpcChannels.diagnosticsOpenLogs, EmptySchema, () => shell.openPath(services.diagnostics.logRoot));
}

function handle<TInput, TResult>(
  channel: string,
  schema: ZodType<TInput>,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TResult> | TResult
): void {
  ipcMain.handle(channel, async (event, raw: unknown) => {
    try {
      const input = schema.parse(raw ?? {});
      const data = await handler(input, event);
      return { ok: true, data } satisfies IpcResult<TResult>;
    } catch (error) {
      return { ok: false, error: operationError(error) } satisfies IpcResult<never>;
    }
  });
}

function operationError(error: unknown): { code: NoliaErrorCode; message: string; operationId: string; retryable: boolean } {
  const operationId = randomUUID();
  if (error instanceof ZodError) {
    return { code: "invalid_request", message: "Invalid request", operationId, retryable: false };
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (error instanceof Error && error.name === "WorkspaceReadOnlyError") {
    return { code: "workspace_read_only", message, operationId, retryable: false };
  }
  if (/not open/i.test(message)) {
    return { code: "workspace_not_open", message, operationId, retryable: true };
  }
  if (/conflict/i.test(message)) {
    return { code: "file_conflict", message, operationId, retryable: true };
  }
  if (/permission|EACCES|EPERM/i.test(message)) {
    return { code: "file_permission_denied", message, operationId, retryable: false };
  }
  return { code: "internal_error", message, operationId, retryable: true };
}

function reciprocalRankFusion(
  exact: UnifiedSearchResult[],
  semantic: Array<{ pathRel: string; title: string; score: number; snippets: string[] }>,
  limit: number
): UnifiedSearchResult[] {
  const merged = new Map<string, UnifiedSearchResult & { exactRank?: number; semanticRank?: number }>();
  exact.forEach((item, index) => merged.set(item.pathRel, { ...item, exactRank: index + 1 }));
  semantic.forEach((item, index) => {
    const current = merged.get(item.pathRel);
    merged.set(item.pathRel, current
      ? { ...current, source: "both", snippets: [...new Set([...current.snippets, ...item.snippets])].slice(0, 2), semanticRank: index + 1 }
      : { ...item, source: "semantic", matchedFields: ["body"], semanticRank: index + 1 });
  });
  return [...merged.values()]
    .map((item) => ({ ...item, score: (item.exactRank ? 1 / (60 + item.exactRank) : 0) + (item.semanticRank ? 1 / (60 + item.semanticRank) : 0) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => ({ pathRel: item.pathRel, title: item.title, score: item.score, source: item.source, snippets: item.snippets, matchedFields: item.matchedFields, modifiedAt: item.modifiedAt }));
}
