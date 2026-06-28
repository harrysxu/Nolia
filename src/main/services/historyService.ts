import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES } from "../../shared/constants";
import type { FileHistoryEntry, FileHistoryReadResponse } from "../../shared/types";
import { WorkspaceDb } from "./workspaceDb";
import { normalizePathRel, resolveWorkspacePath } from "../utils/filePaths";
import { sha256Buffer } from "../utils/hash";

export class HistoryService {
  async createSnapshot(
    rootPath: string,
    db: WorkspaceDb,
    pathRel: string,
    reason: "autosave" | "manual" | "conflict" | "restore",
    content?: string
  ): Promise<string | undefined> {
    const normalized = normalizePathRel(pathRel);
    const sourcePath = resolveWorkspacePath(rootPath, normalized);
    let bytes: Buffer;
    if (content !== undefined) {
      bytes = Buffer.from(content, "utf8");
    } else {
      try {
        bytes = await readFile(sourcePath);
      } catch {
        return undefined;
      }
    }

    const sha256 = sha256Buffer(bytes);
    const latest = db.listSnapshots(normalized, 1)[0];
    if (latest?.sha256 === sha256) {
      return undefined;
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const snapshotRel = `${normalized}.${timestamp}.md`;
    const snapshotPath = path.join(rootPath, WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES.snapshots, snapshotRel);
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, bytes);
    const snapshotStat = await stat(snapshotPath);
    db.addSnapshot(normalized, snapshotRel, sha256, reason, snapshotStat.size);
    await db.save();
    return snapshotRel;
  }

  listSnapshots(db: WorkspaceDb, pathRel: string, limit?: number): FileHistoryEntry[] {
    return db.listSnapshots(normalizePathRel(pathRel), limit);
  }

  async readSnapshot(rootPath: string, db: WorkspaceDb, snapshotId: number): Promise<FileHistoryReadResponse | undefined> {
    const entry = db.getSnapshot(snapshotId);
    if (!entry) {
      return undefined;
    }
    const snapshotPath = path.join(rootPath, WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES.snapshots, entry.snapshotPath);
    const content = await readFile(snapshotPath, "utf8");
    return { entry, content };
  }
}
