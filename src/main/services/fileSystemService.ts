import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { lookup as lookupMime } from "mime-types";

import type {
  FileBinaryReadResponse,
  FileHistoryEntry,
  FileHistoryReadResponse,
  FileReadResponse,
  FileStatInfo,
  FileTreeNode,
  FileWriteResponse,
  RenameReferencePreview
} from "../../shared/types";
import { renameMarkdownTagReferences } from "../../shared/markdown";
import type { TagRenameApplyRequest, TagRenameApplyResponse, TagRenamePreview, TagRenamePreviewRequest } from "../../shared/contracts";
import type {
  ExternalFileReadRequest,
  ExternalFileWriteAtomicRequest,
  FileCreateRequest,
  FileHistoryCreateRequest,
  FileHistoryListRequest,
  FileHistoryReadRequest,
  FileListTreeRequest,
  FileReadRequest,
  FileRenameRequest,
  FileRenamePreviewRequest,
  FileResourceActionRequest,
  FileTrashRequest,
  FileWriteBinaryAtomicRequest,
  FileWriteAtomicRequest
} from "../../shared/ipc";
import {
  fileKindForPath,
  isAlwaysIgnoredWorkspacePath,
  isMarkdownPath,
  resolveWorkspacePath,
  normalizeWorkspaceUserPath,
  resolveWorkspaceUserPath,
  toWorkspaceRelative
} from "../utils/filePaths";
import { sha256Buffer, sha256Text } from "../utils/hash";
import { replaceFileWithRetry } from "../utils/atomicFile";
import { HistoryService } from "./historyService";
import { WorkspaceIndexService } from "./workspaceIndexService";
import { WorkspaceService } from "./workspaceService";

