import type { AiSettings } from "./ai";

export type ThemeId = "system" | "light" | "dark" | "paper" | "technical";
export type EditorMode = "wysiwyg" | "source" | "split";
export type FileKind = "directory" | "markdown" | "asset" | "other";
export type IndexStatus = "idle" | "indexing" | "ready" | "error";
export type SaveStatus = "saved" | "conflict" | "permission_denied" | "missing";
export type LocalePreference = "system" | "zh-CN" | "zh-TW" | "en-US" | "ja-JP" | "ko-KR";
export type ResolvedLocale = Exclude<LocalePreference, "system">;

export interface AppSettings {
  language: LocalePreference;
  theme: ThemeId;
  editorMode: EditorMode;
  editorWidth: "narrow" | "medium" | "wide" | "full";
  fontSize: "small" | "medium" | "large" | "extraLarge";
  focusMode: boolean;
  autoSaveDelayMs: number;
  attachmentStrategy: "workspace_assets" | "document_assets";
  pluginSafeMode: boolean;
  ai: AiSettings;
  plugins: Record<string, {
    enabled: boolean;
    permissionsAcceptedAt?: number;
    acceptedPermissionHash?: string;
    disabledReason?: string;
    settings?: Record<string, unknown>;
  }>;
}

export interface WorkspaceInfo {
  workspaceId: string;
  name: string;
  rootPath: string;
  configPath: string;
  createdAt: number;
  lastOpenedAt: number;
  permissions: {
    readable: boolean;
    writable: boolean;
  };
  indexState: {
    status: IndexStatus;
    progress: number;
    version: number;
    message?: string;
  };
}

export interface WorkspaceIndexedEvent {
  workspaceId: string;
  pathRel: string;
  indexVersion: number;
}

export interface RecentWorkspace {
  workspaceId: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  createdAt: number;
  exists: boolean;
}

export interface FileTreeNode {
  pathRel: string;
  name: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
  children?: FileTreeNode[];
}

export interface FileStatInfo {
  size: number;
  mtimeMs: number;
  birthtimeMs: number;
}

export interface FileReadResponse {
  content: string;
  stat: FileStatInfo;
  sha256: string;
  encoding: "utf-8";
}

export interface FileBinaryReadResponse {
  data: ArrayBuffer;
  stat: FileStatInfo;
  sha256: string;
  encoding: "binary";
  mimeType?: string;
}

export interface FileWriteResponse {
  status: SaveStatus;
  sha256?: string;
  mtimeMs?: number;
  conflict?: {
    diskHash: string;
    mtimeMs: number;
  };
}

export interface FileHistoryEntry {
  id: number;
  pathRel: string;
  snapshotPath: string;
  reason: "autosave" | "manual" | "conflict" | "restore" | string;
  size: number;
  sha256: string;
  createdAt: number;
}

export interface FileHistoryReadResponse {
  entry: FileHistoryEntry;
  content: string;
}

export interface OutlineItem {
  id: string;
  text: string;
  depth: number;
  line: number;
}

export interface MarkdownLink {
  href: string;
  title?: string;
  text: string;
  line: number;
}

export interface WikiLink {
  targetText: string;
  targetHeading?: string;
  alias?: string;
  line: number;
  col: number;
}

export interface AttachmentRef {
  refPath: string;
  kind: "image" | "pdf" | "archive" | "media" | "other";
  line: number;
}

export interface ParseDiagnostic {
  severity: "warning" | "error";
  message: string;
  line?: number;
  col?: number;
}

export interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  title: string;
  body: string;
  plainText: string;
  headings: OutlineItem[];
  tags: string[];
  links: MarkdownLink[];
  wikilinks: WikiLink[];
  attachments: AttachmentRef[];
  diagnostics: ParseDiagnostic[];
  wordCount: number;
  lineCount: number;
}

export interface SearchResultItem {
  pathRel: string;
  title: string;
  score: number;
  snippets: string[];
}

export interface SearchQueryResponse {
  items: SearchResultItem[];
  indexVersion: number;
  isPartial: boolean;
}

export interface BacklinkItem {
  pathRel: string;
  title: string;
  line: number;
  context: string;
}

export interface BacklinksResponse {
  linked: BacklinkItem[];
  unlinked: BacklinkItem[];
}
