import { contextBridge, ipcRenderer } from "electron";

import { IpcChannels } from "../shared/channels";
import { isPreloadIpcResult } from "./ipcResult";
import {
  type AttachmentImportRequest,
  type AttachmentPickImageRequest,
  type AiModelsListRequest,
  type AiEmbeddingTestRequest,
  type AiProviderTestRequest,
  type AiRunCancelRequest,
  type AiRunStartRequest,
  type AiTaskApprovalRequest,
  type AiTaskCancelRequest,
  type AiTaskReadRequest,
  type AiTaskRejectRequest,
  type AiTaskResumeRequest,
  type AiTaskStartRequest,
  type AiTaskUndoWriteRequest,
  type AiSecretClearRequest,
  type AiSecretGetRequest,
  type AiSecretSetRequest,
  type AiSemanticIndexRequest,
  type AiSettingsSetRequest,
  type ClipboardWriteRichRequest,
  type DocumentParseRequest,
  type ExtensionsSyncMenusRequest,
  type ExportDocumentRequest,
  type ExternalFileReadRequest,
  type ExternalFileWriteAtomicRequest,
  type FileCreateRequest,
  type FileHistoryCreateRequest,
  type FileHistoryListRequest,
  type FileHistoryReadRequest,
  type FileListTreeRequest,
  type FileReadRequest,
  type FileRenameRequest,
  type FileRenamePreviewRequest,
  type FileResourceActionRequest,
  type FileTrashRequest,
  type FileWriteBinaryAtomicRequest,
  type FileWriteAtomicRequest,
  type GraphBacklinksRequest,
  type PluginAcceptPermissionsRequest,
  type PluginRecordFailureRequest,
  type PluginSetEnabledRequest,
  type SearchQueryRequest,
  type SettingsSetRequest,
  type WorkspaceOpenRequest,
  type WorkspaceListTagsRequest,
  type WorkspaceRemoveRecentRequest,
  type WorkspaceSwitchRequest
} from "../shared/ipc";
import type { AiModelDescriptor, AiProviderTestResult, AiRunEvent, AiRunStartResponse, AiSecretGetResponse, AiSemanticIndexResult, AiSemanticIndexStatus, AiSettingsPublic, AiTaskSnapshot, AiTaskStartResponse, AiTaskSummary } from "../shared/ai";
import type { PluginDescriptor } from "../shared/extensions";
import type { PluginRpcRequest, PluginRpcResponse, PluginSessionDescriptor } from "../shared/plugins";
import type {
  ExternalDocumentChangedEvent,
  ExternalDocumentDraft,
  ExternalDocumentReadResponse,
  ExternalDocumentSaveRequest,
  ExternalDocumentSaveResponse,
  ExternalFolderSession,
  RecentExternalFile,
  WindowDocumentState
} from "../shared/externalDocuments";
import type {
  LocalGraphResponse,
  DocumentDraft,
  PropertyMutationRequest,
  PropertyMutationResponse,
  SavedSearch,
  UnifiedSearchQuery,
  UnifiedSearchResponse,
  TagRenameApplyRequest,
  TagRenameApplyResponse,
  TagRenamePreview,
  TagRenamePreviewRequest,
  WorkspaceProbeResult,
  WorkspaceHealthSnapshot,
  WorkspaceSessionSnapshot,
  WikiLinkTarget
} from "../shared/contracts";
import type {
  AppSettings,
  BacklinksResponse,
  FileBinaryReadResponse,
  FileHistoryEntry,
  FileHistoryReadResponse,
  FileReadResponse,
  FileTreeNode,
  FileWriteResponse,
  RenameReferencePreview,
  ParsedDocument,
  RecentWorkspace,
  SearchQueryResponse,
  WorkspaceIndexedEvent,
  WorkspaceInfo
} from "../shared/types";

type Unsubscribe = () => void;

