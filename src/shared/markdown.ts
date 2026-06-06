/* eslint-disable no-redeclare */
import { toString as mdastToString } from "mdast-util-to-string";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeParse from "rehype-parse";
import rehypeRaw from "rehype-raw";
import rehypeRemark from "rehype-remark";
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Info as MarkdownInfo, State as MarkdownState } from "mdast-util-to-markdown";
import type { Heading, Image, Link, Parents, Root, RootContent, Text } from "mdast";

import { codeFenceLanguageForCodeBlock } from "./codeBlockLanguages";
import type { AttachmentRef, MarkdownLink, OutlineItem, ParsedDocument, WikiLink } from "./types";

export const NOLIA_TOC_START = "<!-- nolia-toc:start -->";
export const NOLIA_TOC_END = "<!-- nolia-toc:end -->";

const attachmentExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".bmp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".rar",
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".avi",
  ".mkv",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
  ".drawio",
  ".dio",
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

type MarkdownParent = Parents & { children: RootContent[] };
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const mermaidFenceDirectives = new Map<string, string>([
  ["architecture", "architecture-beta"],
  ["architecture-beta", "architecture-beta"],
  ["block", "block"],
  ["block-beta", "block-beta"],
  ["c4component", "C4Component"],
  ["c4container", "C4Container"],
  ["c4context", "C4Context"],
  ["c4deployment", "C4Deployment"],
  ["c4dynamic", "C4Dynamic"],
  ["classdiagram", "classDiagram"],
  ["classdiagram-v2", "classDiagram-v2"],
  ["erdiagram", "erDiagram"],
  ["eventmodeling", "eventmodeling"],
  ["flowchart", "flowchart"],
  ["flowchart-elk", "flowchart-elk"],
  ["flowchart-v2", "flowchart"],
  ["gantt", "gantt"],
  ["gitgraph", "gitGraph"],
  ["graph", "graph"],
  ["info", "info"],
  ["ishikawa", "ishikawa"],
  ["ishikawa-beta", "ishikawa-beta"],
  ["journey", "journey"],
  ["kanban", "kanban"],
  ["mindmap", "mindmap"],
  ["packet", "packet"],
  ["packet-beta", "packet-beta"],
  ["pie", "pie"],
  ["quadrantchart", "quadrantChart"],
  ["radar-beta", "radar-beta"],
  ["requirement", "requirementDiagram"],
  ["requirementdiagram", "requirementDiagram"],
  ["sankey", "sankey"],
  ["sankey-beta", "sankey-beta"],
  ["sequencediagram", "sequenceDiagram"],
  ["statediagram", "stateDiagram"],
  ["statediagram-v2", "stateDiagram-v2"],
  ["timeline", "timeline"],
  ["treeview-beta", "treeView-beta"],
  ["treemap", "treemap"],
  ["treemap-beta", "treemap-beta"],
  ["venn-beta", "venn-beta"],
  ["wardley-beta", "wardley-beta"],
  ["xychart", "xychart"],
  ["xychart-beta", "xychart-beta"]
]);

const markdownSanitizeSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "abbr",
    "details",
    "summary",
    "mark",
    "kbd",
    "sub",
    "sup",
    "ruby",
    "rt",
    "rp",
    "dl",
    "dt",
    "dd"
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "id",
      "className",
      ["dataCallout"],
      ["dataCalloutFold"],
      ["dataWikilinkTarget"],
      ["dataWikilinkHeading"],
      ["dataType"],
      ["data-type"],
      ["dataMarkdown"],
      ["data-markdown"],
      ["dataKind"],
      ["data-kind"],
      ["dataDiagram"]
    ],
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      ["dataWikilinkTarget"],
      ["dataWikilinkHeading"]
    ],
    abbr: [
      ...(defaultSchema.attributes?.abbr ?? []),
      "title"
    ],
    details: [
      ...(defaultSchema.attributes?.details ?? []),
      "open"
    ]
  }
};

export function splitFrontmatter(source: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) {
    return {
      frontmatter: {},
      body: source
    };
  }

  const parsed = parseFrontmatterYaml(match[1]);
  return {
    frontmatter: parsed,
    body: source.slice(match[0].length).replace(/^\n+/, "")
  };
}

