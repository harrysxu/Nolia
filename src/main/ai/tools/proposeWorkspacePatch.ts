import { randomUUID } from "node:crypto";
import { z } from "zod";

import { AI_WORKSPACE_PATCH_OPERATION_LIMIT } from "../../../shared/ai";
import type { AiTool, AiToolContext } from "../types";
import { isAlwaysIgnoredWorkspacePath, isMarkdownPath, normalizePathRel } from "../../utils/filePaths";
import { sha256Text } from "../../utils/hash";

const WorkspacePatchOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("replaceDocument"),
    pathRel: z.string().min(1),
    beforeText: z.string(),
    afterText: z.string()
  }),
  z.object({
    type: z.literal("append"),
    pathRel: z.string().min(1),
    afterText: z.string()
  }),
  z.object({
    type: z.literal("createFile"),
    pathRel: z.string().min(1),
    afterText: z.string()
  }),
  z.object({
    type: z.literal("createDirectory"),
    pathRel: z.string().min(1)
  }),
  z.object({
    type: z.literal("movePath"),
    sourcePathRel: z.string().min(1),
    targetPathRel: z.string().min(1)
  })
]);

const InputSchema = z
  .object({
    summary: z.string().min(1),
    operations: z.array(WorkspacePatchOperationSchema).min(1).max(AI_WORKSPACE_PATCH_OPERATION_LIMIT)
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export const proposeWorkspacePatchTool: AiTool<Input> = {
  name: "proposeWorkspacePatch",
  description: `Create a user-reviewable workspace operation proposal with up to ${AI_WORKSPACE_PATCH_OPERATION_LIMIT} operations. It can propose Markdown file creation, appends, full-document replacements, folder creation, and moving/renaming files or folders. It cannot delete paths or directly execute file operations; for deletion requests, explain the limitation. This never writes files; every operation must be confirmed by the user and the app creates history snapshots before writing existing files.`,
  inputSchema: InputSchema,
  outputSchema: z.object({ proposal: z.any() }),
  permissions: ["workspace-proposal"],
  mutability: "proposal",
  maxCallsPerRun: 2,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const operations = [];
    let firstExistingHash = "new";
    let firstSourceHash = "";
    for (const operation of input.operations) {
      if (operation.type === "createFile") {
        const pathRel = normalizeWorkspacePatchFilePath(operation.pathRel);
        await assertWorkspacePathMissing(context, pathRel);
        operations.push({ ...operation, pathRel });
        if (!firstSourceHash) {
          firstSourceHash = sha256Text("");
          firstExistingHash = "new";
        }
        continue;
      }
      if (operation.type === "createDirectory") {
        const pathRel = normalizeWorkspaceOperationPath(operation.pathRel);
        await assertWorkspacePathMissing(context, pathRel);
        operations.push({ type: "createDirectory" as const, pathRel });
        if (!firstSourceHash) {
          firstSourceHash = sha256Text("");
          firstExistingHash = "new";
        }
        continue;
      }
      if (operation.type === "movePath") {
        const sourcePathRel = normalizeWorkspaceOperationPath(operation.sourcePathRel);
        const targetPathRel = normalizeWorkspaceOperationPath(operation.targetPathRel);
        await assertWorkspacePathExists(context, sourcePathRel);
        await assertWorkspacePathMissing(context, targetPathRel);
        operations.push({ type: "movePath" as const, sourcePathRel, targetPathRel });
        if (!firstSourceHash) {
          firstSourceHash = sha256Text(sourcePathRel);
          firstExistingHash = "move";
        }
        continue;
      }
      const pathRel = normalizeWorkspacePatchFilePath(operation.pathRel);
      const current = await context.services.files.readFile({ workspaceId: context.workspaceId, pathRel });
      if (operation.type === "replaceDocument" && operation.beforeText && operation.beforeText !== current.content) {
        throw new Error(`Workspace patch baseline does not match ${pathRel}`);
      }
      const beforeText = operation.type === "append" ? current.content : operation.beforeText || current.content;
      const normalizedOperation = operation.type === "append"
        ? { type: "append" as const, pathRel, afterText: operation.afterText }
        : { type: "replaceDocument" as const, pathRel, beforeText, afterText: operation.afterText };
      operations.push(normalizedOperation);
      if (!firstSourceHash) {
        firstSourceHash = current.sha256;
        firstExistingHash = current.sha256;
      }
    }
    const primaryPath = operations[0]?.pathRel ?? "workspace";
    return {
      proposal: {
        id: randomUUID(),
        runId: context.runId,
        workspaceId: context.workspaceId,
        pathRel: primaryPath,
        title: primaryPath,
        summary: input.summary,
        sourceSnapshotHash: firstSourceHash || sha256Text(""),
        baseHash: firstExistingHash,
        operations
      }
    };
  }
};

async function assertWorkspacePathExists(context: AiToolContext, pathRel: string): Promise<void> {
  if (await workspacePathExists(context, pathRel)) {
    return;
  }
  throw new Error(`Workspace path does not exist: ${pathRel}`);
}

async function assertWorkspacePathMissing(context: AiToolContext, pathRel: string): Promise<void> {
  if (await workspacePathExists(context, pathRel)) {
    throw new Error(`Workspace path already exists: ${pathRel}`);
  }
}

async function workspacePathExists(context: AiToolContext, pathRel: string): Promise<boolean> {
  const parent = pathRel.split("/").slice(0, -1).join("/");
  const name = pathRel.split("/").at(-1) ?? pathRel;
  if (!context.workspaceId) {
    return false;
  }
  try {
    const response = await context.services.files.listTree({ workspaceId: context.workspaceId, root: parent, sortBy: "name", showHidden: false });
    return response.nodes.some((node) => node.pathRel === pathRel || node.name === name);
  } catch {
    return false;
  }
}

function normalizeWorkspacePatchFilePath(pathRel: string): string {
  const normalized = normalizeWorkspaceOperationPath(pathRel);
  if (!isMarkdownPath(normalized)) {
    throw new Error("Workspace patch file operations only support Markdown files");
  }
  return normalized;
}

function normalizeWorkspaceOperationPath(pathRel: string): string {
  const normalized = normalizePathRel(pathRel);
  if (!normalized) {
    throw new Error("Workspace operation path is required");
  }
  if (isAlwaysIgnoredWorkspacePath(normalized)) {
    throw new Error("Workspace operation cannot target ignored paths");
  }
  return normalized;
}
