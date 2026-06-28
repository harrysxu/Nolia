import { z } from "zod";

import type { AiTool } from "../types";
import { excerpt } from "../context/contextBudget";

const InputSchema = z.object({ includeBody: z.boolean().optional(), includeSelection: z.boolean().optional() }).strict();
type Input = z.infer<typeof InputSchema>;

export const getCurrentNoteContextTool: AiTool<Input> = {
  name: "getCurrentNoteContext",
  description: "Get metadata, selected text, outline, and optionally an excerpt of the active Markdown note.",
  inputSchema: InputSchema,
  outputSchema: z.object({
    pathRel: z.string(),
    title: z.string(),
    baseHash: z.string(),
    dirty: z.boolean(),
    selection: z.string().optional(),
    bodyExcerpt: z.string().optional(),
    headings: z.array(z.object({ text: z.string(), depth: z.number(), line: z.number() })).optional()
  }),
  permissions: ["current-note"],
  mutability: "read",
  maxCallsPerRun: 3,
  async run(input, context) {
    const document = context.clientContext.activeDocument;
    if (!document) {
      throw new Error("No active document");
    }
    return {
      pathRel: document.pathRel,
      title: document.parsedTitle || document.title,
      baseHash: document.baseHash,
      dirty: document.dirty,
      selection: input.includeSelection && context.allowedScopes.includeSelection ? context.clientContext.selection?.text : undefined,
      bodyExcerpt: input.includeBody && context.allowedScopes.includeCurrentNote ? excerpt(document.sourceText, 24_000) : undefined,
      headings: document.headings
    };
  }
};
