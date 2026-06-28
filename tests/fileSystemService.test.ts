import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DiagnosticsService } from "../src/main/services/diagnosticsService";
import { FileSystemService } from "../src/main/services/fileSystemService";
import { HistoryService } from "../src/main/services/historyService";
import { SettingsService } from "../src/main/services/settingsService";
import { WorkspaceService } from "../src/main/services/workspaceService";

describe("file system binary operations", () => {
  it("creates, lists, and reads text history snapshots", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    let workspaces: WorkspaceService | undefined;
    try {
      await writeFile(path.join(workspaceRoot, "note.md"), "# Note\n\nDisk content.");

      const settings = new SettingsService(userData);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      workspaces = new WorkspaceService(settings, diagnostics);
      const workspace = await workspaces.createWorkspace({ path: workspaceRoot });
      expect(workspace).toBeDefined();

      const files = new FileSystemService(workspaces, new HistoryService());
      const created = await files.createHistorySnapshot({
        workspaceId: workspace!.workspaceId,
        pathRel: "note.md",
        reason: "manual",
        content: "# Note\n\nUnsaved content."
      });
      expect(created.entry?.reason).toBe("manual");

      const history = await files.listHistory({ workspaceId: workspace!.workspaceId, pathRel: "note.md" });
      expect(history.entries).toHaveLength(1);
      const read = await files.readHistory({ workspaceId: workspace!.workspaceId, snapshotId: history.entries[0].id });
      expect(read?.content).toBe("# Note\n\nUnsaved content.");
    } finally {
      await workspaces?.closeActiveWorkspace();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("reads and writes workspace binary files atomically with conflict checks", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    let workspaces: WorkspaceService | undefined;
    try {
      const initialBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
      await writeFile(path.join(workspaceRoot, "sample.pdf"), initialBytes);

      const settings = new SettingsService(userData);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      workspaces = new WorkspaceService(settings, diagnostics);
      const workspace = await workspaces.createWorkspace({ path: workspaceRoot });
      expect(workspace).toBeDefined();

      const files = new FileSystemService(workspaces, new HistoryService());
      const read = await files.readBinaryFile({ workspaceId: workspace!.workspaceId, pathRel: "sample.pdf" });
      expect([...new Uint8Array(read.data)]).toEqual([...initialBytes]);
      expect(read.encoding).toBe("binary");
      expect(read.mimeType).toBe("application/pdf");

      const nextBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x01, 0x02]).buffer;
      const saved = await files.writeBinaryAtomic({
        workspaceId: workspace!.workspaceId,
        pathRel: "sample.pdf",
        data: nextBytes,
        baseHash: read.sha256,
        createSnapshot: true
      });
      expect(saved.status).toBe("saved");
      expect([...await readDiskBytes(path.join(workspaceRoot, "sample.pdf"))]).toEqual([...new Uint8Array(nextBytes)]);

      const conflict = await files.writeBinaryAtomic({
        workspaceId: workspace!.workspaceId,
        pathRel: "sample.pdf",
        data: new Uint8Array([1, 2, 3]).buffer,
        baseHash: read.sha256
      });
      expect(conflict.status).toBe("conflict");
    } finally {
      await workspaces?.closeActiveWorkspace();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects renderer-exposed operations for internal workspace paths", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    let workspaces: WorkspaceService | undefined;
    try {
      await writeFile(path.join(workspaceRoot, "note.md"), "# Note\n");
      await mkdir(path.join(workspaceRoot, ".git"), { recursive: true });
      await mkdir(path.join(workspaceRoot, "node_modules", "pkg"), { recursive: true });
      await writeFile(path.join(workspaceRoot, ".git", "config"), "[core]\n");
      await writeFile(path.join(workspaceRoot, "node_modules", "pkg", "index.js"), "module.exports = {};\n");

      const settings = new SettingsService(userData);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      workspaces = new WorkspaceService(settings, diagnostics);
      const workspace = await workspaces.createWorkspace({ path: workspaceRoot });
      expect(workspace).toBeDefined();

      const files = new FileSystemService(workspaces, new HistoryService());
      const workspaceId = workspace!.workspaceId;
      const ignoredPathError = "Workspace path is ignored";

      await expect(files.listTree({ workspaceId, root: ".git" })).rejects.toThrow(ignoredPathError);
      await expect(files.readFile({ workspaceId, pathRel: ".nolia/workspace.json" })).rejects.toThrow(ignoredPathError);
      await expect(files.readBinaryFile({ workspaceId, pathRel: "node_modules/pkg/index.js" })).rejects.toThrow(ignoredPathError);
      await expect(files.listHistory({ workspaceId, pathRel: ".git/config" })).rejects.toThrow(ignoredPathError);
      await expect(files.createHistorySnapshot({ workspaceId, pathRel: ".nolia/private.md", reason: "manual", content: "# Private" })).rejects.toThrow(ignoredPathError);
      await expect(files.writeAtomic({ workspaceId, pathRel: ".nolia/private.md", content: "# Private", baseHash: "new" })).rejects.toThrow(ignoredPathError);
      await expect(files.writeBinaryAtomic({ workspaceId, pathRel: ".git/asset.bin", data: new Uint8Array([1, 2, 3]).buffer, baseHash: "new" })).rejects.toThrow(ignoredPathError);
      await expect(files.create({ workspaceId, pathRel: "node_modules/pkg/created.md", kind: "file", content: "# Created" })).rejects.toThrow(ignoredPathError);
      await expect(files.rename({ workspaceId, sourcePathRel: ".git/config", targetPathRel: "config.md" })).rejects.toThrow(ignoredPathError);
      await expect(files.rename({ workspaceId, sourcePathRel: "note.md", targetPathRel: ".nolia/note.md" })).rejects.toThrow(ignoredPathError);
      await expect(files.trash({ workspaceId, pathRel: ".nolia/workspace.json" })).rejects.toThrow(ignoredPathError);
      await expect(files.openExternal({ workspaceId, pathRel: ".git/config" })).rejects.toThrow(ignoredPathError);
      expect(() => files.revealInFinder({ workspaceId, pathRel: "node_modules/pkg/index.js" })).toThrow(ignoredPathError);

      await expect(readFile(path.join(workspaceRoot, ".nolia", "private.md"), "utf8")).rejects.toThrow();
      await expect(readFile(path.join(workspaceRoot, "node_modules", "pkg", "created.md"), "utf8")).rejects.toThrow();
    } finally {
      await workspaces?.closeActiveWorkspace();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

async function makeTempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nolia-test-"));
  await mkdir(root, { recursive: true });
  return root;
}

async function readDiskBytes(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(filePath));
}