export class FileSystemService {
  private readonly indexer = new WorkspaceIndexService();
  private readonly externalAssetRoots = new Set<string>();

  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly history: HistoryService
  ) {}

  async listTree(request: FileListTreeRequest): Promise<{ nodes: FileTreeNode[] }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const rootPath = resolveWorkspaceUserPath(runtime.info.rootPath, request.root ?? "", { allowEmpty: true });
    const nodes = await readTree(runtime.info.rootPath, rootPath, request.showHidden ?? false);
    return { nodes: sortNodes(nodes, request.sortBy ?? "name") };
  }

  async readFile(request: FileReadRequest): Promise<FileReadResponse> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const normalized = normalizeWorkspaceUserPath(request.pathRel);
    const absolutePath = resolveWorkspacePath(runtime.info.rootPath, normalized);
    const content = await readFile(absolutePath, "utf8");
    const entryStat = await stat(absolutePath);
    runtime.db.touchRecentFile(normalized);
    runtime.db.scheduleSave();
    return {
      content,
      stat: statInfo(entryStat),
      sha256: sha256Text(content),
      encoding: "utf-8"
    };
  }

  async readBinaryFile(request: FileReadRequest): Promise<FileBinaryReadResponse> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const normalized = normalizeWorkspaceUserPath(request.pathRel);
    const absolutePath = resolveWorkspacePath(runtime.info.rootPath, normalized);
    const bytes = await readFile(absolutePath);
    const entryStat = await stat(absolutePath);
    runtime.db.touchRecentFile(normalized);
    runtime.db.scheduleSave();
    return {
      data: bufferToArrayBuffer(bytes),
      stat: statInfo(entryStat),
      sha256: sha256Buffer(bytes),
      encoding: "binary",
      mimeType: lookupMime(absolutePath) || undefined
    };
  }

  async listHistory(request: FileHistoryListRequest): Promise<{ entries: FileHistoryEntry[] }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const normalized = normalizeWorkspaceUserPath(request.pathRel);
    return {
      entries: this.history.listSnapshots(runtime.db, normalized, request.limit)
    };
  }

  async readHistory(request: FileHistoryReadRequest): Promise<FileHistoryReadResponse | undefined> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    return this.history.readSnapshot(runtime.info.rootPath, runtime.db, request.snapshotId);
  }

  async createHistorySnapshot(request: FileHistoryCreateRequest): Promise<{ entry?: FileHistoryEntry }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const normalized = normalizeWorkspaceUserPath(request.pathRel);
    const snapshotPath = await this.history.createSnapshot(runtime.info.rootPath, runtime.db, normalized, request.reason ?? "manual", request.content);
    if (!snapshotPath) {
      return {};
    }
    return {
      entry: runtime.db.listSnapshots(normalized, 1).find((entry) => entry.snapshotPath === snapshotPath)
    };
  }

  async readExternalFile(request: ExternalFileReadRequest): Promise<FileReadResponse> {
    const absolutePath = this.normalizeExternalMarkdownPath(request.filePath);
    const content = await readFile(absolutePath, "utf8");
    const entryStat = await stat(absolutePath);
    this.externalAssetRoots.add(path.dirname(absolutePath));
    return {
      content,
      stat: statInfo(entryStat),
      sha256: sha256Text(content),
      encoding: "utf-8"
    };
  }

  async writeAtomic(request: FileWriteAtomicRequest): Promise<FileWriteResponse> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    assertWorkspaceWritable(runtime.info.permissions.writable);
    const normalized = normalizeWorkspaceUserPath(request.pathRel);
    const absolutePath = resolveWorkspacePath(runtime.info.rootPath, normalized);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    let diskHash: string | undefined;
    let diskMtimeMs = 0;
    try {
      const current = await readFile(absolutePath, "utf8");
      const currentStat = await stat(absolutePath);
      diskHash = sha256Text(current);
      diskMtimeMs = currentStat.mtimeMs;
    } catch {
      if (request.baseHash !== "new") {
        return { status: "missing" };
      }
    }

    if (diskHash && diskHash !== request.baseHash) {
      return {
        status: "conflict",
        conflict: {
          diskHash,
          mtimeMs: diskMtimeMs
        }
      };
    }

    if (request.createSnapshot && diskHash) {
      await this.history.createSnapshot(runtime.info.rootPath, runtime.db, normalized, "autosave");
    }

    const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, request.content, "utf8");
    await replaceFileWithRetry(tmpPath, absolutePath);

    const savedStat = await stat(absolutePath);
    const sha256 = sha256Text(request.content);
    await this.indexer.indexPathRel(runtime.info.rootPath, normalized, runtime.db);
    return {
      status: "saved",
      sha256,
      mtimeMs: savedStat.mtimeMs
    };
  }

  async writeBinaryAtomic(request: FileWriteBinaryAtomicRequest): Promise<FileWriteResponse> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    assertWorkspaceWritable(runtime.info.permissions.writable);
    const normalized = normalizeWorkspaceUserPath(request.pathRel);
    const absolutePath = resolveWorkspacePath(runtime.info.rootPath, normalized);
    await mkdir(path.dirname(absolutePath), { recursive: true });

    let diskHash: string | undefined;
    let diskMtimeMs = 0;
    try {
      const current = await readFile(absolutePath);
      const currentStat = await stat(absolutePath);
      diskHash = sha256Buffer(current);
      diskMtimeMs = currentStat.mtimeMs;
    } catch {
      if (request.baseHash !== "new") {
        return { status: "missing" };
      }
    }

    if (diskHash && diskHash !== request.baseHash) {
      return {
        status: "conflict",
        conflict: {
          diskHash,
          mtimeMs: diskMtimeMs
        }
      };
    }

    if (request.createSnapshot && diskHash) {
      await this.history.createSnapshot(runtime.info.rootPath, runtime.db, normalized, "autosave");
    }

    const bytes = binaryDataToBuffer(request.data);
    const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, bytes);
    await replaceFileWithRetry(tmpPath, absolutePath);

    const savedStat = await stat(absolutePath);
    const sha256 = sha256Buffer(bytes);
    await this.indexer.indexPathRel(runtime.info.rootPath, normalized, runtime.db);
    return {
      status: "saved",
      sha256,
      mtimeMs: savedStat.mtimeMs
    };
  }

  async writeExternalAtomic(request: ExternalFileWriteAtomicRequest): Promise<FileWriteResponse> {
    const absolutePath = this.normalizeExternalMarkdownPath(request.filePath);
    let diskHash: string | undefined;
    let diskMtimeMs = 0;
    try {
      const current = await readFile(absolutePath, "utf8");
      const currentStat = await stat(absolutePath);
      diskHash = sha256Text(current);
      diskMtimeMs = currentStat.mtimeMs;
    } catch {
      if (request.baseHash !== "new") {
        return { status: "missing" };
      }
    }

    if (diskHash && diskHash !== request.baseHash) {
      return {
        status: "conflict",
        conflict: {
          diskHash,
          mtimeMs: diskMtimeMs
        }
      };
    }

    await mkdir(path.dirname(absolutePath), { recursive: true });
    const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, request.content, "utf8");
    await replaceFileWithRetry(tmpPath, absolutePath);

    const savedStat = await stat(absolutePath);
    const sha256 = sha256Text(request.content);
    this.externalAssetRoots.add(path.dirname(absolutePath));
    return {
      status: "saved",
      sha256,
      mtimeMs: savedStat.mtimeMs
    };
  }

  async create(request: FileCreateRequest): Promise<{ ok: boolean; affectedPaths: string[] }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    assertWorkspaceWritable(runtime.info.permissions.writable);
    const normalized = normalizeWorkspaceUserPath(request.pathRel);
    const absolutePath = resolveWorkspacePath(runtime.info.rootPath, normalized);
    if (request.kind === "directory") {
      await mkdir(absolutePath, { recursive: true });
    } else {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, request.content ?? "", { encoding: "utf8", flag: "wx" });
    }
    await this.indexer.indexPathRel(runtime.info.rootPath, normalized, runtime.db);
    return { ok: true, affectedPaths: [normalized] };
  }

  async previewRename(request: FileRenamePreviewRequest): Promise<RenameReferencePreview> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const source = normalizeWorkspaceUserPath(request.sourcePathRel);
    const target = normalizeWorkspaceUserPath(request.targetPathRel);
    const changes = isMarkdownPath(source) && isMarkdownPath(target)
      ? await collectReferenceChanges(runtime.info.rootPath, source, target)
      : [];
    return { sourcePathRel: source, targetPathRel: target, changes: changes.map((change) => ({ pathRel: change.pathRel, before: change.before, after: change.after, replacements: change.replacements })) };
  }

  async previewTagRename(request: TagRenamePreviewRequest): Promise<TagRenamePreview> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    await runtime.indexTask;
    const changes = await collectTagRenameChanges(runtime.info.rootPath, runtime.db.listPathsForTag(request.sourceTag), request.sourceTag, request.targetTag);
    return {
      sourceTag: request.sourceTag,
      targetTag: request.targetTag,
      changes,
      replacements: changes.reduce((sum, change) => sum + change.replacements, 0)
    };
  }

  async applyTagRename(request: TagRenameApplyRequest): Promise<TagRenameApplyResponse> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    await runtime.indexTask;
    assertWorkspaceWritable(runtime.info.permissions.writable);
    const changes = await collectTagRenameChanges(runtime.info.rootPath, runtime.db.listPathsForTag(request.sourceTag), request.sourceTag, request.targetTag);
    for (const change of changes) {
      if (request.expectedBaseHashes[change.pathRel] !== change.baseHash) {
        throw new Error(`Tag rename conflict: ${change.pathRel}`);
      }
    }
    const expectedPaths = Object.keys(request.expectedBaseHashes).sort();
    const actualPaths = changes.map((change) => change.pathRel).sort();
    if (expectedPaths.length !== actualPaths.length || expectedPaths.some((pathRel, index) => pathRel !== actualPaths[index])) {
      throw new Error("Tag rename conflict: affected files changed after preview");
    }

    const applied: typeof changes = [];
    try {
      for (const change of changes) {
        const absolutePath = resolveWorkspacePath(runtime.info.rootPath, change.pathRel);
        const current = await readFile(absolutePath, "utf8");
        if (sha256Text(current) !== change.baseHash) throw new Error(`Tag rename conflict: ${change.pathRel}`);
        await this.history.createSnapshot(runtime.info.rootPath, runtime.db, change.pathRel, "manual", current);
        await writeTextAtomic(absolutePath, change.after, "tag-rename");
        applied.push(change);
      }
      for (const change of changes) await this.indexer.indexPathRel(runtime.info.rootPath, change.pathRel, runtime.db);
      await runtime.db.save();
    } catch (error) {
      for (const change of [...applied].reverse()) {
        await writeTextAtomic(resolveWorkspacePath(runtime.info.rootPath, change.pathRel), change.before, "tag-rollback").catch(() => undefined);
      }
      for (const change of applied) await this.indexer.indexPathRel(runtime.info.rootPath, change.pathRel, runtime.db).catch(() => undefined);
      await runtime.db.save().catch(() => undefined);
      throw error;
    }
    return {
      affectedPaths: changes.map((change) => change.pathRel),
      replacements: changes.reduce((sum, change) => sum + change.replacements, 0)
    };
  }

  async rename(request: FileRenameRequest): Promise<{ ok: boolean; affectedPaths: string[]; referenceUpdate?: { updated: number } }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    assertWorkspaceWritable(runtime.info.permissions.writable);
    const source = normalizeWorkspaceUserPath(request.sourcePathRel);
    const target = normalizeWorkspaceUserPath(request.targetPathRel);
    const sourcePath = resolveWorkspacePath(runtime.info.rootPath, source);
    const targetPath = resolveWorkspacePath(runtime.info.rootPath, target);
    const referenceChanges = request.updateReferences && isMarkdownPath(source) && isMarkdownPath(target)
      ? await collectReferenceChanges(runtime.info.rootPath, source, target)
      : [];
    await mkdir(path.dirname(targetPath), { recursive: true });
    let renamed = false;
    const applied: typeof referenceChanges = [];
    try {
      await rename(sourcePath, targetPath);
      renamed = true;
      for (const change of referenceChanges) {
        const absolutePath = resolveWorkspacePath(runtime.info.rootPath, change.pathRel);
        const current = await readFile(absolutePath, "utf8");
        if (sha256Text(current) !== change.baseHash) {
          throw new Error(`Reference update conflict: ${change.pathRel}`);
        }
        await this.history.createSnapshot(runtime.info.rootPath, runtime.db, change.pathRel, "manual", current);
        const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.rename.tmp`;
        await writeFile(tmpPath, change.after, "utf8");
        await replaceFileWithRetry(tmpPath, absolutePath);
        applied.push(change);
      }
      runtime.db.removeFile(source);
      await this.indexer.indexPathRel(runtime.info.rootPath, target, runtime.db);
      for (const change of referenceChanges) await this.indexer.indexPathRel(runtime.info.rootPath, change.pathRel, runtime.db);
    } catch (error) {
      for (const change of [...applied].reverse()) {
        await writeFile(resolveWorkspacePath(runtime.info.rootPath, change.pathRel), change.before, "utf8").catch(() => undefined);
      }
      if (renamed) await rename(targetPath, sourcePath).catch(() => undefined);
      throw error;
    }
    return {
      ok: true,
      affectedPaths: [source, target, ...referenceChanges.map((change) => change.pathRel)],
      referenceUpdate: { updated: referenceChanges.reduce((sum, change) => sum + change.replacements, 0) }
    };
  }

  async trash(request: FileTrashRequest): Promise<{ ok: boolean; affectedPaths: string[] }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    assertWorkspaceWritable(runtime.info.permissions.writable);
    const normalized = normalizeWorkspaceUserPath(request.pathRel);
    const absolutePath = resolveWorkspacePath(runtime.info.rootPath, normalized);
    try {
      await shell.trashItem(absolutePath);
    } catch {
      await rm(absolutePath, { recursive: true, force: true });
    }
    runtime.db.removeFile(normalized);
    await runtime.db.save();
    return { ok: true, affectedPaths: [normalized] };
  }

  async openExternal(request: FileResourceActionRequest): Promise<{ ok: boolean; error?: string }> {
    const absolutePath = this.resolveResourcePath(request);
    const result = await shell.openPath(absolutePath);
    return result ? { ok: false, error: result } : { ok: true };
  }

  revealInFinder(request: FileResourceActionRequest): { ok: boolean } {
    const absolutePath = this.resolveResourcePath(request);
    shell.showItemInFolder(absolutePath);
    return { ok: true };
  }

  resolveExternalAssetPath(assetPath: string): string {
    const absolutePath = path.resolve(assetPath);
    if (!this.isAllowedExternalAsset(absolutePath)) {
      throw new Error("External asset is not allowed");
    }
    return absolutePath;
  }

  private resolveResourcePath(request: FileResourceActionRequest): string {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const normalized = normalizeWorkspaceUserPath(request.pathRel);
    return resolveWorkspacePath(runtime.info.rootPath, normalized);
  }

  private normalizeExternalMarkdownPath(filePath: string): string {
    const absolutePath = path.resolve(filePath);
    if (!isMarkdownPath(absolutePath)) {
      throw new Error("Only Markdown files can be opened directly");
    }
    return absolutePath;
  }

  private isAllowedExternalAsset(absolutePath: string): boolean {
    for (const root of this.externalAssetRoots) {
      const relative = path.relative(root, absolutePath);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        return true;
      }
    }
    return false;
  }
}

interface ReferenceChangeInternal {
  pathRel: string;
  before: string;
  after: string;
  replacements: number;
  baseHash: string;
}

async function collectReferenceChanges(rootPath: string, sourcePathRel: string, targetPathRel: string): Promise<ReferenceChangeInternal[]> {
  const tree = await readTree(rootPath, rootPath, false);
  const markdownFiles = flattenTreeNodes(tree).filter((node) => node.kind === "markdown" && node.pathRel !== sourcePathRel);
  const changes: ReferenceChangeInternal[] = [];
  for (const node of markdownFiles) {
    const absolutePath = resolveWorkspacePath(rootPath, node.pathRel);
    const before = await readFile(absolutePath, "utf8");
    const result = updateMarkdownReferences(before, node.pathRel, sourcePathRel, targetPathRel);
    if (result.replacements) {
      changes.push({ pathRel: node.pathRel, before, after: result.content, replacements: result.replacements, baseHash: sha256Text(before) });
    }
  }
  return changes;
}

function flattenTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenTreeNodes(node.children) : [])]);
}

export function updateMarkdownReferences(content: string, documentPathRel: string, sourcePathRel: string, targetPathRel: string): { content: string; replacements: number } {
  let replacements = 0;
  const sourceStem = sourcePathRel.replace(/\.(?:md|markdown)$/i, "");
  const targetStem = targetPathRel.replace(/\.(?:md|markdown)$/i, "");
  const sourceName = path.posix.basename(sourceStem);
  const targetName = path.posix.basename(targetStem);
  let updated = content.replace(/\[\[([^\]|#]+)(#[^\]|]+)?(\|[^\]]+)?\]\]/g, (full, rawTarget: string, heading = "", alias = "") => {
    const normalized = rawTarget.trim().replace(/^\.\//, "");
    if (![sourcePathRel, sourceStem, sourceName].some((candidate) => candidate.toLowerCase() === normalized.toLowerCase())) return full;
    replacements += 1;
    const nextTarget = normalized.includes("/") ? targetStem : targetName;
    return `[[${nextTarget}${heading}${alias}]]`;
  });
  const documentDir = path.posix.dirname(documentPathRel);
  updated = updated.replace(/\]\((<?)([^)\s>]+)(>?)\)/g, (full, open: string, rawHref: string, close: string) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(rawHref) || rawHref.startsWith("#")) return full;
    const [rawPath, fragment] = rawHref.split(/(?=[?#])/, 2);
    let decoded = rawPath;
    try { decoded = decodeURIComponent(rawPath); } catch { /* keep raw path */ }
    const resolved = path.posix.normalize(path.posix.join(documentDir === "." ? "" : documentDir, decoded));
    if (resolved.toLowerCase() !== sourcePathRel.toLowerCase()) return full;
    let relative = path.posix.relative(documentDir === "." ? "" : documentDir, targetPathRel);
    if (!relative) relative = path.posix.basename(targetPathRel);
    replacements += 1;
    return `](${open}${encodeURI(relative)}${fragment ?? ""}${close})`;
  });
  return { content: updated, replacements };
}

async function collectTagRenameChanges(rootPath: string, paths: string[], sourceTag: string, targetTag: string): Promise<TagRenamePreview["changes"]> {
  const changes: TagRenamePreview["changes"] = [];
  for (const pathRel of paths) {
    const before = await readFile(resolveWorkspacePath(rootPath, pathRel), "utf8");
    const renamed = renameMarkdownTagReferences(before, sourceTag, targetTag);
    if (!renamed.replacements || renamed.content === before) continue;
    changes.push({ pathRel, baseHash: sha256Text(before), before, after: renamed.content, replacements: renamed.replacements });
  }
  return changes;
}

async function writeTextAtomic(absolutePath: string, content: string, operation: string): Promise<void> {
  const tmpPath = `${absolutePath}.${process.pid}.${Date.now()}.${operation}.tmp`;
  await writeFile(tmpPath, content, "utf8");
  await replaceFileWithRetry(tmpPath, absolutePath);
}

async function readTree(rootPath: string, absolutePath: string, showHidden: boolean): Promise<FileTreeNode[]> {
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const visibleEntries = entries.filter((entry) => {
    if (!showHidden && entry.name.startsWith(".")) return false;
    const entryPath = path.join(absolutePath, entry.name);
    const pathRel = toWorkspaceRelative(rootPath, entryPath);
    return !isAlwaysIgnoredWorkspacePath(pathRel);
  });
  const fileNodes = await Promise.all(visibleEntries.filter((entry) => !entry.isDirectory()).map(async (entry) => {
    const entryPath = path.join(absolutePath, entry.name);
    const pathRel = toWorkspaceRelative(rootPath, entryPath);
    const entryStat = await stat(entryPath);
    return {
      pathRel,
      name: entry.name,
      kind: fileKindForPath(entryPath, false),
      size: entryStat.size,
      mtimeMs: entryStat.mtimeMs
    } satisfies FileTreeNode;
  }));
  const directoryNodes: FileTreeNode[] = [];
  for (const entry of visibleEntries.filter((item) => item.isDirectory())) {
    const entryPath = path.join(absolutePath, entry.name);
    const pathRel = toWorkspaceRelative(rootPath, entryPath);
    const [entryStat, children] = await Promise.all([
      stat(entryPath),
      readTree(rootPath, entryPath, showHidden)
    ]);
    directoryNodes.push({
      pathRel,
      name: entry.name,
      kind: "directory",
      size: entryStat.size,
      mtimeMs: entryStat.mtimeMs,
      children
    });
  }
  return [...directoryNodes, ...fileNodes];
}

function sortNodes(nodes: FileTreeNode[], sortBy: "name" | "mtime" | "type"): FileTreeNode[] {
  return nodes
    .map((node) => ({
      ...node,
      children: node.children ? sortNodes(node.children, sortBy) : undefined
    }))
    .sort((a, b) => {
      if (a.kind === "directory" && b.kind !== "directory") {
        return -1;
      }
      if (a.kind !== "directory" && b.kind === "directory") {
        return 1;
      }
      if (sortBy === "mtime") {
        return b.mtimeMs - a.mtimeMs;
      }
      if (sortBy === "type") {
        return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
}

function statInfo(entryStat: Stats): FileStatInfo {
  return {
    size: entryStat.size,
    mtimeMs: entryStat.mtimeMs,
    birthtimeMs: entryStat.birthtimeMs
  };
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

function assertWorkspaceWritable(writable: boolean): void {
  if (!writable) {
    const error = new Error("Workspace is read-only");
    error.name = "WorkspaceReadOnlyError";
    throw error;
  }
}

function binaryDataToBuffer(data: ArrayBuffer | ArrayBufferView): Buffer {
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}
