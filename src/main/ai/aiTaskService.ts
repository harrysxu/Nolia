import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_DIRECTORIES, WORKSPACE_META_DIR } from "../../shared/constants";
import type {
  AiPatchOperation,
  AiPatchProposal,
  AiRunEvent,
  AiTaskApprovalRequest,
  AiTaskCancelRequest,
  AiTaskReadRequest,
  AiTaskRejectRequest,
  AiTaskResumeRequest,
  AiTaskSnapshot,
  AiTaskStartRequest,
  AiTaskStartResponse,
  AiTaskSummary,
  AiTaskUndoWriteRequest,
  AiToolApproval,
  AiWriteTransaction
} from "../../shared/ai";
import { AI_WORKSPACE_PATCH_OPERATION_LIMIT } from "../../shared/ai";
import { isMarkdownPath, normalizeWorkspaceUserPath } from "../utils/filePaths";
import { sha256Text } from "../utils/hash";
import { AiService } from "./aiService";
import type { AiRuntimeServices } from "./types";

export class AiTaskService {
  private readonly activeRuns = new Map<string, string>();
  private readonly activeTaskIdsByRun = new Map<string, string>();
  private readonly activeTasks = new Map<string, AiTaskSnapshot>();
  private readonly pendingEventsByRun = new Map<string, AiRunEvent[]>();
  private readonly pendingEventCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly ai: AiService,
    private readonly services: AiRuntimeServices,
    private readonly emit: (event: AiRunEvent) => void
  ) {}

  async start(request: AiTaskStartRequest): Promise<AiTaskStartResponse> {
    const task = await this.createTask(request);
    this.activeTasks.set(task.id, task);
    const response = this.ai.startRun(request);
    task.runId = response.runId;
    task.updatedAt = Date.now();
    this.activeRuns.set(task.id, response.runId);
    this.activeTaskIdsByRun.set(response.runId, task.id);
    await this.flushPendingRunEvents(response.runId);
    await this.saveTask(task);
    this.emit({ type: "task-updated", runId: task.runId, task: taskSummary(task) });
    return { taskId: task.id, runId: response.runId };
  }

  async list(): Promise<AiTaskSummary[]> {
    const tasks = await this.readAllTasks();
    return tasks.map(taskSummary).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async read(request: AiTaskReadRequest): Promise<AiTaskSnapshot | undefined> {
    return this.readTask(request.taskId);
  }

  async resume(request: AiTaskResumeRequest): Promise<AiTaskSummary | undefined> {
    const task = await this.readTask(request.taskId);
    if (!task) {
      return undefined;
    }
    if (task.status === "running") {
      task.status = "interrupted";
      task.lastError = "上次运行在应用关闭或任务中断时结束，请重新发起任务或处理待确认操作。";
      task.updatedAt = Date.now();
      await this.saveTask(task);
    }
    this.emit({ type: "task-restored", runId: task.runId, task: taskSummary(task) });
    return taskSummary(task);
  }

  async cancel(request: AiTaskCancelRequest): Promise<{ ok: boolean }> {
    const task = await this.readTask(request.taskId);
    if (!task) {
      return { ok: false };
    }
    const runId = this.activeRuns.get(task.id) ?? task.runId;
    this.ai.cancelRun({ runId });
    task.status = "cancelled";
    task.updatedAt = Date.now();
    await this.saveTask(task);
    this.activeRuns.delete(task.id);
    this.activeTaskIdsByRun.delete(task.runId);
    this.activeTasks.delete(task.id);
    this.emit({ type: "task-updated", runId: task.runId, task: taskSummary(task) });
    return { ok: true };
  }

  async approveProposal(request: AiTaskApprovalRequest): Promise<AiTaskSnapshot | undefined> {
    const task = await this.readTask(request.taskId);
    if (!task) {
      return undefined;
    }
    const approval = task.approvals.find((item) => item.id === request.approvalId);
    const proposal = task.proposals.find((item) => item.approvalId === request.approvalId || item.id === approval?.proposalId);
    if (!approval || !proposal) {
      throw new Error("AI task approval was not found");
    }
    if (approval.status !== "pending") {
      return task;
    }
    await this.applyProposal(task, proposal, request.selectedOperationIds);
    approval.status = "approved";
    proposal.status = "applied";
    task.steps.push({ id: randomUUID(), index: task.steps.length + 1, kind: "write", title: "Applied AI proposal", summary: proposal.summary, createdAt: Date.now() });
    task.status = "completed";
    task.pendingApprovalId = undefined;
    task.updatedAt = Date.now();
    await this.saveTask(task);
    this.activeRuns.delete(task.id);
    this.activeTaskIdsByRun.delete(task.runId);
    this.activeTasks.delete(task.id);
    this.emit({ type: "task-updated", runId: task.runId, task: taskSummary(task) });
    return task;
  }

  async rejectProposal(request: AiTaskRejectRequest): Promise<AiTaskSnapshot | undefined> {
    const task = await this.readTask(request.taskId);
    if (!task) {
      return undefined;
    }
    const approval = task.approvals.find((item) => item.id === request.approvalId);
    const proposal = task.proposals.find((item) => item.approvalId === request.approvalId || item.id === approval?.proposalId);
    if (!approval) {
      throw new Error("AI task approval was not found");
    }
    approval.status = "rejected";
    if (proposal) {
      proposal.status = "rejected";
    }
    task.steps.push({ id: randomUUID(), index: task.steps.length + 1, kind: "approval", title: "Rejected AI proposal", summary: request.reason || "用户拒绝了本次写入建议。", createdAt: Date.now() });
    task.status = "completed";
    task.pendingApprovalId = undefined;
    task.updatedAt = Date.now();
    await this.saveTask(task);
    this.activeRuns.delete(task.id);
    this.activeTaskIdsByRun.delete(task.runId);
    this.activeTasks.delete(task.id);
    this.emit({ type: "task-updated", runId: task.runId, task: taskSummary(task) });
    return task;
  }

  async undoWrite(request: AiTaskUndoWriteRequest): Promise<AiTaskSnapshot | undefined> {
    const task = await this.readTask(request.taskId);
    if (!task) {
      return undefined;
    }
    const transaction = task.writes.find((item) => item.id === request.transactionId);
    if (!transaction || transaction.undoneAt) {
      return task;
    }
    if (transaction.status !== "committed") {
      throw new Error(`transaction_not_committed: ${transaction.id} is ${transaction.status}`);
    }
    for (const operation of [...transaction.operations].reverse()) {
      if (operation.status === "rolled_back") {
        continue;
      }
      if (operation.movedPath && operation.targetPathRel) {
        await this.services.files.rename({ workspaceId: transaction.workspaceId, sourcePathRel: operation.targetPathRel, targetPathRel: operation.pathRel });
        continue;
      }
      if (operation.createdFile) {
        const current = await this.services.files.readFile({ workspaceId: transaction.workspaceId, pathRel: operation.pathRel });
        if (operation.afterHash && current.sha256 !== operation.afterHash) {
          throw new Error(`transaction_precondition_failed: ${operation.pathRel} changed after the AI transaction`);
        }
        await this.services.files.trash({ workspaceId: transaction.workspaceId, pathRel: operation.pathRel });
        continue;
      }
      if (operation.createdDirectory) {
        await this.services.files.trash({ workspaceId: transaction.workspaceId, pathRel: operation.pathRel });
        continue;
      }
      const beforeContent = await this.readTransactionBeforeContent(transaction.workspaceId, operation);
      const current = await this.services.files.readFile({ workspaceId: transaction.workspaceId, pathRel: operation.pathRel });
      if (operation.afterHash && current.sha256 !== operation.afterHash) {
        throw new Error(`transaction_precondition_failed: ${operation.pathRel} changed after the AI transaction`);
      }
      const restored = await this.services.files.writeAtomic({
        workspaceId: transaction.workspaceId,
        pathRel: operation.pathRel,
        content: beforeContent,
        baseHash: current.sha256,
        createSnapshot: true
      });
      if (restored.status !== "saved") {
        throw new Error(`Undo failed for ${operation.pathRel}: ${restored.status}`);
      }
    }
    transaction.undoneAt = Date.now();
    transaction.status = "rolled_back";
    task.steps.push({ id: randomUUID(), index: task.steps.length + 1, kind: "write", title: "Undid AI write transaction", summary: transaction.proposalId, createdAt: Date.now() });
    task.updatedAt = Date.now();
    await this.saveTask(task);
    this.emit({ type: "task-updated", runId: task.runId, task: taskSummary(task) });
    return task;
  }

  async recordEvent(event: AiRunEvent): Promise<void> {
    if (isTaskServiceEvent(event)) {
      return;
    }
    if (!this.activeTaskIdsByRun.has(event.runId)) {
      this.bufferPendingRunEvent(event);
      return;
    }
    const task = await this.taskForRun(event.runId);
    if (!task) {
      this.bufferPendingRunEvent(event);
      return;
    }
    if (event.type === "text-delta" || event.type === "usage") {
      return;
    }
    if (event.type === "tool-call") {
      task.steps.push({ id: randomUUID(), index: task.steps.length + 1, kind: "tool", title: event.toolName, summary: event.inputSummary, createdAt: Date.now() });
    } else if (event.type === "tool-result") {
      task.steps.push({ id: randomUUID(), index: task.steps.length + 1, kind: "tool", title: event.toolName, summary: event.resultSummary, createdAt: Date.now() });
      task.sources = dedupeSources([...task.sources, ...(event.sourceRefs ?? [])]);
    } else if (event.type === "source-used") {
      task.sources = dedupeSources([...task.sources, event.source]);
    } else if (event.type === "patch-proposal") {
      const approval = createApproval(task, event.proposal);
      const proposal = {
        ...event.proposal,
        operations: await this.prepareProposalOperations(event.proposal),
        taskId: task.id,
        approvalId: approval.id,
        createdAt: Date.now(),
        status: "pending" as const
      };
      task.proposals.push(proposal);
      task.approvals.push(approval);
      task.status = "waiting_approval";
      task.pendingApprovalId = approval.id;
      this.emit({ type: "approval-required", runId: task.runId, approval, proposal });
    } else if (event.type === "error") {
      task.status = "failed";
      task.lastError = event.message;
      task.steps.push({ id: randomUUID(), index: task.steps.length + 1, kind: "error", title: event.code, summary: event.message, createdAt: Date.now() });
    } else if (event.type === "cancelled") {
      task.status = "cancelled";
    } else if (event.type === "done" && task.status !== "waiting_approval") {
      task.status = "completed";
    } else if (event.type === "run-started") {
      task.status = "running";
    }
    task.updatedAt = Date.now();
    await this.saveTask(task);
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      this.activeRuns.delete(task.id);
      this.activeTaskIdsByRun.delete(task.runId);
      this.activeTasks.delete(task.id);
    }
    this.emit({ type: "task-updated", runId: task.runId, task: taskSummary(task) });
  }

  async markInterruptedRunningTasks(): Promise<void> {
    const tasks = await this.readAllTasks();
    for (const task of tasks) {
      if (task.status !== "running" && task.status !== "queued") {
        continue;
      }
      task.status = "interrupted";
      task.lastError = "任务在应用关闭或进程中断时停止。";
      task.updatedAt = Date.now();
      await this.saveTask(task);
    }
  }

  private async createTask(request: AiTaskStartRequest): Promise<AiTaskSnapshot> {
    const now = Date.now();
    const task: AiTaskSnapshot = {
      id: randomUUID(),
      runId: "",
      workspaceId: request.clientContext.workspaceId,
      title: request.title ?? request.instruction.slice(0, 80),
      status: "queued",
      createdAt: now,
      updatedAt: now,
      instruction: request.instruction,
      steps: [{ id: randomUUID(), index: 1, kind: "model", title: "Task created", summary: request.instruction, createdAt: now }],
      sources: [],
      approvals: [],
      proposals: [],
      writes: []
    };
    await this.saveTask(task);
    return task;
  }

  private async applyProposal(task: AiTaskSnapshot, proposal: AiPatchProposal, selectedOperationIds?: string[]): Promise<AiWriteTransaction> {
    if (proposal.operations.length > AI_WORKSPACE_PATCH_OPERATION_LIMIT) {
      throw new Error(`AI proposal exceeds the ${AI_WORKSPACE_PATCH_OPERATION_LIMIT}-operation limit`);
    }
    const selected = selectProposalOperations(proposal.operations, selectedOperationIds);
    validateProposalOperations(selected, proposal.pathRel);
    await this.assertProposalPreconditions(proposal.workspaceId, selected, proposal.pathRel);
    const executionOrder = [...selected].sort((left, right) => operationExecutionRank(left) - operationExecutionRank(right));
    const transaction: AiWriteTransaction = {
      id: randomUUID(),
      taskId: proposal.taskId ?? proposal.runId,
      proposalId: proposal.id,
      workspaceId: proposal.workspaceId,
      createdAt: Date.now(),
      status: "prepared",
      operations: []
    };
    task.writes.push(transaction);
    task.updatedAt = Date.now();
    await this.saveTask(task);
    try {
      for (const operation of executionOrder) {
        const pathRel = operationTargetPath(operation, proposal.pathRel);
        const operationId = operation.id;
        if (operation.type === "createDirectory") {
          if (!pathRel) {
            throw new Error("AI workspace operation path is required.");
          }
          await this.services.files.create({ workspaceId: proposal.workspaceId, pathRel, kind: "directory" });
          transaction.operations.push({ pathRel, beforeSnapshotId: undefined, beforeHash: "new", afterHash: "directory", createdDirectory: true, operationId, status: "applied" });
          continue;
        }
        if (operation.type === "movePath") {
          await this.services.files.rename({ workspaceId: proposal.workspaceId, sourcePathRel: operation.sourcePathRel, targetPathRel: operation.targetPathRel });
          transaction.operations.push({ pathRel: operation.sourcePathRel, targetPathRel: operation.targetPathRel, beforeHash: "move", afterHash: "move", movedPath: true, operationId, status: "applied" });
          continue;
        }
        if (!pathRel || !isMarkdownPath(pathRel)) {
          throw new Error("AI 工作区操作只能修改 Markdown 文件。");
        }
        if (operation.type === "createFile") {
          await this.services.files.create({ workspaceId: proposal.workspaceId, pathRel, kind: "file", content: operation.afterText });
          const snapshot = await this.services.files.createHistorySnapshot({ workspaceId: proposal.workspaceId, pathRel, reason: "manual", content: operation.afterText });
          transaction.operations.push({ pathRel, beforeSnapshotId: undefined, beforeHash: "new", afterHash: snapshot.entry?.sha256 ?? sha256Text(operation.afterText), createdFile: true, operationId, status: "applied" });
          continue;
        }
        const current = await this.services.files.readFile({ workspaceId: proposal.workspaceId, pathRel });
        const beforeSnapshot = await this.services.files.createHistorySnapshot({ workspaceId: proposal.workspaceId, pathRel, reason: "manual", content: current.content });
        const nextContent = applyPatchOperation(current.content, operation);
        const result = await this.services.files.writeAtomic({
          workspaceId: proposal.workspaceId,
          pathRel,
          content: nextContent,
          baseHash: current.sha256,
          createSnapshot: false
        });
        if (result.status !== "saved") {
          throw new Error(`${pathRel}: ${result.status === "conflict" ? "保存冲突" : "保存失败"}`);
        }
        transaction.operations.push({ pathRel, beforeSnapshotId: beforeSnapshot.entry?.id, beforeContent: current.content, beforeHash: current.sha256, afterHash: result.sha256, createdFile: false, operationId, status: "applied" });
      }
      transaction.status = "committed";
      await this.saveTask(task);
      return transaction;
    } catch (error) {
      try {
        await this.rollbackTransactionOperations(transaction);
        transaction.status = "rolled_back";
      } catch (rollbackError) {
        transaction.status = "rollback_failed";
        transaction.operations.push({ pathRel: "", status: "failed", error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) });
      }
      task.updatedAt = Date.now();
      await this.saveTask(task);
      throw error;
    }
  }

  private async prepareProposalOperations(proposal: AiPatchProposal): Promise<AiPatchOperation[]> {
    const prepared = withOperationMetadata(proposal.operations);
    return Promise.all(prepared.map(async (operation) => {
      if (operation.type === "createDirectory" || operation.type === "createFile") {
        return { ...operation, baseHash: "new" };
      }
      if (operation.type === "movePath") {
        let baseHash = "exists";
        if (isMarkdownPath(operation.sourcePathRel)) {
          try {
            baseHash = (await this.services.files.readFile({ workspaceId: proposal.workspaceId, pathRel: operation.sourcePathRel })).sha256;
          } catch {
            // Directory moves use an existence precondition instead of a content hash.
          }
        }
        return { ...operation, baseHash, targetBaseHash: "new" };
      }
      const pathRel = operationTargetPath(operation, proposal.pathRel);
      const current = await this.services.files.readFile({ workspaceId: proposal.workspaceId, pathRel });
      return { ...operation, baseHash: current.sha256 };
    }));
  }

  private async assertProposalPreconditions(workspaceId: string, operations: AiPatchOperation[], fallbackPath: string): Promise<void> {
    for (const operation of operations) {
      if (operation.type === "createDirectory" || operation.type === "createFile") {
        if (await this.workspacePathExists(workspaceId, operation.pathRel)) {
          throw new Error(`transaction_precondition_failed: ${operation.pathRel} already exists`);
        }
        continue;
      }
      if (operation.type === "movePath") {
        if (!(await this.workspacePathExists(workspaceId, operation.sourcePathRel))) {
          throw new Error(`transaction_precondition_failed: ${operation.sourcePathRel} is missing`);
        }
        if (await this.workspacePathExists(workspaceId, operation.targetPathRel)) {
          throw new Error(`transaction_precondition_failed: ${operation.targetPathRel} already exists`);
        }
        if (operation.baseHash && operation.baseHash !== "exists" && isMarkdownPath(operation.sourcePathRel)) {
          const current = await this.services.files.readFile({ workspaceId, pathRel: operation.sourcePathRel });
          if (current.sha256 !== operation.baseHash) {
            throw new Error(`transaction_precondition_failed: ${operation.sourcePathRel} changed after proposal`);
          }
        }
        continue;
      }
      const pathRel = operationTargetPath(operation, fallbackPath);
      const current = await this.services.files.readFile({ workspaceId, pathRel });
      if (!operation.baseHash || current.sha256 !== operation.baseHash) {
        throw new Error(`transaction_precondition_failed: ${pathRel} changed after proposal`);
      }
    }
  }

  private async workspacePathExists(workspaceId: string, pathRel: string): Promise<boolean> {
    const parent = pathRel.split("/").slice(0, -1).join("/");
    try {
      const tree = await this.services.files.listTree({ workspaceId, root: parent, sortBy: "name", showHidden: true });
      return tree.nodes.some((node) => node.pathRel === pathRel);
    } catch {
      return false;
    }
  }

  private async rollbackTransactionOperations(transaction: AiWriteTransaction): Promise<void> {
    for (const operation of [...transaction.operations].reverse()) {
      if (operation.movedPath && operation.targetPathRel) {
        await this.services.files.rename({ workspaceId: transaction.workspaceId, sourcePathRel: operation.targetPathRel, targetPathRel: operation.pathRel });
      } else if (operation.createdFile || operation.createdDirectory) {
        await this.services.files.trash({ workspaceId: transaction.workspaceId, pathRel: operation.pathRel });
      } else if (!operation.createdFile && !operation.createdDirectory && !operation.movedPath) {
        const beforeContent = await this.readTransactionBeforeContent(transaction.workspaceId, operation);
        const current = await this.services.files.readFile({ workspaceId: transaction.workspaceId, pathRel: operation.pathRel });
        const restored = await this.services.files.writeAtomic({ workspaceId: transaction.workspaceId, pathRel: operation.pathRel, content: beforeContent, baseHash: current.sha256, createSnapshot: false });
        if (restored.status !== "saved") throw new Error(`Rollback failed for ${operation.pathRel}: ${restored.status}`);
      }
      operation.status = "rolled_back";
    }
  }

  private async readTransactionBeforeContent(
    workspaceId: string,
    operation: AiWriteTransaction["operations"][number]
  ): Promise<string> {
    if (operation.beforeContent !== undefined) return operation.beforeContent;
    if (operation.beforeSnapshotId) {
      const snapshot = await this.services.files.readHistory({ workspaceId, snapshotId: operation.beforeSnapshotId });
      if (snapshot) return snapshot.content;
    }
    throw new Error(`Missing rollback snapshot for ${operation.pathRel}`);
  }

  private async taskForRun(runId: string): Promise<AiTaskSnapshot | undefined> {
    const activeTaskId = this.activeTaskIdsByRun.get(runId);
    if (activeTaskId) {
      return this.activeTasks.get(activeTaskId) ?? this.readTask(activeTaskId);
    }
    const tasks = await this.readAllTasks();
    const activeTaskIdAfterRead = this.activeTaskIdsByRun.get(runId);
    if (activeTaskIdAfterRead) {
      return this.activeTasks.get(activeTaskIdAfterRead) ?? this.readTask(activeTaskIdAfterRead);
    }
    return tasks.find((task) => task.runId === runId);
  }

  private bufferPendingRunEvent(event: AiRunEvent): void {
    const events = this.pendingEventsByRun.get(event.runId) ?? [];
    if (events.length >= 50) {
      events.shift();
    }
    events.push(event);
    this.pendingEventsByRun.set(event.runId, events);
    if (!this.pendingEventCleanupTimers.has(event.runId)) {
      this.pendingEventCleanupTimers.set(event.runId, setTimeout(() => {
        this.pendingEventsByRun.delete(event.runId);
        this.pendingEventCleanupTimers.delete(event.runId);
      }, 30_000));
    }
  }

  private async flushPendingRunEvents(runId: string): Promise<void> {
    const pending = this.pendingEventsByRun.get(runId);
    if (!pending?.length) {
      return;
    }
    this.pendingEventsByRun.delete(runId);
    const cleanup = this.pendingEventCleanupTimers.get(runId);
    if (cleanup) {
      clearTimeout(cleanup);
      this.pendingEventCleanupTimers.delete(runId);
    }
    for (const event of pending) {
      await this.recordEvent(event);
    }
  }

  private async readAllTasks(): Promise<AiTaskSnapshot[]> {
    const active = this.services.workspaces.getActiveWorkspace();
    if (!active) {
      return [];
    }
    const stored = active.db.listAiTasks().map(normalizeStoredTask);
    if (stored.length) {
      return stored;
    }
    const dir = tasksDir(active.info.rootPath);
    try {
      const entries = await readdir(dir);
      const tasks = await Promise.all(entries.filter((entry) => entry.endsWith(".json")).map((entry) => readTaskFile(path.join(dir, entry))));
      const migrated = tasks.filter((task): task is AiTaskSnapshot => Boolean(task)).map(normalizeStoredTask);
      for (const task of migrated) active.db.saveAiTask(task);
      if (migrated.length) await active.db.save();
      return migrated;
    } catch {
      return [];
    }
  }

  private async readTask(taskId: string): Promise<AiTaskSnapshot | undefined> {
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      return activeTask;
    }
    const active = this.services.workspaces.getActiveWorkspace();
    if (!active) {
      return undefined;
    }
    const stored = active.db.readAiTask(taskId);
    if (stored) return normalizeStoredTask(stored);
    const legacy = await readTaskFile(path.join(tasksDir(active.info.rootPath), `${safeTaskId(taskId)}.json`));
    if (legacy) {
      const task = normalizeStoredTask(legacy);
      active.db.saveAiTask(task);
      await active.db.save();
      return task;
    }
    return undefined;
  }

  private async saveTask(task: AiTaskSnapshot): Promise<void> {
    const workspaceId = task.workspaceId;
    if (!workspaceId) {
      return;
    }
    const runtime = this.services.workspaces.requireWorkspace(workspaceId);
    runtime.db.saveAiTask(task);
    await runtime.db.save();
  }
}

