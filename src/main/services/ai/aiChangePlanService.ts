import { randomUUID } from "node:crypto";

import type {
  AiChangePlanApplyRequest,
  AiChangePlanApplyResponse,
  AiChangePlanOperation,
  AiChangePlanPrepareRequest,
  AiChangePlanPrepareResponse
} from "../../../shared/ai";
import { normalizePathRel } from "../../utils/filePaths";
import { FileSystemService } from "../fileSystemService";
import { WorkspaceService } from "../workspaceService";

type RawChange = Record<string, unknown>;

export class AiChangePlanService {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly files: FileSystemService
  ) {}

  async prepare(request: AiChangePlanPrepareRequest): Promise<AiChangePlanPrepareResponse> {
    this.workspaces.requireWorkspace(request.workspaceId);
    const warnings: string[] = [];
    const parsed = parsePlanSource(request.sourceText);
    if (!parsed.changes.length) {
      return {
        planId: randomUUID(),
        sourceText: request.sourceText,
        operations: [],
        warnings,
        error: "未识别到有效的 AI 变更计划。"
      };
    }

    const operations: AiChangePlanOperation[] = [];
    for (const [index, raw] of parsed.changes.entries()) {
      const operation = await this.prepareOperation(request.workspaceId, raw, index, warnings);
      if (operation) {
        operations.push(operation);
      }
    }

    return {
      planId: randomUUID(),
      sourceText: request.sourceText,
      summary: parsed.summary,
      operations,
      warnings,
      error: operations.length ? undefined : "AI 变更计划没有可执行的变更。"
    };
  }

  async apply(request: AiChangePlanApplyRequest): Promise<AiChangePlanApplyResponse> {
    this.workspaces.requireWorkspace(request.workspaceId);
    const acceptedIds = request.acceptedOperationIds?.length ? new Set(request.acceptedOperationIds) : undefined;
    const operations: AiChangePlanOperation[] = [];
    for (const operation of request.plan.operations) {
      if (acceptedIds && !acceptedIds.has(operation.id)) {
        operations.push({ ...operation, status: operation.status === "pending" ? "rejected" : operation.status });
        continue;
      }
      if (operation.status === "rejected" || operation.status === "applied") {
        operations.push(operation);
        continue;
      }
      operations.push(await this.applyOperation(request.workspaceId, operation));
    }
    return {
      planId: request.plan.planId,
      operations,
      appliedCount: operations.filter((operation) => operation.status === "applied").length,
      conflictCount: operations.filter((operation) => operation.status === "conflict").length,
      errorCount: operations.filter((operation) => operation.status === "error").length
    };
  }

  private async prepareOperation(
    workspaceId: string,
    raw: RawChange,
    index: number,
    warnings: string[]
  ): Promise<AiChangePlanOperation | undefined> {
    const action = parseAction(raw.action);
    const pathRel = typeof raw.pathRel === "string" ? normalizePlanPath(raw.pathRel) : undefined;
    const targetPathValue = raw.targetPathRel ?? raw.newPathRel ?? raw.toPathRel ?? raw.to;
    const targetPathRel = typeof targetPathValue === "string" ? normalizePlanPath(targetPathValue) : undefined;
    const contentValue = raw.content ?? raw.newContent ?? raw.markdown ?? raw.after;
    const content = typeof contentValue === "string" ? ensureTrailingNewline(contentValue.trimEnd()) : undefined;
    const title = typeof raw.title === "string" ? raw.title.trim() : undefined;
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `ai-change-${index + 1}-${randomUUID().slice(0, 8)}`;

    if (!action || !pathRel) {
      warnings.push(`已跳过第 ${index + 1} 个变更：缺少 action 或 pathRel。`);
      return undefined;
    }
    if ((action === "create" || action === "modify") && !content?.trim()) {
      warnings.push(`已跳过 ${pathRel}：创建/修改必须提供完整 content。`);
      return undefined;
    }
    if (action === "rename" && !targetPathRel) {
      warnings.push(`已跳过 ${pathRel}：重命名必须提供 targetPathRel。`);
      return undefined;
    }

    const baseOperation: AiChangePlanOperation = {
      id,
      action,
      pathRel,
      targetPathRel,
      title,
      content,
      after: content,
      status: "pending"
    };

    if (action === "create") {
      const existing = await this.tryRead(workspaceId, pathRel);
      return existing
        ? {
            ...baseOperation,
            before: existing.content,
            baseHash: existing.sha256,
            diff: buildUnifiedDiff(pathRel, existing.content, content ?? ""),
            status: "conflict",
            message: "目标文件已存在，不能作为创建操作直接写入。"
          }
        : {
            ...baseOperation,
            baseHash: "new",
            diff: buildUnifiedDiff(pathRel, "", content ?? "")
          };
    }

    if (action === "modify") {
      const current = await this.tryRead(workspaceId, pathRel);
      if (!current) {
        return {
          ...baseOperation,
          baseHash: undefined,
          diff: buildUnifiedDiff(pathRel, "", content ?? ""),
          status: "conflict",
          message: "目标文件不存在，无法修改。"
        };
      }
      return {
        ...baseOperation,
        before: current.content,
        baseHash: current.sha256,
        diff: buildUnifiedDiff(pathRel, current.content, content ?? "")
      };
    }

    if (action === "rename") {
      const current = await this.tryRead(workspaceId, pathRel);
      const target = targetPathRel ? await this.tryRead(workspaceId, targetPathRel) : undefined;
      return {
        ...baseOperation,
        before: current?.content,
        baseHash: current?.sha256,
        status: current && !target ? "pending" : "conflict",
        message: !current ? "源文件不存在，无法重命名。" : target ? "目标文件已存在，无法重命名。" : undefined,
        diff: `rename ${pathRel}\n   to ${targetPathRel ?? ""}`
      };
    }

    const current = await this.tryRead(workspaceId, pathRel);
    return {
      ...baseOperation,
      before: current?.content,
      baseHash: current?.sha256,
      status: current ? "pending" : "conflict",
      message: current ? undefined : "目标文件不存在，无法删除。",
      diff: current ? buildUnifiedDiff(pathRel, current.content, "") : `delete ${pathRel}`
    };
  }

  private async applyOperation(workspaceId: string, operation: AiChangePlanOperation): Promise<AiChangePlanOperation> {
    if (operation.status === "conflict" || operation.status === "error") {
      return operation;
    }
    try {
      if (operation.action === "create") {
        const existing = await this.tryRead(workspaceId, operation.pathRel);
        if (existing) {
          return { ...operation, status: "conflict", message: "目标文件已存在。" };
        }
        await this.files.create({
          workspaceId,
          pathRel: operation.pathRel,
          kind: "file",
          content: ensureTrailingNewline(operation.content ?? operation.after ?? "")
        });
        return { ...operation, status: "applied", message: "已创建" };
      }

      if (operation.action === "modify") {
        const current = await this.tryRead(workspaceId, operation.pathRel);
        if (!current) {
          return { ...operation, status: "conflict", message: "目标文件不存在。" };
        }
        if (operation.baseHash && current.sha256 !== operation.baseHash) {
          return { ...operation, status: "conflict", message: "文件已变化，请重新生成变更计划。" };
        }
        const result = await this.files.writeAtomic({
          workspaceId,
          pathRel: operation.pathRel,
          content: ensureTrailingNewline(operation.content ?? operation.after ?? ""),
          baseHash: current.sha256,
          createSnapshot: true
        });
        if (result.status !== "saved") {
          return { ...operation, status: result.status === "conflict" ? "conflict" : "error", message: `保存失败：${result.status}` };
        }
        return { ...operation, status: "applied", message: "已修改" };
      }

      if (operation.action === "rename") {
        const current = await this.tryRead(workspaceId, operation.pathRel);
        if (!current) {
          return { ...operation, status: "conflict", message: "源文件不存在。" };
        }
        if (operation.baseHash && current.sha256 !== operation.baseHash) {
          return { ...operation, status: "conflict", message: "源文件已变化，请重新生成变更计划。" };
        }
        if (!operation.targetPathRel) {
          return { ...operation, status: "error", message: "缺少目标路径。" };
        }
        if (await this.tryRead(workspaceId, operation.targetPathRel)) {
          return { ...operation, status: "conflict", message: "目标文件已存在。" };
        }
        await this.files.rename({
          workspaceId,
          sourcePathRel: operation.pathRel,
          targetPathRel: operation.targetPathRel,
          updateReferences: true
        });
        return { ...operation, status: "applied", message: "已重命名" };
      }

      const current = await this.tryRead(workspaceId, operation.pathRel);
      if (!current) {
        return { ...operation, status: "conflict", message: "目标文件不存在。" };
      }
      if (operation.baseHash && current.sha256 !== operation.baseHash) {
        return { ...operation, status: "conflict", message: "文件已变化，请重新生成变更计划。" };
      }
      await this.files.trash({ workspaceId, pathRel: operation.pathRel });
      return { ...operation, status: "applied", message: "已移到废纸篓" };
    } catch (error) {
      return { ...operation, status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async tryRead(workspaceId: string, pathRel: string): Promise<{ content: string; sha256: string } | undefined> {
    try {
      const file = await this.files.readFile({ workspaceId, pathRel });
      return { content: file.content, sha256: file.sha256 };
    } catch {
      return undefined;
    }
  }
}

function parsePlanSource(sourceText: string): { summary?: string; changes: RawChange[] } {
  for (const candidate of extractJsonCandidates(sourceText)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const summary = parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as { summary?: unknown }).summary === "string"
        ? (parsed as { summary: string }).summary
        : undefined;
      const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "changes" in parsed
        ? (parsed as { changes?: unknown }).changes
        : parsed;
      if (Array.isArray(source)) {
        return { summary, changes: source.filter((item): item is RawChange => Boolean(item) && typeof item === "object" && !Array.isArray(item)) };
      }
    } catch {
      continue;
    }
  }
  return { changes: [] };
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match = fencePattern.exec(text);
  while (match) {
    candidates.push(match[1].trim());
    match = fencePattern.exec(text);
  }
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(text.slice(firstObject, lastObject + 1));
  }
  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    candidates.push(text.slice(firstArray, lastArray + 1));
  }
  return [...new Set(candidates)];
}

