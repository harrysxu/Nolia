import { Node, mergeAttributes } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { wireMarkdownNodeInteraction } from "./markdownNodeInteraction";
import type { MarkdownOpenTarget } from "./markdownOpenTarget";

type MarkdownInlineOptions = {
  editHint: string;
  wikilinkSourceLabel: string;
  footnoteRefSourceLabel: string;
  inlineSourceLabel: string;
  onOpenMarkdownTarget?: (target: MarkdownOpenTarget) => void;
};

export const MarkdownInline = Node.create<MarkdownInlineOptions>({
  name: "markdownInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      editHint: "选中后可编辑源码",
      wikilinkSourceLabel: "双链源码",
      footnoteRefSourceLabel: "脚注引用源码",
      inlineSourceLabel: "Markdown 行内源码",
      onOpenMarkdownTarget: undefined
    };
  },

  addAttributes() {
    return {
      kind: {
        default: "inline",
        parseHTML: (element) => element.getAttribute("data-kind") ?? "inline",
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
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({
          "data-label": attributes.label
        })
      },
      href: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-href") ?? "",
        renderHTML: (attributes) => ({
          "data-href": attributes.href
        })
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-type='markdown-inline']"
      },
      {
        tag: "sup[data-type='markdown-inline']"
      }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "markdown-inline",
        "data-kind": node.attrs.kind,
        "data-markdown": node.attrs.markdown,
        "data-label": node.attrs.label,
        "data-href": node.attrs.href,
        class: `markdown-inline markdown-inline-${node.attrs.kind}`
      }),
      node.attrs.label || node.attrs.markdown
    ];
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let currentNode = node;
      const wrapper = document.createElement("span");
      wrapper.className = `markdown-inline markdown-inline-${node.attrs.kind}`;
      wrapper.dataset.type = "markdown-inline";
      wrapper.dataset.kind = node.attrs.kind;
      wrapper.dataset.markdown = node.attrs.markdown;
      wrapper.dataset.label = node.attrs.label;
      wrapper.dataset.href = node.attrs.href;
      wrapper.textContent = node.attrs.label || node.attrs.markdown;
      wrapper.contentEditable = "false";
      wrapper.tabIndex = 0;

      const label = document.createElement("span");
      label.className = "markdown-inline-label";
      const editorPanel = document.createElement("span");
      editorPanel.className = "markdown-inline-editor";
      const sourceInput = document.createElement("textarea");
      sourceInput.className = "markdown-inline-input markdown-source-control";
      sourceInput.rows = 1;
      sourceInput.wrap = "soft";
      sourceInput.spellcheck = false;
      sourceInput.setAttribute("aria-label", inlineEditorLabel(node.attrs.kind, this.options));
      const hint = document.createElement("span");
      hint.className = "inline-edit-hint";
      hint.textContent = this.options.editHint;
      editorPanel.append(sourceInput);
      wrapper.replaceChildren(label, editorPanel, hint);

      const syncDom = () => {
        const displayLabel = currentNode.attrs.label || currentNode.attrs.markdown;
        wrapper.className = `markdown-inline markdown-inline-${currentNode.attrs.kind}`;
        wrapper.dataset.kind = currentNode.attrs.kind;
        wrapper.dataset.markdown = currentNode.attrs.markdown;
        wrapper.dataset.label = currentNode.attrs.label;
        wrapper.dataset.href = currentNode.attrs.href;
        label.textContent = displayLabel;
        if (sourceInput.value !== currentNode.attrs.markdown) {
          sourceInput.value = currentNode.attrs.markdown;
        }
        sourceInput.style.width = inlineMarkdownSourceWidth(String(currentNode.attrs.markdown ?? ""));
        sourceInput.setAttribute("aria-label", inlineEditorLabel(currentNode.attrs.kind, this.options));
        resizeInlineMarkdownSource(sourceInput);
      };

      const setEditing = (editing: boolean, focusInput = false) => {
        wrapper.classList.toggle("is-editing", editing);
        if (!focusInput) {
          return;
        }
        window.requestAnimationFrame(() => {
          resizeInlineMarkdownSource(sourceInput);
          sourceInput.focus({ preventScroll: true });
          sourceInput.setSelectionRange(sourceInput.value.length, sourceInput.value.length);
        });
      };

      const updateMarkdown = () => {
        const markdown = sourceInput.value;
        const previousFootnoteLabel =
          currentNode.attrs.kind === "footnote-ref"
            ? footnoteLabelFromMarkdown(String(currentNode.attrs.markdown ?? "")) || String(currentNode.attrs.label ?? "")
            : "";
        const attrs = inlineAttrsFromMarkdown(currentNode.attrs.kind, markdown, {
          kind: String(currentNode.attrs.kind ?? "inline"),
          markdown: String(currentNode.attrs.markdown ?? ""),
          label: String(currentNode.attrs.label ?? ""),
          href: String(currentNode.attrs.href ?? "")
        });
        const pos = getPos();
        if (typeof pos === "number") {
          let transaction = view.state.tr.setNodeMarkup(pos, undefined, attrs);
          if (currentNode.attrs.kind === "footnote-ref") {
            const nextFootnoteLabel = footnoteLabelFromMarkdown(attrs.markdown) || attrs.label;
            transaction = syncFootnoteDefinitions(transaction, previousFootnoteLabel, nextFootnoteLabel);
          }
          transaction.setMeta("noliaUserEdit", true);
          view.dispatch(transaction);
        }
      };

      wireMarkdownNodeInteraction({
        wrapper,
        input: sourceInput,
        view,
        getPos: () => {
          const pos = getPos();
          return typeof pos === "number" ? pos : undefined;
        },
        setEditing,
        onOpenModifiedClick: () => {
          if (currentNode.attrs.kind !== "wikilink") {
            return;
          }
          this.options.onOpenMarkdownTarget?.({
            kind: "wikilink",
            markdown: String(currentNode.attrs.markdown ?? ""),
            label: String(currentNode.attrs.label ?? ""),
            href: String(currentNode.attrs.href ?? "")
          });
        }
      });
      sourceInput.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          setEditing(false);
          view.focus();
        }
      });
      sourceInput.addEventListener("input", (event) => {
        event.stopPropagation();
        sourceInput.style.width = inlineMarkdownSourceWidth(sourceInput.value);
        resizeInlineMarkdownSource(sourceInput);
        updateMarkdown();
      });
      syncDom();

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "markdownInline") {
            return false;
          }
          const isEditing = wrapper.classList.contains("is-editing");
          currentNode = updatedNode;
          syncDom();
          wrapper.classList.toggle("is-editing", isEditing);
          return true;
        },
        stopEvent: (event) => event.target instanceof globalThis.Node && wrapper.contains(event.target),
        ignoreMutation: (mutation) => mutation.type === "selection" || sourceInput.contains(mutation.target)
      };
    };
  }
});

