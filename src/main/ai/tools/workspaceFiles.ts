import { z } from "zod";

import type { AiTool } from "../types";
import { excerpt } from "../context/contextBudget";
import { isAlwaysIgnoredWorkspacePath, normalizePathRel } from "../../utils/filePaths";

const MAX_FILE_EXCERPT_CHARS = 24_000;

const ListInputSchema = z.object({
  root: z.string().optional(),
  recursive: z.boolean().optional(),
  limit: z.number().int().positive().max(120).optional()
}).strict();
const ReadInputSchema = z.object({ pathRel: z.string().min(1) }).strict();
const ReadManyInputSchema = z.object({ paths: z.array(z.string().min(1)).min(1).max(12), maxCharsPerFile: z.number().int().positive().max(24_000).optional() }).strict();
const InspectInputSchema = z.object({ pathRel: z.string() }).strict();
const FindPathsInputSchema = z.object({
  query: z.string().min(1),
  root: z.string().optional(),
  includeDirectories: z.boolean().optional(),
  includeFiles: z.boolean().optional(),
  recursive: z.boolean().optional(),
  limit: z.number().int().positive().max(120).optional()
}).strict();
const RecentInputSchema = z.object({ limit: z.number().int().positive().max(50).optional() }).strict();
const OutlineInputSchema = z.object({ pathRel: z.string().min(1) }).strict();
const BacklinksInputSchema = z.object({ pathRel: z.string().min(1), includeUnlinkedMentions: z.boolean().optional() }).strict();

type ListInput = z.infer<typeof ListInputSchema>;
type ReadInput = z.infer<typeof ReadInputSchema>;
type ReadManyInput = z.infer<typeof ReadManyInputSchema>;
type InspectInput = z.infer<typeof InspectInputSchema>;
type FindPathsInput = z.infer<typeof FindPathsInputSchema>;
type RecentInput = z.infer<typeof RecentInputSchema>;
type OutlineInput = z.infer<typeof OutlineInputSchema>;
type BacklinksInput = z.infer<typeof BacklinksInputSchema>;

const readableTextExtensions = new Set([
  ".md",
  ".markdown",
  ".mdown",
  ".mkd",
  ".txt",
  ".csv",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".html",
  ".htm",
  ".log"
]);

export const recentWorkspaceFilesTool: AiTool<RecentInput> = {
  name: "workspace_recent_files",
  description: "List recently opened Markdown files in the current workspace. Use this to understand the user's recent working context.",
  inputSchema: RecentInputSchema,
  outputSchema: z.object({ items: z.array(z.object({ pathRel: z.string(), title: z.string(), openedAt: z.number() })) }),
  permissions: ["workspace-read"],
  mutability: "read",
  maxCallsPerRun: 3,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const runtime = context.services.workspaces.requireWorkspace(context.workspaceId);
    return { items: runtime.db.listRecentFiles(input.limit ?? 20) };
  }
};

export const listWorkspaceFilesTool: AiTool<ListInput> = {
  name: "listWorkspaceFiles",
  description: "List directories and readable text/Markdown files in the current workspace when whole-workspace read access is granted. By default, list only the direct children of the workspace root so top-level folders are not hidden by deep results. For questions about a folder such as \"cc\", call this with root set to that folder, for example {\"root\":\"cc\"}. Set recursive true only when the user asks for a deeper tree. This returns paths and metadata only; use readWorkspaceFile to read a specific file excerpt.",
  inputSchema: ListInputSchema,
  outputSchema: z.object({
    items: z.array(z.object({ pathRel: z.string(), title: z.string(), kind: z.string(), size: z.number(), mtimeMs: z.number() }))
  }),
  permissions: ["workspace-read"],
  mutability: "read",
  maxCallsPerRun: 3,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const root = input.root ? normalizePathRel(input.root) : "";
    if (root) {
      assertReadableWorkspaceDirectoryPath(root);
    }
    const response = await context.services.files.listTree({ workspaceId: context.workspaceId, root, sortBy: "name", showHidden: false });
    const limit = input.limit ?? 50;
    return {
      items: listWorkspaceEntries(response.nodes, Boolean(input.recursive))
        .slice(0, limit)
        .map((entry) => ({
          pathRel: entry.pathRel,
          title: entry.name,
          kind: entry.kind,
          size: entry.size,
          mtimeMs: entry.mtimeMs
        }))
    };
  }
};

