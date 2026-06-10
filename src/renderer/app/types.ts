import type { BacklinksResponse, EditorMode, FileTreeNode, ParsedDocument, SearchResultItem, WorkspaceInfo } from "../../shared/types";

export type SidebarView = string;
export type RightPanelView = "outline" | "details" | "errors" | "ai";
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

export interface SuspendedShellState {
  workspace?: WorkspaceInfo;
  fileTree: FileTreeNode[];
  searchResults: SearchResultItem[];
  favoriteDocs: FavoriteDocument[];
  recentViewedDocs: DocumentListItem[];
  recentEditedDocs: DocumentListItem[];
  noteFilterQuery: string;
  workspaceSearchQuery: string;
  openDocs: OpenDocumentTab[];
  activePathRel?: string;
  activeResource?: ActiveResource;
  treeSelection?: TreeSelection;
  backlinks: BacklinksResponse;
  sidebarView: SidebarView;
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
}
