import { Node, mergeAttributes } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import mermaid from "mermaid";
import { wireMarkdownNodeInteraction } from "./markdownNodeInteraction";

type MarkdownPreviewBlockOptions = {
  sourceLabel: string;
};

export const MarkdownPreviewBlock = Node.create<MarkdownPreviewBlockOptions>({
  name: "markdownPreviewBlock",
  group: "block",
  atom: true,
  isolating: true,

  addOptions() {
    return {
      sourceLabel: "Markdown 块源码"
    };
  },

  addAttributes() {
    return {
      kind: {
        default: "block",
        parseHTML: (element) => element.getAttribute("data-kind") ?? "block",
        renderHTML: (attributes) => ({
          "data-kind": attributes.kind
        })
      },
      markdown: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-markdown") ?? "",
        renderHTML: (attributes) => ({
          "data-markdown": attributes.markdown
        })
      },
      html: {
        default: "",
        parseHTML: (element) => element.innerHTML,
        renderHTML: () => ({})
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-type='markdown-preview-block']"
      }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "markdown-preview-block",
        "data-kind": node.attrs.kind,
        "data-markdown": node.attrs.markdown,
        class: `markdown-preview-block markdown-preview-block-${node.attrs.kind}`
      })
    ];
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let currentNode = node;
      const wrapper = document.createElement("div");
      wrapper.className = `markdown-preview-block markdown-preview-block-${node.attrs.kind}`;
      wrapper.dataset.type = "markdown-preview-block";
      wrapper.dataset.kind = node.attrs.kind;
      wrapper.dataset.markdown = node.attrs.markdown;
      wrapper.contentEditable = "false";
      wrapper.tabIndex = 0;
      const preview = document.createElement("div");
      preview.className = "markdown-preview-block-render";
      const input = document.createElement("textarea");
      input.className = "markdown-preview-block-source markdown-source-control";
      input.value = node.attrs.markdown;
      input.rows = textareaRows(node.attrs.markdown);
      input.spellcheck = false;
      input.setAttribute("aria-label", this.options.sourceLabel);
      wrapper.append(preview, input);
      renderPreviewBlock(preview, node.attrs.kind, node.attrs.html, node.attrs.markdown);

      const setEditing = (editing: boolean, focusInput = false) => {
        wrapper.classList.toggle("is-editing", editing);
        if (!focusInput) {
          return;
        }
        window.requestAnimationFrame(() => {
          input.focus({ preventScroll: true });
          input.setSelectionRange(input.value.length, input.value.length);
        });
      };

      const updateMarkdown = () => {
        wrapper.dataset.markdown = input.value;
        input.rows = textareaRows(input.value);
        const pos = getPos();
        if (typeof pos === "number") {
          const transaction = view.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, markdown: input.value, html: "" });
          transaction.setMeta("noliaUserEdit", true);
          view.dispatch(transaction);
        }
      };

      const getNodePos = () => {
        const pos = getPos();
        return typeof pos === "number" ? pos : undefined;
      };

      if (node.attrs.kind === "toc") {
        wireTocBlockNavigation(wrapper, view, getNodePos);
      } else {
        wireMarkdownNodeInteraction({
          wrapper,
          input,
          view,
          getPos: getNodePos,
          setEditing
        });
      }
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          setEditing(false);
          view.focus();
        }
      });
      input.addEventListener("input", (event) => {
        event.stopPropagation();
        updateMarkdown();
      });

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "markdownPreviewBlock") {
            return false;
          }
          if (currentNode.attrs.kind !== updatedNode.attrs.kind) {
            return false;
          }
          currentNode = updatedNode;
          const wasToc = wrapper.dataset.kind === "toc";
          const isEditing = !wasToc && wrapper.classList.contains("is-editing");
          wrapper.className = `markdown-preview-block markdown-preview-block-${updatedNode.attrs.kind}`;
          if (isEditing) {
            wrapper.classList.add("is-editing");
          }
          wrapper.dataset.kind = updatedNode.attrs.kind;
          wrapper.dataset.markdown = updatedNode.attrs.markdown;
          if (input.value !== updatedNode.attrs.markdown) {
            input.value = updatedNode.attrs.markdown;
            input.rows = textareaRows(updatedNode.attrs.markdown);
          }
          renderPreviewBlock(preview, updatedNode.attrs.kind, updatedNode.attrs.html, updatedNode.attrs.markdown);
          return true;
        },
        stopEvent: (event) => event.target instanceof globalThis.Node && wrapper.contains(event.target),
        ignoreMutation: (mutation) => mutation.type === "selection" || input.contains(mutation.target) || preview.contains(mutation.target)
      };
    };
  }
});

