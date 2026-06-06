import { Node, mergeAttributes } from "@tiptap/core";
import katex from "katex";
import { wireMarkdownNodeInteraction } from "./markdownNodeInteraction";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathBlock: {
      insertMathBlock: (latex?: string) => ReturnType;
    };
  }
}

type MathBlockOptions = {
  sourceLabel: string;
};

export const MathBlock = Node.create<MathBlockOptions>({
  name: "mathBlock",
  group: "block",
  atom: true,
  defining: true,

  addOptions() {
    return {
      sourceLabel: "块公式 Markdown 源码"
    };
  },

  addAttributes() {
    return {
      markdown: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown") ?? mathBlockMarkdown(element.getAttribute("data-latex") ?? element.textContent ?? ""),
        renderHTML: (attributes) => ({
          "data-markdown": attributes.markdown
        })
      },
      latex: {
        default: "E = mc^2",
        parseHTML: (element) => element.getAttribute("data-latex") ?? element.textContent ?? "",
        renderHTML: (attributes) => ({
          "data-latex": attributes.latex
        })
      }
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-type='math-block']"
      }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "math-block",
        "data-markdown": node.attrs.markdown ?? mathBlockMarkdown(node.attrs.latex),
        "data-latex": node.attrs.latex,
        class: "math-block"
      }),
      node.attrs.markdown ?? mathBlockMarkdown(node.attrs.latex)
    ];
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let currentNode = node;
      const wrapper = document.createElement("div");
      wrapper.className = "math-block";
      wrapper.dataset.type = "math-block";
      wrapper.dataset.markdown = node.attrs.markdown ?? mathBlockMarkdown(node.attrs.latex);
      wrapper.dataset.latex = node.attrs.latex;
      wrapper.contentEditable = "false";
      wrapper.tabIndex = 0;
      const preview = document.createElement("div");
      preview.className = "math-block-preview";
      const input = document.createElement("textarea");
      input.className = "math-block-input markdown-source-control";
      input.value = node.attrs.markdown ?? mathBlockMarkdown(node.attrs.latex);
      input.rows = rowsForSource(input.value);
      input.spellcheck = false;
      input.setAttribute("aria-label", this.options.sourceLabel);
      wrapper.append(preview, input);
      renderFormula(preview, node.attrs.latex);

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

      wireMarkdownNodeInteraction({
        wrapper,
        input,
        view,
        getPos: () => {
          const pos = getPos();
          return typeof pos === "number" ? pos : undefined;
        },
        setEditing,
        hasBlockingError: () => wrapper.classList.contains("has-source-error"),
        clearTransientError: () => wrapper.classList.remove("has-source-error")
      });
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          wrapper.classList.remove("has-source-error");
          setEditing(false);
          view.focus();
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !wrapper.classList.contains("has-source-error")) {
          event.preventDefault();
          setEditing(false);
          view.focus();
        }
      });
      input.addEventListener("input", (event) => {
        event.stopPropagation();
        const markdown = input.value;
        const latex = latexFromMathBlockMarkdown(markdown);
        input.rows = rowsForSource(markdown);
        wrapper.dataset.markdown = markdown;
        if (!latex) {
          wrapper.classList.add("has-source-error");
        } else {
          wrapper.classList.remove("has-source-error");
          wrapper.dataset.latex = latex;
          renderFormula(preview, latex);
        }
        const pos = getPos();
        if (typeof pos === "number") {
          const transaction = view.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            markdown,
            latex: latex ?? currentNode.attrs.latex
          });
          transaction.setMeta("noliaUserEdit", true);
          view.dispatch(transaction);
        }
      });

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "mathBlock") {
            return false;
          }
          const isEditing = wrapper.classList.contains("is-editing");
          const hasSourceError = wrapper.classList.contains("has-source-error");
          currentNode = updatedNode;
          const markdown = updatedNode.attrs.markdown ?? mathBlockMarkdown(updatedNode.attrs.latex);
          wrapper.dataset.markdown = markdown;
          wrapper.dataset.latex = updatedNode.attrs.latex;
          if (input.value !== markdown) {
            input.value = markdown;
            input.rows = rowsForSource(markdown);
          }
          renderFormula(preview, updatedNode.attrs.latex);
          wrapper.classList.toggle("is-editing", isEditing);
          wrapper.classList.toggle("has-source-error", hasSourceError);
          return true;
        },
        stopEvent: (event) => event.target instanceof globalThis.Node && wrapper.contains(event.target),
        ignoreMutation: (mutation) => mutation.type === "selection" || input.contains(mutation.target)
      };
    };
  },

  addCommands() {
    return {
      insertMathBlock:
        (latex = "E = mc^2") =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { latex, markdown: mathBlockMarkdown(latex) }
          })
    };
  }
});

function mathBlockMarkdown(latex: string): string {
  return `$$\n${latex}\n$$`;
}

function latexFromMathBlockMarkdown(markdown: string): string | undefined {
  const match = markdown.trim().match(/^\$\$\s*\n?([\s\S]*?)\n?\s*\$\$$/);
  const latex = match?.[1]?.trim();
  return latex ? latex : undefined;
}

function rowsForSource(markdown: string): number {
  return Math.min(10, Math.max(3, markdown.split(/\r?\n/).length));
}

function renderFormula(target: HTMLElement, latex: string) {
  target.innerHTML = "";
  try {
    katex.render(latex || "\\,", target, {
      displayMode: true,
      throwOnError: false
    });
  } catch {
    target.textContent = latex;
  }
}
