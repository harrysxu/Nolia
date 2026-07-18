import type { EditorMode, ParsedDocument } from "../../shared/types";
import type { DocumentRevision } from "../../shared/contracts";
import type { ExternalFolderSession } from "../../shared/externalDocuments";

export type SidebarView = string;
export type RightPanelView = "outline" | "details" | "history" | "errors";
export type NewItemKind = "file" | "directory";
export type ItemKind = "file" | "directory" | "resource";
export type RenameTarget = { pathRel: string; kind: ItemKind; name: string };
export type DeleteTarget = { pathRel: string; kind: ItemKind; name: string };
export type LinkDraft = { text: string; href: string };
export type TreeSelection = { pathRel: string; kind: ItemKind };
export type CreateMenuState = { x: number; y: number; parentPath: string };
export type FileClipboard = { pathRel: string; name: string };
export type MoveDialogState = { target: RenameTarget; destinationPath: string };
export type DocumentListItem = { pathRel: string; title: string; timestamp: number; kind?: "file" | "resource" };
export type FavoriteDocument = { pathRel: string; title: string; addedAt: number };
export type StoredDocumentItem = DocumentListItem | FavoriteDocument;
export type ResourceCategory = "image" | "pdf" | "audio" | "video" | "diagram" | "archive" | "text" | "other";

export interface OpenDocumentTab {
  pathRel: string;
  sourceKind?: "workspace" | "external";
  filePath?: string;
  title: string;
  sourceText: string;
  baseHash: string;
  lastSavedHash: string;
  dirty: boolean;
  mode: EditorMode;
  parsed: ParsedDocument;
  pendingHtml?: string;
  lastSavedAt?: number;
  revisionState?: DocumentRevision;
  realPath?: string;
  bom?: boolean;
  eol?: "lf" | "crlf";
  readonly?: boolean;
  encodingSupported?: boolean;
  folderSession?: ExternalFolderSession;
  externalConflict?: {
    kind: "change" | "delete";
    diskHash?: string;
    diskContent?: string;
    mtimeMs?: number;
  };
}

export interface ActiveResource {
  pathRel: string;
  name: string;
  kind: "asset" | "other";
  size: number;
  mtimeMs: number;
  viewerId?: string;
  editorId?: string;
  category?: ResourceCategory;
  initialText?: string;
  initialBytes?: ArrayBuffer;
  baseHash?: string;
  dirty?: boolean;
  lastSavedAt?: number;
}
