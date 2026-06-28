import { z } from "zod";

export { IpcChannels, type IpcChannel } from "./channels";
import type {
  AiModelsListRequest,
  AiEmbeddingTestRequest,
  AiSemanticIndexRequest,
  AiTaskApprovalRequest,
  AiTaskCancelRequest,
  AiTaskReadRequest,
  AiTaskRejectRequest,
  AiTaskResumeRequest,
  AiTaskStartRequest,
  AiTaskUndoWriteRequest,
  AiProviderTestRequest,
  AiRunCancelRequest,
  AiRunStartRequest,
  AiSecretClearRequest,
  AiSecretGetRequest,
  AiSecretSetRequest,
  AiSettingsSetRequest
} from "./ai";
import { MAX_CONVERSATION_HISTORY_MESSAGES, MAX_CONVERSATION_HISTORY_TURNS } from "./ai";

export const EmptySchema = z.object({}).strict();

export const WorkspaceOpenRequestSchema = z.object({
  path: z.string().min(1).optional(),
  createIfMissing: z.boolean().optional()
});

export const WorkspaceSwitchRequestSchema = z.object({
  workspaceId: z.string().min(1)
});

export const WorkspaceRemoveRecentRequestSchema = z.object({
  workspaceId: z.string().min(1)
});

export const WorkspaceListTagsRequestSchema = z.object({
  workspaceId: z.string().min(1)
});

export const FileListTreeRequestSchema = z.object({
  workspaceId: z.string().min(1),
  root: z.string().optional(),
  sortBy: z.enum(["name", "mtime", "type"]).optional(),
  showHidden: z.boolean().optional()
});

export const FileReadRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1)
});

const BinaryDataSchema = z.custom<ArrayBuffer | ArrayBufferView>(
  (value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value),
  "Expected binary data"
);

export const FileWriteAtomicRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  content: z.string(),
  baseHash: z.string().min(1),
  createSnapshot: z.boolean().optional()
});

export const FileWriteBinaryAtomicRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  data: BinaryDataSchema,
  baseHash: z.string().min(1),
  createSnapshot: z.boolean().optional()
});

export const FileHistoryListRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  limit: z.number().int().positive().max(200).optional()
});

export const FileHistoryReadRequestSchema = z.object({
  workspaceId: z.string().min(1),
  snapshotId: z.number().int().positive()
});

export const FileHistoryCreateRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  reason: z.enum(["autosave", "manual", "conflict", "restore"]).optional(),
  content: z.string().optional()
});

export const FileCreateRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  kind: z.enum(["file", "directory"]),
  content: z.string().optional()
});

export const FileRenameRequestSchema = z.object({
  workspaceId: z.string().min(1),
  sourcePathRel: z.string().min(1),
  targetPathRel: z.string().min(1),
  updateReferences: z.boolean().optional()
});

export const FileTrashRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1)
});

export const FileResourceActionRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1)
});

export const ExternalFileReadRequestSchema = z.object({
  filePath: z.string().min(1)
});

export const ExternalFileWriteAtomicRequestSchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
  baseHash: z.string().min(1)
});

export const DocumentParseRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  content: z.string(),
  mode: z.enum(["full", "outlineOnly", "linksOnly"]).optional()
});

export const SearchQueryRequestSchema = z.object({
  workspaceId: z.string().min(1),
  query: z.string(),
  filters: z
    .object({
      path: z.string().optional(),
      tag: z.string().optional(),
      field: z.enum(["title", "path", "tags", "body"]).optional(),
      caseSensitive: z.boolean().optional(),
      regex: z.boolean().optional()
    })
    .optional(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional()
});

export const GraphBacklinksRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  includeUnlinkedMentions: z.boolean().optional()
});

export const AttachmentImportRequestSchema = z.object({
  workspaceId: z.string().min(1),
  documentPathRel: z.string().min(1),
  source: z.object({
    path: z.string().min(1)
  }),
  strategy: z.enum(["workspace_assets", "document_assets"]).optional()
});

export const AttachmentPickImageRequestSchema = z.object({
  workspaceId: z.string().min(1)
});

export const ExportDocumentRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  format: z.enum(["pdf", "html", "markdown"]),
  themeId: z.string().optional(),
  includeAssets: z.boolean().optional(),
  page: z
    .object({
      title: z.string().optional(),
      margin: z.string().optional(),
      paperSize: z.string().optional()
    })
    .optional()
});

export const ClipboardWriteRichRequestSchema = z.object({
  html: z.string(),
  text: z.string()
});

export const SettingsSetRequestSchema = z.object({
  key: z.string().min(1),
  value: z.unknown()
});

export const PluginSetEnabledRequestSchema = z.object({
  pluginId: z.string().min(1),
  enabled: z.boolean()
});

export const PluginAcceptPermissionsRequestSchema = z.object({
  pluginId: z.string().min(1)
});

export const PluginRecordFailureRequestSchema = z.object({
  pluginId: z.string().min(1),
  message: z.string().min(1)
});

