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
});

async function makeTempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nolia-test-"));
  await mkdir(root, { recursive: true });
  return root;
}

async function readDiskBytes(filePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(filePath));
}
