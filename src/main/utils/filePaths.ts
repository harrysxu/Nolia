import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { MARKDOWN_EXTENSIONS, WORKSPACE_META_DIR } from "../../shared/constants";
import type { FileKind } from "../../shared/types";

const assetExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".bmp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".rar",
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".avi",
  ".mkv",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
  ".drawio",
  ".dio",
  ".txt",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".htm",
  ".log"
]);

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export function normalizePathRel(pathRel: string): string {
  const normalized = path.posix.normalize(pathRel.replace(/\\/g, "/")).replace(/^\/+/, "");
  if (!normalized || normalized === ".") {
    return "";
  }
  if (normalized.startsWith("../") || normalized === "..") {
    throw new Error("Path escapes the workspace");
  }
  return normalized;
}

export function resolveWorkspacePath(rootPath: string, pathRel: string): string {
  const normalizedRel = normalizePathRel(pathRel);
  const absolute = path.resolve(rootPath, normalizedRel);
  const relative = path.relative(rootPath, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the workspace");
  }
  return absolute;
}

export function toWorkspaceRelative(rootPath: string, absolutePath: string): string {
  const relative = path.relative(rootPath, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path escapes the workspace");
  }
  return relative.split(path.sep).join("/");
}

export function isHiddenFromWorkspaceTree(pathRel: string): boolean {
  return pathRel === WORKSPACE_META_DIR || pathRel.startsWith(`${WORKSPACE_META_DIR}/`);
}

export function isAlwaysIgnoredWorkspacePath(pathRel: string): boolean {
  const normalized = normalizePathRel(pathRel);
  if (!normalized) {
    return false;
  }
  if (isHiddenFromWorkspaceTree(normalized)) {
    return true;
  }
  return normalized.split("/").some((segment) => segment === ".git" || segment === "node_modules" || segment === ".DS_Store");
}

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

export function fileKindForPath(filePath: string, isDirectory: boolean): FileKind {
  if (isDirectory) {
    return "directory";
  }
  const ext = path.extname(filePath).toLowerCase();
  if (MARKDOWN_EXTENSIONS.includes(ext)) {
    return "markdown";
  }
  if (assetExtensions.has(ext)) {
    return "asset";
  }
  return "other";
}

export async function getFileKind(filePath: string): Promise<FileKind> {
  const entryStat = await stat(filePath);
  return fileKindForPath(filePath, entryStat.isDirectory());
}

export function dirnameRel(pathRel: string): string {
  const dir = path.posix.dirname(normalizePathRel(pathRel));
  return dir === "." ? "" : dir;
}

export function basenameWithoutExt(pathRel: string): string {
  const base = path.posix.basename(pathRel);
  return base.replace(/\.[^.]+$/, "");
}
