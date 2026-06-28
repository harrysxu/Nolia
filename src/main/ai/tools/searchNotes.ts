import { z } from "zod";

import type { AiTool } from "../types";
import { AiEmbeddingService } from "../embeddingService";

const InputSchema = z.object({ query: z.string().min(1), limit: z.number().int().positive().max(8).optional() }).strict();
type Input = z.infer<typeof InputSchema>;

const embeddings = new AiEmbeddingService();

export const searchNotesTool: AiTool<Input> = {
  name: "searchNotes",
  description: "Search Markdown notes in the current workspace. When a ready semantic index exists, use it to find semantic candidates; otherwise fall back to the local full-text index. Always call readNote for relevant hits before answering questions that depend on note content, because search snippets and embeddings are only retrieval hints.",
  inputSchema: InputSchema,
  outputSchema: z.object({
    query: z.string(),
    mode: z.enum(["semantic", "full-text"]),
    fallbackReason: z.string().optional(),
    items: z.array(z.object({ pathRel: z.string(), title: z.string(), snippets: z.array(z.string()) }))
  }),
  permissions: ["workspace-search"],
  mutability: "read",
  maxCallsPerRun: 5,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const runtime = context.services.workspaces.requireWorkspace(context.workspaceId);
    const embeddingSettings = context.services.aiSettings?.resolvedEmbeddingSettings();
    if (!embeddingSettings) {
      const response = runtime.db.search({ workspaceId: context.workspaceId, query: input.query, limit: input.limit ?? 8 });
      response.items.forEach((item) => context.searchResultPaths.add(item.pathRel));
      return {
        query: input.query,
        mode: "full-text" as const,
        fallbackReason: "Semantic settings are unavailable; full-text search was used.",
        items: response.items.map((item) => ({ pathRel: item.pathRel, title: item.title, snippets: item.snippets }))
      };
    }
    const status = runtime.db.semanticIndexStatus(embeddingSettings);
    if (status.state === "ready") {
      try {
        const queryEmbedding = await embeddings.embedOne(embeddingSettings, input.query, context.signal);
        const semanticItems = runtime.db.semanticSearch(queryEmbedding, embeddingSettings, input.limit ?? 8);
        if (semanticItems.length) {
          semanticItems.forEach((item) => context.searchResultPaths.add(item.pathRel));
          return {
            query: input.query,
            mode: "semantic" as const,
            items: semanticItems.map((item) => ({ pathRel: item.pathRel, title: item.title, snippets: item.snippets }))
          };
        }
      } catch {
        // Fall through to full-text search. The result reports the fallback below.
      }
    }
    const response = runtime.db.search({ workspaceId: context.workspaceId, query: input.query, limit: input.limit ?? 8 });
    response.items.forEach((item) => context.searchResultPaths.add(item.pathRel));
    return {
      query: input.query,
      mode: "full-text" as const,
      fallbackReason: status.state === "ready" ? "Semantic search returned no usable results, so full-text search was used." : semanticFallbackReason(status.state),
      items: response.items.map((item) => ({ pathRel: item.pathRel, title: item.title, snippets: item.snippets }))
    };
  }
};

function semanticFallbackReason(state: string): string {
  if (state === "not_configured") {
    return "Semantic index is not configured; full-text search was used.";
  }
  if (state === "not_created") {
    return "Semantic index has not been created; full-text search was used.";
  }
  if (state === "stale") {
    return "Semantic index is stale; full-text search was used.";
  }
  if (state === "failed") {
    return "Semantic index failed; full-text search was used.";
  }
  return "Full-text search was used.";
}