type MarkdownInlineAttrs = {
  kind: string;
  markdown: string;
  label: string;
  href: string;
};

function inlineEditorLabel(kind: string, labels: MarkdownInlineOptions): string {
  if (kind === "wikilink") {
    return labels.wikilinkSourceLabel;
  }
  if (kind === "footnote-ref") {
    return labels.footnoteRefSourceLabel;
  }
  return labels.inlineSourceLabel;
}

function resizeInlineMarkdownSource(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.ceil(textarea.scrollHeight)}px`;
  textarea.style.overflowY = "hidden";
}

function inlineMarkdownSourceWidth(markdown: string): string {
  return `${Math.min(Math.max(markdown.length + 2, 12), 72)}ch`;
}

function inlineAttrsFromMarkdown(kind: string, markdown: string, fallback: MarkdownInlineAttrs): MarkdownInlineAttrs {
  if (kind === "wikilink") {
    const parsed = markdown.match(/^\s*\[\[([^\]\n]+)\]\]\s*$/);
    if (!parsed) {
      return { ...fallback, markdown, label: markdown || fallback.label, href: "" };
    }
    const [targetWithHeading, alias] = parsed[1].split("|").map((part) => part.trim());
    const [targetText, heading] = targetWithHeading.split("#").map((part) => part.trim());
    const label = alias || targetText || parsed[1].trim();
    return {
      kind,
      markdown,
      label,
      href: `#wiki-${slugify(targetText || label)}${heading ? `-${slugify(heading)}` : ""}`
    };
  }
  if (kind === "footnote-ref") {
    const label = footnoteLabelFromMarkdown(markdown) || markdown.replace(/^\[\^?|\]$/g, "").trim() || fallback.label;
    return {
      kind,
      markdown,
      label,
      href: label ? `#user-content-fn-${label}` : fallback.href
    };
  }
  return {
    ...fallback,
    markdown,
    label: markdown || fallback.label
  };
}

function footnoteLabelFromMarkdown(markdown: string): string | undefined {
  return markdown.match(/^\s*\[\^([^\]\n]+)\]\s*$/)?.[1]?.trim() || undefined;
}

function syncFootnoteDefinitions(transaction: Transaction, previousLabel: string, nextLabel: string): Transaction {
  if (!previousLabel || !nextLabel || previousLabel === nextLabel) {
    return transaction;
  }
  transaction.doc.descendants((node, position) => {
    if (node.type.name !== "markdownPreviewBlock" || node.attrs.kind !== "footnotes") {
      return;
    }
    const markdown = String(node.attrs.markdown ?? "");
    const renamed = renameFootnoteDefinitionLabels(markdown, previousLabel, nextLabel);
    if (renamed === markdown) {
      return;
    }
    transaction = transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      markdown: renamed,
      html: ""
    });
  });
  return transaction;
}

function renameFootnoteDefinitionLabels(markdown: string, previousLabel: string, nextLabel: string): string {
  const matcher = new RegExp(`(^|\\n)([ \\t]*)\\[\\^${escapeRegExp(previousLabel)}\\]:`, "g");
  return markdown.replace(matcher, (_match, prefix: string, indent: string) => `${prefix}${indent}[^${nextLabel}]:`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
