import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { lookup } from "mime-types";
import sanitize from "sanitize-filename";

import type {
  ExternalDocumentChangedEvent,
  ExternalDocumentDraft,
  ExternalDocumentReadResponse,
  ExternalDocumentSaveRequest,
  ExternalDocumentSaveResponse,
  ExternalFolderSession,
  RecentExternalFile
} from "../../shared/externalDocuments";
import type { FileTreeNode } from "../../shared/types";
import { MARKDOWN_EXTENSIONS } from "../../shared/constants";
import { replaceFileWithRetry } from "../utils/atomicFile";
import { sha256Buffer } from "../utils/hash";
import { SettingsService } from "./settingsService";

const MAX_FOLDER_NODES = 5_000;
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

export class ExternalDocumentService {
  private readonly draftRoot: string;
  private readonly folderSessions = new Map<string, ExternalFolderSession>();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watchTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    userDataPath: string,
    private readonly settings: SettingsService,
    private readonly emitChanged: (event: ExternalDocumentChangedEvent) => void = () => undefined
  ) {
    this.draftRoot = path.join(userDataPath, "external-drafts");
  }

  async init(): Promise<void> {
    await mkdir(this.draftRoot, { recursive: true });
  }

  close(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    for (const timer of this.watchTimers.values()) clearTimeout(timer);
    this.watchers.clear();
    this.watchTimers.clear();
    this.folderSessions.clear();
  }

  async pickFile(parentWindow?: BrowserWindow): Promise<{ filePaths: string[] }> {
    const options: OpenDialogOptions = {
      title: "打开 Markdown 文件",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Markdown", extensions: MARKDOWN_EXTENSIONS.map((extension) => extension.slice(1)) }]
    };
    const result = parentWindow && !parentWindow.isDestroyed() ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    return { filePaths: result.canceled ? [] : result.filePaths.map((item) => path.resolve(item)) };
  }

  async read(filePathValue: string): Promise<ExternalDocumentReadResponse> {
    const filePath = await normalizeMarkdownFile(filePathValue, false);
    const bytes = await readFile(filePath);
    const fileStat = await stat(filePath);
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const body = bom ? bytes.subarray(3) : bytes;
    let content: string;
    let encodingSupported = true;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      encodingSupported = false;
      content = new TextDecoder("utf-8").decode(body);
    }
    const readonly = !encodingSupported || !(await isWritable(filePath));
    const response: ExternalDocumentReadResponse = {
      filePath,
      realPath: await realpath(filePath),
      content,
      sha256: sha256Buffer(bytes),
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      readonly,
      encoding: "utf-8",
      encodingSupported,
      bom,
      eol: /\r\n/.test(content) ? "crlf" : "lf",
      draft: await this.readDraft(filePath)
    };
    await this.settings.addRecentExternalFile(filePath);
    this.watchFile(filePath);
    return response;
  }

  async save(request: ExternalDocumentSaveRequest, parentWindow?: BrowserWindow): Promise<ExternalDocumentSaveResponse> {
    const sourcePath = path.resolve(request.filePath);
    if (!isMarkdownFile(sourcePath)) return { status: "error", filePath: sourcePath, revision: request.revision, error: "Only Markdown files are supported" };
    let targetPath = request.targetPath ? path.resolve(request.targetPath) : sourcePath;
    if (request.mode === "saveAs" && !request.targetPath) {
      const options: SaveDialogOptions = { title: "另存 Markdown 文件", defaultPath: sourcePath };
      const chosen = parentWindow && !parentWindow.isDestroyed() ? await dialog.showSaveDialog(parentWindow, options) : await dialog.showSaveDialog(options);
      if (chosen.canceled || !chosen.filePath) return { status: "cancelled", filePath: sourcePath, revision: request.revision };
      targetPath = path.resolve(chosen.filePath);
    }
    if (!isMarkdownFile(targetPath)) return { status: "error", filePath: targetPath, revision: request.revision, error: "Only Markdown files are supported" };

    let diskHash: string | undefined;
    let diskMtimeMs = 0;
    let diskContent: string | undefined;
    try {
      const current = await readFile(targetPath);
      const currentStat = await stat(targetPath);
      diskHash = sha256Buffer(current);
      diskMtimeMs = currentStat.mtimeMs;
      diskContent = decodeUtf8(current);
      if (diskContent === undefined) {
        return {
          status: "readonly",
          filePath: targetPath,
          revision: request.revision,
          error: "Unsupported text encoding"
        };
      }
      if (!(await isWritable(targetPath))) return { status: "readonly", filePath: targetPath, revision: request.revision };
    } catch (error) {
      if (request.mode !== "saveAs" && !isMissing(error)) return { status: "error", filePath: targetPath, revision: request.revision, error: errorMessage(error) };
      if (request.mode !== "saveAs" && request.baseHash !== "new") return { status: "missing", filePath: targetPath, revision: request.revision };
    }
    if (request.mode !== "force" && request.mode !== "saveAs" && diskHash && diskHash !== request.baseHash) {
      return { status: "conflict", filePath: targetPath, revision: request.revision, conflict: { diskHash, mtimeMs: diskMtimeMs, diskContent } };
    }

    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      const normalizedContent = normalizeEol(request.content, request.eol ?? "lf");
      const contentBytes = Buffer.from(`${request.bom ? "\ufeff" : ""}${normalizedContent}`, "utf8");
      const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, contentBytes);
      await replaceFileWithRetry(tmpPath, targetPath);
      const savedStat = await stat(targetPath);
      const sha256 = sha256Buffer(contentBytes);
      await this.deleteDraft(sourcePath);
      await this.settings.addRecentExternalFile(targetPath);
      if (sourcePath !== targetPath) {
        this.watchers.get(sourcePath)?.close();
        this.watchers.delete(sourcePath);
      }
      this.watchers.get(targetPath)?.close();
      this.watchers.delete(targetPath);
      this.watchFile(targetPath);
      return { status: "saved", filePath: targetPath, sha256, mtimeMs: savedStat.mtimeMs, revision: request.revision };
    } catch (error) {
      return { status: isPermission(error) ? "readonly" : "error", filePath: targetPath, revision: request.revision, error: errorMessage(error) };
    }
  }

  async readDraft(filePathValue: string): Promise<ExternalDocumentDraft | undefined> {
    try {
      const value = JSON.parse(await readFile(this.draftPath(filePathValue), "utf8")) as ExternalDocumentDraft;
      return value.filePath === path.resolve(filePathValue) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async writeDraft(request: Omit<ExternalDocumentDraft, "updatedAt">): Promise<{ ok: true }> {
    const draft: ExternalDocumentDraft = { ...request, filePath: path.resolve(request.filePath), updatedAt: Date.now() };
    await writeFile(this.draftPath(draft.filePath), `${JSON.stringify(draft)}\n`, "utf8");
    return { ok: true };
  }

  async deleteDraft(filePathValue: string): Promise<{ ok: true }> {
    const { rm } = await import("node:fs/promises");
    await rm(this.draftPath(filePathValue), { force: true });
    return { ok: true };
  }

  listRecent(): Promise<RecentExternalFile[]> {
    return this.settings.listRecentExternalFiles();
  }

  removeRecent(filePath: string): Promise<RecentExternalFile[]> {
    return this.settings.removeRecentExternalFile(filePath);
  }

  async openFolder(filePathValue: string): Promise<ExternalFolderSession> {
    const filePath = await normalizeMarkdownFile(filePathValue, false);
    const rootPath = path.dirname(filePath);
    const realRootPath = await realpath(rootPath);
    const { nodes, truncated } = await readMarkdownTree(rootPath, realRootPath);
    const session: ExternalFolderSession = { id: randomUUID(), rootPath, realRootPath, authorizedAt: Date.now(), sequence: 1, nodes, truncated };
    this.folderSessions.set(session.id, session);
    return session;
  }

  closeFolder(sessionId: string): { ok: boolean } {
    return { ok: this.folderSessions.delete(sessionId) };
  }

  async resolveLink(filePathValue: string, href: string, folderSessionId?: string): Promise<{ filePath?: string; fragment?: string }> {
    const filePath = await normalizeMarkdownFile(filePathValue, false);
    const [rawTarget, fragment] = href.replace(/^<|>$/g, "").split("#", 2);
    if (!rawTarget) return { filePath, fragment };
    const session = folderSessionId ? this.folderSessions.get(folderSessionId) : undefined;
    const root = session?.realRootPath ?? await realpath(path.dirname(filePath));
    const candidate = path.resolve(path.dirname(filePath), decodeURIComponent(rawTarget));
    if (!isMarkdownFile(candidate)) return {};
    const candidateReal = await realpath(candidate);
    assertWithinRoot(root, candidateReal);
    return { filePath: candidateReal, fragment };
  }

  async pickImage(parentWindow?: BrowserWindow): Promise<{ path?: string }> {
    const options: OpenDialogOptions = { title: "选择图片", properties: ["openFile"], filters: [{ name: "图片", extensions: IMAGE_EXTENSIONS }] };
    const result = parentWindow && !parentWindow.isDestroyed() ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? {} : { path: result.filePaths[0] };
  }

  async importAttachment(documentPathValue: string, sourcePathValue: string, baseHash: string): Promise<{ assetPath: string; markdown: string; mimeType: string; size: number }> {
    const documentPath = await normalizeMarkdownFile(documentPathValue, false);
    const documentBytes = await readFile(documentPath);
    if (sha256Buffer(documentBytes) !== baseHash) throw new Error("Document changed before attachment import");
    const sourcePath = path.resolve(sourcePathValue);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile()) throw new Error("Attachment source is not a file");
    const safeName = sanitize(path.basename(sourcePath)) || `asset-${Date.now()}`;
    const assetDir = path.join(path.dirname(documentPath), `${path.basename(documentPath, path.extname(documentPath))}.assets`);
    try {
      if ((await lstat(assetDir)).isSymbolicLink()) throw new Error("Attachment directory cannot be a symbolic link");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await mkdir(assetDir, { recursive: true });
    assertWithinRoot(await realpath(path.dirname(documentPath)), await realpath(assetDir));
    const assetPath = await uniquePath(assetDir, safeName);
    await copyFile(sourcePath, assetPath);
    const mimeType = lookup(sourcePath) || "application/octet-stream";
    const relative = path.relative(path.dirname(documentPath), assetPath).split(path.sep).join("/");
    return { assetPath, markdown: mimeType.startsWith("image/") ? `![${safeName}](${relative})` : `[${safeName}](${relative})`, mimeType, size: sourceStat.size };
  }

  private watchFile(filePathValue: string): void {
    const filePath = path.resolve(filePathValue);
    if (this.watchers.has(filePath)) return;
    try {
      const watcher = watch(filePath, () => {
        const current = this.watchTimers.get(filePath);
        if (current) clearTimeout(current);
        this.watchTimers.set(filePath, setTimeout(() => void this.emitFileState(filePath), 180));
      });
      watcher.on("error", () => undefined);
      this.watchers.set(filePath, watcher);
    } catch {
      // Saving and base-hash checks remain available when native watching is unavailable.
    }
  }

  private async emitFileState(filePath: string): Promise<void> {
    this.watchTimers.delete(filePath);
    try {
      const bytes = await readFile(filePath);
      const fileStat = await stat(filePath);
      this.emitChanged({ filePath, kind: "change", sha256: sha256Buffer(bytes), mtimeMs: fileStat.mtimeMs });
    } catch (error) {
      if (isMissing(error)) this.emitChanged({ filePath, kind: "delete" });
    }
  }

  private draftPath(filePathValue: string): string {
    const key = createHash("sha256").update(path.resolve(filePathValue)).digest("hex");
    return path.join(this.draftRoot, `${key}.json`);
  }
}

async function normalizeMarkdownFile(filePathValue: string, allowMissing: boolean): Promise<string> {
  const filePath = path.resolve(filePathValue);
  if (!isMarkdownFile(filePath)) throw new Error("Only Markdown files can be opened directly");
  if (!allowMissing) {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("External document is not a file");
  }
  return filePath;
}

function isMarkdownFile(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.includes(path.extname(filePath).toLowerCase() as (typeof MARKDOWN_EXTENSIONS)[number]);
}

async function isWritable(filePath: string): Promise<boolean> {
  try { await access(filePath, constants.W_OK); return true; } catch { return false; }
}

function decodeUtf8(bytes: Buffer): string | undefined {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0)); } catch { return undefined; }
}

