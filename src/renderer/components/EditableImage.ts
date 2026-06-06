import Image, { type ImageOptions } from "@tiptap/extension-image";
import { wireMarkdownNodeInteraction } from "./markdownNodeInteraction";
import type { MarkdownOpenTarget } from "./markdownOpenTarget";

type EditableImageOptions = ImageOptions & {
  workspaceId?: string;
  documentPathRel?: string;
  markdownSourceLabel: string;
  editHint: string;
  onOpenMarkdownTarget?: (target: MarkdownOpenTarget) => void;
};

export const EditableImage = Image.extend<EditableImageOptions>({
  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
      resize: false,
      ...this.parent?.(),
      workspaceId: undefined,
      documentPathRel: undefined,
      markdownSourceLabel: "图片 Markdown 源码",
      editHint: "选中后可编辑 Markdown 源码",
      onOpenMarkdownTarget: undefined
    };
  },

  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      markdown: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown") ?? imageMarkdownFromElement(element),
        renderHTML: (attributes) => ({
          "data-markdown": attributes.markdown
        })
      },
      markdownSrc: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown-src") ?? element.getAttribute("src"),
        renderHTML: (attributes) => ({
          "data-markdown-src": attributes.markdownSrc
        })
      }
    };
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let currentNode = node;
      const wrapper = document.createElement("figure");
      wrapper.className = "editable-image-node";
      wrapper.dataset.type = "editable-image";
      wrapper.contentEditable = "false";
      wrapper.tabIndex = 0;

      const image = document.createElement("img");
      image.draggable = false;
      const sourceInput = document.createElement("textarea");
      sourceInput.className = "editable-image-source markdown-source-control";
      sourceInput.rows = 2;
      sourceInput.spellcheck = false;
      sourceInput.setAttribute("aria-label", this.options.markdownSourceLabel);
      const hint = document.createElement("span");
      hint.className = "block-edit-hint";
      hint.textContent = this.options.editHint;
      wrapper.append(image, sourceInput, hint);

      const markdownSrc = () => String(currentNode.attrs.markdownSrc ?? currentNode.attrs.src ?? "");
      const markdownSource = () => String(currentNode.attrs.markdown ?? imageMarkdownFromAttrs(currentNode.attrs));
      const setEditing = (editing: boolean, focusInput = false) => {
        wrapper.classList.toggle("is-editing", editing);
        if (!focusInput) {
          return;
        }
        window.requestAnimationFrame(() => {
          sourceInput.focus({ preventScroll: true });
          sourceInput.setSelectionRange(sourceInput.value.length, sourceInput.value.length);
        });
      };

      const syncDom = () => {
        const src = String(currentNode.attrs.src || "");
        const alt = String(currentNode.attrs.alt || "");
        const title = String(currentNode.attrs.title || "");
        const source = markdownSrc();
        image.src = src;
        image.alt = alt;
        if (title) {
          image.title = title;
        } else {
          image.removeAttribute("title");
        }
        wrapper.dataset.markdownSrc = source;
        wrapper.dataset.alt = alt;
        wrapper.dataset.title = title;
        wrapper.dataset.markdown = markdownSource();
        if (sourceInput.value !== markdownSource()) {
          sourceInput.value = markdownSource();
        }
      };

      const updateImage = () => {
        const nextMarkdown = sourceInput.value;
        const parsed = parseImageMarkdown(nextMarkdown);
        if (!parsed) {
          wrapper.classList.add("has-source-error");
          const pos = getPos();
          if (typeof pos === "number") {
            const transaction = view.state.tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              markdown: nextMarkdown
            });
            transaction.setMeta("noliaUserEdit", true);
            view.dispatch(transaction);
          }
          return;
        }
        wrapper.classList.remove("has-source-error");
        const nextMarkdownSrc = parsed.src;
        const nextSrc = imageDisplaySrc(nextMarkdownSrc, this.options.workspaceId, this.options.documentPathRel) || nextMarkdownSrc;
        const nextAttrs = {
          ...currentNode.attrs,
          src: nextSrc,
          alt: parsed.alt,
          title: parsed.title,
          markdown: nextMarkdown,
          markdownSrc: nextMarkdownSrc
        };
        const pos = getPos();
        if (typeof pos === "number") {
          const transaction = view.state.tr.setNodeMarkup(pos, undefined, nextAttrs);
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
        onOpenModifiedClick: () =>
          this.options.onOpenMarkdownTarget?.({
            kind: "image",
            src: markdownSrc(),
            markdown: markdownSource()
          }),
        hasBlockingError: () => wrapper.classList.contains("has-source-error"),
        clearTransientError: () => wrapper.classList.remove("has-source-error")
      });
      sourceInput.addEventListener("input", (event) => {
        event.stopPropagation();
        updateImage();
      });
      sourceInput.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          wrapper.classList.remove("has-source-error");
          setEditing(false);
          view.focus();
        }
        if ((event.key === "Enter" && (event.metaKey || event.ctrlKey)) || (event.key === "Enter" && !event.shiftKey && !event.altKey)) {
          event.preventDefault();
          if (!wrapper.classList.contains("has-source-error")) {
            setEditing(false);
            view.focus();
          }
        }
      });
      syncDom();

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "image") {
            return false;
          }
          const isEditing = wrapper.classList.contains("is-editing");
          const hasSourceError = wrapper.classList.contains("has-source-error");
          currentNode = updatedNode;
          syncDom();
          wrapper.classList.toggle("is-editing", isEditing);
          wrapper.classList.toggle("has-source-error", hasSourceError);
          return true;
        },
        stopEvent: (event) => event.target instanceof globalThis.Node && wrapper.contains(event.target),
        ignoreMutation: (mutation) => mutation.type === "selection" || wrapper.contains(mutation.target)
      };
    };
  }
});