function taskSummary(task: AiTaskSnapshot): AiTaskSummary {
  return {
    id: task.id,
    runId: task.runId,
    workspaceId: task.workspaceId,
    title: task.title,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    lastError: task.lastError,
    pendingApprovalId: task.pendingApprovalId
  };
}

function createApproval(task: AiTaskSnapshot, proposal: AiPatchProposal): AiToolApproval {
  return {
    id: randomUUID(),
    taskId: task.id,
    runId: task.runId,
    toolName: "proposal",
    input: proposal.operations,
    status: "pending",
    createdAt: Date.now(),
    proposalId: proposal.id
  };
}

function applyPatchOperation(current: string, operation: AiPatchOperation): string {
  if (operation.type === "replaceDocument") {
    if (operation.beforeText && operation.beforeText !== current) {
      throw new Error("AI 修改建议的基线内容与当前文件不一致。");
    }
    return operation.afterText;
  }
  if (operation.type === "append") {
    return `${current.replace(/\s*$/, "")}\n\n${operation.afterText.trim()}\n`;
  }
  if (operation.type === "insertAt") {
    return `${current.slice(0, operation.offset)}${operation.afterText}${current.slice(operation.offset)}`;
  }
  if (operation.type === "replaceRange") {
    const before = current.slice(operation.range.from, operation.range.to);
    if (operation.beforeText && before !== operation.beforeText) {
      throw new Error("AI 修改建议的选区基线与当前文件不一致。");
    }
    return `${current.slice(0, operation.range.from)}${operation.afterText}${current.slice(operation.range.to)}`;
  }
  throw new Error("Unsupported AI patch operation");
}