export function stringifyMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const normalizedBody = body.endsWith("\n") ? body : `${body}\n`;
  if (Object.keys(frontmatter).length === 0) {
    return normalizedBody;
  }
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n${normalizedBody}`;
}

export function parseMarkdown(source: string, pathRel = ""): ParsedDocument {
  const diagnostics: ParsedDocument["diagnostics"] = [];
  const { frontmatter, body } = splitFrontmatter(source);
  const parseBody = markdownWithTocBlocksMasked(body);
  let tree: Root;

  try {
    tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(parseBody);
  } catch (error) {
    diagnostics.push({
      severity: "error",
      message: error instanceof Error ? error.message : "Markdown parse failed"
    });
    tree = { type: "root", children: [] };
  }

  const headings: OutlineItem[] = [];
  const links: MarkdownLink[] = [];
  const attachments: AttachmentRef[] = [];

  visit(tree, "heading", (node: Heading) => {
    const text = mdastToString(node).trim();
    if (!text) {
      return;
    }
    headings.push({
      id: slugify(text),
      text,
      depth: node.depth,
      line: node.position?.start.line ?? 1
    });
  });

  visit(tree, "link", (node: Link) => {
    const href = node.url ?? "";
    const line = node.position?.start.line ?? 1;
    links.push({
      href,
      title: node.title ?? undefined,
      text: mdastToString(node).trim(),
      line
    });
    if (isAttachmentPath(href)) {
      attachments.push({ refPath: href, kind: classifyAttachment(href), line });
    }
  });

  visit(tree, "image", (node: Image) => {
    const url = node.url ?? "";
    attachments.push({
      refPath: url,
      kind: classifyAttachment(url),
      line: node.position?.start.line ?? 1
    });
  });

  const wikilinks = extractWikiLinks(parseBody);
  const inlineTags = extractInlineTags(parseBody);
  const frontmatterTags = extractFrontmatterTags(frontmatter);
  const title = pickTitle(frontmatter, headings, pathRel);
  const plainText = mdastToString(tree);

  return {
    frontmatter,
    title,
    body,
    plainText,
    headings,
    tags: uniqueStrings([...frontmatterTags, ...inlineTags]),
    links,
    wikilinks,
    attachments: uniqueAttachments(attachments),
    diagnostics,
    wordCount: countWords(plainText),
    lineCount: source.split(/\r?\n/).length
  };
}

export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const { body } = splitFrontmatter(markdown);
  const renderBody = preprocessEmptyTaskListItems(preprocessDefinitionLists(preprocessTocBlocks(body)));
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkWikiLinksAndMarks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, markdownSanitizeSchema)
    .use(rehypeHeadingIds)
    .use(rehypeTrimAutolinkTrailingPunctuation)
    .use(rehypeKatex)
    .use(rehypeHighlight)
    .use(rehypeWikiLinkClasses)
    .use(rehypeCallouts)
    .use(rehypeDiagramBlocks)
    .use(rehypeStringify)
    .process(renderBody);

  return trimRenderedCodeFenceNewline(String(file));
}

export function createMarkdownTocBlock(source: string, title = "目录"): string {
  return [NOLIA_TOC_START, `## ${title}`, "", markdownTocList(source), NOLIA_TOC_END].join("\n");
}

export function updateMarkdownToc(source: string): string {
  const sourceWithoutToc = markdownWithoutTocBlocks(source);
  return replaceMarkdownTocBlocks(source, (blockSource) => createMarkdownTocBlock(sourceWithoutToc, tocTitleFromBlock(blockSource)));
}

export function hasMarkdownToc(source: string): boolean {
  return tocBlockPattern().test(source);
}

function markdownTocList(source: string): string {
  const headings = parseMarkdown(markdownWithoutTocBlocks(source)).headings;
  if (!headings.length) {
    return "- _暂无标题_";
  }
  return headings
    .map((heading) => {
      const indent = "  ".repeat(Math.max(0, heading.depth - 1));
      return `${indent}- [${escapeMarkdownTocLabel(heading.text)}](#${encodeMarkdownHeadingSlug(heading.id)})`;
    })
    .join("\n");
}

function replaceMarkdownTocBlocks(source: string, createReplacement: (blockSource: string) => string): string {
  return source.replace(tocBlockPattern(), (blockSource) => createReplacement(blockSource));
}

function markdownWithoutTocBlocks(source: string): string {
  return replaceMarkdownTocBlocks(source, () => "");
}

function markdownWithTocBlocksMasked(source: string): string {
  return replaceMarkdownTocBlocks(source, (blockSource) => blockSource.replace(/[^\r\n]/g, " "));
}

function tocBlockPattern(): RegExp {
  return new RegExp(`${escapeRegExp(NOLIA_TOC_START)}[\\s\\S]*?${escapeRegExp(NOLIA_TOC_END)}`, "g");
}

function tocTitleFromBlock(blockSource: string): string {
  const body = blockSource
    .replace(NOLIA_TOC_START, "")
    .replace(NOLIA_TOC_END, "");
  const title = body.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
  return title || "目录";
}

function escapeMarkdownTocLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function encodeMarkdownHeadingSlug(value: string): string {
  return encodeURI(value);
}

function preprocessTocBlocks(source: string): string {
  return replaceMarkdownTocBlocks(source, (blockSource) => {
    return [
      `<div data-type="markdown-preview-block" data-kind="toc" data-markdown="${escapeHtmlAttribute(blockSource)}" class="markdown-preview-block markdown-preview-block-toc">`,
      tocBlockHtml(blockSource),
      "</div>"
    ].join("");
  });
}

function tocBlockHtml(blockSource: string): string {
  const visibleMarkdown = blockSource
    .replace(NOLIA_TOC_START, "")
    .replace(NOLIA_TOC_END, "")
    .trim();
  const title = visibleMarkdown.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() || "目录";
  const items = visibleMarkdown
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+\[([^\]]+)]\((#[^)]+)\)/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => `<li><a href="${escapeHtmlAttribute(match[2])}">${escapeHtml(unescapeMarkdownTocLabel(match[1]))}</a></li>`)
    .join("");
  return `<h2 id="${escapeHtmlAttribute(slugify(title))}">${escapeHtml(title)}</h2><ul>${items || "<li><em>暂无标题</em></li>"}</ul>`;
}

function unescapeMarkdownTocLabel(value: string): string {
  return value.replace(/\\]/g, "]").replace(/\\\\/g, "\\");
}

function remarkWikiLinksAndMarks() {
  return (tree: Root) => {
    visit(tree, "text", (node: Text, index: number | undefined, parent: Parents | undefined) => {
      if (!isMarkdownParent(parent) || typeof index !== "number") {
        return;
      }
      const replacements = expandInlineExtensions(node.value);
      if (replacements.length === 1 && replacements[0]?.type === "text" && replacements[0].value === node.value) {
        return;
      }
      parent.children.splice(index, 1, ...replacements);
    });
  };
}

