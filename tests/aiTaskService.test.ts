import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
