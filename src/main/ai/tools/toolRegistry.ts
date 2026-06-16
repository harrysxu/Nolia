import { z } from "zod";

import type { AiAllowedScopes, AiProviderTool, AiTool, AiToolContext, AiToolResultEnvelope } from "../types";
import { getCurrentNoteContextTool } from "./getCurrentNoteContext";
import { searchNotesTool } from "./searchNotes";
import { readNoteTool } from "./readNote";
import { proposePatchTool } from "./proposePatch";
import { proposeWorkspacePatchTool } from "./proposeWorkspacePatch";
import { listTagsTool } from "./listTags";
import { listWorkspaceFilesTool, readManyWorkspaceFilesTool, readWorkspaceFileTool, recentWorkspaceFilesTool, workspaceBacklinksTool, workspaceOutlineTool } from "./workspaceFiles";

const tools = [
  getCurrentNoteContextTool,
  searchNotesTool,
  readNoteTool,
  listWorkspaceFilesTool,
  recentWorkspaceFilesTool,
  readWorkspaceFileTool,
  readManyWorkspaceFilesTool,
  workspaceOutlineTool,
  workspaceBacklinksTool,
  proposePatchTool,
  proposeWorkspacePatchTool,
  listTagsTool
] as AiTool[];

export function allAiTools(): AiTool[] {
  return [...tools];
}

export class AiToolRegistry {
  private readonly callCounts = new Map<string, number>();

  providerTools(scopes: AiAllowedScopes, hasActiveDocument: boolean, hasWorkspace: boolean): AiProviderTool[] {
    return tools.filter((tool) => toolAllowedForScopes(tool, scopes, hasActiveDocument, hasWorkspace)).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.inputSchema)
    }));
  }

  async execute(toolName: string, input: unknown, context: AiToolContext): Promise<AiToolResultEnvelope> {
    const tool = tools.find((item) => item.name === toolName);
    if (!tool) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    const count = this.callCounts.get(toolName) ?? 0;
    if (count >= tool.maxCallsPerRun) {
      throw new Error(`Tool call limit exceeded: ${toolName}`);
    }
    this.checkPermissions(tool, context);
    const parsed = tool.inputSchema.parse(input);
    const result = await tool.run(parsed, context);
    tool.outputSchema.parse(result);
    this.callCounts.set(toolName, count + 1);
    return summarizeToolResult(tool.name, result);
  }

  private checkPermissions(tool: AiTool, context: AiToolContext): void {
    if (tool.permissions.includes("current-note") && !context.clientContext.activeDocument) {
      throw new Error("No current note");
    }
    if (tool.permissions.includes("workspace-search") && !context.allowedScopes.allowWorkspaceSearch) {
      throw new Error("Workspace search is disabled");
    }
    if (tool.permissions.includes("read-note") && (!context.allowedScopes.allowWorkspaceSearch || !context.allowedScopes.allowReadSearchResults)) {
      throw new Error("Reading search result notes requires workspace search and search-result note reading to be enabled");
    }
    if (tool.permissions.includes("workspace-read") && !context.allowedScopes.allowWorkspaceRead) {
      throw new Error("Whole-workspace reading is disabled");
    }
    if (tool.permissions.includes("proposal") && (!context.clientContext.activeDocument || !context.workspaceId)) {
      throw new Error("Patch proposals require an active note");
    }
    if (tool.permissions.includes("workspace-proposal") && (!context.allowedScopes.allowWorkspaceRead || !context.allowedScopes.allowWorkspaceOperations)) {
      throw new Error("Workspace operation proposals require whole-workspace read and operation proposal permissions");
    }
    if ((tool.permissions.includes("tags") || tool.permissions.includes("workspace-search") || tool.permissions.includes("read-note") || tool.permissions.includes("workspace-read") || tool.permissions.includes("workspace-proposal")) && !context.workspaceId) {
      throw new Error("Workspace is not available");
    }
  }
}

