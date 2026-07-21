import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { AiRunEvent, AiTaskStartRequest } from "../src/shared/ai";
import { AiTaskService } from "../src/main/ai/aiTaskService";
import { DiagnosticsService } from "../src/main/services/diagnosticsService";
import { FileSystemService } from "../src/main/services/fileSystemService";
import { HistoryService } from "../src/main/services/historyService";
import { SettingsService } from "../src/main/services/settingsService";
import { WorkspaceService } from "../src/main/services/workspaceService";

describe("AI task service", () => {
  it("persists proposal approvals, writes files, and can undo the write transaction", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    let workspaces: WorkspaceService | undefined;
    try {
      await writeFile(path.join(workspaceRoot, "note.md"), "# Note\n\nOriginal.");

      const settings = new SettingsService(userData);
      await settings.init();
      await settings.setSetting("ai", {
        enabled: true,
        providers: [
          {
            id: "openai-compatible",
            name: "OpenAI-compatible",
            providerId: "openai-compatible",
            model: "gpt-4.1",
            baseUrl: "https://api.example.test/v1",
            apiMode: "chat-completions"
          }
        ],
        defaultProviderId: "openai-compatible",
        allowWorkspaceRead: true,
        allowWorkspaceOperations: true
      });
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      workspaces = new WorkspaceService(settings, diagnostics);
      const workspace = await workspaces.createWorkspace({ path: workspaceRoot });
      expect(workspace).toBeDefined();

      const files = new FileSystemService(workspaces, new HistoryService());
      const runtimeServices = { workspaces, files, settings, diagnostics };
      const ai = {
        startRun: () => ({ runId: "run-1" }),
        cancelRun: () => ({ ok: true })
      };
      const emitted: AiRunEvent[] = [];
      const tasks = new AiTaskService(ai as never, runtimeServices, (event) => emitted.push(event));

      const started = await tasks.start(taskRequest(workspace!.workspaceId));
      await tasks.recordEvent({
        type: "patch-proposal",
        runId: started.runId,
        proposal: {
          id: "proposal-1",
          runId: started.runId,
          workspaceId: workspace!.workspaceId,
          pathRel: "note.md",
          title: "note.md",
          summary: "Replace note",
          sourceSnapshotHash: "original",
          baseHash: "original",
          operations: [
            {
              type: "replaceDocument",
              pathRel: "note.md",
              beforeText: "# Note\n\nOriginal.",
              afterText: "# Note\n\nUpdated by AI."
            }
          ]
        }
      });

      const waiting = await tasks.read({ taskId: started.taskId });
      expect(waiting?.status).toBe("waiting_approval");
      const approvalId = waiting?.pendingApprovalId;
      expect(approvalId).toBeTruthy();

      const applied = await tasks.approveProposal({ taskId: started.taskId, approvalId: approvalId! });
      expect(applied?.status).toBe("completed");
      expect(await readFile(path.join(workspaceRoot, "note.md"), "utf8")).toBe("# Note\n\nUpdated by AI.");
      expect(applied?.writes).toHaveLength(1);
      expect((await files.listHistory({ workspaceId: workspace!.workspaceId, pathRel: "note.md" })).entries.length).toBeGreaterThanOrEqual(1);

      await writeFile(path.join(workspaceRoot, "note.md"), "# Note\n\nUser edit after AI.");
      await expect(tasks.undoWrite({ taskId: started.taskId, transactionId: applied!.writes[0].id })).rejects.toThrow("transaction_precondition_failed");
      expect(await readFile(path.join(workspaceRoot, "note.md"), "utf8")).toBe("# Note\n\nUser edit after AI.");
      await writeFile(path.join(workspaceRoot, "note.md"), "# Note\n\nUpdated by AI.");
      const undone = await tasks.undoWrite({ taskId: started.taskId, transactionId: applied!.writes[0].id });
      expect(undone?.writes[0].undoneAt).toBeTypeOf("number");
      expect(await readFile(path.join(workspaceRoot, "note.md"), "utf8")).toBe("# Note\n\nOriginal.");
      expect(emitted.map((event) => event.type)).toContain("approval-required");
      expect(emitted.map((event) => event.type)).toContain("task-updated");
    } finally {
      await workspaces?.closeActiveWorkspace();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("applies and undoes folder creation and move workspace proposals", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    let workspaces: WorkspaceService | undefined;
    try {
      await mkdir(path.join(workspaceRoot, "docs"), { recursive: true });
      await writeFile(path.join(workspaceRoot, "docs", "guide.md"), "# Guide\n\nOriginal.");

      const settings = new SettingsService(userData);
      await settings.init();
      await settings.setSetting("ai", {
        enabled: true,
        providers: [
          {
            id: "openai-compatible",
            name: "OpenAI-compatible",
            providerId: "openai-compatible",
            model: "gpt-4.1",
            baseUrl: "https://api.example.test/v1",
            apiMode: "chat-completions"
          }
        ],
        defaultProviderId: "openai-compatible",
        allowWorkspaceRead: true,
        allowWorkspaceOperations: true
      });
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      workspaces = new WorkspaceService(settings, diagnostics);
      const workspace = await workspaces.createWorkspace({ path: workspaceRoot });
      expect(workspace).toBeDefined();

      const files = new FileSystemService(workspaces, new HistoryService());
      const runtimeServices = { workspaces, files, settings, diagnostics };
      const ai = {
        startRun: () => ({ runId: "run-folder-move" }),
        cancelRun: () => ({ ok: true })
      };
      const emitted: AiRunEvent[] = [];
      const tasks = new AiTaskService(ai as never, runtimeServices, (event) => emitted.push(event));

      const started = await tasks.start(taskRequest(workspace!.workspaceId));
      await tasks.recordEvent({
        type: "patch-proposal",
        runId: started.runId,
        proposal: {
          id: "proposal-folder-move",
          runId: started.runId,
          workspaceId: workspace!.workspaceId,
          pathRel: "archive",
          title: "Archive guide",
          summary: "Create archive and move guide",
          sourceSnapshotHash: "new",
          baseHash: "new",
          operations: [
            { id: "move-guide", type: "movePath", sourcePathRel: "docs/guide.md", targetPathRel: "archive/guide.md" },
            { id: "create-archive", type: "createDirectory", pathRel: "archive" }
          ]
        }
      });

      const waiting = await tasks.read({ taskId: started.taskId });
      expect(waiting?.status).toBe("waiting_approval");
      const approvalId = waiting?.pendingApprovalId;
      expect(approvalId).toBeTruthy();

      const applied = await tasks.approveProposal({ taskId: started.taskId, approvalId: approvalId!, selectedOperationIds: ["move-guide"] });

      expect(applied?.status).toBe("completed");
      expect(await pathExists(path.join(workspaceRoot, "archive"))).toBe(true);
      expect(await readFile(path.join(workspaceRoot, "archive", "guide.md"), "utf8")).toBe("# Guide\n\nOriginal.");
      expect(await pathExists(path.join(workspaceRoot, "docs", "guide.md"))).toBe(false);
      expect(applied?.writes[0].operations).toMatchObject([
        { pathRel: "archive", createdDirectory: true },
        { pathRel: "docs/guide.md", targetPathRel: "archive/guide.md", movedPath: true }
      ]);

      const undone = await tasks.undoWrite({ taskId: started.taskId, transactionId: applied!.writes[0].id });

      expect(undone?.writes[0].undoneAt).toBeTypeOf("number");
      expect(await readFile(path.join(workspaceRoot, "docs", "guide.md"), "utf8")).toBe("# Guide\n\nOriginal.");
      expect(await pathExists(path.join(workspaceRoot, "archive", "guide.md"))).toBe(false);
      expect(await pathExists(path.join(workspaceRoot, "archive"))).toBe(false);
      expect(emitted.map((event) => event.type)).toContain("approval-required");
      expect(emitted.map((event) => event.type)).toContain("task-updated");
    } finally {
      await workspaces?.closeActiveWorkspace();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects approval when any selected file changed after the proposal", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    let workspaces: WorkspaceService | undefined;
    try {
      await writeFile(path.join(workspaceRoot, "a.md"), "# A\n\nOriginal A.\n");
      await writeFile(path.join(workspaceRoot, "b.md"), "# B\n\nOriginal B.\n");
      const settings = new SettingsService(userData);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      workspaces = new WorkspaceService(settings, diagnostics);
      const workspace = await workspaces.createWorkspace({ path: workspaceRoot });
      const files = new FileSystemService(workspaces, new HistoryService());
      const tasks = new AiTaskService({
        startRun: () => ({ runId: "run-precondition" }),
        cancelRun: () => ({ ok: true })
      } as never, { workspaces, files, settings, diagnostics }, () => undefined);

      const started = await tasks.start(taskRequest(workspace!.workspaceId));
      await tasks.recordEvent({
        type: "patch-proposal",
        runId: started.runId,
        proposal: {
          id: "proposal-precondition",
          runId: started.runId,
          workspaceId: workspace!.workspaceId,
          pathRel: "a.md",
          title: "Two files",
          summary: "Append to both files",
          sourceSnapshotHash: "captured",
          baseHash: "captured",
          operations: [
            { id: "append-a", type: "append", pathRel: "a.md", afterText: "AI A" },
            { id: "append-b", type: "append", pathRel: "b.md", afterText: "AI B" }
          ]
        }
      });
      const waiting = await tasks.read({ taskId: started.taskId });
      await writeFile(path.join(workspaceRoot, "b.md"), "# B\n\nChanged outside Nolia.\n");

      await expect(tasks.approveProposal({ taskId: started.taskId, approvalId: waiting!.pendingApprovalId! }))
        .rejects.toThrow("transaction_precondition_failed: b.md changed after proposal");
      expect(await readFile(path.join(workspaceRoot, "a.md"), "utf8")).toBe("# A\n\nOriginal A.\n");
      expect(await readFile(path.join(workspaceRoot, "b.md"), "utf8")).toBe("# B\n\nChanged outside Nolia.\n");
      expect((await tasks.read({ taskId: started.taskId }))?.writes).toHaveLength(0);
    } finally {
      await workspaces?.closeActiveWorkspace();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("persists rolled-back and rollback-failed states when multi-file writes fail", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    let workspaces: WorkspaceService | undefined;
    try {
      const originalA = "# A\n\nOriginal A.\n";
      const originalB = "# B\n\nOriginal B.\n";
      await writeFile(path.join(workspaceRoot, "a.md"), originalA);
      await writeFile(path.join(workspaceRoot, "b.md"), originalB);

      const settings = new SettingsService(userData);
      await settings.init();
      await settings.setSetting("ai", {
        enabled: true,
        providers: [{
          id: "openai-compatible",
          name: "OpenAI-compatible",
          providerId: "openai-compatible",
          model: "test",
          baseUrl: "https://api.example.test/v1",
          apiMode: "chat-completions"
        }],
        defaultProviderId: "openai-compatible",
        allowWorkspaceRead: true,
        allowWorkspaceOperations: true
      });
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      workspaces = new WorkspaceService(settings, diagnostics);
      const workspace = await workspaces.createWorkspace({ path: workspaceRoot });
      expect(workspace).toBeDefined();

      const files = new FileSystemService(workspaces, new HistoryService());
      const originalWriteAtomic = files.writeAtomic.bind(files);
      let runIndex = 0;
      const tasks = new AiTaskService({
        startRun: () => ({ runId: `run-failure-${++runIndex}` }),
        cancelRun: () => ({ ok: true })
      } as never, { workspaces, files, settings, diagnostics }, () => undefined);

      const prepareProposal = async (id: string) => {
        const started = await tasks.start(taskRequest(workspace!.workspaceId));
        await tasks.recordEvent({
          type: "patch-proposal",
          runId: started.runId,
          proposal: {
            id,
            runId: started.runId,
            workspaceId: workspace!.workspaceId,
            pathRel: "a.md",
            title: "Failure injection",
            summary: "Append to two files",
            sourceSnapshotHash: "failure-test",
            baseHash: "failure-test",
            operations: [
              { type: "append", pathRel: "a.md", afterText: "Applied A." },
              { type: "append", pathRel: "b.md", afterText: "Applied B." }
            ]
          }
        });
        const waiting = await tasks.read({ taskId: started.taskId });
        expect(waiting?.pendingApprovalId).toBeTruthy();
        return { taskId: started.taskId, approvalId: waiting!.pendingApprovalId! };
      };

      let writeAttempt = 0;
      files.writeAtomic = async (request) => {
        writeAttempt += 1;
        if (writeAttempt === 2) throw new Error("Injected second-file failure");
        return originalWriteAtomic(request);
      };
      const recoverable = await prepareProposal("proposal-rollback");
      await expect(tasks.approveProposal(recoverable)).rejects.toThrow("Injected second-file failure");
      const rolledBack = await tasks.read({ taskId: recoverable.taskId });
      expect(rolledBack?.writes.at(-1)?.status).toBe("rolled_back");
      expect(rolledBack?.writes.at(-1)?.operations.every((operation) => operation.status === "rolled_back")).toBe(true);
      expect(await readFile(path.join(workspaceRoot, "a.md"), "utf8")).toBe(originalA);
      expect(await readFile(path.join(workspaceRoot, "b.md"), "utf8")).toBe(originalB);

      writeAttempt = 0;
      files.writeAtomic = async (request) => {
        writeAttempt += 1;
        if (writeAttempt >= 2) throw new Error(writeAttempt === 2 ? "Injected apply failure" : "Injected rollback failure");
        return originalWriteAtomic(request);
      };
      const unrecoverable = await prepareProposal("proposal-rollback-failed");
      await expect(tasks.approveProposal(unrecoverable)).rejects.toThrow("Injected apply failure");
      const rollbackFailed = await tasks.read({ taskId: unrecoverable.taskId });
      expect(rollbackFailed?.writes.at(-1)?.status).toBe("rollback_failed");
      expect(rollbackFailed?.writes.at(-1)?.operations.at(-1)).toMatchObject({ status: "failed", error: "Injected rollback failure" });
      expect(await readFile(path.join(workspaceRoot, "a.md"), "utf8")).toContain("Applied A.");
      expect(await readFile(path.join(workspaceRoot, "b.md"), "utf8")).toBe(originalB);
      expect(rollbackFailed?.status).not.toBe("completed");
    } finally {
      await workspaces?.closeActiveWorkspace();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 15_000);

  it("records run events that arrive before the task file is updated with the run id", async () => {
    const userData = await makeTempDir();
    const home = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    let workspaces: WorkspaceService | undefined;
    try {
      await writeFile(path.join(workspaceRoot, "race.md"), "# Race\n\nOriginal.");

      const settings = new SettingsService(userData);
      await settings.init();
      await settings.setSetting("ai", {
        enabled: true,
        providers: [
          {
            id: "openai-compatible",
            name: "OpenAI-compatible",
            providerId: "openai-compatible",
            model: "gpt-4.1",
            baseUrl: "https://api.example.test/v1",
            apiMode: "chat-completions"
          }
        ],
        defaultProviderId: "openai-compatible",
        allowWorkspaceRead: true,
        allowWorkspaceOperations: true
      });
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      workspaces = new WorkspaceService(settings, diagnostics);
      const workspace = await workspaces.createWorkspace({ path: workspaceRoot });
      expect(workspace).toBeDefined();

      const files = new FileSystemService(workspaces, new HistoryService());
      const runtimeServices = { workspaces, files, settings, diagnostics };
      let tasks: AiTaskService;
      const ai = {
        startRun: () => {
          void tasks.recordEvent({
            type: "patch-proposal",
            runId: "run-race",
            proposal: {
              id: "proposal-race",
              runId: "run-race",
              workspaceId: workspace!.workspaceId,
              pathRel: "race.md",
              title: "race.md",
              summary: "Race proposal",
              sourceSnapshotHash: "original",
              baseHash: "original",
              operations: [
                {
                  type: "replaceDocument",
                  pathRel: "race.md",
                  beforeText: "# Race\n\nOriginal.",
                  afterText: "# Race\n\nUpdated."
                }
              ]
            }
          });
          return { runId: "run-race" };
        },
        cancelRun: () => ({ ok: true })
      };
      const emitted: AiRunEvent[] = [];
      tasks = new AiTaskService(ai as never, runtimeServices, (event) => emitted.push(event));

      const started = await tasks.start(taskRequest(workspace!.workspaceId));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const waiting = await tasks.read({ taskId: started.taskId });
      expect(waiting?.status).toBe("waiting_approval");
      expect(waiting?.proposals).toHaveLength(1);
      expect(waiting?.pendingApprovalId).toBeTruthy();
      expect(emitted.map((event) => event.type)).toContain("approval-required");
    } finally {
      await workspaces?.closeActiveWorkspace();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function taskRequest(workspaceId: string): AiTaskStartRequest {
  return {
    entryPoint: "chat",
    instruction: "更新 note.md",
    clientContext: { workspaceId },
    options: {
      allowTools: false,
      allowWorkspaceRead: true,
      allowWorkspaceOperations: true
    }
  };
}

async function makeTempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nolia-ai-task-"));
  await mkdir(root, { recursive: true });
  return root;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
