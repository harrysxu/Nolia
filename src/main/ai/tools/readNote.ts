import { z } from "zod";

import type { AiTool } from "../types";
import { excerpt } from "../context/contextBudget";
import { isMarkdownPath, normalizePathRel } from "../../utils/filePaths";

const InputSchema = z.object({ pathRel: z.string().min(1) }).strict();
type Input = z.infer<typeof InputSchema>;

export const readNoteTool: AiTool<Input> = {
  name: "readNote",
  description: "Read an excerpt from a Markdown note that was returned by searchNotes earlier in this same run. Cannot read arbitrary files, unread search results, or the whole workspace folder.",
  inputSchema: InputSchema,
  outputSchema: z.object({ pathRel: z.string(), title: z.string(), contentExcerpt: z.string(), sha256: z.string() }),
  permissions: ["read-note"],
  mutability: "read",
  maxCallsPerRun: 3,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const pathRel = normalizePathRel(input.pathRel);
    if (!context.searchResultPaths.has(pathRel)) {
      throw new Error("readNote can only read notes found by search in this run");
    }
    if (!isMarkdownPath(pathRel)) {
      throw new Error("readNote only supports Markdown files");
    }
    const file = await context.services.files.readFile({ workspaceId: context.workspaceId, pathRel });
    return {
      pathRel,
      title: pathRel.split("/").pop() ?? pathRel,
      contentExcerpt: excerpt(file.content, 12_000),
      sha256: file.sha256
    };
  }
};
