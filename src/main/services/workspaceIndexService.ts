import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { parseMarkdown } from "../../shared/markdown";
import { WorkspaceDb } from "./workspaceDb";
import { fileKindForPath, isAlwaysIgnoredWorkspacePath, normalizePathRel, toWorkspaceRelative } from "../utils/filePaths";
import { sha256Text } from "../utils/hash";

interface IndexProgress {
  indexed: number;
  total: number;
}

type ProgressListener = (progress: IndexProgress) => void;

interface RebuildOptions {
  signal?: AbortSignal;
}

export class WorkspaceIndexService {
  async rebuildWorkspace(rootPath: string, db: WorkspaceDb, onProgress?: ProgressListener, options: RebuildOptions = {}): Promise<void> {
    const filePaths = await collectFiles(rootPath, options.signal);
    throwIfAborted(options.signal);
    const currentPathRels = new Set(filePaths.map((absolutePath) => toWorkspaceRelative(rootPath, absolutePath)));

    for (const [index, absolutePath] of filePaths.entries()) {
      throwIfAborted(options.signal);
      await this.indexAbsolutePath(rootPath, absolutePath, db);
      onProgress?.({ indexed: index + 1, total: filePaths.length });
    }

    db.markMissingFilesDeleted(currentPathRels);
    await db.save();
  }

  async indexPathRel(rootPath: string, pathRel: string, db: WorkspaceDb): Promise<void> {
    const absolutePath = path.join(rootPath, normalizePathRel(pathRel));
    try {
      await this.indexAbsolutePath(rootPath, absolutePath, db);
    } catch {
      db.removeFile(normalizePathRel(pathRel));
    }
    await db.save();
  }

  async removePathRel(pathRel: string, db: WorkspaceDb): Promise<void> {
    db.removeFile(normalizePathRel(pathRel));
    await db.save();
  }

  private async indexAbsolutePath(rootPath: string, absolutePath: string, db: WorkspaceDb): Promise<void> {
    const entryStat = await stat(absolutePath);
    const pathRel = toWorkspaceRelative(rootPath, absolutePath);
    if (isAlwaysIgnoredWorkspacePath(pathRel)) {
      return;
    }

    const kind = fileKindForPath(absolutePath, entryStat.isDirectory());
    const baseEntry = {
      pathRel,
      name: path.basename(absolutePath),
      ext: path.extname(absolutePath).toLowerCase(),
      kind,
      size: entryStat.size,
      mtimeMs: entryStat.mtimeMs,
      ctimeMs: entryStat.ctimeMs
    };

    if (kind !== "markdown") {
      if (!db.shouldIndexFile(baseEntry)) {
        return;
      }
      db.upsertFile(baseEntry);
      return;
    }

    const content = await readFile(absolutePath, "utf8");
    const sha256 = sha256Text(content);
    const entry = {
      ...baseEntry,
      sha256
    };
    if (!db.shouldIndexFile(entry)) {
      return;
    }
    db.upsertDocument(
      entry,
      parseMarkdown(content, pathRel)
    );
  }
}

async function collectFiles(rootPath: string, signal?: AbortSignal): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    throwIfAborted(signal);
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      throwIfAborted(signal);
      const absolutePath = path.join(current, entry.name);
      const pathRel = toWorkspaceRelative(rootPath, absolutePath);
      if (shouldSkip(pathRel, entry.name)) {
        continue;
      }
      results.push(absolutePath);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      }
    }
  }

  await walk(rootPath);
  return results;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("Workspace indexing was cancelled");
  }
}

function shouldSkip(pathRel: string, name: string): boolean {
  return name === ".DS_Store" || isAlwaysIgnoredWorkspacePath(pathRel);
}