function expandInlineExtensions(value: string): RootContent[] {
  const nodes: RootContent[] = [];
  const pattern = /(\[\[([^\]\n]+)\]\]|==([^=\n](?:.*?[^=\n])?)==)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      nodes.push({ type: "text", value: value.slice(cursor, match.index) });
    }
    if (match[2]) {
      nodes.push(createWikiLinkNode(match[2]));
    } else {
      nodes.push({ type: "html", value: `<mark>${escapeHtml(match[3] ?? "")}</mark>` } as RootContent);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) {
    nodes.push({ type: "text", value: value.slice(cursor) });
  }
  return nodes.length ? nodes : [{ type: "text", value }];
}

function createWikiLinkNode(raw: string): RootContent {
  const [targetWithHeading, alias] = raw.split("|").map((part) => part.trim());
  const [targetText, targetHeading] = targetWithHeading.split("#").map((part) => part.trim());
  const label = alias || targetText || raw.trim();
  const targetSlug = slugify(targetText || label);
  return {
    type: "link",
    url: `#wiki-${targetSlug}`,
    children: [{ type: "text", value: label }],
    data: {
      hProperties: {
        className: ["wikilink"],
        dataWikilinkTarget: targetText,
        dataWikilinkHeading: targetHeading || undefined
      }
    }
  } as RootContent;
}

function rehypeWikiLinkClasses() {
  return (tree: HastNode) => {
    visit(tree, (node: HastNode) => {
      if (!isElement(node, "a") || !node.properties?.dataWikilinkTarget) {
        return;
      }
      node.properties.className = ["wikilink"];
    });
  };
}

function rehypeHeadingIds() {
  return (tree: HastNode) => {
    visit(tree, (node: HastNode) => {
      if (!isElement(node) || !/^h[1-6]$/.test(node.tagName ?? "")) {
        return;
      }
      node.properties = {
        ...(node.properties ?? {}),
        id: slugify(textContentLines(node).join(" ").trim())
      };
    });
  };
}

function rehypeCallouts() {
  return (tree: HastNode) => {
    visit(tree, (node: HastNode) => {
      if (!isElement(node, "blockquote")) {
        return;
      }
      const firstParagraph = node.children?.find((child) => isElement(child, "p"));
      const firstText = firstParagraph?.children?.find((child) => child.type === "text");
      if (!firstText?.value) {
        return;
      }
      const match = firstText.value.match(/^\[!([A-Za-z][A-Za-z0-9_-]*)([+-])?]\s*([^\n]*)/);
      if (!match) {
        return;
      }
      const kind = match[1].toLowerCase();
      const title = match[3].trim() || defaultCalloutTitle(kind);
      firstText.value = firstText.value.slice(match[0].length);
      if (firstParagraph) {
        trimLeadingEmptyText(firstParagraph);
      }
      node.properties = {
        ...(node.properties ?? {}),
        className: ["callout", `callout-${kind}`],
        dataCallout: kind,
        dataCalloutFold: match[2] ?? undefined,
        dataMarkdown: calloutMarkdown(kind, match[2], title, calloutBodyText(node))
      };
      node.children = [
        {
          type: "element",
          tagName: "div",
          properties: { className: ["callout-title"] },
          children: [{ type: "text", value: title }]
        },
        ...(node.children ?? [])
      ];
    });
  };
}

function rehypeDiagramBlocks() {
  return (tree: HastNode) => {
    visit(tree, (node: HastNode) => {
      if (!isElement(node, "pre")) {
        return;
      }
      const code = node.children?.find((child) => isElement(child, "code"));
      const className = normalizeClassName(code?.properties?.className);
      const language = className.find((value) => value.startsWith("language-"))?.replace(/^language-/, "");
      const source = code?.children?.map((child) => child.value ?? "").join("") ?? "";
      if (language === "mermaid" || mermaidDirectiveForFence(language)) {
        const diagramSource = mermaidSourceForFence(language, source);
        (node as HastNode).tagName = "div";
        node.properties = {
          className: ["mermaid"],
          dataDiagram: "mermaid",
          dataMarkdown: fencedCodeMarkdown(language || "mermaid", source)
        };
        node.children = [{ type: "text", value: diagramSource }];
        return;
      }
      if (language === "plantuml" || language === "puml" || language === "echarts") {
        node.properties = {
          ...(node.properties ?? {}),
          className: ["diagram-source", `diagram-source-${language}`]
        };
        return;
      }
      node.properties = {
        ...(node.properties ?? {}),
        ...(language ? { dataLanguage: language } : {}),
        dataCodeBlock: "true"
      };
    });
  };
}

function rehypeTrimAutolinkTrailingPunctuation() {
  return (tree: HastNode) => {
    visit(tree, (node: HastNode, index: number | undefined, parent: HastNode | undefined) => {
      if (!isElement(node, "a") || typeof index !== "number" || !parent?.children) {
        return;
      }
      const href = String(node.properties?.href ?? "");
      const label = textContentLines(node).join("");
      if (!/^https?:\/\//i.test(href) || !label.startsWith("http")) {
        return;
      }
      const trailing = trailingLinkPunctuation(label);
      if (!trailing) {
        return;
      }
      const decodedHref = decodeUriSafely(href);
      if (!decodedHref.endsWith(trailing)) {
        return;
      }
      const nextLabel = label.slice(0, -trailing.length);
      const nextHref = decodedHref.slice(0, -trailing.length);
      node.properties = {
        ...(node.properties ?? {}),
        href: nextHref
      };
      node.children = [{ type: "text", value: nextLabel }];
      parent.children.splice(index + 1, 0, { type: "text", value: trailing });
    });
  };
}