type ImageMarkdownParts = {
  alt: string;
  src: string;
  title: string;
};

function imageMarkdownFromElement(element: HTMLElement): string {
  return imageMarkdownFromAttrs({
    alt: element.getAttribute("alt") ?? "",
    markdownSrc: element.getAttribute("data-markdown-src") ?? element.getAttribute("src") ?? "",
    src: element.getAttribute("src") ?? "",
    title: element.getAttribute("title") ?? ""
  });
}

function imageMarkdownFromAttrs(attrs: Record<string, unknown>): string {
  const alt = escapeImageAlt(String(attrs.alt ?? ""));
  const src = String(attrs.markdownSrc || attrs.src || "").trim();
  const title = String(attrs.title ?? "");
  if (!title) {
    return `![${alt}](${src})`;
  }
  return `![${alt}](${src} "${escapeImageTitle(title)}")`;
}

function parseImageMarkdown(markdown: string): ImageMarkdownParts | undefined {
  const match = markdown.trim().match(/^!\[([^\]\n]*)]\(([\s\S]*)\)$/);
  if (!match) {
    return undefined;
  }
  const alt = unescapeImageAlt(match[1] ?? "");
  let body = (match[2] ?? "").trim();
  if (!body) {
    return undefined;
  }
  let title = "";
  const titleMatch = body.match(/\s+("((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|\(([^()]*)\))\s*$/);
  if (titleMatch && typeof titleMatch.index === "number") {
    title = unescapeImageTitle(titleMatch[2] ?? titleMatch[3] ?? titleMatch[4] ?? "");
    body = body.slice(0, titleMatch.index).trim();
  }
  if (body.startsWith("<") && body.endsWith(">")) {
    body = body.slice(1, -1).trim();
  }
  return body ? { alt, src: body, title } : undefined;
}

function escapeImageAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

function unescapeImageAlt(value: string): string {
  return value.replace(/\\]/g, "]").replace(/\\\\/g, "\\");
}

function escapeImageTitle(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescapeImageTitle(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function imageDisplaySrc(markdownSrc: string, workspaceId?: string, documentPathRel?: string): string {
  const trimmed = markdownSrc.trim();
  if (!trimmed || !workspaceId || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/^([^?#]*)([?#][\s\S]*)?$/);
  const pathPart = match?.[1] ?? trimmed;
  const suffix = match?.[2] ?? "";
  const baseDir = dirnameRel(documentPathRel ?? "");
  const joinedPath = pathPart.startsWith("/") ? pathPart.slice(1) : [baseDir, pathPart].filter(Boolean).join("/");
  const normalizedPath = normalizeWorkspaceAssetPath(joinedPath);
  return normalizedPath ? assetUrl(workspaceId, `${decodeWorkspaceAssetPath(normalizedPath)}${suffix}`) : trimmed;
}

function dirnameRel(pathRel: string): string {
  const normalized = normalizeWorkspaceAssetPath(pathRel) ?? "";
  return normalized.includes("/") ? normalized.split("/").slice(0, -1).join("/") : "";
}

function normalizeWorkspaceAssetPath(pathRel: string): string | undefined {
  const parts: string[] = [];
  for (const part of pathRel.split(/[\\/]+/)) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (!parts.length) {
        return undefined;
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function decodeWorkspaceAssetPath(pathRel: string): string {
  try {
    return pathRel
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  } catch {
    return pathRel;
  }
}

function assetUrl(workspaceId: string, pathRel: string): string {
  return `nolia-asset://workspace/${encodeURIComponent(workspaceId)}/${pathRel.split("/").map(encodeURIComponent).join("/")}`;
}
