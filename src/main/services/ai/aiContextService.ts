import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  AiAttachmentExtractResponse,
  AiCitation,
  AiContextItemPreview,
  AiContextPreviewRequest,
  AiContextPreviewResponse,
  AiSettings
} from "../../../shared/ai";
import { parseMarkdown } from "../../../shared/markdown";
import { normalizePathRel, resolveWorkspacePath } from "../../utils/filePaths";
import { WorkspaceService } from "../workspaceService";
import { AiIndexService, type AiIndexSearchOptions } from "./aiIndexService";

const MAX_SELECTION_CHARS = 8_000;
const MAX_DOCUMENT_CHARS = 18_000;
const MAX_WORKSPACE_ITEM_CHARS = 1_200;
const MAX_CONTEXT_ITEMS = 8;
const DEFAULT_CONTEXT_BUDGET_CHARS = 40_000;
const MIN_CONTEXT_BUDGET_CHARS = 1_000;
const MAX_CONTEXT_BUDGET_CHARS = 200_000;

export class AiContextService {
  constructor(
    private readonly workspaces: WorkspaceService,
    private readonly aiIndex: AiIndexService,
    private readonly searchOptionsForSettings: ((settings: AiSettings) => Promise<Pick<AiIndexSearchOptions, "embeddingProfile" | "embedQuery">>) | undefined = undefined,
    private readonly extractAttachment: ((workspaceId: string, pathRel: string) => Promise<AiAttachmentExtractResponse>) | undefined = undefined
  ) {}

  async preview(request: AiContextPreviewRequest, settings: AiSettings): Promise<AiContextPreviewResponse> {
    const items: AiContextItemPreview[] = [];
    const warnings: string[] = [];
    const editor = request.editor;
    const scope = request.scope ?? editor?.scope ?? "document";
    const includeSelection = request.includeSelection !== false;
    const includeCurrentDocument = request.includeCurrentDocument !== false;

    if (includeSelection && editor?.selectionText?.trim()) {
      items.push({
        id: "selection",
        kind: "selection",
        label: "选区",
        pathRel: editor.pathRel,
        title: editor.title,
        excerpt: clip(editor.selectionText, MAX_SELECTION_CHARS),
        charCount: editor.selectionText.length
      });
    }

    if (includeCurrentDocument && editor?.sourceText?.trim() && shouldIncludeDocument(scope, editor.selectionText) && settings.privacy.allowCurrentDocumentContext) {
      items.push({
        id: "current-document",
        kind: "current-document",
        label: "当前文档",
        pathRel: editor.pathRel,
        title: editor.title,
        excerpt: clip(editor.sourceText, MAX_DOCUMENT_CHARS),
        charCount: editor.sourceText.length
      });
    } else if (includeCurrentDocument && editor?.sourceText?.trim() && !settings.privacy.allowCurrentDocumentContext) {
      warnings.push("当前文档上下文已在 AI 隐私设置中关闭。");
    }

    if ((scope === "workspace" || scope === "folder") && request.workspaceId) {
      if (!settings.privacy.allowWorkspaceContext) {
        warnings.push("工作区上下文已在 AI 隐私设置中关闭。");
      } else {
        items.push(...await this.workspaceItems(request, editor?.pathRel, settings));
      }
    }

    if (request.includeBacklinks && request.workspaceId && editor?.pathRel && settings.privacy.allowWorkspaceContext) {
      items.push(...this.backlinkItems(request.workspaceId, editor.pathRel));
    }

    if (request.includeAttachments && request.workspaceId && editor?.pathRel && editor.sourceText?.trim()) {
      if (!settings.privacy.allowAttachmentContext) {
        warnings.push("附件上下文已在 AI 隐私设置中关闭。");
      } else {
        items.push(...await this.attachmentItems(request.workspaceId, editor.pathRel, editor.sourceText, warnings));
      }
    }

    if (request.includeWebSearch) {
      warnings.push("当前版本不支持联网搜索。");
    }

    const deduped = dedupeItems(items).slice(0, MAX_CONTEXT_ITEMS);
    const budgeted = applyContextBudget(deduped, settings.privacy.maxContextChars, warnings);
    return {
      previewId: randomUUID(),
      providerId: request.providerId,
      model: request.model,
      estimatedInputChars: budgeted.reduce((sum, item) => sum + item.excerpt.length, 0) + request.prompt.length,
      items: budgeted,
      warnings,
      expiresAt: Date.now() + 5 * 60 * 1000
    };
  }