function wireTocBlockNavigation(wrapper: HTMLElement, view: EditorView, getPos: () => number | undefined) {
  const selectBlock = () => {
    const pos = getPos();
    if (typeof pos !== "number") {
      return;
    }
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  };
  const handlePointer = (event: MouseEvent) => {
    if (event.target instanceof Element) {
      const anchor = event.target.closest<HTMLAnchorElement>("a[href^='#']");
      if (anchor && wrapper.contains(anchor)) {
        event.preventDefault();
        event.stopPropagation();
        jumpToHeadingReference(view, anchor.getAttribute("href") ?? "");
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    selectBlock();
    view.focus();
  };
  wrapper.addEventListener("mousedown", handlePointer);
  wrapper.addEventListener("click", handlePointer);
  wrapper.addEventListener("dblclick", handlePointer);
  wrapper.addEventListener("focus", () => selectBlock());
  wrapper.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const firstAnchor = wrapper.querySelector<HTMLAnchorElement>("a[href^='#']");
    if (firstAnchor) {
      jumpToHeadingReference(view, firstAnchor.getAttribute("href") ?? "");
    }
  });
}

function jumpToHeadingReference(view: EditorView, href: string): boolean {
  const normalizedReference = normalizeHeadingReference(href.replace(/^#/, ""));
  if (!normalizedReference) {
    return false;
  }
  let targetPosition: number | undefined;
  view.state.doc.descendants((node, position) => {
    if (node.type.name !== "heading") {
      return;
    }
    const text = node.textContent.trim();
    const level = typeof node.attrs.level === "number" ? node.attrs.level : 1;
    const keys = [
      slugifyHeading(text),
      slugifyHeadingWithLevel(text, level),
      text
    ].map(normalizeHeadingReference);
    if (keys.includes(normalizedReference)) {
      targetPosition = position;
      return false;
    }
  });
  if (targetPosition === undefined) {
    return false;
  }
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, targetPosition + 1)).scrollIntoView());
  view.focus();
  return true;
}

function normalizeHeadingReference(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  return decoded
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "-");
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function slugifyHeadingWithLevel(text: string, level: number): string {
  return `${slugifyHeading(text)}-${level}`;
}

function renderPreviewBlock(target: HTMLElement, kind: string, html: string, markdown: string) {
  target.innerHTML = html || fallbackPreviewHtml(kind, markdown);
  if (kind === "mermaid") {
    window.requestAnimationFrame(() => {
      void renderMermaidPreview(target);
    });
  }
}

function fallbackPreviewHtml(kind: string, markdown: string): string {
  if (kind === "mermaid") {
    return `<div class="mermaid" data-markdown="${escapeHtmlAttribute(markdown)}">${escapeHtml(mermaidSourceFromMarkdown(markdown))}</div>`;
  }
  if (kind === "definition-list") {
    const [term = "", definition = ""] = markdown.split(/\r?\n:\s?/);
    return `<dl><dt>${escapeHtml(term.trim())}</dt><dd>${escapeHtml(definition.trim())}</dd></dl>`;
  }
  if (kind === "html") {
    return markdown;
  }
  if (kind === "footnotes") {
    return `<section class="footnotes"><p>${escapeHtml(markdown)}</p></section>`;
  }
  if (kind === "callout") {
    return `<blockquote>${escapeHtml(markdown)}</blockquote>`;
  }
  return `<pre><code>${escapeHtml(markdown)}</code></pre>`;
}

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

function mermaidSourceFromMarkdown(markdown: string): string {
  const info = markdown.match(/^```([^\s`]+)[^\n]*\n?/);
  const body = fencedCodeBody(markdown);
  const directive = info ? mermaidFenceDirectives.get(info[1].toLowerCase()) : undefined;
  if (!directive) {
    return body;
  }
  if (new RegExp(`^${escapeRegExp(directive)}\\b`).test(body.trimStart())) {
    return body;
  }
  return `${directive}\n${body}`;
}

function fencedCodeBody(markdown: string): string {
  return markdown
    .replace(/^```[^\n]*\n?/, "")
    .replace(/\n?```$/, "")
    .trimEnd();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textareaRows(markdown: string): number {
  return Math.min(18, Math.max(4, markdown.split(/\r?\n/).length + 1));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

async function renderMermaidPreview(target: HTMLElement) {
  const diagram = target.querySelector<HTMLElement>(".mermaid");
  const source = diagram?.textContent ?? "";
  if (!diagram || !source.trim()) {
    return;
  }
  const token = `${Date.now()}-${Math.random()}`;
  diagram.dataset.renderToken = token;
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: document.documentElement.dataset.theme === "dark" || document.documentElement.dataset.theme === "technical" ? "dark" : "default"
    });
    const { svg } = await mermaid.render(`nolia-edit-mermaid-${Date.now()}`, source);
    if (diagram.dataset.renderToken !== token) {
      return;
    }
    diagram.innerHTML = svg;
    diagram.dataset.rendered = "true";
  } catch (error) {
    if (diagram.dataset.renderToken !== token) {
      return;
    }
    diagram.classList.add("is-error");
    diagram.textContent = error instanceof Error ? error.message : "Mermaid render failed";
  }
}