function trailingLinkPunctuation(value: string): string {
  let cursor = value.length;
  while (cursor > 0 && /[。．，、；：！？,.!?;:]/u.test(value[cursor - 1])) {
    cursor -= 1;
  }
  return value.slice(cursor);
}

function decodeUriSafely(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function preprocessDefinitionLists(source: string): string {
  const lines = source.split(/\r?\n/);
  const output: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fence = line.match(/^ {0,3}(```+|~~~+)/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1].startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      output.push(line);
      continue;
    }
    const next = lines[index + 1] ?? "";
    if (!inFence && isDefinitionTerm(line) && isDefinitionLine(next)) {
      const definitions: string[] = [];
      index += 1;
      while (index < lines.length && isDefinitionLine(lines[index] ?? "")) {
        definitions.push((lines[index] ?? "").replace(/^\s*:\s?/, ""));
        index += 1;
      }
      index -= 1;
      const markdown = `${line.trim()}\n${definitions.map((definition) => `: ${definition.trim()}`).join("\n")}`;
      output.push(
        `<dl data-markdown="${escapeHtmlAttribute(markdown)}">`,
        `<dt>${escapeHtml(line.trim())}</dt>`,
        ...definitions.map((definition) => `<dd>${escapeHtml(definition.trim())}</dd>`),
        "</dl>"
      );
      continue;
    }
    output.push(line);
  }
  return output.join("\n");
}

function isMarkdownParent(parent: Parents | undefined): parent is MarkdownParent {
  return Boolean(parent && Array.isArray((parent as MarkdownParent).children));
}

function isElement<T extends string>(node: HastNode | undefined, tagName: T): node is HastNode & { type: "element"; tagName: T; children: HastNode[] };
function isElement(node: HastNode | undefined): node is HastNode & { type: "element"; children: HastNode[] };
function isElement(node: HastNode | undefined, tagName?: string): node is HastNode & { type: "element"; children: HastNode[] } {
  return Boolean(node && node.type === "element" && (!tagName || node.tagName === tagName));
}

function trimLeadingEmptyText(node: HastNode) {
  while (node.children?.[0]?.type === "text" && !node.children[0].value?.trim()) {
    node.children.shift();
  }
}

function calloutBodyText(node: HastNode): string {
  return (node.children ?? [])
    .flatMap((child) => textContentLines(child))
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function textContentLines(node: HastNode): string[] {
  if (node.type === "text") {
    return (node.value ?? "").split(/\r?\n/);
  }
  return (node.children ?? []).flatMap((child) => textContentLines(child));
}

function normalizeClassName(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  return [];
}

function isDefinitionTerm(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(trimmed && !/^(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|~~~|\||<)/.test(trimmed));
}

function isDefinitionLine(line: string): boolean {
  return /^\s*:\s+\S/.test(line);
}

function defaultCalloutTitle(kind: string): string {
  const titles: Record<string, string> = {
    note: "Note",
    tip: "Tip",
    important: "Important",
    warning: "Warning",
    caution: "Caution",
    info: "Info",
    todo: "Todo",
    example: "Example",
    quote: "Quote"
  };
  return titles[kind] ?? kind.replace(/(^|-)([a-z])/g, (_match, prefix: string, letter: string) => `${prefix ? " " : ""}${letter.toUpperCase()}`);
}

function calloutMarkdown(kind: string, fold: string | undefined, title: string, body: string): string {
  const header = `> [!${kind.toUpperCase()}${fold ?? ""}] ${title}`.trimEnd();
  const bodyLines = body
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return bodyLines ? `${header}\n${bodyLines}` : header;
}

function fencedCodeMarkdown(language: string, source: string): string {
  return `\`\`\`${language}\n${source.trimEnd()}\n\`\`\``;
}

function mermaidDirectiveForFence(language: string | undefined): string | undefined {
  if (!language) {
    return undefined;
  }
  return mermaidFenceDirectives.get(language.toLowerCase());
}

export function isMermaidFenceLanguage(language: string | undefined): boolean {
  return language?.toLowerCase() === "mermaid" || Boolean(mermaidDirectiveForFence(language));
}

export interface EditableCodeFenceLocation {
  fenceStart: number;
  infoStart: number;
  infoEnd: number;
  bodyStart: number;
  closeEnd: number;
  language?: string;
  markdown: string;
}

export function findEditableCodeFenceLocations(source: string): EditableCodeFenceLocation[] {
  const locations: EditableCodeFenceLocation[] = [];
  const openingFencePattern = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})([^\r\n]*)\r?\n/g;
  let openingMatch: RegExpExecArray | null;
  while ((openingMatch = openingFencePattern.exec(source))) {
    const fenceStart = openingMatch.index + openingMatch[1].length;
    const fenceMarker = openingMatch[3];
    const fenceChar = fenceMarker[0];
    const infoStart = fenceStart + openingMatch[2].length + fenceMarker.length;
    const bodyStart = openingFencePattern.lastIndex;
    const infoEnd = source.slice(0, bodyStart).endsWith("\r\n") ? bodyStart - 2 : bodyStart - 1;
    const language = openingMatch[4].trim().split(/\s+/)[0] || undefined;
    let lineStart = bodyStart;
    let closeEnd: number | undefined;
    while (lineStart <= source.length) {
      const lineEnd = source.indexOf("\n", lineStart);
      const lineEndIndex = lineEnd === -1 ? source.length : lineEnd;
      const line = source.slice(lineStart, lineEndIndex);
      if (isClosingFenceLine(line, fenceChar, fenceMarker.length)) {
        closeEnd = lineEnd === -1 ? source.length : lineEnd + 1;
        if (!isMermaidFenceLanguage(language)) {
          locations.push({
            fenceStart,
            infoStart,
            infoEnd,
            bodyStart,
            closeEnd,
            language,
            markdown: source.slice(fenceStart, closeEnd)
          });
        }
        break;
      }
      if (lineEnd === -1) {
        break;
      }
      lineStart = lineEnd + 1;
    }
    if (!closeEnd) {
      break;
    }
    openingFencePattern.lastIndex = closeEnd;
  }
  return locations;
}

export function updateFencedCodeBlockLanguage(source: string, index: number, language: string): string | undefined {
  const location = findEditableCodeFenceLocations(source)[index];
  if (!location) {
    return undefined;
  }
  const nextLanguage = codeFenceLanguageForCodeBlock(language);
  const rawInfo = source.slice(location.infoStart, location.infoEnd);
  const leadingWhitespace = rawInfo.match(/^\s*/)?.[0] ?? "";
  const infoBody = rawInfo.slice(leadingWhitespace.length);
  const currentLanguage = infoBody.match(/^\S+/)?.[0] ?? "";
  const rest = currentLanguage ? infoBody.slice(currentLanguage.length) : infoBody;
  const nextInfo = nextLanguage ? `${leadingWhitespace}${nextLanguage}${rest}` : rest.trim() ? rest : "";
  return `${source.slice(0, location.infoStart)}${nextInfo}${source.slice(location.infoEnd)}`;
}

function isClosingFenceLine(line: string, fenceChar: string, minLength: number): boolean {
  const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  const marker = normalizedLine.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/)?.[1];
  return Boolean(marker && marker[0] === fenceChar && marker.length >= minLength);
}