export const inspectWorkspacePathTool: AiTool<InspectInput> = {
  name: "inspectWorkspacePath",
  description: "Inspect whether a specific workspace path exists and whether it is a directory or readable text/Markdown file. Use this before claiming that a named file or folder such as \"cc\" exists or does not exist.",
  inputSchema: InspectInputSchema,
  outputSchema: z.object({
    pathRel: z.string(),
    exists: z.boolean(),
    ignored: z.boolean(),
    kind: z.string().optional(),
    title: z.string().optional(),
    size: z.number().optional(),
    mtimeMs: z.number().optional(),
    childCount: z.number().optional(),
    readableText: z.boolean().optional()
  }),
  permissions: ["workspace-read"],
  mutability: "read",
  maxCallsPerRun: 8,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const pathRel = normalizePathRel(input.pathRel);
    if (!pathRel) {
      return { pathRel, exists: true, ignored: false, kind: "directory", title: "" };
    }
    if (isAlwaysIgnoredWorkspacePath(pathRel)) {
      return { pathRel, exists: false, ignored: true };
    }
    const parent = parentPath(pathRel);
    const name = basename(pathRel);
    const response = await context.services.files.listTree({ workspaceId: context.workspaceId, root: parent, sortBy: "name", showHidden: false });
    const node = response.nodes.find((item) => item.name === name || item.pathRel === pathRel);
    if (!node) {
      return { pathRel, exists: false, ignored: false };
    }
    return {
      pathRel: node.pathRel,
      exists: true,
      ignored: false,
      kind: node.kind,
      title: node.name,
      size: node.size,
      mtimeMs: node.mtimeMs,
      childCount: node.kind === "directory" ? (node.children ?? []).filter((child) => !isAlwaysIgnoredWorkspacePath(child.pathRel)).length : undefined,
      readableText: node.kind !== "directory" ? isReadableTextPath(node.pathRel) : undefined
    };
  }
};