  toProviderContext(preview: AiContextPreviewResponse): { contextText: string; citations: AiCitation[] } {
    const contextText = preview.items
      .map((item) => [
        `<context id="${item.id}" kind="${item.kind}" label="${escapeContextAttribute(item.label)}">`,
        item.pathRel ? `文件：${item.pathRel}` : "",
        item.title ? `标题：${item.title}` : "",
        item.startLine ? `行：${item.startLine}${item.endLine && item.endLine !== item.startLine ? `-${item.endLine}` : ""}` : "",
        item.excerpt,
        "</context>"
      ].filter(Boolean).join("\n"))
      .join("\n\n");
    const citations = preview.items
      .filter((item) => item.pathRel || item.kind === "selection" || item.kind === "current-document")
      .map((item) => ({
        contextItemId: item.id,
        pathRel: item.pathRel,
        title: item.title,
        line: item.startLine,
        excerpt: clip(item.excerpt, 260)
      }));
    return { contextText, citations };
  }

  private async workspaceItems(request: AiContextPreviewRequest, currentPathRel: string | undefined, settings: AiSettings): Promise<AiContextItemPreview[]> {
    const runtime = this.workspaces.requireWorkspace(request.workspaceId ?? "");
    const query = buildWorkspaceQuery(request.prompt, request.editor?.selectionText, request.editor?.title);
    if (!query) {
      return [];
    }
    const pathPrefix = request.scope === "folder" && currentPathRel ? folderPrefix(currentPathRel) : undefined;
    const searchOptions = await this.searchOptionsForSettings?.(settings);
    const indexedItems = settings.index.enabled && settings.index.includeTextResources
      ? await this.aiIndex.search(runtime.info.workspaceId, runtime.info.rootPath, query, { pathPrefix, limit: 6, ...searchOptions })
      : [];
    if (indexedItems.length > 0) {
      return indexedItems
        .filter((item) => item.pathRel !== currentPathRel)
        .map((item) => ({
          id: `ai-index:${item.id}`,
          kind: "workspace-search-result",
          label: item.heading ? `AI 索引片段：${item.heading}` : "AI 索引片段",
          pathRel: item.pathRel,
          title: item.title,
          startLine: item.startLine,
          endLine: item.endLine,
          excerpt: item.text,
          charCount: item.charCount
        }));
    }
    const results = runtime.db.search({
      workspaceId: runtime.info.workspaceId,
      query,
      filters: pathPrefix ? { path: pathPrefix } : undefined,
      limit: 6
    });
    const items: AiContextItemPreview[] = [];
    for (const result of results.items) {
      if (result.pathRel === currentPathRel) {
        continue;
      }
      items.push({
        id: `search:${result.pathRel}`,
        kind: "workspace-search-result",
        label: "工作区搜索结果",
        pathRel: result.pathRel,
        title: result.title,
        excerpt: await this.readWorkspaceExcerpt(runtime.info.rootPath, result.pathRel, result.snippets[0]),
        charCount: result.snippets[0]?.length ?? 0
      });
    }
    return items;
  }