function mermaidSourceForFence(language: string | undefined, source: string): string {
  const directive = mermaidDirectiveForFence(language);
  if (!directive) {
    return source;
  }
  const trimmedStart = source.trimStart();
  if (new RegExp(`^${escapeRegExp(directive)}\\b`).test(trimmedStart)) {
    return source;
  }
  return `${directive}\n${source}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value)
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");
}

function trimRenderedCodeFenceNewline(html: string): string {
  return html.replace(/(<pre(?:\s[^>]*)?><code(?:\s[^>]*)?>)([\s\S]*?)(<\/code><\/pre>)/g, (_match, open: string, code: string, close: string) => {
    if (!code.endsWith("\n")) {
      return `${open}${code}${close}`;
    }
    return `${open}${code.slice(0, -1)}${close}`;
  });
}

export async function htmlToMarkdown(html: string): Promise<string> {
  return htmlToMarkdownSync(html);
}

export function htmlToMarkdownSync(html: string): string {
  const { html: normalizedHtml, rawBlocks } = normalizeEditorHtml(html);
  const file = unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypeRemark)
    .use(remarkGfm)
    .use(remarkStringify, {
      bullet: "-",
      fences: true,
      handlers: {
        text: relaxedMarkdownText
      },
      rule: "-",
      tightDefinitions: true
    })
    .processSync(normalizedHtml);

  let markdown = String(file).trimEnd();
  markdown = compactTaskListMarkdown(markdown);
  markdown = markdown.replace(/\u200b/g, "");
  rawBlocks.forEach((raw, index) => {
    markdown = markdown.replace(new RegExp(`NOLIA_RAW_BLOCK_${index}(?!\\d)`, "g"), () => raw);
  });
  return markdown;
}

function preprocessEmptyTaskListItems(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let fence: "`" | "~" | undefined;
  return lines
    .map((line) => {
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1][0] as "`" | "~";
        if (!fence) {
          fence = marker;
        } else if (fence === marker) {
          fence = undefined;
        }
        return line;
      }
      if (fence) {
        return line;
      }
      return line.replace(/^(\s*[-+*]\s+\[[ xX]\])\s*$/, "$1 \u200b");
    })
    .join("\n");
}

function compactTaskListMarkdown(markdown: string): string {
  let next = markdown;
  let previous = "";
  while (next !== previous) {
    previous = next;
    next = next.replace(/(^|\n)([ \t]*)- \[([ xX])]\n\n[ \t]+([^\n]+)(?=\n|$)/g, (_match, prefix: string, indent: string, checked: string, text: string) => {
      return `${prefix}${indent}- [${checked.toLowerCase() === "x" ? "x" : " "}] ${text.trim()}`;
    });
  }
  return next;
}

function relaxedMarkdownText(node: Text, parent: Parents | undefined, state: MarkdownState, info: MarkdownInfo): string {
  if (shouldPreserveUserMarkdownText(node, parent, state.stack)) {
    return node.value;
  }
  return restoreGeneratedInlineMarkdown(state.safe(node.value, info));
}

function shouldPreserveUserMarkdownText(node: Text, parent: Parents | undefined, stack: string[]): boolean {
  if (isRawMarkdownPlaceholder(node.value) || isGeneratedMarkdownInlineToken(node.value)) {
    return true;
  }
  if (parent?.type !== "paragraph" && parent?.type !== "heading") {
    return false;
  }
  if (stack.some((construct) => syntaxSensitiveMarkdownConstructs.has(construct))) {
    return false;
  }
  if (!("children" in parent) || parent.children.length !== 1) {
    return false;
  }
  return looksLikeStandaloneMarkdownShortcut(node.value);
}

function isRawMarkdownPlaceholder(value: string): boolean {
  return /^NOLIA_RAW_BLOCK_\d+$/.test(value.trim());
}

function isGeneratedMarkdownInlineToken(value: string): boolean {
  const text = value.trim();
  return [
    /^\[\[[\s\S]+]]$/,
    /^\[\^[^\]\n]+]$/,
    /^==[^=\n]+==$/,
    /^\$[^$\n]+\$$/
  ].some((pattern) => pattern.test(text));
}

