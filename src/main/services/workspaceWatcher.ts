import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_META_DIR } from "../../shared/constants";
import { WorkspaceDb } from "./workspaceDb";
import { WorkspaceIndexService } from "./workspaceIndexService";
import { isAlwaysIgnoredWorkspacePath, toWorkspaceRelative } from "../utils/filePaths";
import { fileKindForPath } from "../utils/filePaths";
import type { FileTreeNode } from "../../shared/types";

export class WorkspaceWatcher {
  private watcher?: FSWatcher;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly activeTasks = new Set<Promise<void>>();
  private stopped = false;

  constructor(
    private readonly rootPath: string,
    private readonly db: WorkspaceDb,
    private readonly indexer: WorkspaceIndexService,
    private readonly onIndexed: (pathRel: string, operation: "create" | "change" | "delete", node?: FileTreeNode) => void,
    private readonly onError: (error: unknown) => void = () => undefined
  ) {}

  start(): void {
    if (this.watcher) {
      return;
    }
    this.stopped = false;
    try {
      this.watcher = watch(this.rootPath, { recursive: true, persistent: true }, (eventType, fileName) => {
        if (!fileName) {
          return;
        }
        const filePath = path.join(this.rootPath, fileName.toString());
        if (this.shouldIgnore(filePath)) {
          return;
        }
        this.queueRefresh(filePath, eventType === "change" ? "change" : "create");
      });
    } catch (error) {
      this.onError(error);
      return;
    }
    this.watcher.on("error", (error) => this.onError(error));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timeout of this.pending.values()) {
      clearTimeout(timeout);
    }
    this.pending.clear();
    const watcher = this.watcher;
    this.watcher = undefined;
    watcher?.close();
    await Promise.allSettled([...this.activeTasks]);
  }

  private queueRefresh(filePath: string, operation: "create" | "change"): void {
    this.queue(filePath, async (pathRel) => {
      try {
        const entryStat = await stat(filePath);
        await this.indexer.indexPathRel(this.rootPath, pathRel, this.db);
        this.onIndexed(pathRel, operation, {
          pathRel,
          name: path.basename(filePath),
          kind: fileKindForPath(filePath, entryStat.isDirectory()),
          size: entryStat.size,
          mtimeMs: entryStat.mtimeMs,
          children: entryStat.isDirectory() ? [] : undefined
        });
      } catch (error) {
        if (isMissingPathError(error)) {
          await this.indexer.removePathRel(pathRel, this.db);
          this.onIndexed(pathRel, "delete");
          return;
        }
        throw error;
      }
    });
  }

  private queue(filePath: string, task: (pathRel: string) => Promise<void>): void {
    if (this.stopped) {
      return;
    }
    const pathRel = toWorkspaceRelative(this.rootPath, filePath);
    if (isAlwaysIgnoredWorkspacePath(pathRel)) {
      return;
    }
    const existing = this.pending.get(pathRel);
    if (existing) {
      clearTimeout(existing);
    }
    this.pending.set(
      pathRel,
      setTimeout(() => {
        this.pending.delete(pathRel);
        if (this.stopped) {
          return;
        }
        const activeTask = task(pathRel)
          .catch((error: unknown) => this.onError(error))
          .finally(() => {
            this.activeTasks.delete(activeTask);
          });
        this.activeTasks.add(activeTask);
      }, 250)
    );
  }

  private shouldIgnore(filePath: string): boolean {
    try {
      const pathRel = toWorkspaceRelative(this.rootPath, filePath);
      return pathRel === WORKSPACE_META_DIR || pathRel.startsWith(`${WORKSPACE_META_DIR}/`) || isAlwaysIgnoredWorkspacePath(pathRel);
    } catch {
      return false;
    }
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}
