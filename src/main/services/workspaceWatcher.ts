import chokidar, { type FSWatcher } from "chokidar";

import { WORKSPACE_META_DIR } from "../../shared/constants";
import { WorkspaceDb } from "./workspaceDb";
import { WorkspaceIndexService } from "./workspaceIndexService";
import { isAlwaysIgnoredWorkspacePath, toWorkspaceRelative } from "../utils/filePaths";

export class WorkspaceWatcher {
  private watcher?: FSWatcher;
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly rootPath: string,
    private readonly db: WorkspaceDb,
    private readonly indexer: WorkspaceIndexService,
    private readonly onIndexed: (pathRel: string) => void
  ) {}

  start(): void {
    this.watcher = chokidar.watch(this.rootPath, {
      ignored: (filePath) => this.shouldIgnore(filePath),
      ignoreInitial: true,
      persistent: true
    });

    this.watcher
      .on("add", (filePath) => this.queueIndex(filePath))
      .on("change", (filePath) => this.queueIndex(filePath))
      .on("unlink", (filePath) => this.queueRemove(filePath))
      .on("addDir", (filePath) => this.queueIndex(filePath))
      .on("unlinkDir", (filePath) => this.queueRemove(filePath));
  }

  async stop(): Promise<void> {
    for (const timeout of this.pending.values()) {
      clearTimeout(timeout);
    }
    this.pending.clear();
    await this.watcher?.close();
  }

  private queueIndex(filePath: string): void {
    this.queue(filePath, async (pathRel) => {
      await this.indexer.indexPathRel(this.rootPath, pathRel, this.db);
      this.onIndexed(pathRel);
    });
  }

  private queueRemove(filePath: string): void {
    this.queue(filePath, async (pathRel) => {
      await this.indexer.removePathRel(pathRel, this.db);
      this.onIndexed(pathRel);
    });
  }

  private queue(filePath: string, task: (pathRel: string) => Promise<void>): void {
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
        void task(pathRel);
      }, 250)
    );
  }

  private shouldIgnore(filePath: string): boolean {
    if (filePath.includes(`/${WORKSPACE_META_DIR}/`)) {
      return true;
    }
    try {
      return isAlwaysIgnoredWorkspacePath(toWorkspaceRelative(this.rootPath, filePath));
    } catch {
      return false;
    }
  }
}
