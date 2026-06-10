import { contextBridge, ipcRenderer } from "electron";

import { IpcChannels } from "../shared/channels";
import {
  type AiAttachmentExtractRequest,
  type AiChangePlanApplyRequest,
  type AiChangePlanPrepareRequest,
  type AiChatCancelRequest,
  type AiChatStartRequest,
  type AiCommandRunRequest,
  type AiCommandsListRequest,
  type AiContextPreviewRequest,
  type AiCredentialDeleteRequest,
  type AiCredentialListRequest,
  type AiCredentialSetRequest,
  type AiIndexCancelRequest,
  type AiIndexClearRequest,
  type AiIndexRebuildRequest,
  type AiIndexStatusRequest,
  type AiInsightsRequest,
  type AiModelsListRequest,
  type AiProviderTestRequest,
  type AiWebSearchRequest,
  type AttachmentImportRequest,
  type AttachmentPickImageRequest,
  type ClipboardWriteRichRequest,
  type DocumentParseRequest,
  type ExtensionsSyncMenusRequest,
  type ExportDocumentRequest,
  type ExternalFileReadRequest,
  type ExternalFileWriteAtomicRequest,
  type FileCreateRequest,
  type FileListTreeRequest,
  type FileReadRequest,
  type FileRenameRequest,
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
import type {
  AiAttachmentExtractResponse,
  AiChangePlanApplyResponse,
  AiChangePlanPrepareResponse,
  AiChatStartResponse,
  AiChatStreamEvent,
  AiCommandDefinition,
  AiContextPreviewResponse,
  AiCredentialSummary,
  AiIndexStatus,
  AiInsightsResponse,
  AiModelsListResponse,
  AiProviderTestResponse,
  AiWebSearchResponse
} from "../shared/ai";
import type { PluginDescriptor } from "../shared/extensions";
import type {
  AppSettings,
  BacklinksResponse,
  FileBinaryReadResponse,
  FileReadResponse,
  FileTreeNode,
  FileWriteResponse,
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
    create: (request?: WorkspaceOpenRequest) => Promise<WorkspaceInfo | undefined>;
    listRecent: () => Promise<RecentWorkspace[]>;
    removeRecent?: (request: WorkspaceRemoveRecentRequest) => Promise<RecentWorkspace[]>;
    listTags: (request: WorkspaceListTagsRequest) => Promise<Array<{ name: string; displayName: string; count: number }>>;
    switch: (request: WorkspaceSwitchRequest) => Promise<{ ok: boolean; restoredState?: WorkspaceInfo }>;
    close: () => Promise<void>;
  };
  file: {
    listTree: (request: FileListTreeRequest) => Promise<{ nodes: FileTreeNode[] }>;
    read: (request: FileReadRequest) => Promise<FileReadResponse>;
    readBinary?: (request: FileReadRequest) => Promise<FileBinaryReadResponse>;
    writeAtomic: (request: FileWriteAtomicRequest) => Promise<FileWriteResponse>;
    writeBinaryAtomic?: (request: FileWriteBinaryAtomicRequest) => Promise<FileWriteResponse>;
    create: (request: FileCreateRequest) => Promise<{ ok: boolean; affectedPaths: string[] }>;
    rename: (request: FileRenameRequest) => Promise<{ ok: boolean; affectedPaths: string[] }>;
    trash: (request: FileTrashRequest) => Promise<{ ok: boolean; affectedPaths: string[] }>;
    openExternal?: (request: FileResourceActionRequest) => Promise<{ ok: boolean; error?: string }>;
    revealInFinder?: (request: FileResourceActionRequest) => Promise<{ ok: boolean }>;
  };
  externalFile?: {
    consumePendingOpen: () => Promise<string[]>;
    read: (request: ExternalFileReadRequest) => Promise<FileReadResponse>;
    writeAtomic: (request: ExternalFileWriteAtomicRequest) => Promise<FileWriteResponse>;
  };
  document: {
    parse: (request: DocumentParseRequest) => Promise<ParsedDocument>;
  };
  search: {
    query: (request: SearchQueryRequest) => Promise<SearchQueryResponse>;
  };
  graph: {
    getBacklinks: (request: GraphBacklinksRequest) => Promise<BacklinksResponse>;
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
  ai?: {
    listCredentials: (request?: AiCredentialListRequest) => Promise<AiCredentialSummary[]>;
    setCredential: (request: AiCredentialSetRequest) => Promise<AiCredentialSummary>;
    deleteCredential: (request: AiCredentialDeleteRequest) => Promise<{ ok: boolean }>;
    testProvider: (request: AiProviderTestRequest) => Promise<AiProviderTestResponse>;
    listModels: (request: AiModelsListRequest) => Promise<AiModelsListResponse>;
    previewContext: (request: AiContextPreviewRequest) => Promise<AiContextPreviewResponse>;
    startChat: (request: AiChatStartRequest) => Promise<AiChatStartResponse>;
    cancelChat: (request: AiChatCancelRequest) => Promise<{ ok: boolean }>;
    listCommands: (request?: AiCommandsListRequest) => Promise<AiCommandDefinition[]>;
    runCommand: (request: AiCommandRunRequest) => Promise<AiChatStartResponse>;
    indexStatus: (request?: AiIndexStatusRequest) => Promise<AiIndexStatus>;
    rebuildIndex: (request: AiIndexRebuildRequest) => Promise<AiIndexStatus>;
    clearIndex: (request: AiIndexClearRequest) => Promise<AiIndexStatus>;
    cancelIndex: (request: AiIndexCancelRequest) => Promise<AiIndexStatus>;
    webSearch: (request: AiWebSearchRequest) => Promise<AiWebSearchResponse>;
    extractAttachment: (request: AiAttachmentExtractRequest) => Promise<AiAttachmentExtractResponse>;
    prepareChangePlan: (request: AiChangePlanPrepareRequest) => Promise<AiChangePlanPrepareResponse>;
    applyChangePlan: (request: AiChangePlanApplyRequest) => Promise<AiChangePlanApplyResponse>;
    insights: (request: AiInsightsRequest) => Promise<AiInsightsResponse>;
    onChatEvent: (listener: (event: AiChatStreamEvent) => void) => Unsubscribe;
  };
  plugins?: {
    list: () => Promise<PluginDescriptor[]>;
    setEnabled: (request: PluginSetEnabledRequest) => Promise<PluginDescriptor[]>;
    acceptPermissions: (request: PluginAcceptPermissionsRequest) => Promise<PluginDescriptor[]>;
    recordFailure: (request: PluginRecordFailureRequest) => Promise<PluginDescriptor[]>;
  };
  extensions?: {
    syncMenus: (request: ExtensionsSyncMenusRequest) => Promise<{ ok: boolean }>;
  };
  diagnostics: {
    openLogs: () => Promise<string>;
  };
  events: {
    onAppCommand: (listener: (command: string) => void) => Unsubscribe;
    onExternalFileOpen: (listener: (filePath: string) => void) => Unsubscribe;
    onWorkspaceIndexed?: (listener: (event: WorkspaceIndexedEvent) => void) => Unsubscribe;
  };
}

const api: NoliaApi = {
  workspace: {
    bootstrap: () => invoke(IpcChannels.workspaceBootstrap, {}),
    open: (request = {}) => invoke(IpcChannels.workspaceOpen, request),
    create: (request = {}) => invoke(IpcChannels.workspaceCreate, request),
    listRecent: () => invoke(IpcChannels.workspaceListRecent, {}),
    removeRecent: (request) => invoke(IpcChannels.workspaceRemoveRecent, request),
    listTags: (request) => invoke(IpcChannels.workspaceListTags, request),
    switch: (request) => invoke(IpcChannels.workspaceSwitch, request),
    close: () => invoke(IpcChannels.workspaceClose, {})
  },
  file: {
    listTree: (request) => invoke(IpcChannels.fileListTree, request),
    read: (request) => invoke(IpcChannels.fileRead, request),
    readBinary: (request) => invoke(IpcChannels.fileReadBinary, request),
    writeAtomic: (request) => invoke(IpcChannels.fileWriteAtomic, request),
    writeBinaryAtomic: (request) => invoke(IpcChannels.fileWriteBinaryAtomic, request),
    create: (request) => invoke(IpcChannels.fileCreate, request),
    rename: (request) => invoke(IpcChannels.fileRename, request),
    trash: (request) => invoke(IpcChannels.fileTrash, request),
    openExternal: (request) => invoke(IpcChannels.fileOpenExternal, request),
    revealInFinder: (request) => invoke(IpcChannels.fileRevealInFinder, request)
  },
  externalFile: {
    consumePendingOpen: () => invoke(IpcChannels.externalFileConsumePendingOpen, {}),
    read: (request) => invoke(IpcChannels.externalFileRead, request),
    writeAtomic: (request) => invoke(IpcChannels.externalFileWriteAtomic, request)
  },
  document: {
    parse: (request) => invoke(IpcChannels.documentParse, request)
  },
  search: {
    query: (request) => invoke(IpcChannels.searchQuery, request)
  },
  graph: {
    getBacklinks: (request) => invoke(IpcChannels.graphGetBacklinks, request)
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
  ai: {
    listCredentials: (request = {}) => invoke(IpcChannels.aiCredentialsList, request),
    setCredential: (request) => invoke(IpcChannels.aiCredentialsSet, request),
    deleteCredential: (request) => invoke(IpcChannels.aiCredentialsDelete, request),
    testProvider: (request) => invoke(IpcChannels.aiProviderTest, request),
    listModels: (request) => invoke(IpcChannels.aiModelsList, request),
    previewContext: (request) => invoke(IpcChannels.aiContextPreview, request),
    startChat: (request) => invoke(IpcChannels.aiChatStart, request),
    cancelChat: (request) => invoke(IpcChannels.aiChatCancel, request),
    listCommands: (request = {}) => invoke(IpcChannels.aiCommandsList, request),
    runCommand: (request) => invoke(IpcChannels.aiCommandRun, request),
    indexStatus: (request = {}) => invoke(IpcChannels.aiIndexStatus, request),
    rebuildIndex: (request) => invoke(IpcChannels.aiIndexRebuild, request),
    clearIndex: (request) => invoke(IpcChannels.aiIndexClear, request),
    cancelIndex: (request) => invoke(IpcChannels.aiIndexCancel, request),
    webSearch: (request) => invoke(IpcChannels.aiWebSearch, request),
    extractAttachment: (request) => invoke(IpcChannels.aiAttachmentExtract, request),
    prepareChangePlan: (request) => invoke(IpcChannels.aiChangePlanPrepare, request),
    applyChangePlan: (request) => invoke(IpcChannels.aiChangePlanApply, request),
    insights: (request) => invoke(IpcChannels.aiInsights, request),
    onChatEvent: (listener) => subscribe(IpcChannels.aiChatEvent, listener)
  },
  plugins: {
    list: () => invoke(IpcChannels.pluginsList, {}),
    setEnabled: (request) => invoke(IpcChannels.pluginsSetEnabled, request),
    acceptPermissions: (request) => invoke(IpcChannels.pluginsAcceptPermissions, request),
    recordFailure: (request) => invoke(IpcChannels.pluginsRecordFailure, request)
  },
  extensions: {
    syncMenus: (request) => invoke(IpcChannels.extensionsSyncMenus, request)
  },
  diagnostics: {
    openLogs: () => invoke(IpcChannels.diagnosticsOpenLogs, {})
  },
  events: {
    onAppCommand: (listener) => subscribe("app.command", listener),
    onExternalFileOpen: (listener) => subscribe("file.openExternal", listener),
    onWorkspaceIndexed: (listener) => subscribe("workspace.indexed", listener)
  }
};

contextBridge.exposeInMainWorld("nolia", api);

function invoke<T>(channel: string, payload: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>;
}

function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.off(channel, handler);
  };
}