function toolAllowedForScopes(tool: AiTool, scopes: AiAllowedScopes, hasActiveDocument: boolean, hasWorkspace: boolean): boolean {
  if (tool.permissions.includes("current-note") && !hasActiveDocument) {
    return false;
  }
  if (tool.permissions.includes("proposal") && (!hasActiveDocument || !hasWorkspace)) {
    return false;
  }
  if ((tool.permissions.includes("tags") || tool.permissions.includes("workspace-search") || tool.permissions.includes("read-note") || tool.permissions.includes("workspace-read") || tool.permissions.includes("workspace-proposal")) && !hasWorkspace) {
    return false;
  }
  if (tool.permissions.includes("workspace-search") && !scopes.allowWorkspaceSearch) {
    return false;
  }
  if (tool.permissions.includes("read-note") && (!scopes.allowWorkspaceSearch || !scopes.allowReadSearchResults)) {
    return false;
  }
  if (tool.permissions.includes("workspace-read") && !scopes.allowWorkspaceRead) {
    return false;
  }
  if (tool.permissions.includes("workspace-proposal") && (!scopes.allowWorkspaceRead || !scopes.allowWorkspaceOperations)) {
    return false;
  }
  return true;
}

function zodToJsonSchema(schema: z.ZodType): unknown {
  return z.toJSONSchema(schema, { target: "draft-7" });
}

function summarizeToolResult(toolName: string, result: unknown): AiToolResultEnvelope {
  if (toolName === "searchNotes" && isSearchResult(result)) {
    return {
      result,
      summary: result.fallbackReason
        ? `Found ${result.items.length} note result(s) using ${result.mode ?? "full-text"} search. ${result.fallbackReason}`
        : `Found ${result.items.length} note result(s) using ${result.mode ?? "full-text"} search.`,
      sourceRefs: result.items.map((item) => ({ kind: "search-result", pathRel: item.pathRel, title: item.title, snippet: item.snippets[0] }))
    };
  }
  if (toolName === "readNote" && isReadNoteResult(result)) {
    return {
      result,
      summary: `Read ${result.pathRel}.`,
      sourceRefs: [{ kind: "note", pathRel: result.pathRel, title: result.title, snippet: result.contentExcerpt.slice(0, 240) }]
    };
  }
  if (toolName === "readWorkspaceFile" && isReadNoteResult(result)) {
    return {
      result,
      summary: `Read workspace file ${result.pathRel}.`,
      sourceRefs: [{ kind: "workspace-file", pathRel: result.pathRel, title: result.title, snippet: result.contentExcerpt.slice(0, 240) }]
    };
  }
  if (toolName === "listWorkspaceFiles" && isWorkspaceFileList(result)) {
    return {
      result,
      summary: `Listed ${result.items.length} workspace file(s).`,
      sourceRefs: result.items.slice(0, 8).map((item) => ({ kind: "workspace-file", pathRel: item.pathRel, title: item.title }))
    };
  }
  if (toolName === "getCurrentNoteContext" && isCurrentNoteResult(result)) {
    return {
      result,
      summary: `Loaded current note context for ${result.pathRel}.`,
      sourceRefs: [{ kind: "current-note", pathRel: result.pathRel, title: result.title, snippet: result.selection ?? result.bodyExcerpt?.slice(0, 240) }]
    };
  }
  if ((toolName === "proposePatch" || toolName === "proposeWorkspacePatch") && isPatchResult(result)) {
    return {
      result,
      summary: result.proposal.summary,
      proposal: result.proposal
    };
  }
  return { result, summary: `${toolName} completed.` };
}

function isSearchResult(value: unknown): value is { mode?: string; fallbackReason?: string; items: Array<{ pathRel: string; title: string; snippets: string[] }> } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items));
}

function isWorkspaceFileList(value: unknown): value is { items: Array<{ pathRel: string; title: string }> } {
  return isSearchResult(value);
}

function isReadNoteResult(value: unknown): value is { pathRel: string; title: string; contentExcerpt: string } {
  return Boolean(value && typeof value === "object" && typeof (value as { pathRel?: unknown }).pathRel === "string");
}

function isCurrentNoteResult(value: unknown): value is { pathRel: string; title: string; selection?: string; bodyExcerpt?: string } {
  return isReadNoteResult(value);
}

function isPatchResult(value: unknown): value is { proposal: import("../../../shared/ai").AiPatchProposal } {
  return Boolean(value && typeof value === "object" && (value as { proposal?: unknown }).proposal);
}
