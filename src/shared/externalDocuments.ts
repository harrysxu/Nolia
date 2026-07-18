import type { FileTreeNode } from "./types";

export type DocumentOrigin =
  | { kind: "workspace"; workspaceId: string; pathRel: string }
  | { kind: "external"; filePath: string; realPath: string; folderSessionId?: string };

export interface DocumentCapabilities {
  save: boolean;
  saveAs: boolean;
  export: boolean;
  outline: boolean;
  properties: boolean;
  history: boolean;
  relations: boolean;
  attachments: boolean;
  relativeNavigation: boolean;
  workspaceAi: boolean;
}

export interface ExternalDocumentDraft {
  filePath: string;
  content: string;
  baseHash: string;
  revision: number;
  updatedAt: number;
}

export interface ExternalDocumentReadResponse {
  filePath: string;
  realPath: string;
  content: string;
  sha256: string;
  size: number;
  mtimeMs: number;
  readonly: boolean;
  encoding: "utf-8";
  encodingSupported: boolean;
  bom: boolean;
  eol: "lf" | "crlf";
  draft?: ExternalDocumentDraft;
}

export interface ExternalDocumentSaveRequest {
  filePath: string;
  content: string;
  baseHash: string;
  revision: number;
  mode?: "normal" | "saveAs" | "force";
  targetPath?: string;
  bom?: boolean;
  eol?: "lf" | "crlf";
}

export interface ExternalDocumentSaveResponse {
  status: "saved" | "conflict" | "missing" | "readonly" | "cancelled" | "error";
  filePath: string;
  sha256?: string;
  mtimeMs?: number;
  revision: number;
  conflict?: { diskHash: string; mtimeMs: number; diskContent?: string };
  error?: string;
}

export interface RecentExternalFile {
  filePath: string;
  name: string;
  lastOpenedAt: number;
  availability: "available" | "missing" | "unreadable";
}

export interface ExternalFolderSession {
  id: string;
  rootPath: string;
  realRootPath: string;
  authorizedAt: number;
  sequence: number;
  nodes: FileTreeNode[];
  truncated: boolean;
}

export interface ExternalDocumentChangedEvent {
  filePath: string;
  kind: "change" | "delete";
  sha256?: string;
  mtimeMs?: number;
}

export interface WindowDocumentState {
  title: string;
  representedFilename?: string;
  dirty: boolean;
}

export const WORKSPACE_DOCUMENT_CAPABILITIES: DocumentCapabilities = {
  save: true,
  saveAs: false,
  export: true,
  outline: true,
  properties: true,
  history: true,
  relations: true,
  attachments: true,
  relativeNavigation: true,
  workspaceAi: true
};

export const EXTERNAL_DOCUMENT_CAPABILITIES: DocumentCapabilities = {
  save: true,
  saveAs: true,
  export: true,
  outline: true,
  properties: true,
  history: false,
  relations: false,
  attachments: true,
  relativeNavigation: true,
  workspaceAi: false
};