function withOperationMetadata(operations: AiPatchOperation[]): AiPatchOperation[] {
  const identified = operations.map((operation, index) => ({ ...operation, id: operation.id ?? `operation-${index + 1}` }));
  const directories = identified.flatMap((operation) => operation.type === "createDirectory" ? [{ pathRel: operation.pathRel, id: operation.id }] : []);
  return identified.map((operation) => {
    const target = operation.type === "movePath" ? operation.targetPathRel : "pathRel" in operation ? operation.pathRel : undefined;
    const inferred = target
      ? directories.filter((directory) => target !== directory.pathRel && target.startsWith(`${directory.pathRel}/`)).map((directory) => directory.id)
      : [];
    return { ...operation, dependsOn: [...new Set([...(operation.dependsOn ?? []), ...inferred])] } as AiPatchOperation;
  });
}

function selectProposalOperations(operations: AiPatchOperation[], selectedOperationIds?: string[]): AiPatchOperation[] {
  const prepared = withOperationMetadata(operations);
  if (!selectedOperationIds) return prepared;
  if (!selectedOperationIds.length) {
    throw new Error("AI proposal approval must select at least one operation");
  }
  const byId = new Map(prepared.map((operation) => [operation.id!, operation]));
  const unknown = selectedOperationIds.find((id) => !byId.has(id));
  if (unknown) {
    throw new Error(`AI proposal operation was not found: ${unknown}`);
  }
  const selected = new Set(selectedOperationIds);
  const includeDependencies = (id: string) => {
    const operation = byId.get(id);
    if (!operation) return;
    for (const dependency of operation.dependsOn ?? []) {
      if (!byId.has(dependency)) {
        throw new Error(`AI proposal dependency was not found: ${dependency}`);
      }
      if (!selected.has(dependency)) {
        selected.add(dependency);
        includeDependencies(dependency);
      }
    }
  };
  [...selected].forEach(includeDependencies);
  return prepared.filter((operation) => selected.has(operation.id!));
}

