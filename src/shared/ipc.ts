import { z } from "zod";

export { IpcChannels, type IpcChannel } from "./channels";

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

export type WorkspaceOpenRequest = z.infer<typeof WorkspaceOpenRequestSchema>;
export type WorkspaceSwitchRequest = z.infer<typeof WorkspaceSwitchRequestSchema>;
export type WorkspaceRemoveRecentRequest = z.infer<typeof WorkspaceRemoveRecentRequestSchema>;
export type WorkspaceListTagsRequest = z.infer<typeof WorkspaceListTagsRequestSchema>;
export type FileListTreeRequest = z.infer<typeof FileListTreeRequestSchema>;
export type FileReadRequest = z.infer<typeof FileReadRequestSchema>;
export type FileWriteAtomicRequest = z.infer<typeof FileWriteAtomicRequestSchema>;
export type FileWriteBinaryAtomicRequest = z.infer<typeof FileWriteBinaryAtomicRequestSchema>;
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
