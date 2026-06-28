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
  FileWriteResponse
} from "../../shared/types";
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
    await rename(tmpPath, absolutePath);

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
    await rename(tmpPath, absolutePath);

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
    await rename(tmpPath, absolutePath);

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

  async rename(request: FileRenameRequest): Promise<{ ok: boolean; affectedPaths: string[]; referenceUpdate?: { updated: number } }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
    const source = normalizeWorkspaceUserPath(request.sourcePathRel);
    const target = normalizeWorkspaceUserPath(request.targetPathRel);
    const sourcePath = resolveWorkspacePath(runtime.info.rootPath, source);
    const targetPath = resolveWorkspacePath(runtime.info.rootPath, target);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await rename(sourcePath, targetPath);
    runtime.db.removeFile(source);
    await this.indexer.indexPathRel(runtime.info.rootPath, target, runtime.db);
    return {
      ok: true,
      affectedPaths: [source, target],
      referenceUpdate: { updated: 0 }
    };
  }

  async trash(request: FileTrashRequest): Promise<{ ok: boolean; affectedPaths: string[] }> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId);
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

async function readTree(rootPath: string, absolutePath: string, showHidden: boolean): Promise<FileTreeNode[]> {
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];
  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(absolutePath, entry.name);
    const pathRel = toWorkspaceRelative(rootPath, entryPath);
    if (isAlwaysIgnoredWorkspacePath(pathRel)) {
      continue;
    }
    const entryStat = await stat(entryPath);
    const kind = fileKindForPath(entryPath, entry.isDirectory());
    nodes.push({
      pathRel,
      name: entry.name,
      kind,
      size: entryStat.size,
      mtimeMs: entryStat.mtimeMs,
      children: entry.isDirectory() ? await readTree(rootPath, entryPath, showHidden) : undefined
    });
  }
  return nodes;
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

function binaryDataToBuffer(data: ArrayBuffer | ArrayBufferView): Buffer {
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}
