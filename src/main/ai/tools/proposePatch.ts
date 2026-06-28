import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { AiTool } from "../types";
import { sha256Text } from "../../utils/hash";

const AiPatchOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replaceRange"), range: z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative() }), beforeText: z.string(), afterText: z.string() }),
  z.object({ type: z.literal("insertAt"), offset: z.number().int().nonnegative(), afterText: z.string() }),
  z.object({ type: z.literal("append"), afterText: z.string() }),
  z.object({ type: z.literal("replaceDocument"), beforeText: z.string(), afterText: z.string() })
]);

const InputSchema = z
  .object({
    pathRel: z.string().min(1),
    summary: z.string().min(1),
    operations: z.array(AiPatchOperationSchema).min(1).max(4)
  })
  .strict();
type Input = z.infer<typeof InputSchema>;

export const proposePatchTool: AiTool<Input> = {
  name: "proposePatch",
  description: "Create a user-reviewable patch proposal for the current active Markdown note. This does not write files.",
  inputSchema: InputSchema,
  outputSchema: z.object({ proposal: z.any() }),
  permissions: ["proposal"],
  mutability: "proposal",
  maxCallsPerRun: 3,
  async run(input, context) {
    const document = context.clientContext.activeDocument;
    if (!document || !context.workspaceId) {
      throw new Error("No active document");
    }
    if (input.pathRel !== document.pathRel) {
      throw new Error("Patch proposals can only target the active document");
    }
    return {
      proposal: {
        id: randomUUID(),
        runId: context.runId,
        workspaceId: context.workspaceId,
        pathRel: document.pathRel,
        title: document.parsedTitle || document.title,
        summary: input.summary,
        sourceSnapshotHash: sha256Text(document.sourceText),
        baseHash: document.baseHash,
        operations: input.operations
      }
    };
  }
};
