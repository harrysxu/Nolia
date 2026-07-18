import { z } from "zod";

import type { EditorMode, FileTreeNode, ParsedDocument } from "./types";

export type NoliaErrorCode =
  | "invalid_request"
  | "workspace_not_open"
  | "workspace_not_initialized"
  | "workspace_read_only"
  | "workspace_corrupt"
  | "file_conflict"
  | "file_missing"
  | "file_permission_denied"
  | "migration_failed"
  | "plugin_incompatible"
  | "plugin_permission_denied"
  | "plugin_network_denied"
  | "plugin_timeout"
  | "transaction_precondition_failed"
  | "transaction_rollback_failed"
  | "internal_error";

export interface NoliaOperationError {
  code: NoliaErrorCode;
  message: string;
  operationId: string;
  retryable: boolean;
}

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: NoliaOperationError };

export function isIpcResult(value: unknown): value is IpcResult<unknown> {
  return Boolean(value && typeof value === "object" && "ok" in value && typeof (value as { ok?: unknown }).ok === "boolean");
}

export type WorkspaceProbeStatus = "initialized" | "initializable" | "read_only" | "inaccessible" | "corrupt";

export interface WorkspaceProbeResult {
  path: string;
  name: string;
  status: WorkspaceProbeStatus;
  readable: boolean;
  writable: boolean;
  markdownCount: number;
  hasNoliaDirectory: boolean;
  recoveryBackupPath?: string;
  message?: string;
}

export interface WorkspaceHealthSnapshot {
  workspaceId: string;
  readable: boolean;
  writable: boolean;
  watcher: { status: "ready" | "error"; message?: string };
  index: { status: string; progress: number; message?: string };
  database: { schemaVersion: number; status: "ready" | "error" };
  history: { bytes: number };
  issues: Array<{ id: string; title: string; message: string; severity: "warning" | "error" }>;
}

export const WorkspaceProbeRequestSchema = z.object({
  path: z.string().min(1).optional()
});
export const WorkspaceHealthRequestSchema = z.object({ workspaceId: z.string().min(1) });

export type WorkspaceTreePatchKind = "create" | "change" | "delete" | "move";

export interface WorkspaceTreePatchOperation {
  kind: WorkspaceTreePatchKind;
  pathRel: string;
  previousPathRel?: string;
  node?: FileTreeNode;
}

export interface WorkspaceTreeSnapshot {
  workspaceId: string;
  sequence: number;
  nodes: FileTreeNode[];
  createdAt: number;
}

export interface WorkspaceTreePatchEvent {
  workspaceId: string;
  sequence: number;
  operations: WorkspaceTreePatchOperation[];
  occurredAt: number;
}

export type DocumentSaveState = "clean" | "dirty" | "saving" | "conflict" | "readonly" | "missing" | "error";

export interface DocumentRevision {
  documentId: string;
  pathRel: string;
  revision: number;
  parsedRevision: number;
  baseHash: string;
  diskHash: string;
  draftHash?: string;
  saveState: DocumentSaveState;
}

export interface DocumentDraft {
  pathRel: string;
  content: string;
  baseHash: string;
  revision: number;
  updatedAt: number;
}

export interface WorkspaceSessionDocument {
  pathRel: string;
  mode: EditorMode;
  cursor?: number;
  scrollTop?: number;
  lastActiveAt: number;
}

export interface WorkspaceSessionSnapshot {
  workspaceId: string;
  activePathRel?: string;
  documents: WorkspaceSessionDocument[];
  recentlyClosed: WorkspaceSessionDocument[];
  sidebarView: "files" | "discover" | "ai";
  inspectorView: "outline" | "properties" | "links" | "history";
  updatedAt: number;
}

export type SearchMode = "exact" | "hybrid";
export type SearchResultSource = "exact" | "semantic" | "both";

export interface UnifiedSearchQuery {
  text: string;
  mode: SearchMode;
  scopes?: Array<"title" | "body" | "path" | "tags" | "properties" | "tasks">;
  pathPrefix?: string;
  tags?: string[];
  modifiedAfter?: number;
  modifiedBefore?: number;
  limit?: number;
  offset?: number;
}

export interface UnifiedSearchResult {
  pathRel: string;
  title: string;
  score: number;
  source: SearchResultSource;
  snippets: string[];
  matchedFields: string[];
  modifiedAt?: number;
}