export const ExtensionsSyncMenusRequestSchema = z.object({
  menus: z.array(
    z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        command: z.string().optional(),
        location: z.enum(["app", "file", "edit", "view", "window", "help", "context"]),
        group: z.string().optional(),
        order: z.number().optional(),
        when: z.enum(["always", "workspace", "!workspace", "document", "!document", "resource", "!resource"]).optional(),
        separatorBefore: z.boolean().optional(),
        separatorAfter: z.boolean().optional()
      })
      .strict()
  )
});

export const AiProviderIdSchema = z.enum(["openai-compatible", "ollama"]);
export const AiApiModeSchema = z.enum(["chat-completions", "responses", "ollama-native"]);
export const AiEmbeddingApiModeSchema = z.enum(["openai-embeddings", "ollama-native"]);
export const AiProviderProfileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    alias: z.string().optional(),
    providerId: AiProviderIdSchema,
    model: z.string(),
    baseUrl: z.string(),
    apiMode: AiApiModeSchema,
    disabled: z.boolean().optional()
  })
  .strict();

export const AiEmbeddingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    providerId: AiProviderIdSchema,
    model: z.string(),
    baseUrl: z.string(),
    apiMode: AiEmbeddingApiModeSchema
  })
  .strict();

export const AiSettingsSetRequestSchema = z.object({
  settings: z
    .object({
      enabled: z.boolean().optional(),
      defaultProviderId: z.string().min(1).optional(),
      providers: z.array(AiProviderProfileSchema).optional(),
      embedding: AiEmbeddingSettingsSchema.partial().optional(),
      conversationHistoryTurns: z.number().int().min(0).max(MAX_CONVERSATION_HISTORY_TURNS).optional(),
      agentMaxSteps: z.number().int().min(1).max(30).optional(),
      allowCurrentNoteContent: z.boolean().optional(),
      allowWorkspaceSearch: z.boolean().optional(),
      allowReadSearchResults: z.boolean().optional(),
      allowWorkspaceRead: z.boolean().optional(),
      allowWorkspaceOperations: z.boolean().optional()
    })
    .strict()
});

export const AiSecretSetRequestSchema = z.object({
  providerProfileId: z.string().min(1),
  apiKey: z.string()
});

export const AiSecretClearRequestSchema = z.object({
  providerProfileId: z.string().min(1)
});

export const AiSecretGetRequestSchema = z.object({
  providerProfileId: z.string().min(1)
});

export const AiProviderTestRequestSchema = z
  .object({
    providerProfileId: z.string().min(1).optional(),
    provider: AiProviderProfileSchema.partial().optional(),
    apiKey: z.string().optional()
  })
  .strict();

export const AiModelsListRequestSchema = z
  .object({
    providerProfileId: z.string().min(1).optional(),
    provider: AiProviderProfileSchema.partial().optional(),
    apiKey: z.string().optional()
  })
  .strict();

export const AiEmbeddingTestRequestSchema = z
  .object({
    settings: AiEmbeddingSettingsSchema.partial().optional(),
    apiKey: z.string().optional()
  })
  .strict();

export const AiSemanticIndexRequestSchema = z.object({
  workspaceId: z.string().min(1),
  settings: AiEmbeddingSettingsSchema.partial().optional(),
  apiKey: z.string().optional()
});

const AiTextRangeSchema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative()
});

export const AiRunStartRequestSchema = z.object({
  entryPoint: z.enum(["chat", "selection-action", "command-palette"]),
  instruction: z.string().min(1),
  actionId: z.enum(["polish", "summarize", "translate", "todo", "explain"]).optional(),
  conversation: z
    .array(
      z
        .object({
          role: z.enum(["user", "assistant"]),
          content: z.string()
        })
        .strict()
    )
    .max(MAX_CONVERSATION_HISTORY_MESSAGES)
    .optional(),
  clientContext: z
    .object({
      workspaceId: z.string().min(1).optional(),
      activeDocument: z
        .object({
          pathRel: z.string().min(1),
          title: z.string(),
          mode: z.enum(["wysiwyg", "source", "split"]),
          sourceText: z.string(),
          baseHash: z.string().min(1),
          dirty: z.boolean(),
          parsedTitle: z.string().optional(),
          headings: z
            .array(
              z.object({
                text: z.string(),
                depth: z.number().int().positive(),
                line: z.number().int().nonnegative()
              })
            )
            .optional()
        })
        .optional(),
      selection: z
        .object({
          text: z.string(),
          range: AiTextRangeSchema.optional(),
          source: z.enum(["source", "wysiwyg", "preview"])
        })
        .optional(),
      cursor: z
        .object({
          offset: z.number().int().nonnegative().optional(),
          line: z.number().int().positive().optional(),
          column: z.number().int().positive().optional()
        })
        .optional()
    })
    .strict(),
  options: z
    .object({
      allowTools: z.boolean().optional(),
      includeCurrentNote: z.boolean().optional(),
      requireCurrentNote: z.boolean().optional(),
      includeSelection: z.boolean().optional(),
      allowWorkspaceSearch: z.boolean().optional(),
      allowWorkspaceRead: z.boolean().optional(),
      allowDocumentPatch: z.boolean().optional(),
      allowWorkspaceOperations: z.boolean().optional(),
      patchFallback: z.boolean().optional(),
      maxToolRounds: z.number().int().positive().max(30).optional()
    })
    .strict()
    .optional()
});