  private async attachmentItems(workspaceId: string, documentPathRel: string, sourceText: string, warnings: string[]): Promise<AiContextItemPreview[]> {
    if (!this.extractAttachment) {
      warnings.push("附件抽取服务不可用。");
      return [];
    }
    const parsed = parseMarkdown(sourceText, documentPathRel);
    const attachments = parsed.attachments.slice(0, 4);
    const items: AiContextItemPreview[] = [];
    for (const attachment of attachments) {
      const pathRel = normalizeAttachmentPath(documentPathRel, attachment.refPath);
      if (!pathRel) {
        continue;
      }
      try {
        const extracted = await this.extractAttachment(workspaceId, pathRel);
        if (!extracted.text.trim()) {
          warnings.push(...extracted.warnings);
          continue;
        }
        items.push({
          id: `attachment:${pathRel}`,
          kind: "attachment",
          label: `附件：${extracted.title}`,
          pathRel,
          title: extracted.title,
          excerpt: clip(extracted.text, MAX_WORKSPACE_ITEM_CHARS),
          charCount: extracted.text.length
        });
        warnings.push(...extracted.warnings);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }
    return items;
  }

  private backlinkItems(workspaceId: string, pathRel: string): AiContextItemPreview[] {
    const runtime = this.workspaces.requireWorkspace(workspaceId);
    return runtime.db.getBacklinks(normalizePathRel(pathRel), false).linked.slice(0, 4).map((item) => ({
      id: `backlink:${item.pathRel}:${item.line}`,
      kind: "backlink",
      label: "反向链接",
      pathRel: item.pathRel,
      title: item.title,
      startLine: item.line,
      endLine: item.line,
      excerpt: item.context,
      charCount: item.context.length
    }));
  }

  private async readWorkspaceExcerpt(rootPath: string, pathRel: string, fallback?: string): Promise<string> {
    try {
      const content = await readFile(resolveWorkspacePath(rootPath, pathRel), "utf8");
      if (fallback?.trim()) {
        const cleanFallback = stripSearchMarkup(fallback);
        const index = content.toLocaleLowerCase().indexOf(cleanFallback.toLocaleLowerCase().slice(0, 80));
        if (index >= 0) {
          return clipAround(content, index, MAX_WORKSPACE_ITEM_CHARS);
        }
      }
      return clip(content, MAX_WORKSPACE_ITEM_CHARS);
    } catch {
      return clip(stripSearchMarkup(fallback ?? ""), MAX_WORKSPACE_ITEM_CHARS);
    }
  }
}

function shouldIncludeDocument(scope: string, selectionText: string | undefined): boolean {
  if (scope === "document" || scope === "workspace" || scope === "folder") {
    return true;
  }
  return !selectionText?.trim();
}

function buildWorkspaceQuery(prompt: string, selectionText: string | undefined, title: string | undefined): string {
  const source = prompt.trim() || selectionText?.trim() || title?.trim() || "";
  return source.split(/\s+/).slice(0, 12).join(" ");
}

function folderPrefix(pathRel: string): string {
  const dir = path.posix.dirname(normalizePathRel(pathRel));
  return dir === "." ? "" : dir;
}

function normalizeAttachmentPath(documentPathRel: string, refPath: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(refPath) || refPath.startsWith("#")) {
    return undefined;
  }
  const base = path.posix.dirname(normalizePathRel(documentPathRel));
  return normalizePathRel(path.posix.join(base === "." ? "" : base, refPath));
}

function dedupeItems(items: AiContextItemPreview[]): AiContextItemPreview[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.pathRel ?? ""}:${item.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function applyContextBudget(items: AiContextItemPreview[], configuredBudget: number, warnings: string[]): AiContextItemPreview[] {
  const budget = clampContextBudget(configuredBudget);
  let remaining = budget;
  let clipped = false;
  const budgeted: AiContextItemPreview[] = [];
  for (const item of items) {
    if (remaining <= 0) {
      clipped = true;
      break;
    }
    if (item.excerpt.length <= remaining) {
      budgeted.push(item);
      remaining -= item.excerpt.length;
      continue;
    }
    const excerpt = clipToExactBudget(item.excerpt, remaining);
    if (excerpt.trim()) {
      budgeted.push({ ...item, excerpt });
    }
    clipped = true;
    remaining = 0;
  }
  if (clipped) {
    warnings.push(`AI 上下文已按 ${budget} 字符预算裁剪。`);
  }
  return budgeted;
}

function clampContextBudget(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_CONTEXT_BUDGET_CHARS;
  }
  return Math.min(MAX_CONTEXT_BUDGET_CHARS, Math.max(MIN_CONTEXT_BUDGET_CHARS, Math.trunc(value)));
}

function clipToExactBudget(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 0) {
    return "";
  }
  if (maxChars <= 3) {
    return value.slice(0, maxChars);
  }
  if (maxChars <= 24) {
    return `${value.slice(0, maxChars - 3)}...`;
  }
  return `${value.slice(0, maxChars - 4).trimEnd()}\n...`;
}

function clip(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars).trimEnd()}\n...`;
}

function clipAround(value: string, index: number, maxChars: number): string {
  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(value.length, start + maxChars);
  return `${start > 0 ? "...\n" : ""}${value.slice(start, end).trim()}${end < value.length ? "\n..." : ""}`;
}

function stripSearchMarkup(value: string): string {
  return value.replace(/<\/?mark>/g, "");
}

function escapeContextAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}