function parseAction(value: unknown): AiChangePlanOperation["action"] | undefined {
  return value === "create" || value === "modify" || value === "rename" || value === "delete" ? value : undefined;
}

function normalizePlanPath(pathRel: string): string | undefined {
  const normalized = normalizePathRel(pathRel.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") {
    return undefined;
  }
  return hasExtension(normalized) ? normalized : `${normalized}.md`;
}

function hasExtension(pathRel: string): boolean {
  return /\.[^./]+$/.test(pathRel);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function buildUnifiedDiff(pathRel: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const lines = [`--- a/${pathRel}`, `+++ b/${pathRel}`];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const beforeLine = beforeLines[beforeIndex];
    const afterLine = afterLines[afterIndex];
    if (beforeLine === afterLine) {
      if (beforeLine !== undefined && lines.length < 240) {
        lines.push(` ${beforeLine}`);
      }
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }
    if (beforeLine !== undefined) {
      lines.push(`-${beforeLine}`);
      beforeIndex += 1;
    }
    if (afterLine !== undefined) {
      lines.push(`+${afterLine}`);
      afterIndex += 1;
    }
    if (lines.length >= 240) {
      lines.push("...");
      break;
    }
  }
  const diff = lines.join("\n").trimEnd();
  return diff || `--- a/${pathRel}\n+++ b/${pathRel}`;
}
