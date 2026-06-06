import { Node, mergeAttributes } from "@tiptap/core";
import katex from "katex";
import { wireMarkdownNodeInteraction } from "./markdownNodeInteraction";

type InlineMathOptions = {
  sourceLabel: string;
  editHint: string;
};

export const InlineMath = Node.create<InlineMathOptions>({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return {
      sourceLabel: "行内公式源码",
      editHint: "选中后可编辑源码"
    };
  },

  addAttributes() {
    return {
      markdown: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-markdown") ?? inlineMathMarkdown(element.getAttribute("data-latex") ?? element.textContent ?? ""),
        renderHTML: (attributes) => ({
          "data-markdown": attributes.markdown
        })
      },
      latex: {
        default: "",
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
        tag: "span[data-type='inline-math']"
      }
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "inline-math",
        "data-markdown": node.attrs.markdown ?? inlineMathMarkdown(node.attrs.latex),
        "data-latex": node.attrs.latex,
        class: "inline-math"
      }),
      node.attrs.markdown ?? inlineMathMarkdown(node.attrs.latex)
    ];
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let currentNode = node;
      const wrapper = document.createElement("span");
      wrapper.className = "inline-math";
      wrapper.dataset.type = "inline-math";
      wrapper.dataset.markdown = node.attrs.markdown ?? inlineMathMarkdown(node.attrs.latex);
      wrapper.dataset.latex = node.attrs.latex;
      wrapper.contentEditable = "false";
      wrapper.tabIndex = 0;

      const preview = document.createElement("span");
      preview.className = "inline-math-preview";
      const input = document.createElement("input");
      input.className = "inline-math-input markdown-source-control";
      input.value = node.attrs.markdown ?? inlineMathMarkdown(node.attrs.latex);
      input.spellcheck = false;
      input.setAttribute("aria-label", this.options.sourceLabel);
      const hint = document.createElement("span");
      hint.className = "inline-edit-hint";
      hint.textContent = this.options.editHint;
      wrapper.append(preview, input, hint);
      renderInlineFormula(preview, node.attrs.latex);

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

      const updateLatex = () => {
        const markdown = input.value;
        const latex = latexFromInlineMathMarkdown(markdown);
        wrapper.dataset.markdown = markdown;
        if (!latex) {
          wrapper.classList.add("has-source-error");
        } else {
          wrapper.classList.remove("has-source-error");
          wrapper.dataset.latex = latex;
          renderInlineFormula(preview, latex);
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
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          if (event.key === "Escape") {
            wrapper.classList.remove("has-source-error");
            setEditing(false);
            view.focus();
            return;
          }
          if (!wrapper.classList.contains("has-source-error")) {
            setEditing(false);
            view.focus();
          }
        }
      });
      input.addEventListener("input", (event) => {
        event.stopPropagation();
        updateLatex();
      });

      return {
        dom: wrapper,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "inlineMath") {
            return false;
          }
          const isEditing = wrapper.classList.contains("is-editing");
          const hasSourceError = wrapper.classList.contains("has-source-error");
          currentNode = updatedNode;
          const markdown = updatedNode.attrs.markdown ?? inlineMathMarkdown(updatedNode.attrs.latex);
          wrapper.dataset.markdown = markdown;
          wrapper.dataset.latex = updatedNode.attrs.latex;
          if (input.value !== markdown) {
            input.value = markdown;
          }
          renderInlineFormula(preview, updatedNode.attrs.latex);
          wrapper.classList.toggle("is-editing", isEditing);
          wrapper.classList.toggle("has-source-error", hasSourceError);
          return true;
        },
        stopEvent: (event) => event.target instanceof globalThis.Node && wrapper.contains(event.target),
        ignoreMutation: (mutation) => mutation.type === "selection" || input.contains(mutation.target) || preview.contains(mutation.target)
      };
    };
  }
});

function inlineMathMarkdown(latex: string): string {
  return `$${latex}$`;
}

function latexFromInlineMathMarkdown(markdown: string): string | undefined {
  const match = markdown.trim().match(/^\$([\s\S]*?)\$$/);
  const latex = match?.[1]?.trim();
  return latex ? latex : undefined;
}

function renderInlineFormula(target: HTMLElement, latex: string) {
  target.innerHTML = "";
  try {
    katex.render(latex || "\\,", target, {
      displayMode: false,
      throwOnError: false
    });
  } catch {
    target.textContent = latex;
  }
}