function restoreGeneratedInlineMarkdown(value: string): string {
  return value
    .replace(/\\\[\\\[((?:[^\]]|](?!]))+)]]/g, "[[$1]]")
    .replace(/\\\[\^([^\]\n]+)]/g, "[^$1]");
}

function looksLikeStandaloneMarkdownShortcut(value: string): boolean {
  const text = value.trim();
  return [
    /^#{1,6}\s+\S[\s\S]*$/,
    /^>\s+\S[\s\S]*$/,
    /^[-+*]\s+\[[ xX]\]\s*[\s\S]*$/,
    /^\*\*[^*\n]+?\*\*$/,
    /^\*[^*\n]+?\*$/,
    /^~~[^~\n]+?~~$/,
    /^`[^`\n]+?`$/,
    /^==[^=\n]+?==$/,
    /^\[[^\]\n]+]\([^)]+?\)$/
  ].some((pattern) => pattern.test(text));
}

const syntaxSensitiveMarkdownConstructs = new Set([
  "autolink",
  "codeFencedLangGraveAccent",
  "codeFencedLangTilde",
  "codeFencedMetaGraveAccent",
  "codeFencedMetaTilde",
  "definition",
  "destinationLiteral",
  "destinationRaw",
  "label",
  "link",
  "reference",
  "table",
  "tableCell",
  "tableRow",
  "titleApostrophe",
  "titleQuote"
]);

function normalizeEditorHtml(html: string): { html: string; rawBlocks: string[] } {
  const rawBlocks: string[] = [];
  const tree = unified().use(rehypeParse, { fragment: true }).parse(html) as HastNode;
  rewriteEditorHast(tree, rawBlocks);
  const normalized = unified().use(rehypeStringify).stringify(tree as never);
  return { html: String(normalized), rawBlocks };
}

function rewriteEditorHast(node: HastNode, rawBlocks: string[]): void {
  if (!node.children) {
    return;
  }
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    normalizeAssetImage(child);
    const replacement = replacementForEditorNode(child, rawBlocks);
    if (replacement) {
      node.children[index] = replacement;
      continue;
    }
    rewriteEditorHast(child, rawBlocks);
  }
}

function replacementForEditorNode(node: HastNode, rawBlocks: string[]): HastNode | undefined {
  if (!isElement(node)) {
    return undefined;
  }

  const dataType = hastPropertyString(node, "dataType");
  const names = classNames(node);
  if (dataType === "markdown-inline") {
    return textNode(hastPropertyString(node, "dataMarkdown") || hastPropertyString(node, "dataLabel") || "");
  }
  if (dataType === "markdown-preview-block" || names.includes("markdown-preview-block")) {
    const markdown = hastPropertyString(node, "dataMarkdown");
    if (markdown) {
      return rawBlockNode(rawBlocks, markdown);
    }
  }
  if (isElement(node, "img")) {
    const markdown = hastPropertyString(node, "dataMarkdown");
    if (markdown) {
      return rawBlockNode(rawBlocks, markdown);
    }
  }
  if (dataType === "inline-math" || names.includes("katex")) {
    const markdown = hastPropertyString(node, "dataMarkdown");
    if (markdown) {
      return textNode(markdown);
    }
    const latex = hastPropertyString(node, "dataLatex") || latexFromKatex(node);
    return latex ? textNode(`$${latex}$`) : undefined;
  }
  if (dataType === "math-block" || names.includes("katex-display")) {
    const markdown = hastPropertyString(node, "dataMarkdown");
    if (markdown) {
      return rawBlockNode(rawBlocks, markdown);
    }
    const latex = hastPropertyString(node, "dataLatex") || latexFromKatex(node) || textContentLines(node).join("\n").trim();
    return latex ? rawBlockNode(rawBlocks, `$$\n${latex}\n$$`) : undefined;
  }
  if (dataType === "taskList" || names.includes("contains-task-list")) {
    const markdown = markdownForTaskList(node);
    return markdown ? rawBlockNode(rawBlocks, markdown) : undefined;
  }

  if (isElement(node, "a") && isWikiLinkHast(node)) {
    return textNode(markdownForWikiLinkHast(node));
  }
  if (isElement(node, "mark")) {
    return textNode(`==${markdownForInlineHastChildren(node.children ?? [])}==`);
  }
  if (node.type === "element" && node.tagName === "sup") {
    const children = node.children ?? [];
    const anchor = children.find((child: HastNode) => isElement(child, "a")) as HastNode | undefined;
    if (anchor && ("dataFootnoteRef" in (anchor.properties ?? {}) || /fnref?-/.test(`${hastPropertyString(anchor, "id")} ${hastPropertyString(anchor, "href")}`))) {
      return textNode(`[^${footnoteLabelFromHast(anchor)}]`);
    }
  }
  if (isElement(node, "blockquote") && names.some((className) => className.startsWith("callout"))) {
    const markdown = hastPropertyString(node, "dataMarkdown") || calloutMarkdownFromHast(node);
    return rawBlockNode(rawBlocks, markdown);
  }
  if (isElement(node, "dl")) {
    return rawBlockNode(rawBlocks, hastPropertyString(node, "dataMarkdown") || definitionListMarkdownFromHast(node));
  }
  if (isElement(node, "details")) {
    return rawBlockNode(rawBlocks, stringifyHastFragment(node));
  }
  if (isElement(node) && names.includes("mermaid")) {
    const markdown = hastPropertyString(node, "dataMarkdown") || fencedCodeMarkdown("mermaid", textContentLines(node).join("\n"));
    return rawBlockNode(rawBlocks, markdown);
  }
  if (isElement(node) && names.includes("footnotes")) {
    return rawBlockNode(rawBlocks, footnotesMarkdownFromHast(node));
  }

  return undefined;
}

function normalizeAssetImage(node: HastNode): void {
  if (!isElement(node, "img")) {
    return;
  }
  const markdownSrc = hastPropertyString(node, "dataMarkdownSrc");
  const src = hastPropertyString(node, "src");
  const assetPath = assetPathFromNoliaNoteUrl(markdownSrc) ?? (markdownSrc || assetPathFromNoliaNoteUrl(src));
  if (!assetPath) {
    return;
  }
  node.properties = {
    ...(node.properties ?? {}),
    src: assetPath,
    dataMarkdownSrc: undefined
  };
}

function assetPathFromNoliaNoteUrl(src: string): string | undefined {
  try {
    const url = new URL(src);
    if (url.protocol !== "nolia-asset:") {
      return undefined;
    }
    if (url.hostname === "external") {
      const originalMarkdown = url.searchParams.get("markdown");
      return originalMarkdown || undefined;
    }
    const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    const assetSegments = url.hostname === "workspace" ? segments.slice(1) : segments;
    const assetPath = decodeAssetPath(assetSegments.join("/"));
    return assetPath ? `${assetPath}${url.search}${url.hash}` : undefined;
  } catch {
    const assetMatch = src.match(/^nolia-asset:\/\/[^/]+\/([^?#]+)([?#][\s\S]*)?$/);
    return assetMatch ? `${decodeAssetPath(assetMatch[1])}${assetMatch[2] ?? ""}` : undefined;
  }
}

function rawBlockNode(rawBlocks: string[], markdown: string): HastNode {
  const placeholder = `NOLIA_RAW_BLOCK_${rawBlocks.length}`;
  rawBlocks.push(markdown.trimEnd());
  return {
    type: "element",
    tagName: "p",
    properties: {},
    children: [textNode(placeholder)]
  };
}

function textNode(value: string): HastNode {
  return { type: "text", value };
}

function markdownForTaskList(node: HastNode): string {
  return (node.children ?? [])
    .filter((child) => isElement(child, "li"))
    .map((item) => {
      const checked = hastPropertyString(item, "dataChecked") === "true" || hasCheckedInput(item);
      return taskItemMarkdown(item, checked);
    })
    .join("\n");
}

function taskItemMarkdown(item: HastNode, checked: boolean): string {
  const prefix = `- [${checked ? "x" : " "}]`;
  const content = taskItemMarkdownContent(item);
  if (!content) {
    return prefix;
  }
  const [firstLine = "", ...restLines] = content.split("\n");
  return [firstLine ? `${prefix} ${firstLine}` : prefix, ...restLines.map((line) => (line ? `  ${line}` : ""))].join("\n");
}

function taskItemMarkdownContent(item: HastNode): string {
  const children = taskItemContentChildren(item);
  if (!children.length) {
    return "";
  }
  return htmlToMarkdownSync(stringifyHastChildren(children))
    .replace(/\u200b/g, "")
    .trim();
}

function taskItemContentChildren(item: HastNode): HastNode[] {
  return (item.children ?? []).flatMap((child) => taskItemContentNode(child, true));
}

function taskItemContentNode(node: HastNode, unwrapDiv: boolean): HastNode[] {
  if (isElement(node, "label") || isElement(node, "input")) {
    return [];
  }
  if (node.type === "text") {
    return unwrapDiv && !node.value?.trim() ? [] : [{ ...node }];
  }
  if (!isElement(node)) {
    return [{ ...node }];
  }
  const children = (node.children ?? []).flatMap((child) => taskItemContentNode(child, false));
  if (unwrapDiv && node.tagName === "div") {
    return children;
  }
  return [{ ...node, children }];
}

function hasCheckedInput(node: HastNode): boolean {
  let checked = false;
  visit(node, (child: HastNode) => {
    if (checked || !isElement(child, "input")) {
      return;
    }
    checked = Boolean(child.properties?.checked);
  });
  return checked;
}

function isWikiLinkHast(node: HastNode): boolean {
  return Boolean(hastPropertyString(node, "dataWikilinkTarget") || classNames(node).includes("wikilink"));
}

function latexFromKatex(node: HastNode): string {
  let latex = "";
  visit(node, (child: HastNode) => {
    if (latex || !isElement(child, "annotation")) {
      return;
    }
    if (hastPropertyString(child, "encoding") === "application/x-tex") {
      latex = textContentLines(child).join("\n").trim();
    }
  });
  return latex;
}

function markdownForWikiLinkHast(node: HastNode): string {
  const label = textContentLines(node).join(" ").trim();
  const target = hastPropertyString(node, "dataWikilinkTarget") || hastPropertyString(node, "href").replace(/^#wiki-/, "") || label;
  const heading = hastPropertyString(node, "dataWikilinkHeading");
  const targetWithHeading = `${target}${heading ? `#${heading}` : ""}`;
  return label && label !== target ? `[[${targetWithHeading}|${label}]]` : `[[${targetWithHeading}]]`;
}

function footnoteLabelFromHast(anchor: HastNode | undefined): string {
  const id = hastPropertyString(anchor, "id") || hastPropertyString(anchor, "href");
  return id.match(/fn(?:ref)?-([A-Za-z0-9_-]+)/)?.[1] || textContentLines(anchor ?? { type: "text", value: "1" }).join("").trim() || "1";
}

function calloutMarkdownFromHast(node: HastNode): string {
  const kind = classNames(node).find((className) => className.startsWith("callout-"))?.replace(/^callout-/, "").toUpperCase() || "NOTE";
  const title = node.children?.find((child) => isElement(child) && classNames(child).includes("callout-title"));
  const body = (node.children ?? [])
    .filter((child) => child !== title)
    .flatMap((child) => textContentLines(child))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join("\n");
  const header = `> [!${kind}] ${textContentLines(title ?? { type: "text", value: kind }).join(" ").trim() || kind}`;
  return body ? `${header}\n${body}` : header;
}

function definitionListMarkdownFromHast(node: HastNode): string {
  const lines: string[] = [];
  for (const child of node.children ?? []) {
    if (isElement(child, "dt")) {
      lines.push(textContentLines(child).join(" ").trim());
    } else if (isElement(child, "dd")) {
      lines.push(`: ${textContentLines(child).join(" ").trim()}`);
    }
  }
  return lines.join("\n");
}

function footnotesMarkdownFromHast(node: HastNode): string {
  return (node.children ?? [])
    .flatMap((child) => (isElement(child, "ol") ? child.children ?? [] : []))
    .filter((child) => isElement(child, "li"))
    .map((item, index) => {
      const id = hastPropertyString(item, "id");
      const label = id.match(/fn-([A-Za-z0-9_-]+)/)?.[1] || String(index + 1);
      const text = textContentLines(item).join(" ").replace(/↩|Back to reference \d+/g, "").trim();
      return `[^${label}]: ${text}`;
    })
    .join("\n");
}

function stringifyHastFragment(node: HastNode): string {
  return String(unified().use(rehypeStringify).stringify({ type: "root", children: [node] } as never));
}

function stringifyHastChildren(children: HastNode[]): string {
  return String(unified().use(rehypeStringify).stringify({ type: "root", children } as never));
}

function markdownForInlineHastChildren(children: HastNode[]): string {
  return htmlToMarkdownSync(`<p>${stringifyHastChildren(children)}</p>`).trim();
}

function hastPropertyString(node: HastNode | undefined, name: string): string {
  const value = node?.properties?.[name];
  if (Array.isArray(value)) {
    return value.map(String).join(" ");
  }
  return value === undefined || value === null ? "" : String(value);
}

function classNames(node: HastNode): string[] {
  const className = node.properties?.className;
  if (Array.isArray(className)) {
    return className.map(String);
  }
  if (typeof className === "string") {
    return className.split(/\s+/).filter(Boolean);
  }
  return [];
}


function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeAssetPath(value: string): string {
  return value
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/");
}

export function mergeWysiwygBodyIntoSource(sourceText: string, nextBody: string): string {
  const { frontmatter } = splitFrontmatter(sourceText);
  return stringifyMarkdown(frontmatter, nextBody);
}

function pickTitle(frontmatter: Record<string, unknown>, headings: OutlineItem[], pathRel: string): string {
  const frontmatterTitle = frontmatter.title;
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) {
    return frontmatterTitle.trim();
  }
  if (headings[0]?.text) {
    return headings[0].text;
  }
  const fallback = pathRel.split("/").pop()?.replace(/\.[^.]+$/, "");
  return fallback || "Untitled";
}

function parseFrontmatterYaml(raw: string): Record<string, unknown> {
  try {
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function extractFrontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const tags = frontmatter.tags ?? frontmatter.tag;
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags
      .split(/[,\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function extractInlineTags(source: string): string[] {
  const tags: string[] = [];
  const tagPattern = /(^|[\s([{])#([A-Za-z0-9][\w/-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source)) !== null) {
    tags.push(match[2]);
  }
  return tags;
}

function extractWikiLinks(source: string): WikiLink[] {
  const links: WikiLink[] = [];
  const pattern = /\[\[([^\]\n]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const raw = match[1].trim();
    const [targetWithHeading, alias] = raw.split("|").map((part) => part.trim());
    const [targetText, targetHeading] = targetWithHeading.split("#").map((part) => part.trim());
    const position = positionForOffset(source, match.index);
    links.push({
      targetText,
      targetHeading: targetHeading || undefined,
      alias: alias || undefined,
      line: position.line,
      col: position.col
    });
  }
  return links;
}

function positionForOffset(source: string, offset: number): { line: number; col: number } {
  const prefix = source.slice(0, offset);
  const lines = prefix.split(/\r?\n/);
  return {
    line: lines.length,
    col: lines[lines.length - 1].length + 1
  };
}

function countWords(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*/g)?.length ?? 0;
  return cjk + latin;
}

function uniqueStrings(values: string[]): string[] {
  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return [...new Set(normalized)].sort((a, b) => a.localeCompare(b));
}

function uniqueAttachments(values: AttachmentRef[]): AttachmentRef[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.refPath}:${value.kind}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isAttachmentPath(href: string): boolean {
  const lower = href.toLowerCase().split(/[?#]/)[0];
  const ext = lower.match(/\.[^./]+$/)?.[0];
  return Boolean(ext && attachmentExtensions.has(ext));
}

function classifyAttachment(refPath: string): AttachmentRef["kind"] {
  const lower = refPath.toLowerCase().split(/[?#]/)[0];
  const ext = lower.match(/\.[^./]+$/)?.[0] ?? "";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"].includes(ext)) {
    return "image";
  }
  if (ext === ".pdf") {
    return "pdf";
  }
  if ([".zip", ".tar", ".gz", ".tgz", ".7z", ".rar"].includes(ext)) {
    return "archive";
  }
  if ([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"].includes(ext)) {
    return "media";
  }
  return "other";
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