function operationExecutionRank(operation: AiPatchOperation): number {
  if (operation.type === "createDirectory") return 0;
  if (operation.type === "movePath") return 1;
  return 2;
}

function validateProposalOperations(operations: AiPatchOperation[], fallbackPath: string): void {
  for (const operation of operations) {
    if (operation.type === "movePath") {
      normalizeWorkspaceUserPath(operation.sourcePathRel);
      normalizeWorkspaceUserPath(operation.targetPathRel);
      continue;
    }
    const pathRel = operationTargetPath(operation, fallbackPath);
    if (operation.type !== "createDirectory" && !isMarkdownPath(pathRel)) {
      throw new Error("AI 工作区操作只能修改 Markdown 文件。");
    }
  }
}

function operationTargetPath(operation: AiPatchOperation, fallback: string): string {
  const pathRel = "pathRel" in operation && operation.pathRel ? operation.pathRel : fallback;
  return normalizeWorkspaceUserPath(pathRel);
}

function dedupeSources(sources: AiTaskSnapshot["sources"]): AiTaskSnapshot["sources"] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.kind}:${source.pathRel ?? ""}:${source.title ?? ""}:${source.snippet ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isTaskServiceEvent(event: AiRunEvent): boolean {
  return event.type === "task-updated" || event.type === "approval-required" || event.type === "task-restored";
}

function tasksDir(rootPath: string): string {
  return path.join(rootPath, WORKSPACE_META_DIR, WORKSPACE_DIRECTORIES.aiTasks);
}

function safeTaskId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

async function readTaskFile(filePath: string): Promise<AiTaskSnapshot | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as AiTaskSnapshot;
  } catch {
    return undefined;
  }
}

function normalizeStoredTask(task: AiTaskSnapshot): AiTaskSnapshot {
  return {
    ...task,
    writes: task.writes.map((transaction) => ({
      ...transaction,
      status: transaction.status ?? (transaction.undoneAt ? "rolled_back" : "committed"),
      operations: transaction.operations.map((operation) => ({ ...operation, status: operation.status ?? "applied" }))
    }))
  };
}