export interface NoliaApi {
  workspace: {
    bootstrap: () => Promise<{
      activeWorkspace?: WorkspaceInfo;
      recentWorkspaces: RecentWorkspace[];
      settings: AppSettings;
      appInfo?: {
        platform: NodeJS.Platform;
        pluginDirectory: string;
        logsDirectory: string;
      };
    }>;
    open: (request?: WorkspaceOpenRequest) => Promise<WorkspaceInfo | undefined>;
    probe?: (request?: { path?: string }) => Promise<WorkspaceProbeResult | undefined>;
    create: (request?: WorkspaceOpenRequest) => Promise<WorkspaceInfo | undefined>;
    listRecent: () => Promise<RecentWorkspace[]>;
    removeRecent?: (request: WorkspaceRemoveRecentRequest) => Promise<RecentWorkspace[]>;
    listTags: (request: WorkspaceListTagsRequest) => Promise<Array<{ name: string; displayName: string; count: number }>>;
    listLinkTargets?: (request: { workspaceId: string }) => Promise<WikiLinkTarget[]>;
    previewTagRename?: (request: TagRenamePreviewRequest) => Promise<TagRenamePreview>;
    applyTagRename?: (request: TagRenameApplyRequest) => Promise<TagRenameApplyResponse>;
    switch: (request: WorkspaceSwitchRequest) => Promise<{ ok: boolean; restoredState?: WorkspaceInfo }>;
    close: () => Promise<void>;
    readSession?: (request: { workspaceId: string }) => Promise<WorkspaceSessionSnapshot | undefined>;
    writeSession?: (request: { workspaceId: string; session: WorkspaceSessionSnapshot }) => Promise<{ ok: boolean }>;
    health?: (request: { workspaceId: string }) => Promise<WorkspaceHealthSnapshot>;
  };
  file: {
    listTree: (request: FileListTreeRequest) => Promise<{ nodes: FileTreeNode[] }>;
    read: (request: FileReadRequest) => Promise<FileReadResponse>;
    readBinary?: (request: FileReadRequest) => Promise<FileBinaryReadResponse>;
    writeAtomic: (request: FileWriteAtomicRequest) => Promise<FileWriteResponse>;
    writeBinaryAtomic?: (request: FileWriteBinaryAtomicRequest) => Promise<FileWriteResponse>;
    listHistory?: (request: FileHistoryListRequest) => Promise<{ entries: FileHistoryEntry[] }>;
    readHistory?: (request: FileHistoryReadRequest) => Promise<FileHistoryReadResponse | undefined>;
    createHistorySnapshot?: (request: FileHistoryCreateRequest) => Promise<{ entry?: FileHistoryEntry }>;
    create: (request: FileCreateRequest) => Promise<{ ok: boolean; affectedPaths: string[] }>;
    rename: (request: FileRenameRequest) => Promise<{ ok: boolean; affectedPaths: string[] }>;
    previewRename?: (request: FileRenamePreviewRequest) => Promise<RenameReferencePreview>;
    trash: (request: FileTrashRequest) => Promise<{ ok: boolean; affectedPaths: string[] }>;
    openExternal?: (request: FileResourceActionRequest) => Promise<{ ok: boolean; error?: string }>;
    revealInFinder?: (request: FileResourceActionRequest) => Promise<{ ok: boolean }>;
  };
  externalFile?: {
    consumePendingOpen: () => Promise<string[]>;
    pick?: () => Promise<{ filePaths: string[] }>;
    read: (request: ExternalFileReadRequest) => Promise<ExternalDocumentReadResponse>;
    writeAtomic: (request: ExternalFileWriteAtomicRequest) => Promise<FileWriteResponse>;
    save?: (request: ExternalDocumentSaveRequest) => Promise<ExternalDocumentSaveResponse>;
    readDraft?: (request: { filePath: string }) => Promise<ExternalDocumentDraft | undefined>;
    writeDraft?: (request: Omit<ExternalDocumentDraft, "updatedAt">) => Promise<{ ok: true }>;
    deleteDraft?: (request: { filePath: string }) => Promise<{ ok: true }>;
    listRecent?: () => Promise<RecentExternalFile[]>;
    removeRecent?: (request: { filePath: string }) => Promise<RecentExternalFile[]>;
    openFolder?: (request: { filePath: string }) => Promise<ExternalFolderSession>;
    closeFolder?: (request: { sessionId: string }) => Promise<{ ok: boolean }>;
    resolveLink?: (request: { filePath: string; href: string; folderSessionId?: string }) => Promise<{ filePath?: string; fragment?: string }>;
    pickAttachment?: () => Promise<{ path?: string }>;
    importAttachment?: (request: { documentPath: string; sourcePath: string; baseHash: string }) => Promise<{ assetPath: string; markdown: string; mimeType: string; size: number }>;
    export?: (request: { filePath: string; format: "pdf" | "html" | "markdown"; themeId?: string }) => Promise<{ status: "completed" | "failed"; outputPath?: string; warnings: string[] }>;
  };
  window?: {
    setDocumentState: (state: WindowDocumentState) => Promise<{ ok: true }>;
    confirmClose: () => Promise<{ ok: true }>;
  };
  document: {
    parse: (request: DocumentParseRequest) => Promise<ParsedDocument>;
    mutateProperty?: (request: PropertyMutationRequest) => Promise<PropertyMutationResponse>;
    readDraft?: (request: { workspaceId: string; pathRel: string }) => Promise<DocumentDraft | undefined>;
    writeDraft?: (request: { workspaceId: string; pathRel: string; content: string; baseHash: string; revision: number }) => Promise<{ ok: boolean }>;
    deleteDraft?: (request: { workspaceId: string; pathRel: string }) => Promise<{ ok: boolean }>;
  };
  search: {
    query: (request: SearchQueryRequest) => Promise<SearchQueryResponse>;
    unified?: (request: { workspaceId: string; query: UnifiedSearchQuery }) => Promise<UnifiedSearchResponse>;
    listSaved?: (request: { workspaceId: string }) => Promise<SavedSearch[]>;
    save?: (request: { workspaceId: string; search: SavedSearch }) => Promise<SavedSearch[]>;
    deleteSaved?: (request: { workspaceId: string; searchId: string }) => Promise<SavedSearch[]>;
  };
  graph: {
    getBacklinks: (request: GraphBacklinksRequest) => Promise<BacklinksResponse>;
    getLocal?: (request: { workspaceId: string; pathRel: string; depth?: 1 | 2; limit?: number }) => Promise<LocalGraphResponse>;
  };
  attachment: {
    import: (request: AttachmentImportRequest) => Promise<{
      assetPathRel: string;
      markdown: string;
      mimeType: string;
      size: number;
    }>;
    pickImage: (request: AttachmentPickImageRequest) => Promise<{ path?: string }>;
  };
  export: {
    document: (request: ExportDocumentRequest) => Promise<{
      status: "completed" | "failed";
      outputPath?: string;
      warnings: string[];
    }>;
  };
  clipboard: {
    writeRich: (request: ClipboardWriteRichRequest) => Promise<{ ok: boolean }>;
  };
  settings: {
    get: () => Promise<AppSettings>;
    set: (request: SettingsSetRequest) => Promise<AppSettings>;
  };
  plugins?: {
    list: () => Promise<PluginDescriptor[]>;
    setEnabled: (request: PluginSetEnabledRequest) => Promise<PluginDescriptor[]>;
    acceptPermissions: (request: PluginAcceptPermissionsRequest) => Promise<PluginDescriptor[]>;
    recordFailure: (request: PluginRecordFailureRequest) => Promise<PluginDescriptor[]>;
    openSession?: (request: { pluginId: string }) => Promise<PluginSessionDescriptor>;
    closeSession?: (request: { sessionId: string }) => Promise<{ ok: boolean }>;
    request?: (request: PluginRpcRequest) => Promise<PluginRpcResponse>;
  };
  extensions?: {
    syncMenus: (request: ExtensionsSyncMenusRequest) => Promise<{ ok: boolean }>;
  };
  ai?: {
    getSettings: () => Promise<AiSettingsPublic>;
    setSettings: (request: AiSettingsSetRequest) => Promise<AiSettingsPublic>;
    setApiKey: (request: AiSecretSetRequest) => Promise<AiSettingsPublic>;
    clearApiKey: (request: AiSecretClearRequest) => Promise<AiSettingsPublic>;
    getApiKey: (request: AiSecretGetRequest) => Promise<AiSecretGetResponse>;
    testProvider: (request?: AiProviderTestRequest) => Promise<AiProviderTestResult>;
    listModels: (request?: AiModelsListRequest) => Promise<AiModelDescriptor[]>;
    testEmbedding: (request?: AiEmbeddingTestRequest) => Promise<AiProviderTestResult>;
    semanticIndexStatus: (request: AiSemanticIndexRequest) => Promise<AiSemanticIndexStatus>;
    updateSemanticIndex: (request: AiSemanticIndexRequest) => Promise<AiSemanticIndexResult>;
    resetSemanticIndex: (request: AiSemanticIndexRequest) => Promise<AiSemanticIndexResult>;
    startRun: (request: AiRunStartRequest) => Promise<AiRunStartResponse>;
    cancelRun: (request: AiRunCancelRequest) => Promise<{ ok: boolean }>;
    startTask: (request: AiTaskStartRequest) => Promise<AiTaskStartResponse>;
    listTasks: () => Promise<AiTaskSummary[]>;
    readTask: (request: AiTaskReadRequest) => Promise<AiTaskSnapshot | undefined>;
    resumeTask: (request: AiTaskResumeRequest) => Promise<AiTaskSummary | undefined>;
    cancelTask: (request: AiTaskCancelRequest) => Promise<{ ok: boolean }>;
    approveProposal: (request: AiTaskApprovalRequest) => Promise<AiTaskSnapshot | undefined>;
    rejectProposal: (request: AiTaskRejectRequest) => Promise<AiTaskSnapshot | undefined>;
    undoWrite: (request: AiTaskUndoWriteRequest) => Promise<AiTaskSnapshot | undefined>;
    onRunEvent: (listener: (event: AiRunEvent) => void) => Unsubscribe;
  };
  diagnostics: {
    openLogs: () => Promise<string>;
  };
  events: {
    onAppCommand: (listener: (command: string) => void) => Unsubscribe;
    onExternalFileOpen: (listener: (filePath: string) => void) => Unsubscribe;
    onExternalFileChanged?: (listener: (event: ExternalDocumentChangedEvent) => void) => Unsubscribe;
    onWindowCloseRequest?: (listener: () => void) => Unsubscribe;
    onWorkspaceIndexed?: (listener: (event: WorkspaceIndexedEvent) => void) => Unsubscribe;
  };
}

