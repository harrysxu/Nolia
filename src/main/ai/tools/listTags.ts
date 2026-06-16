import { z } from "zod";

import type { AiTool } from "../types";

const InputSchema = z.object({}).strict();
type Input = z.infer<typeof InputSchema>;

export const listTagsTool: AiTool<Input> = {
  name: "listTags",
  description: "List tags in the current workspace.",
  inputSchema: InputSchema,
  outputSchema: z.object({ tags: z.array(z.object({ name: z.string(), displayName: z.string(), count: z.number() })) }),
  permissions: ["tags"],
  mutability: "read",
  maxCallsPerRun: 2,
  async run(_input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const runtime = context.services.workspaces.requireWorkspace(context.workspaceId);
    return { tags: runtime.db.listTags() };
  }
};
