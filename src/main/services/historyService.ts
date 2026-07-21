import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES } from "../../shared/constants";
import type { FileHistoryEntry, FileHistoryReadResponse } from "../../shared/types";
import { WorkspaceDb } from "./workspaceDb";
import { fileKindForPath, normalizePathRel, resolveWorkspacePath } from "../utils/filePaths";
import { sha256Buffer } from "../utils/hash";

export interface HistoryRetentionPolicy {
  maxAutosaveSnapshotsPerDocument: number;
  maxWorkspaceSnapshotBytes: number;
}

export const DEFAULT_HISTORY_RETENTION_POLICY: HistoryRetentionPolicy = {
  maxAutosaveSnapshotsPerDocument: 50,
  maxWorkspaceSnapshotBytes: 1024 * 1024 * 1024
};

export class HistoryService {
  private readonly retentionPolicy: HistoryRetentionPolicy;

  constructor(retentionPolicy: Partial<HistoryRetentionPolicy> = {}) {
    this.retentionPolicy = {
      ...DEFAULT_HISTORY_RETENTION_POLICY,
      ...retentionPolicy
    };
  }

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
    if (!db.getFileId(normalized)) {
      let sourceStat;
      try {
        sourceStat = await stat(sourcePath);
      } catch {
        return undefined;
      }
      db.upsertFile({
        pathRel: normalized,
        name: path.basename(normalized),
        ext: path.extname(normalized).toLowerCase(),
        kind: fileKindForPath(sourcePath, false),
        size: sourceStat.size,
        mtimeMs: sourceStat.mtimeMs,
        ctimeMs: sourceStat.ctimeMs,
        sha256
      });
    }
    const latest = db.listSnapshots(normalized, 1)[0];
    if (latest?.sha256 === sha256) {
      return undefined;
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const snapshotRel = `${normalized}.${timestamp}-${randomUUID()}.md`;
    const snapshotPath = path.join(rootPath, WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES.snapshots, snapshotRel);
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, bytes);
    const snapshotStat = await stat(snapshotPath);
    db.addSnapshot(normalized, snapshotRel, sha256, reason, snapshotStat.size);
    await this.pruneSnapshots(rootPath, db, normalized);
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
    const snapshotPath = resolveSnapshotPath(rootPath, entry.snapshotPath);
    const content = await readFile(snapshotPath, "utf8");
    return { entry, content };
  }

  private async pruneSnapshots(rootPath: string, db: WorkspaceDb, pathRel: string): Promise<void> {
    const removals = new Map<number, FileHistoryEntry>();
    const documentAutosaves = db
      .listSnapshotsForRetention(pathRel)
      .filter((entry) => entry.reason === "autosave");
    for (const entry of documentAutosaves.slice(this.retentionPolicy.maxAutosaveSnapshotsPerDocument)) {
      removals.set(entry.id, entry);
    }

    const allSnapshots = db.listSnapshotsForRetention();
    let retainedBytes = allSnapshots.reduce((total, entry) => total + (removals.has(entry.id) ? 0 : entry.size), 0);
    if (retainedBytes > this.retentionPolicy.maxWorkspaceSnapshotBytes) {
      const oldestAutosaves = allSnapshots
        .filter((entry) => entry.reason === "autosave" && !removals.has(entry.id))
        .sort((left, right) => left.createdAt - right.createdAt || left.id - right.id);
      for (const entry of oldestAutosaves) {
        if (retainedBytes <= this.retentionPolicy.maxWorkspaceSnapshotBytes) {
          break;
        }
        removals.set(entry.id, entry);
        retainedBytes -= entry.size;
      }
    }

    if (!removals.size) {
      return;
    }
    await Promise.all(
      [...removals.values()].map((entry) =>
        rm(resolveSnapshotPath(rootPath, entry.snapshotPath), { force: true })
      )
    );
    db.deleteSnapshots([...removals.keys()]);
  }
}

function resolveSnapshotPath(rootPath: string, snapshotPathRel: string): string {
  const normalized = normalizePathRel(snapshotPathRel);
  return resolveWorkspacePath(rootPath, path.posix.join(WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES.snapshots, normalized));
}