export const AiRunCancelRequestSchema = z.object({
  runId: z.string().min(1)
});

export const AiTaskStartRequestSchema = AiRunStartRequestSchema.extend({
  title: z.string().min(1).optional(),
  options: AiRunStartRequestSchema.shape.options.unwrap().extend({
    maxToolRounds: z.number().int().positive().max(30).optional()
  }).strict().optional()
});

export const AiTaskReadRequestSchema = z.object({
  taskId: z.string().min(1)
});

export const AiTaskResumeRequestSchema = z.object({
  taskId: z.string().min(1)
});

export const AiTaskCancelRequestSchema = z.object({
  taskId: z.string().min(1)
});

export const AiTaskApprovalRequestSchema = z.object({
  taskId: z.string().min(1),
  approvalId: z.string().min(1)
});

export const AiTaskRejectRequestSchema = AiTaskApprovalRequestSchema.extend({
  reason: z.string().optional()
});

export const AiTaskUndoWriteRequestSchema = z.object({
  taskId: z.string().min(1),
  transactionId: z.string().min(1)
});

export type WorkspaceOpenRequest = z.infer<typeof WorkspaceOpenRequestSchema>;
export type WorkspaceSwitchRequest = z.infer<typeof WorkspaceSwitchRequestSchema>;
export type WorkspaceRemoveRecentRequest = z.infer<typeof WorkspaceRemoveRecentRequestSchema>;
export type WorkspaceListTagsRequest = z.infer<typeof WorkspaceListTagsRequestSchema>;
export type FileListTreeRequest = z.infer<typeof FileListTreeRequestSchema>;
export type FileReadRequest = z.infer<typeof FileReadRequestSchema>;
export type FileWriteAtomicRequest = z.infer<typeof FileWriteAtomicRequestSchema>;
export type FileWriteBinaryAtomicRequest = z.infer<typeof FileWriteBinaryAtomicRequestSchema>;
export type FileHistoryListRequest = z.infer<typeof FileHistoryListRequestSchema>;
export type FileHistoryReadRequest = z.infer<typeof FileHistoryReadRequestSchema>;
export type FileHistoryCreateRequest = z.infer<typeof FileHistoryCreateRequestSchema>;
export type FileCreateRequest = z.infer<typeof FileCreateRequestSchema>;
export type FileRenameRequest = z.infer<typeof FileRenameRequestSchema>;
export type FileTrashRequest = z.infer<typeof FileTrashRequestSchema>;
export type FileResourceActionRequest = z.infer<typeof FileResourceActionRequestSchema>;
export type ExternalFileReadRequest = z.infer<typeof ExternalFileReadRequestSchema>;
export type ExternalFileWriteAtomicRequest = z.infer<typeof ExternalFileWriteAtomicRequestSchema>;
export type DocumentParseRequest = z.infer<typeof DocumentParseRequestSchema>;
export type SearchQueryRequest = z.infer<typeof SearchQueryRequestSchema>;
export type GraphBacklinksRequest = z.infer<typeof GraphBacklinksRequestSchema>;
export type AttachmentImportRequest = z.infer<typeof AttachmentImportRequestSchema>;
export type AttachmentPickImageRequest = z.infer<typeof AttachmentPickImageRequestSchema>;
export type ExportDocumentRequest = z.infer<typeof ExportDocumentRequestSchema>;
export type ClipboardWriteRichRequest = z.infer<typeof ClipboardWriteRichRequestSchema>;
export type SettingsSetRequest = z.infer<typeof SettingsSetRequestSchema>;
export type PluginSetEnabledRequest = z.infer<typeof PluginSetEnabledRequestSchema>;
export type PluginAcceptPermissionsRequest = z.infer<typeof PluginAcceptPermissionsRequestSchema>;
export type PluginRecordFailureRequest = z.infer<typeof PluginRecordFailureRequestSchema>;
export type ExtensionsSyncMenusRequest = z.infer<typeof ExtensionsSyncMenusRequestSchema>;
export type {
  AiModelsListRequest,
  AiEmbeddingTestRequest,
  AiSemanticIndexRequest,
  AiTaskApprovalRequest,
  AiTaskCancelRequest,
  AiTaskReadRequest,
  AiTaskRejectRequest,
  AiTaskResumeRequest,
  AiTaskStartRequest,
  AiTaskUndoWriteRequest,
  AiProviderTestRequest,
  AiRunCancelRequest,
  AiRunStartRequest,
  AiSecretClearRequest,
  AiSecretGetRequest,
  AiSecretSetRequest,
  AiSettingsSetRequest
};