export const findWorkspacePathsTool: AiTool<FindPathsInput> = {
  name: "findWorkspacePaths",
  description: "Find workspace files or folders by path/name substring. Use this for questions like \"where is cc\", \"find README files\", or \"does this folder exist\". This searches paths, not note contents; use searchNotes for note body text.",
  inputSchema: FindPathsInputSchema,
  outputSchema: z.object({
    query: z.string(),
    root: z.string(),
    items: z.array(z.object({ pathRel: z.string(), title: z.string(), kind: z.string(), size: z.number(), mtimeMs: z.number() }))
  }),
  permissions: ["workspace-read"],
  mutability: "read",
  maxCallsPerRun: 6,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const root = input.root ? normalizePathRel(input.root) : "";
    if (root) {
      assertReadableWorkspaceDirectoryPath(root);
    }
    const includeDirectories = input.includeDirectories ?? true;
    const includeFiles = input.includeFiles ?? true;
    const query = input.query.trim().toLowerCase().replace(/\\/g, "/");
    const response = await context.services.files.listTree({ workspaceId: context.workspaceId, root, sortBy: "name", showHidden: false });
    const items = listWorkspaceEntries(response.nodes, input.recursive ?? true)
      .filter((entry) => {
        if (entry.kind === "directory" && !includeDirectories) {
          return false;
        }
        if (entry.kind !== "directory" && !includeFiles) {
          return false;
        }
        const haystack = `${entry.pathRel}\n${entry.name}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, input.limit ?? 50)
      .map((entry) => ({
        pathRel: entry.pathRel,
        title: entry.name,
        kind: entry.kind,
        size: entry.size,
        mtimeMs: entry.mtimeMs
      }));
    return { query: input.query, root, items };
  }
};

export const readWorkspaceFileTool: AiTool<ReadInput> = {
  name: "readWorkspaceFile",
  description: "Read a bounded excerpt from a readable text or Markdown file in the current workspace after whole-workspace read access is granted. Cannot read ignored folders such as .nolia, .git, or node_modules, and cannot read files outside the workspace.",
  inputSchema: ReadInputSchema,
  outputSchema: z.object({ pathRel: z.string(), title: z.string(), contentExcerpt: z.string(), sha256: z.string(), truncated: z.boolean() }),
  permissions: ["workspace-read"],
  mutability: "read",
  maxCallsPerRun: 10,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const pathRel = normalizePathRel(input.pathRel);
    assertReadableWorkspacePath(pathRel);
    const file = await context.services.files.readFile({ workspaceId: context.workspaceId, pathRel });
    return {
      pathRel,
      title: pathRel.split("/").pop() ?? pathRel,
      contentExcerpt: excerpt(file.content, MAX_FILE_EXCERPT_CHARS),
      sha256: file.sha256,
      truncated: file.content.length > MAX_FILE_EXCERPT_CHARS
    };
  }
};

export const readManyWorkspaceFilesTool: AiTool<ReadManyInput> = {
  name: "workspace_read_many_files",
  description: "Read bounded excerpts from multiple readable Markdown or text files in the current workspace. Use this after listing or searching files.",
  inputSchema: ReadManyInputSchema,
  outputSchema: z.object({
    items: z.array(z.object({ pathRel: z.string(), title: z.string(), contentExcerpt: z.string(), sha256: z.string(), truncated: z.boolean() }))
  }),
  permissions: ["workspace-read"],
  mutability: "read",
  maxCallsPerRun: 5,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const maxChars = input.maxCharsPerFile ?? 8_000;
    const items = [];
    for (const rawPath of input.paths) {
      const pathRel = normalizePathRel(rawPath);
      assertReadableWorkspacePath(pathRel);
      const file = await context.services.files.readFile({ workspaceId: context.workspaceId, pathRel });
      items.push({
        pathRel,
        title: pathRel.split("/").pop() ?? pathRel,
        contentExcerpt: excerpt(file.content, maxChars),
        sha256: file.sha256,
        truncated: file.content.length > maxChars
      });
    }
    return { items };
  }
};

export const workspaceOutlineTool: AiTool<OutlineInput> = {
  name: "workspace_get_outline",
  description: "Read the Markdown outline, tags, links, and word count for a Markdown file in the workspace.",
  inputSchema: OutlineInputSchema,
  outputSchema: z.object({
    pathRel: z.string(),
    title: z.string(),
    headings: z.array(z.object({ text: z.string(), depth: z.number(), line: z.number() })),
    tags: z.array(z.string()),
    links: z.array(z.object({ href: z.string(), text: z.string(), line: z.number() })),
    wikilinks: z.array(z.object({ targetText: z.string(), line: z.number() })),
    wordCount: z.number(),
    lineCount: z.number()
  }),
  permissions: ["workspace-read"],
  mutability: "read",
  maxCallsPerRun: 8,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const pathRel = normalizePathRel(input.pathRel);
    assertReadableWorkspacePath(pathRel);
    const file = await context.services.files.readFile({ workspaceId: context.workspaceId, pathRel });
    const { parseMarkdown } = await import("../../../shared/markdown");
    const parsed = parseMarkdown(file.content, pathRel);
    return {
      pathRel,
      title: parsed.title,
      headings: parsed.headings.map((heading) => ({ text: heading.text, depth: heading.depth, line: heading.line })),
      tags: parsed.tags,
      links: parsed.links.map((link) => ({ href: link.href, text: link.text, line: link.line })),
      wikilinks: parsed.wikilinks.map((link) => ({ targetText: link.targetText, line: link.line })),
      wordCount: parsed.wordCount,
      lineCount: parsed.lineCount
    };
  }
};

export const workspaceBacklinksTool: AiTool<BacklinksInput> = {
  name: "workspace_get_backlinks",
  description: "List backlinks and optional unlinked mentions for a Markdown file in the workspace.",
  inputSchema: BacklinksInputSchema,
  outputSchema: z.object({
    linked: z.array(z.object({ pathRel: z.string(), title: z.string(), line: z.number(), context: z.string() })),
    unlinked: z.array(z.object({ pathRel: z.string(), title: z.string(), line: z.number(), context: z.string() }))
  }),
  permissions: ["workspace-read"],
  mutability: "read",
  maxCallsPerRun: 6,
  async run(input, context) {
    if (!context.workspaceId) {
      throw new Error("No workspace");
    }
    const pathRel = normalizePathRel(input.pathRel);
    assertReadableWorkspacePath(pathRel);
    const runtime = context.services.workspaces.requireWorkspace(context.workspaceId);
    return runtime.db.getBacklinks(pathRel, input.includeUnlinkedMentions);
  }
};

export function listWorkspaceEntries(nodes: import("../../../shared/types").FileTreeNode[], recursive: boolean): Array<{ pathRel: string; name: string; kind: string; size: number; mtimeMs: number }> {
  const entries: Array<{ pathRel: string; name: string; kind: string; size: number; mtimeMs: number }> = [];
  for (const node of nodes) {
    if (isAlwaysIgnoredWorkspacePath(node.pathRel)) {
      continue;
    }
    if (node.kind === "directory") {
      entries.push({ pathRel: node.pathRel, name: node.name, kind: node.kind, size: node.size, mtimeMs: node.mtimeMs });
      if (recursive) {
        entries.push(...listWorkspaceEntries(node.children ?? [], true));
      }
      continue;
    }
    if (isReadableTextPath(node.pathRel)) {
      entries.push({ pathRel: node.pathRel, name: node.name, kind: node.kind, size: node.size, mtimeMs: node.mtimeMs });
    }
  }
  return entries;
}

export const flattenWorkspaceEntries = (nodes: import("../../../shared/types").FileTreeNode[]): Array<{ pathRel: string; name: string; kind: string; size: number; mtimeMs: number }> =>
  listWorkspaceEntries(nodes, true);

function assertReadableWorkspacePath(pathRel: string): void {
  if (isAlwaysIgnoredWorkspacePath(pathRel)) {
    throw new Error("Workspace file is ignored and cannot be read by AI");
  }
  if (!isReadableTextPath(pathRel)) {
    throw new Error("AI whole-workspace reads only support text and Markdown files");
  }
}

function assertReadableWorkspaceDirectoryPath(pathRel: string): void {
  if (isAlwaysIgnoredWorkspacePath(pathRel)) {
    throw new Error("Workspace directory is ignored and cannot be listed by AI");
  }
  if (isReadableTextPath(pathRel)) {
    throw new Error("listWorkspaceFiles root must be a workspace directory, not a file");
  }
}

function isReadableTextPath(pathRel: string): boolean {
  const dotIndex = pathRel.lastIndexOf(".");
  const ext = dotIndex >= 0 ? pathRel.slice(dotIndex).toLowerCase() : "";
  return readableTextExtensions.has(ext);
}

function parentPath(pathRel: string): string {
  const parts = normalizePathRel(pathRel).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function basename(pathRel: string): string {
  const parts = normalizePathRel(pathRel).split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}