export interface UnifiedSearchResponse {
  items: UnifiedSearchResult[];
  mode: SearchMode;
  semanticAvailable: boolean;
  fallbackReason?: string;
  indexVersion: number;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: UnifiedSearchQuery;
  createdAt: number;
  updatedAt: number;
}

export interface TagSummary {
  name: string;
  displayName: string;
  count: number;
}

export interface WikiLinkTarget {
  pathRel: string;
  title: string;
}

export interface TagRenameChange {
  pathRel: string;
  baseHash: string;
  before: string;
  after: string;
  replacements: number;
}

export interface TagRenamePreview {
  sourceTag: string;
  targetTag: string;
  changes: TagRenameChange[];
  replacements: number;
}

export interface TagRenameApplyResponse {
  affectedPaths: string[];
  replacements: number;
}

export interface LocalGraphNode {
  id: string;
  pathRel: string;
  title: string;
  depth: number;
  current: boolean;
}

export interface LocalGraphEdge {
  id: string;
  source: string;
  target: string;
  relation: "outgoing" | "incoming" | "mention";
}

export interface LocalGraphResponse {
  nodes: LocalGraphNode[];
  edges: LocalGraphEdge[];
  depth: 1 | 2;
  truncated: boolean;
}

export type PropertyMutation =
  | { type: "set"; key: string; value: unknown }
  | { type: "delete"; key: string }
  | { type: "rename"; key: string; nextKey: string };

export interface PropertyMutationRequest {
  workspaceId: string;
  pathRel: string;
  baseHash: string;
  revision: number;
  mutation: PropertyMutation;
}

export interface PropertyMutationResponse {
  content: string;
  sha256: string;
  parsed: ParsedDocument;
  revision: number;
}

export const WorkspaceSessionReadRequestSchema = z.object({ workspaceId: z.string().min(1) });
export const WorkspaceSessionWriteRequestSchema = z.object({
  workspaceId: z.string().min(1),
  session: z.unknown()
});
export const SavedSearchListRequestSchema = z.object({ workspaceId: z.string().min(1) });
export const SavedSearchSaveRequestSchema = z.object({
  workspaceId: z.string().min(1),
  search: z.unknown()
});
export const SavedSearchDeleteRequestSchema = z.object({
  workspaceId: z.string().min(1),
  searchId: z.string().min(1)
});
const TagNameSchema = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}][\p{L}\p{N}_/-]*$/u);
export const TagRenamePreviewRequestSchema = z.object({
  workspaceId: z.string().min(1),
  sourceTag: TagNameSchema,
  targetTag: TagNameSchema
});
export const WorkspaceListLinkTargetsRequestSchema = z.object({ workspaceId: z.string().min(1) });
export const TagRenameApplyRequestSchema = TagRenamePreviewRequestSchema.extend({
  expectedBaseHashes: z.record(z.string(), z.string().min(1))
});
export const LocalGraphRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  depth: z.union([z.literal(1), z.literal(2)]).default(1),
  limit: z.number().int().min(1).max(60).default(60)
});
export const UnifiedSearchRequestSchema = z.object({
  workspaceId: z.string().min(1),
  query: z.object({
    text: z.string(),
    mode: z.enum(["exact", "hybrid"]),
    scopes: z.array(z.enum(["title", "body", "path", "tags", "properties", "tasks"])).optional(),
    pathPrefix: z.string().optional(),
    tags: z.array(z.string()).optional(),
    modifiedAfter: z.number().optional(),
    modifiedBefore: z.number().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().nonnegative().optional()
  })
});
export const PropertyMutationRequestSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1),
  baseHash: z.string().min(1),
  revision: z.number().int().nonnegative(),
  mutation: z.discriminatedUnion("type", [
    z.object({ type: z.literal("set"), key: z.string().min(1), value: z.unknown() }),
    z.object({ type: z.literal("delete"), key: z.string().min(1) }),
    z.object({ type: z.literal("rename"), key: z.string().min(1), nextKey: z.string().min(1) })
  ])
});

export type TagRenamePreviewRequest = z.infer<typeof TagRenamePreviewRequestSchema>;
export type TagRenameApplyRequest = z.infer<typeof TagRenameApplyRequestSchema>;
export const DocumentDraftReadRequestSchema = z.object({ workspaceId: z.string().min(1), pathRel: z.string().min(1) });
export const DocumentDraftWriteRequestSchema = DocumentDraftReadRequestSchema.extend({ content: z.string(), baseHash: z.string().min(1), revision: z.number().int().nonnegative() });
export const DocumentDraftDeleteRequestSchema = DocumentDraftReadRequestSchema;