function normalizeEol(content: string, eol: "lf" | "crlf"): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return eol === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

async function readMarkdownTree(rootPath: string, realRootPath: string): Promise<{ nodes: FileTreeNode[]; truncated: boolean }> {
  let count = 0;
  let truncated = false;
  const walk = async (current: string): Promise<FileTreeNode[]> => {
    const entries = (await readdir(current, { withFileTypes: true }))
      .filter((entry) => !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name));
    const files: FileTreeNode[] = [];
    const directories: FileTreeNode[] = [];
    for (const entry of entries.filter((item) => !item.isDirectory())) {
      if (count >= MAX_FOLDER_NODES) { truncated = true; break; }
      const absolutePath = path.join(current, entry.name);
      const entryLstat = await lstat(absolutePath);
      if (entryLstat.isSymbolicLink()) continue;
      const entryReal = await realpath(absolutePath);
      assertWithinRoot(realRootPath, entryReal);
      if (!isMarkdownFile(absolutePath)) continue;
      const entryStat = await stat(absolutePath);
      count += 1;
      files.push({ pathRel: absolutePath, name: entry.name, kind: "markdown", size: entryStat.size, mtimeMs: entryStat.mtimeMs });
    }
    for (const entry of entries.filter((item) => item.isDirectory())) {
      if (count >= MAX_FOLDER_NODES) { truncated = true; break; }
      const absolutePath = path.join(current, entry.name);
      const entryLstat = await lstat(absolutePath);
      if (entryLstat.isSymbolicLink()) continue;
      const entryReal = await realpath(absolutePath);
      assertWithinRoot(realRootPath, entryReal);
      let children: FileTreeNode[];
      try {
        children = await walk(absolutePath);
      } catch (error) {
        if (isPermission(error)) continue;
        throw error;
      }
      if (!children.length) continue;
      const entryStat = await stat(absolutePath);
      count += 1;
      directories.push({ pathRel: absolutePath, name: entry.name, kind: "directory", size: entryStat.size, mtimeMs: entryStat.mtimeMs, children });
    }
    return [...directories, ...files];
  };
  return { nodes: await walk(rootPath), truncated };
}

function assertWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("External path escapes the authorized folder");
}

async function uniquePath(dir: string, fileName: string): Promise<string> {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  for (let index = 0; index < 500; index += 1) {
    const candidate = path.join(dir, index === 0 ? fileName : `${stem}-${index}${extension}`);
    try { await stat(candidate); } catch { return candidate; }
  }
  throw new Error("Could not allocate a unique attachment name");
}

function isMissing(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"); }
function isPermission(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && ["EACCES", "EPERM", "EROFS"].includes((error as NodeJS.ErrnoException).code ?? "")); }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
