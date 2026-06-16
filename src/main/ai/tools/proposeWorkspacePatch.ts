import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { AiTool } from "../types";
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
  })
]);

const InputSchema = z
  .object({
    summary: z.string().min(1),
    operations: z.array(WorkspacePatchOperationSchema).min(1).max(8)
  })
  .strict();

type Input = z.infer<typeof InputSchema>;

export const proposeWorkspacePatchTool: AiTool<Input> = {
  name: "proposeWorkspacePatch",
  description: "Create a user-reviewable multi-file workspace operation proposal. It can propose Markdown file creation, appends, or full-document replacements only. This never writes files; every operation must be confirmed by the user and the app creates history snapshots before writing existing files.",
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
      const pathRel = normalizeWorkspacePatchPath(operation.pathRel);
      if (operation.type === "createFile") {
        operations.push({ ...operation, pathRel });
        if (!firstSourceHash) {
          firstSourceHash = sha256Text("");
          firstExistingHash = "new";
        }
        continue;
      }
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

function normalizeWorkspacePatchPath(pathRel: string): string {
  const normalized = normalizePathRel(pathRel);
  if (!normalized) {
    throw new Error("Workspace patch path is required");
  }
  if (isAlwaysIgnoredWorkspacePath(normalized)) {
    throw new Error("Workspace patch cannot target ignored paths");
  }
  if (!isMarkdownPath(normalized)) {
    throw new Error("Workspace patch operations only support Markdown files");
  }
  return normalized;
}
