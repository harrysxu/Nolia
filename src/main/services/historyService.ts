import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES } from "../../shared/constants";
import { WorkspaceDb } from "./workspaceDb";
import { normalizePathRel, resolveWorkspacePath } from "../utils/filePaths";
import { sha256Buffer } from "../utils/hash";

export class HistoryService {
  async createSnapshot(
    rootPath: string,
    db: WorkspaceDb,
    pathRel: string,
    reason: "autosave" | "manual" | "conflict" | "restore"
  ): Promise<string | undefined> {
    const normalized = normalizePathRel(pathRel);
    const sourcePath = resolveWorkspacePath(rootPath, normalized);
    let bytes: Buffer;
    try {
      bytes = await readFile(sourcePath);
    } catch {
      return undefined;
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-");
    const snapshotRel = `${normalized}.${timestamp}.md`;
    const snapshotPath = path.join(rootPath, WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES.snapshots, snapshotRel);
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, bytes);
    const snapshotStat = await stat(snapshotPath);
    db.addSnapshot(normalized, snapshotRel, sha256Buffer(bytes), reason, snapshotStat.size);
    await db.save();
    return snapshotRel;
  }
}