const api: NoliaApi = {
  workspace: {
    bootstrap: () => invoke(IpcChannels.workspaceBootstrap, {}),
    probe: (request = {}) => invoke(IpcChannels.workspaceProbe, request),
    open: (request = {}) => invoke(IpcChannels.workspaceOpen, request),
    create: (request = {}) => invoke(IpcChannels.workspaceCreate, request),
    listRecent: () => invoke(IpcChannels.workspaceListRecent, {}),
    removeRecent: (request) => invoke(IpcChannels.workspaceRemoveRecent, request),
    listTags: (request) => invoke(IpcChannels.workspaceListTags, request),
    listLinkTargets: (request) => invoke(IpcChannels.workspaceListLinkTargets, request),
    previewTagRename: (request) => invoke(IpcChannels.workspaceTagRenamePreview, request),
    applyTagRename: (request) => invoke(IpcChannels.workspaceTagRenameApply, request),
    switch: (request) => invoke(IpcChannels.workspaceSwitch, request),
    close: () => invoke(IpcChannels.workspaceClose, {}),
    readSession: (request) => invoke(IpcChannels.workspaceSessionRead, request),
    writeSession: (request) => invoke(IpcChannels.workspaceSessionWrite, request),
    health: (request) => invoke(IpcChannels.workspaceHealth, request)
  },
  file: {
    listTree: (request) => invoke(IpcChannels.fileListTree, request),
    read: (request) => invoke(IpcChannels.fileRead, request),
    readBinary: (request) => invoke(IpcChannels.fileReadBinary, request),
    writeAtomic: (request) => invoke(IpcChannels.fileWriteAtomic, request),
    writeBinaryAtomic: (request) => invoke(IpcChannels.fileWriteBinaryAtomic, request),
    listHistory: (request) => invoke(IpcChannels.fileHistoryList, request),
    readHistory: (request) => invoke(IpcChannels.fileHistoryRead, request),
    createHistorySnapshot: (request) => invoke(IpcChannels.fileHistoryCreate, request),
    create: (request) => invoke(IpcChannels.fileCreate, request),
    rename: (request) => invoke(IpcChannels.fileRename, request),
    previewRename: (request) => invoke(IpcChannels.fileRenamePreview, request),
    trash: (request) => invoke(IpcChannels.fileTrash, request),
    openExternal: (request) => invoke(IpcChannels.fileOpenExternal, request),
    revealInFinder: (request) => invoke(IpcChannels.fileRevealInFinder, request)
  },
  externalFile: {
    consumePendingOpen: () => invoke(IpcChannels.externalFileConsumePendingOpen, {}),
    pick: () => invoke(IpcChannels.externalFilePick, {}),
    read: (request) => invoke(IpcChannels.externalFileRead, request),
    writeAtomic: (request) => invoke(IpcChannels.externalFileWriteAtomic, request),
    save: (request) => invoke(IpcChannels.externalFileSave, request),
    readDraft: (request) => invoke(IpcChannels.externalFileDraftRead, request),
    writeDraft: (request) => invoke(IpcChannels.externalFileDraftWrite, request),
    deleteDraft: (request) => invoke(IpcChannels.externalFileDraftDelete, request),
    listRecent: () => invoke(IpcChannels.externalFileRecentList, {}),
    removeRecent: (request) => invoke(IpcChannels.externalFileRecentRemove, request),
    openFolder: (request) => invoke(IpcChannels.externalFileFolderOpen, request),
    closeFolder: (request) => invoke(IpcChannels.externalFileFolderClose, request),
    resolveLink: (request) => invoke(IpcChannels.externalFileResolveLink, request),
    pickAttachment: () => invoke(IpcChannels.externalFileAttachmentPick, {}),
    importAttachment: (request) => invoke(IpcChannels.externalFileAttachmentImport, request),
    export: (request) => invoke(IpcChannels.externalFileExport, request)
  },
  window: {
    setDocumentState: (state) => invoke(IpcChannels.windowDocumentStateSet, state),
    confirmClose: () => invoke(IpcChannels.windowCloseConfirm, {})
  },
  document: {
    parse: (request) => invoke(IpcChannels.documentParse, request),
    mutateProperty: (request) => invoke(IpcChannels.documentMutateProperty, request),
    readDraft: (request) => invoke(IpcChannels.documentDraftRead, request),
    writeDraft: (request) => invoke(IpcChannels.documentDraftWrite, request),
    deleteDraft: (request) => invoke(IpcChannels.documentDraftDelete, request)
  },
  search: {
    query: (request) => invoke(IpcChannels.searchQuery, request),
    unified: (request) => invoke(IpcChannels.searchUnified, request),
    listSaved: (request) => invoke(IpcChannels.searchSavedList, request),
    save: (request) => invoke(IpcChannels.searchSavedSave, request),
    deleteSaved: (request) => invoke(IpcChannels.searchSavedDelete, request)
  },
  graph: {
    getBacklinks: (request) => invoke(IpcChannels.graphGetBacklinks, request),
    getLocal: (request) => invoke(IpcChannels.graphGetLocal, request)
  },
  attachment: {
    import: (request) => invoke(IpcChannels.attachmentImport, request),
    pickImage: (request) => invoke(IpcChannels.attachmentPickImage, request)
  },
  export: {
    document: (request) => invoke(IpcChannels.exportDocument, request)
  },
  clipboard: {
    writeRich: (request) => invoke(IpcChannels.clipboardWriteRich, request)
  },
  settings: {
    get: () => invoke(IpcChannels.settingsGet, {}),
    set: (request) => invoke(IpcChannels.settingsSet, request)
  },
  plugins: {
    list: () => invoke(IpcChannels.pluginsList, {}),
    setEnabled: (request) => invoke(IpcChannels.pluginsSetEnabled, request),
    acceptPermissions: (request) => invoke(IpcChannels.pluginsAcceptPermissions, request),
    recordFailure: (request) => invoke(IpcChannels.pluginsRecordFailure, request),
    openSession: (request) => invoke(IpcChannels.pluginSessionOpen, request),
    closeSession: (request) => invoke(IpcChannels.pluginSessionClose, request),
    request: (request) => invoke(IpcChannels.pluginRpcRequest, request)
  },
  extensions: {
    syncMenus: (request) => invoke(IpcChannels.extensionsSyncMenus, request)
  },
  ai: {
    getSettings: () => invoke(IpcChannels.aiSettingsGet, {}),
    setSettings: (request) => invoke(IpcChannels.aiSettingsSet, request),
    setApiKey: (request) => invoke(IpcChannels.aiSecretSet, request),
    clearApiKey: (request) => invoke(IpcChannels.aiSecretClear, request),
    getApiKey: (request) => invoke(IpcChannels.aiSecretGet, request),
    testProvider: (request = {}) => invoke(IpcChannels.aiProviderTest, request),
    listModels: (request = {}) => invoke(IpcChannels.aiModelsList, request),
    testEmbedding: (request = {}) => invoke(IpcChannels.aiEmbeddingTest, request),
    semanticIndexStatus: (request) => invoke(IpcChannels.aiSemanticIndexStatus, request),
    updateSemanticIndex: (request) => invoke(IpcChannels.aiSemanticIndexUpdate, request),
    resetSemanticIndex: (request) => invoke(IpcChannels.aiSemanticIndexReset, request),
    startRun: (request) => invoke(IpcChannels.aiRunStart, request),
    cancelRun: (request) => invoke(IpcChannels.aiRunCancel, request),
    startTask: (request) => invoke(IpcChannels.aiTaskStart, request),
    listTasks: () => invoke(IpcChannels.aiTaskList, {}),
    readTask: (request) => invoke(IpcChannels.aiTaskRead, request),
    resumeTask: (request) => invoke(IpcChannels.aiTaskResume, request),
    cancelTask: (request) => invoke(IpcChannels.aiTaskCancel, request),
    approveProposal: (request) => invoke(IpcChannels.aiTaskApproveProposal, request),
    rejectProposal: (request) => invoke(IpcChannels.aiTaskRejectProposal, request),
    undoWrite: (request) => invoke(IpcChannels.aiTaskUndoWrite, request),
    onRunEvent: (listener) => subscribe(IpcChannels.aiRunEvent, listener)
  },
  diagnostics: {
    openLogs: () => invoke(IpcChannels.diagnosticsOpenLogs, {})
  },
  events: {
    onAppCommand: (listener) => subscribe("app.command", listener),
    onExternalFileOpen: (listener) => subscribe("file.openExternal", listener),
    onExternalFileChanged: (listener) => subscribe(IpcChannels.externalFileChanged, listener),
    onWindowCloseRequest: (listener) => subscribe(IpcChannels.windowCloseRequest, listener),
    onWorkspaceIndexed: (listener) => subscribe("workspace.indexed", listener)
  }
};

contextBridge.exposeInMainWorld("nolia", api);
if (process.env.NOLIA_E2E_TEST_HOOKS === "1") {
  contextBridge.exposeInMainWorld("__noliaE2e", {
    emitAiRunEvent: (event: unknown) => invoke("ai.test.emitRunEvent", event)
  });
}

async function invoke<T>(channel: string, payload: unknown): Promise<T> {
  const response = await ipcRenderer.invoke(channel, payload) as unknown;
  if (!isPreloadIpcResult(response)) {
    return response as T;
  }
  if (response.ok) {
    return response.data as T;
  }
  const error = new Error(response.error.message) as Error & { code?: string; operationId?: string; retryable?: boolean };
  error.code = response.error.code;
  error.operationId = response.error.operationId;
  error.retryable = response.error.retryable;
  throw error;
}

function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.off(channel, handler);
  };
}
