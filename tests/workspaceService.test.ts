import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiagnosticsService } from "../src/main/services/diagnosticsService";
import { SettingsService } from "../src/main/services/settingsService";
import { WorkspaceIndexService } from "../src/main/services/workspaceIndexService";
import { WorkspaceService } from "../src/main/services/workspaceService";

describe("workspace service startup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows recent workspaces on cold startup without automatically reopening the last workspace", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    try {
      const settings = new SettingsService(userData);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      const runningService = new WorkspaceService(settings, diagnostics);
      const opened = await runningService.createWorkspace({ path: workspaceRoot });

      expect(opened).toBeDefined();
      expect((await runningService.bootstrap()).activeWorkspace?.workspaceId).toBe(opened?.workspaceId);

      await runningService.closeActiveWorkspace();

      const statePath = path.join(userData, "global-state.json");
      const legacyState = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>;
      legacyState.activeWorkspaceId = opened?.workspaceId;
      await writeFile(statePath, `${JSON.stringify(legacyState, null, 2)}\n`, "utf8");

      const reloadedSettings = new SettingsService(userData);
      await reloadedSettings.init();
      const coldService = new WorkspaceService(reloadedSettings, diagnostics);
      const coldState = await coldService.bootstrap();

      expect(coldState.activeWorkspace).toBeUndefined();
      expect(coldState.recentWorkspaces.map((workspace) => workspace.workspaceId)).toContain(opened?.workspaceId);
    } finally {
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("does not initialize plain folders through open workspace", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    try {
      const settings = new SettingsService(userData);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      const service = new WorkspaceService(settings, diagnostics);

      await expect(service.openWorkspace({ path: workspaceRoot })).rejects.toThrow("不是 Nolia 工作区");
      await expect(pathExists(path.join(workspaceRoot, ".nolia", "workspace.json"))).resolves.toBe(false);

      const created = await service.createWorkspace({ path: workspaceRoot });
      expect(created).toBeDefined();
      await service.closeActiveWorkspace();

      const reopened = await service.openWorkspace({ path: workspaceRoot });
      expect(reopened?.workspaceId).toBe(created?.workspaceId);
    } finally {
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns from workspace creation before the full index rebuild finishes", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    let finishIndex!: () => void;
    const indexStarted = vi.fn();
    const indexedEvents: string[] = [];
    const rebuildSpy = vi.spyOn(WorkspaceIndexService.prototype, "rebuildWorkspace").mockImplementation(async () => {
      indexStarted();
      await new Promise<void>((resolve) => {
        finishIndex = resolve;
      });
    });

    try {
      const settings = new SettingsService(userData);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      const service = new WorkspaceService(settings, diagnostics, (event) => {
        indexedEvents.push(event.pathRel);
      });

      const opened = await Promise.race([
        service.createWorkspace({ path: workspaceRoot }),
        sleep(50).then(() => "blocked" as const)
      ]);

      expect(opened).not.toBe("blocked");
      expect(indexStarted).toHaveBeenCalledTimes(1);
      expect(rebuildSpy).toHaveBeenCalledTimes(1);
      expect(typeof opened).toBe("object");
      expect(service.getActiveWorkspace()?.info.indexState.status).toBe("indexing");

      finishIndex();
      await vi.waitFor(() => expect(service.getActiveWorkspace()?.info.indexState.status).toBe("ready"));
      expect(indexedEvents).toContain("");
      await service.closeActiveWorkspace();
    } finally {
      finishIndex?.();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "nolia-workspace-"));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
