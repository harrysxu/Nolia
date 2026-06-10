import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Extension, mergeAttributes, type Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import TiptapCode from "@tiptap/extension-code";
import { DOMParser as ProseMirrorDOMParser, DOMSerializer, Fragment, type Mark, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { redoDepth, undoDepth } from "@tiptap/pm/history";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { common, createLowlight } from "lowlight";
import {
  Bold,
  Code as CodeIcon,
  FileCode2,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  SquareCheckBig,
  Sigma,
  Strikethrough,
  Table2,
  TableOfContents,
  Trash2,
  Undo2
} from "lucide-react";

import { codeFenceLanguageForCodeBlock, normalizeCodeBlockLanguage } from "../../shared/codeBlockLanguages";
import { createMarkdownTocBlock, hasMarkdownToc, htmlToMarkdown, htmlToMarkdownSync, renderMarkdownToHtml } from "../../shared/markdown";
import { useRendererI18n } from "../app/i18n";
import { MathBlock } from "./MathBlock";
import { InlineMath } from "./InlineMath";
import { Highlight } from "./Highlight";
import { MarkdownInline } from "./MarkdownInline";
import { MarkdownPreviewBlock } from "./MarkdownPreviewBlock";
import { EditableImage } from "./EditableImage";
import { getCodeBlockLanguageSelectOptions } from "./codeBlockLanguageSelect";
import { isModifiedOpenClick } from "./markdownNodeInteraction";
import type { MarkdownOpenTarget } from "./markdownOpenTarget";

type FloatingMenuState = {
  x: number;
  y: number;
};

type CodeLanguageControlState = FloatingMenuState & {
  from: number;
  language: string;
};

type LinkRange = {
  from: number;
  to: number;
};

type InlineMarkdownSourceDisplay = "inline" | "block" | "list";

type InlineMarkdownSourcePlacement = {
  id: string;
  ariaLabel: string;
  display: InlineMarkdownSourceDisplay;
  decorateType: "inline" | "node";
  decorateFrom: number;
  decorateTo: number;
  widgetAt: number;
};

type LinkSourceEditorState = InlineMarkdownSourcePlacement & {
  markdown: string;
  range: LinkRange;
};

type InlineSyntaxKind = "bold" | "italic" | "strike" | "code" | "highlight";

type InlineSyntaxSourceEditorState = InlineMarkdownSourcePlacement & {
  kind: InlineSyntaxKind;
  markdown: string;
  range: LinkRange;
};

type BlockSyntaxKind = "heading" | "blockquote" | "list";

type BlockSyntaxSourceEditorState = InlineMarkdownSourcePlacement & {
  kind: BlockSyntaxKind;
  markdown: string;
  range: { from: number; to: number };
  listItemIndex?: number;
};

type MarkdownSyntaxSourceEditorState = InlineSyntaxSourceEditorState | BlockSyntaxSourceEditorState;

type MarkdownSourceEditorState =
  | ({ sourceType: "link" } & LinkSourceEditorState)
  | ({ sourceType: "syntax" } & MarkdownSyntaxSourceEditorState);

interface WysiwygEditorProps {
  html: string;
  sourceText?: string;
  workspaceId?: string;
  documentPathRel?: string;
  onChange: (value: string) => void;
  onMarkdownPaste?: (markdown: string) => void;
  onSelectionLengthChange?: (count: number) => void;
  onOpenMarkdownTarget?: (target: MarkdownOpenTarget) => void;
  onInsertToc?: (currentHtml: string) => void;
  readOnly?: boolean;
  showToolbar?: boolean;
  toolbarExtra?: ReactNode;
  onAiContextMenu?: (x: number, y: number) => void;
}

export interface WysiwygEditorHandle {
  undoEdit: () => boolean;
  redoEdit: () => boolean;
  scrollToHeading: (headingIndex: number) => boolean;
  captureAiSelection: () => string | undefined;
  applyAiText: (text: string, mode: "insert" | "replace" | "append") => boolean;
}

type TableDialogState = {
  rows: number;
  columns: number;
  x: number;
  y: number;
};

type TableSourceEditorState = FloatingMenuState & {
  markdown: string;
  from: number;
  to: number;
  error?: string;
  applying?: boolean;
};

type TableMenuMode = "toolbar" | "context";

const codeBlockLowlight = createLowlight(common);

codeBlockLowlight.registerAlias({
  bash: ["sh", "shell", "zsh"],
  css: ["scss", "less"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  markdown: ["md", "mdown"],
  plaintext: ["text", "txt"],
  typescript: ["ts", "tsx"],
  xml: ["html", "svg", "xhtml"],
  yaml: ["yml"]
});

const NoliaCodeBlock = CodeBlockLowlight.extend({
  renderHTML({ node, HTMLAttributes }) {
    const language = typeof node.attrs.language === "string" ? node.attrs.language.trim() : "";
    const languageClassPrefix = this.options.languageClassPrefix ?? "language-";
    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        ...(language ? { "data-language": language } : {}),
        "data-code-block": "true"
      }),
      [
        "code",
        {
          class: language ? `${languageClassPrefix}${language}` : null
        },
        0
      ]
    ];
  }
});

const NoliaInlineCode = TiptapCode.extend({
  excludes: ""
});

const NoliaTaskItem = TaskItem.extend({
  parseHTML() {
    return [
      {
        tag: `li[data-type="${this.name}"]`,
        priority: 100,
        getContent: (element, schema) => taskItemContentFromElement(element, schema)
      }
    ];
  }
});

const tableCellAlignAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) => element.getAttribute("align") || element.style.textAlign || null,
  renderHTML: (attributes: Record<string, unknown>) => {
    const align = typeof attributes.align === "string" ? attributes.align : "";
    return align ? { align, style: `text-align: ${align}` } : {};
  }
};

const NoliaTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      align: tableCellAlignAttribute
    };
  }
});

const NoliaTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      align: tableCellAlignAttribute
    };
  }
});

type ActiveTableCellRange = {
  from: number;
  to: number;
};

const activeTableCellPluginKey = new PluginKey<DecorationSet>("noliaActiveTableCell");
const markdownSourceEditorPluginKey = new PluginKey<MarkdownSourceEditorState | null>("noliaMarkdownSourceEditor");

const NoliaActiveTableCell = Extension.create({
  name: "noliaActiveTableCell",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: activeTableCellPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, decorations) {
            const meta = transaction.getMeta(activeTableCellPluginKey) as ActiveTableCellRange | null | undefined;
            if (meta === null) {
              return DecorationSet.empty;
            }
            if (meta) {
              return DecorationSet.create(transaction.doc, [Decoration.node(meta.from, meta.to, { class: "is-active-cell" }, { key: "nolia-active-table-cell" })]);
            }
            return transaction.docChanged ? decorations.map(transaction.mapping, transaction.doc) : decorations;
          }
        },
        props: {
          decorations(state) {
            return activeTableCellPluginKey.getState(state) ?? DecorationSet.empty;
          }
        }
      })
    ];
  }
});

type MarkdownSourceEditorOptions = {
  onSubmit: (state: MarkdownSourceEditorState, markdown: string) => void;
  onCancel: (state: MarkdownSourceEditorState) => void;
};

const NoliaMarkdownSourceEditor = Extension.create<MarkdownSourceEditorOptions>({
  name: "noliaMarkdownSourceEditor",

  addOptions() {
    return {
      onSubmit: () => undefined,
      onCancel: () => undefined
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<MarkdownSourceEditorState | null>({
        key: markdownSourceEditorPluginKey,
        state: {
          init: () => null,
          apply(transaction, current) {
            const meta = transaction.getMeta(markdownSourceEditorPluginKey) as MarkdownSourceEditorState | null | undefined;
            if (meta !== undefined) {
              return meta;
            }
            return transaction.docChanged ? null : current;
          }
        },
        props: {
          decorations(state) {
            const activeSource = markdownSourceEditorPluginKey.getState(state);
            if (!activeSource) {
              return DecorationSet.empty;
            }
            return DecorationSet.create(state.doc, markdownSourceDecorations(activeSource, options));
          }
        }
      })
    ];
  }
});

function markdownSourceDecorations(source: MarkdownSourceEditorState, options: MarkdownSourceEditorOptions): Decoration[] {
  const hiddenNodeClass = `is-markdown-source-hidden is-markdown-source-hidden-node is-markdown-source-${source.display}${
    source.sourceType === "syntax" ? ` is-markdown-source-${source.kind}` : " is-markdown-source-link"
  }`;
  const decorations =
    source.decorateFrom < source.decorateTo
      ? [
          source.decorateType === "node"
            ? Decoration.node(
                source.decorateFrom,
                source.decorateTo,
                { class: hiddenNodeClass },
                { key: `${source.id}:hidden-node` }
              )
            : Decoration.inline(
                source.decorateFrom,
                source.decorateTo,
                { class: "is-markdown-source-hidden is-markdown-source-hidden-inline" },
                { key: `${source.id}:hidden-inline` }
              )
        ]
      : [];
  decorations.push(
    Decoration.widget(source.widgetAt, () => createMarkdownSourceWidget(source, options), {
      key: `${source.id}:widget`,
      side: -1,
      ignoreSelection: true,
      stopEvent: (event) => event.target instanceof globalThis.Node && event.target instanceof HTMLElement && event.target.closest(".inline-markdown-source-widget") !== null
    })
  );
  return decorations;
}

function createMarkdownSourceWidget(source: MarkdownSourceEditorState, options: MarkdownSourceEditorOptions): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = `inline-markdown-source-widget is-${source.display}${source.sourceType === "syntax" ? ` is-${source.kind}` : " is-link"}`;
  wrapper.dataset.sourceId = source.id;
  wrapper.contentEditable = "false";

  const control =
    source.display === "inline"
      ? document.createElement("input")
      : document.createElement("textarea");
  control.className = `inline-markdown-source-input markdown-source-control is-${source.display}`;
  control.value = source.markdown;
  control.spellcheck = false;
  control.setAttribute("aria-label", source.ariaLabel);
  control.dataset.sourceId = source.id;
  if (control instanceof HTMLInputElement) {
    control.type = "text";
    control.style.width = markdownSourceInputWidth(source.markdown);
  } else {
    const textarea = control;
    textarea.rows = 1;
    textarea.wrap = "soft";
    requestAnimationFrame(() => resizeMarkdownSourceTextarea(textarea));
  }

  let completed = false;
  const complete = (kind: "submit" | "cancel") => {
    if (completed) {
      return;
    }
    completed = true;
    if (kind === "cancel") {
      options.onCancel(source);
      return;
    }
    options.onSubmit(source, control.value);
  };

  control.addEventListener("blur", () => complete("submit"));
  control.addEventListener("input", (event) => {
    event.stopPropagation();
    if (control instanceof HTMLInputElement) {
      control.style.width = markdownSourceInputWidth(control.value);
    } else {
      resizeMarkdownSourceTextarea(control);
    }
  });
  control.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    event.stopPropagation();
    if (keyboardEvent.key === "Escape") {
      event.preventDefault();
      complete("cancel");
      return;
    }
    if (keyboardEvent.key === "Enter" && !(control instanceof HTMLTextAreaElement && keyboardEvent.shiftKey)) {
      event.preventDefault();
      complete("submit");
    }
  });
  for (const eventName of ["mousedown", "mouseup", "click", "dblclick", "touchstart"]) {
    control.addEventListener(eventName, (event) => event.stopPropagation());
  }
  wrapper.append(control);
  return wrapper;
}

function markdownSourceInputWidth(markdown: string): string {
  return `${clampInteger(Math.max(markdown.length + 2, 12), 12, 72)}ch`;
}

function resizeMarkdownSourceTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  const computedMaxHeight = Number.parseFloat(window.getComputedStyle(textarea).maxHeight);
  const fallbackMaxHeight = Math.max(180, Math.floor(window.innerHeight * 0.45));
  const maxHeight = Number.isFinite(computedMaxHeight) && computedMaxHeight > 0 ? computedMaxHeight : fallbackMaxHeight;
  const desiredHeight = Math.ceil(textarea.scrollHeight);
  textarea.style.height = `${Math.min(desiredHeight, maxHeight)}px`;
  textarea.style.overflowY = desiredHeight > maxHeight ? "auto" : "hidden";
}

function showMarkdownSourceEditor(view: EditorView, source: MarkdownSourceEditorState, selection: LinkRange | { from: number; to?: number }) {
  const from = Math.max(0, Math.min(selection.from, view.state.doc.content.size));
  const to = Math.max(from, Math.min(selection.to ?? selection.from, view.state.doc.content.size));
  const transaction = view.state.tr.setMeta(markdownSourceEditorPluginKey, source);
  transaction.setSelection(to > from ? TextSelection.create(view.state.doc, from, to) : TextSelection.create(view.state.doc, from));
  view.dispatch(transaction);
  focusMarkdownSourceInput(view, source.id);
}

function clearMarkdownSourceEditor(view: EditorView) {
  if (!markdownSourceEditorPluginKey.getState(view.state)) {
    return;
  }
  view.dispatch(view.state.tr.setMeta(markdownSourceEditorPluginKey, null));
}

function focusMarkdownSourceInput(view: EditorView, sourceId: string) {
  const focusInput = () => {
    const input = view.dom.querySelector<HTMLInputElement | HTMLTextAreaElement>(`.inline-markdown-source-input[data-source-id="${cssEscape(sourceId)}"]`);
    if (!input) {
      return false;
    }
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    return true;
  };
  if (focusInput()) {
    return;
  }
  window.requestAnimationFrame(() => {
    if (!focusInput()) {
      window.setTimeout(focusInput, 0);
    }
  });
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function taskItemContentFromElement(element: Node, schema: Schema): Fragment {
  if (!(element instanceof HTMLElement)) {
    return Fragment.empty;
  }
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input[type='checkbox'], label").forEach((node) => node.remove());
  clone.querySelectorAll(":scope > div").forEach((node) => node.replaceWith(...Array.from(node.childNodes)));
  const container = document.createElement("div");
  if (hasBlockChildren(clone)) {
    container.append(...Array.from(clone.childNodes));
  } else {
    const paragraph = document.createElement("p");
    paragraph.append(...Array.from(clone.childNodes));
    container.append(paragraph);
  }
  const parsed = ProseMirrorDOMParser.fromSchema(schema).parse(container);
  return parsed.content.size > 0 ? parsed.content : Fragment.from(schema.nodes.paragraph.create());
}

function hasBlockChildren(element: HTMLElement): boolean {
  return Array.from(element.children).some((child) =>
    /^(P|DIV|UL|OL|BLOCKQUOTE|PRE|TABLE|H[1-6])$/.test(child.tagName)
  );
}

export const WysiwygEditor = forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(function WysiwygEditor(
  { html, sourceText, workspaceId, documentPathRel, onChange, onMarkdownPaste, onSelectionLengthChange, onOpenMarkdownTarget, onInsertToc, readOnly, showToolbar = true, toolbarExtra, onAiContextMenu },
  ref
) {
  const { tr } = useRendererI18n();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkHref, setLinkHref] = useState("https://");
  const [linkRange, setLinkRange] = useState<LinkRange | undefined>();
  const [tableDialog, setTableDialog] = useState<TableDialogState | undefined>();
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [tableMenuMode, setTableMenuMode] = useState<TableMenuMode>("toolbar");
  const [tableMenuPosition, setTableMenuPosition] = useState<FloatingMenuState | undefined>();
  const [tableSourceEditor, setTableSourceEditor] = useState<TableSourceEditorState | undefined>();
  const [codeLanguageControl, setCodeLanguageControl] = useState<CodeLanguageControlState | undefined>();
  const lastEmittedHtml = useRef<string | undefined>(undefined);
  const lastCodeSelection = useRef<{ position: number; updatedAt: number } | undefined>(undefined);
  const editorRef = useRef<Editor | null>(null);
  const tableMenuModeRef = useRef<TableMenuMode>("toolbar");
  const sourceTextRef = useRef<string | undefined>(sourceText);
  const onOpenMarkdownTargetRef = useRef<typeof onOpenMarkdownTarget>(onOpenMarkdownTarget);
  const onAiContextMenuRef = useRef<typeof onAiContextMenu>(onAiContextMenu);
  const userEditIntentAt = useRef(0);
  const emitOpenMarkdownTarget = useCallback((target: MarkdownOpenTarget) => {
    onOpenMarkdownTargetRef.current?.(target);
  }, []);
  const markUserEditIntent = () => {
    userEditIntentAt.current = nowMs();
  };
  const setTableMenuModeSynced = useCallback((mode: TableMenuMode) => {
    tableMenuModeRef.current = mode;
    setTableMenuMode(mode);
  }, []);
  const closeTableMenu = useCallback(() => {
    setTableMenuOpen(false);
    if (tableMenuModeRef.current === "context") {
      setTableMenuPosition(undefined);
    }
    setTableMenuModeSynced("toolbar");
  }, [setTableMenuModeSynced]);
  const editableInitialHtml = normalizeRenderedHtmlForWysiwyg(html, { workspaceId, documentPathRel });
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        bulletList: {
          keepMarks: true,
          keepAttributes: false
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false
        },
        codeBlock: false,
        code: false,
        link: {
          openOnClick: false,
          enableClickSelection: false,
          autolink: true,
          linkOnPaste: true
        }
      }),
      EditableImage.configure({
        workspaceId,
        documentPathRel,
        markdownSourceLabel: tr("图片 Markdown 源码"),
        editHint: tr("选中后可编辑 Markdown 源码"),
        onOpenMarkdownTarget: emitOpenMarkdownTarget
      }),
      Highlight,
      NoliaInlineCode,
      MathBlock.configure({
        sourceLabel: tr("块公式 Markdown 源码")
      }),
      InlineMath.configure({
        sourceLabel: tr("行内公式源码"),
        editHint: tr("选中后可编辑源码")
      }),
      MarkdownInline.configure({
        editHint: tr("选中后可编辑源码"),
        wikilinkSourceLabel: tr("双链源码"),
        footnoteRefSourceLabel: tr("脚注引用源码"),
        inlineSourceLabel: tr("Markdown 行内源码"),
        onOpenMarkdownTarget: emitOpenMarkdownTarget
      }),
      MarkdownPreviewBlock.configure({
        sourceLabel: tr("Markdown 块源码")
      }),
      NoliaCodeBlock.configure({
        lowlight: codeBlockLowlight,
        exitOnTripleEnter: false,
        exitOnArrowDown: false,
        enableTabIndentation: true,
        HTMLAttributes: {
          spellcheck: "false"
        }
      }),
      TaskList,
      NoliaTaskItem.configure({
        nested: true
      }),
      Placeholder.configure({
        placeholder: tr("开始输入")
      }),
      Table.configure({
        resizable: true
      }),
      TableRow,
      NoliaTableHeader,
      NoliaTableCell,
      NoliaActiveTableCell,
      NoliaMarkdownSourceEditor.configure({
        onSubmit: (state, markdown) => {
          const currentEditor = editorRef.current;
          if (!currentEditor) {
            return;
          }
          markUserEditIntent();
          clearMarkdownSourceEditor(currentEditor.view);
          if (state.sourceType === "link") {
            void applyLinkSource(currentEditor, { ...state, markdown });
            return;
          }
          void applyMarkdownSyntaxSource(currentEditor, { ...state, markdown });
        },
        onCancel: () => {
          const currentEditor = editorRef.current;
          if (!currentEditor) {
            return;
          }
          clearMarkdownSourceEditor(currentEditor.view);
          currentEditor.view.focus();
        }
      })
    ],
    content: editableInitialHtml,
    editorProps: {
      handleDOMEvents: {
        copy: (view, event) => copySelectedHtml(view, event, sourceTextRef.current),
        beforeinput: () => {
          markUserEditIntent();
          return false;
        },
        cut: () => {
          markUserEditIntent();
          return false;
        },
        drop: () => {
          markUserEditIntent();
          return false;
        },
        contextmenu: (view, event) => {
          const target = elementFromEventTarget(event.target);
          const table = target?.closest("table");
          const shell = view.dom.closest(".wysiwyg-shell");
          if (!table || !shell) {
            if (onAiContextMenuRef.current) {
              const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
              if (position !== undefined && view.state.selection.empty) {
                view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
              }
              view.focus();
              onAiContextMenuRef.current(event.clientX, event.clientY);
              event.preventDefault();
              return true;
            }
            return false;
          }
          const tableCell = tableCellElementFromTarget(view, target);
          setTableMenuModeSynced("context");
          if (tableCell) {
            restoreSelectionInsideTableCell(view, tableCell);
          } else {
            const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            if (position !== undefined) {
              const range = tableCellRangeAtPosition(view.state, position);
              const transaction = view.state.tr.setSelection(TextSelection.create(view.state.doc, position)).scrollIntoView();
              if (range) {
                transaction.setMeta(activeTableCellPluginKey, range);
              }
              view.dispatch(transaction);
            }
          }
          const shellRect = shell.getBoundingClientRect();
          setTableMenuPosition({
            x: event.clientX - shellRect.left,
            y: event.clientY - shellRect.top
          });
          setTableMenuOpen(true);
          view.focus();
          event.preventDefault();
          return true;
        },
        mousedown: (view, event) => {
          const target = elementFromEventTarget(event.target);
          if (target?.closest(".inline-markdown-source-widget, .inline-markdown-source-input")) {
            return false;
          }
          const anchor = target?.closest("a[href]");
          const href = anchor?.getAttribute("href");
          if (anchor && href && event.button === 0) {
            event.preventDefault();
            if (isModifiedOpenClick(event)) {
              emitOpenMarkdownTarget({ kind: "link", href });
              return true;
            }
            return openLinkSourceEditorAtPosition(view, linkPositionFromPointer(view, event) ?? view.state.selection.from, anchor, tr("链接 Markdown 源码"));
          }
          if (event.button === 0 && target && inlineSyntaxKindFromTarget(target, event)) {
            const position = linkPositionFromPointer(view, event) ?? view.state.selection.from;
            const openedSource = openMarkdownSyntaxSourceEditorAtPosition(view, position, tr("Markdown 语法源码"), target, event);
            if (openedSource) {
              event.preventDefault();
              event.stopPropagation();
              return true;
            }
          }
          lastCodeSelection.current = undefined;
          return false;
        }
      },
      handlePaste: (view, event) => {
        markUserEditIntent();
        const clipboard = event.clipboardData;
        const plainText = clipboard?.getData("text/plain") ?? "";
        const richHtml = clipboard?.getData("text/html") ?? "";
        if (richHtml && looksLikeNoliaNoteRichHtml(richHtml)) {
          event.preventDefault();
          const clipboardMarkdown = markdownFromNoliaNoteRichHtml(richHtml);
          if (clipboardMarkdown && shouldReplaceDocumentOnPaste(view)) {
            onMarkdownPaste?.(clipboardMarkdown);
            view.focus();
            return true;
          }
          void Promise.resolve(clipboardMarkdown ?? htmlToMarkdown(richHtml)).then((markdown) => {
            void insertMarkdownPlainText(editor, view, markdown, { workspaceId, documentPathRel }, onChange);
          });
          return true;
        }
        if (!plainText || richHtml || !looksLikeMarkdownPlainText(plainText)) {
          return false;
        }
        event.preventDefault();
        if (shouldReplaceDocumentOnPaste(view)) {
          onMarkdownPaste?.(plainText);
          view.focus();
          return true;
        }
        void insertMarkdownPlainText(editor, view, plainText, { workspaceId, documentPathRel }, onChange);
        return true;
      },
      handleClick: (view, position, event) => {
        const target = elementFromEventTarget(event.target);
        if (target?.closest(".inline-markdown-source-widget, .inline-markdown-source-input")) {
          return false;
        }
        if (target?.closest(".table-controls, .table-source-popover")) {
          return false;
        }
        const anchor = target?.closest("a[href]");
        const href = anchor?.getAttribute("href");
        if (anchor && href) {
          if (isModifiedOpenClick(event)) {
            event.preventDefault();
            emitOpenMarkdownTarget({ kind: "link", href });
            return true;
          }
          return openLinkSourceEditorAtPosition(view, position, anchor, tr("链接 Markdown 源码"));
        }
        const openedSource = openMarkdownSyntaxSourceEditorAtPosition(view, position, tr("Markdown 语法源码"), target, event);
        if (openedSource) {
          return true;
        }
        const tableCell = tableCellElementFromTarget(view, target);
        if (tableCell) {
          setActiveTableCellRange(view, tableCellRangeAtPosition(view.state, position) ?? tableCellRangeFromElement(view, tableCell));
        }
        clearMarkdownSourceEditor(view);
        return false;
      },
      handleDoubleClick: (view, position, event) => {
        const target = elementFromEventTarget(event.target);
        const anchor = target?.closest("a[href]");
        if (!anchor) {
          return false;
        }
        openLinkSourceEditorAtPosition(view, position, anchor, tr("链接 Markdown 源码"));
        event.preventDefault();
        return true;
      },
      handleKeyDown: (view, event) => {
        if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          markUserEditIntent();
        }
        if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }
        if (focusSelectedMarkdownNodeSource(view)) {
          event.preventDefault();
          return true;
        }
        const codePosition = codePositionForEnter(view) ?? recentCodeSelection(lastCodeSelection.current);
        if (codePosition !== undefined) {
          event.preventDefault();
          const transaction = view.state.tr.insertText("\n", codePosition, codePosition);
          transaction.setSelection(TextSelection.create(transaction.doc, codePosition + 1));
          lastCodeSelection.current = { position: codePosition + 1, updatedAt: nowMs() };
          view.dispatch(transaction.scrollIntoView());
          return true;
        }
        const mathPosition = mathBlockPositionForEnter(view);
        if (mathPosition !== undefined) {
          event.preventDefault();
          const mathBlock = view.state.schema.nodes.mathBlock;
          const transaction = view.state.tr.replaceWith(mathPosition.from, mathPosition.to, mathBlock.create({ latex: "" }));
          view.dispatch(transaction.scrollIntoView());
          focusMathBlockInput(view, mathPosition.from);
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor: tiptapEditor, transaction }) => {
      const isUserEdit = Boolean(transaction.getMeta("noliaUserEdit")) || (tiptapEditor.isFocused && nowMs() - userEditIntentAt.current <= 3000);
      if (!transaction.docChanged || !isUserEdit) {
        return;
      }
      const nextHtml = tiptapEditor.getHTML();
      lastEmittedHtml.current = nextHtml;
      onChange(nextHtml);
    }
  });

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
    };
  }, [editor]);

  useEffect(() => {
    sourceTextRef.current = sourceText;
  }, [sourceText]);

  useEffect(() => {
    onOpenMarkdownTargetRef.current = onOpenMarkdownTarget;
  }, [onOpenMarkdownTarget]);

  useEffect(() => {
    onAiContextMenuRef.current = onAiContextMenu;
  }, [onAiContextMenu]);

  useImperativeHandle(ref, () => ({
    undoEdit: () => {
      if (!editor) {
        return false;
      }
      if (undoDepth(editor.state) <= 0) {
        editor.commands.focus();
        return true;
      }
      markUserEditIntent();
      return editor.chain().focus().undo().run();
    },
    redoEdit: () => {
      if (!editor) {
        return false;
      }
      if (redoDepth(editor.state) <= 0) {
        editor.commands.focus();
        return true;
      }
      markUserEditIntent();
      return editor.chain().focus().redo().run();
    },
    scrollToHeading: (headingIndex: number) => scrollToEditorHeading(editor, headingIndex),
    captureAiSelection: () => {
      if (!editor) {
        return undefined;
      }
      const text = selectedText(editor.state);
      return text.trim() ? text : undefined;
    },
    applyAiText: (text: string, mode: "insert" | "replace" | "append") => {
      if (!editor || readOnly) {
        return false;
      }
      markUserEditIntent();
      if (mode === "append") {
        editor.chain().focus("end").run();
        const appendix = editor.getText().trim() ? `\n\n${text.trim()}` : text.trim();
        void insertMarkdownPlainText(editor, editor.view, appendix, { workspaceId, documentPathRel }, onChange);
        return true;
      }
      if (mode === "replace" || mode === "insert") {
        editor.commands.focus();
        void insertMarkdownPlainText(editor, editor.view, text, { workspaceId, documentPathRel }, onChange);
        return true;
      }
      return false;
    }
  }), [documentPathRel, editor, onChange, readOnly, workspaceId]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    if (html === lastEmittedHtml.current) {
      return;
    }
    const currentHtml = editor.getHTML();
    const editableHtml = normalizeRenderedHtmlForWysiwyg(html, { workspaceId, documentPathRel });
    if (currentHtml !== editableHtml && editor.view.dom.innerHTML !== editableHtml) {
      lastEmittedHtml.current = undefined;
      editor.chain().setMeta("addToHistory", false).setContent(editableHtml, { emitUpdate: false, errorOnInvalidContent: false }).run();
    }
  }, [documentPathRel, editor, html, workspaceId]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const copyFromEditorSelection = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !selectionTouchesEditor(editor.view)) {
        return;
      }
      copySelectedHtml(editor.view, event, sourceText);
    };
    const copyFromKeyboardShortcut = (event: KeyboardEvent) => {
      if (!isCopyKeyboardShortcut(event) || !selectionTouchesEditor(editor.view)) {
        return;
      }
      const payload = selectedHtmlPayload(editor.view, sourceText);
      if (!payload) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void writeClipboardPayload(payload);
    };
    document.addEventListener("copy", copyFromEditorSelection, true);
    document.addEventListener("keydown", copyFromKeyboardShortcut, true);
    return () => {
      document.removeEventListener("copy", copyFromEditorSelection, true);
      document.removeEventListener("keydown", copyFromKeyboardShortcut, true);
    };
  }, [editor, sourceText]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const updateSelectionLength = () => {
      onSelectionLengthChange?.(selectedTextLength(editor.state));
    };
    editor.on("selectionUpdate", updateSelectionLength);
    editor.on("transaction", updateSelectionLength);
    updateSelectionLength();
    return () => {
      editor.off("selectionUpdate", updateSelectionLength);
      editor.off("transaction", updateSelectionLength);
    };
  }, [editor, onSelectionLengthChange]);

  useEffect(() => {
    if (!tableMenuOpen) {
      return;
    }
    const closeOnOutsideMouseDown = (event: MouseEvent) => {
      const target = elementFromEventTarget(event.target);
      if (target?.closest(".table-controls")) {
        return;
      }
      if (target?.closest(".table-source-popover")) {
        return;
      }
      closeTableMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTableMenu();
      }
    };
    document.addEventListener("mousedown", closeOnOutsideMouseDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideMouseDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeTableMenu, tableMenuOpen]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const updateTableMenuPosition = (event?: Event | { transaction?: Transaction }) => {
      const transaction = event && !(event instanceof Event) ? event.transaction : undefined;
      const skipActiveCellSync = transaction?.getMeta(activeTableCellPluginKey) !== undefined;
      if (!editor.isActive("table")) {
        setActiveTableCellRange(editor.view, undefined);
        setTableMenuPosition(undefined);
        setTableMenuOpen(false);
        setTableMenuModeSynced("toolbar");
        setTableSourceEditor(undefined);
        return;
      }
      const { from } = editor.state.selection;
      const dom = editor.view.domAtPos(from).node;
      const element = dom.nodeType === Node.ELEMENT_NODE ? (dom as Element) : dom.parentElement;
      const table = element?.closest("table");
      const shell = editor.view.dom.closest(".wysiwyg-shell");
      const scrollContainer = editor.view.dom.closest(".wysiwyg-editor");
      if (!table || !shell || !scrollContainer) {
        setActiveTableCellRange(editor.view, undefined);
        setTableMenuPosition(undefined);
        return;
      }
      if (tableMenuModeRef.current === "context") {
        return;
      }
      if (!skipActiveCellSync) {
        setActiveTableCellRange(editor.view, tableCellRangeAtPosition(editor.state, from));
      }
      const tableRect = table.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const scrollRect = scrollContainer.getBoundingClientRect();
      if (tableRect.bottom <= scrollRect.top + 8 || tableRect.top >= scrollRect.bottom - 8) {
        setTableMenuPosition(undefined);
        return;
      }
      setTableMenuPosition({
        x: Math.max(12, tableRect.left - shellRect.left),
        y: Math.max(scrollRect.top - shellRect.top + 8, tableRect.top - shellRect.top - 34)
      });
    };
    editor.on("selectionUpdate", updateTableMenuPosition);
    editor.on("transaction", updateTableMenuPosition);
    let scrollContainer: Element | null = null;
    const scrollListenerFrame = window.requestAnimationFrame(() => {
      scrollContainer = editor.view.dom.closest(".wysiwyg-editor");
      scrollContainer?.addEventListener("scroll", updateTableMenuPosition, { passive: true });
    });
    window.addEventListener("resize", updateTableMenuPosition);
    updateTableMenuPosition();
    return () => {
      window.cancelAnimationFrame(scrollListenerFrame);
      editor.off("selectionUpdate", updateTableMenuPosition);
      editor.off("transaction", updateTableMenuPosition);
      scrollContainer?.removeEventListener("scroll", updateTableMenuPosition);
      window.removeEventListener("resize", updateTableMenuPosition);
      setActiveTableCellRange(editor.view, undefined);
    };
  }, [editor, setTableMenuModeSynced]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    const updateCodeLanguageControl = () => {
      const range = codeBlockRangeAtSelection(editor.state);
      if (!range) {
        setCodeLanguageControl(undefined);
        return;
      }
      const pre = codeBlockElementForRange(editor.view, range.from);
      const shell = editor.view.dom.closest(".wysiwyg-shell");
      const scrollContainer = editor.view.dom.closest(".wysiwyg-editor");
      if (!pre || !shell || !scrollContainer) {
        setCodeLanguageControl(undefined);
        return;
      }
      const preRect = pre.getBoundingClientRect();
      const shellRect = shell.getBoundingClientRect();
      const scrollRect = scrollContainer.getBoundingClientRect();
      if (preRect.bottom <= scrollRect.top + 8 || preRect.top >= scrollRect.bottom - 8) {
        setCodeLanguageControl(undefined);
        return;
      }
      setCodeLanguageControl({
        from: range.from,
        language: normalizeCodeBlockLanguage(range.node.attrs.language),
        x: Math.max(96, Math.min(shellRect.width - 12, preRect.right - shellRect.left - 10)),
        y: Math.min(scrollRect.bottom - shellRect.top - 32, preRect.bottom - shellRect.top - 34)
      });
    };
    editor.on("selectionUpdate", updateCodeLanguageControl);
    editor.on("transaction", updateCodeLanguageControl);
    let scrollContainer: Element | null = null;
    const scrollListenerFrame = window.requestAnimationFrame(() => {
      scrollContainer = editor.view.dom.closest(".wysiwyg-editor");
      scrollContainer?.addEventListener("scroll", updateCodeLanguageControl, { passive: true });
    });
    window.addEventListener("resize", updateCodeLanguageControl);
    updateCodeLanguageControl();
    return () => {
      window.cancelAnimationFrame(scrollListenerFrame);
      editor.off("selectionUpdate", updateCodeLanguageControl);
      editor.off("transaction", updateCodeLanguageControl);
      scrollContainer?.removeEventListener("scroll", updateCodeLanguageControl);
      window.removeEventListener("resize", updateCodeLanguageControl);
    };
  }, [editor]);

  if (!editor) {
    return <div className="wysiwyg-loading">{tr("编辑器加载中...")}</div>;
  }
  const insertImage = async () => {
    if (!workspaceId || !documentPathRel) {
      return;
    }
    const selected = await window.nolia.attachment.pickImage({ workspaceId });
    if (!selected.path) {
      return;
    }
    const attachment = await window.nolia.attachment.import({
      workspaceId,
      documentPathRel,
      source: { path: selected.path }
    });
    const pathRel = imageSrcFromMarkdown(attachment.markdown) ?? attachment.assetPathRel;
    editor
      .chain()
      .focus()
      .setImage({
        src: assetUrl(workspaceId, pathRel),
        alt: attachment.assetPathRel.split("/").pop() ?? tr("图片"),
        title: pathRel
      })
      .run();
  };
  const openTableSourceEditor = async () => {
    const range = tableRangeAtSelection(editor.state);
    if (!range || !tableMenuPosition) {
      return;
    }
    setTableMenuOpen(false);
    const markdown = await markdownForTableNode(editor, range.node);
    setTableSourceEditor({
      ...tableMenuPosition,
      markdown,
      from: range.from,
      to: range.to
    });
  };
  const applyTableSource = async (markdownOverride?: string) => {
    if (!tableSourceEditor) {
      return;
    }
    const markdown = markdownOverride ?? tableSourceEditor.markdown;
    setTableSourceEditor((current) => (current ? { ...current, markdown, applying: true, error: undefined } : current));
    try {
      const table = await tableNodeFromMarkdown(editor, markdown, { workspaceId, documentPathRel });
      if (!table) {
        throw new Error(tr("请输入有效的 Markdown 表格"));
      }
      const currentRange = tableRangeAtSelection(editor.state);
      const from = currentRange?.from === tableSourceEditor.from ? currentRange.from : tableSourceEditor.from;
      const to = currentRange?.from === tableSourceEditor.from ? currentRange.to : Math.min(tableSourceEditor.to, editor.state.doc.content.size);
      const transaction = editor.state.tr.replaceWith(from, to, table);
      transaction.setMeta("noliaUserEdit", true);
      editor.view.dispatch(transaction.scrollIntoView());
      editor.view.focus();
      setTableSourceEditor(undefined);
    } catch (error) {
      setTableSourceEditor((current) =>
        current
          ? {
              ...current,
              applying: false,
              error: error instanceof Error ? error.message : tr("无法解析 Markdown 表格")
            }
          : current
      );
    }
  };
  const applyCodeBlockLanguage = (language: string) => {
    const range = codeBlockRangeAtSelection(editor.state);
    const from = range?.from ?? codeLanguageControl?.from;
    if (from === undefined) {
      return;
    }
    const node = editor.state.doc.nodeAt(from);
    if (!node || node.type.name !== "codeBlock") {
      return;
    }
    const nextLanguage = codeFenceLanguageForCodeBlock(language);
    const transaction = editor.state.tr.setNodeMarkup(from, undefined, {
      ...node.attrs,
      language: nextLanguage || null
    });
    transaction.setMeta("noliaUserEdit", true);
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
    setCodeLanguageControl((current) =>
      current && current.from === from
        ? {
            ...current,
            language: normalizeCodeBlockLanguage(nextLanguage)
          }
        : current
    );
  };
  const insertOrUpdateToc = async () => {
    clearMarkdownSourceEditor(editor.view);
    closeTableMenu();
    setTableSourceEditor(undefined);
    const currentHtml = editor.getHTML();
    const currentMarkdown = await htmlToMarkdown(currentHtml);
    if (hasMarkdownToc(currentMarkdown)) {
      onInsertToc?.(currentHtml);
      return;
    }
    markUserEditIntent();
    await insertMarkdownBlockAtSelection(editor, createMarkdownTocBlock(currentMarkdown, tr("目录")), { workspaceId, documentPathRel });
  };

  return (
    <div className="wysiwyg-shell">
      {showToolbar ? (
      <div className="editor-toolbar" role="toolbar" aria-label={tr("Markdown 工具")} onMouseDown={markUserEditIntent}>
        {toolbarExtra ? (
          <>
            {toolbarExtra}
            <ToolbarDivider />
          </>
        ) : null}
        <IconButton title={tr("插入目录")} onClick={() => void insertOrUpdateToc()} icon={<TableOfContents size={16} />} />
        <ToolbarDivider />
        <IconButton title={tr("撤销")} onClick={() => {
          if (undoDepth(editor.state) > 0) {
            markUserEditIntent();
            editor.chain().focus().undo().run();
            return;
          }
          editor.commands.focus();
        }} icon={<Undo2 size={16} />} />
        <IconButton title={tr("重做")} onClick={() => {
          if (redoDepth(editor.state) > 0) {
            markUserEditIntent();
            editor.chain().focus().redo().run();
            return;
          }
          editor.commands.focus();
        }} icon={<Redo2 size={16} />} />
        <ToolbarDivider />
        <IconButton title={tr("段落")} onClick={() => editor.chain().focus().setParagraph().run()} icon={<Pilcrow size={16} />} />
        <IconButton title={tr("一级标题")} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} icon={<Heading1 size={16} />} />
        <IconButton title={tr("二级标题")} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} icon={<Heading2 size={16} />} />
        <IconButton title={tr("三级标题")} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} icon={<Heading3 size={16} />} />
        <ToolbarDivider />
        <IconButton title={tr("加粗")} onClick={() => editor.chain().focus().toggleBold().run()} icon={<Bold size={16} />} />
        <IconButton title={tr("斜体")} onClick={() => editor.chain().focus().toggleItalic().run()} icon={<Italic size={16} />} />
        <IconButton title={tr("删除线")} onClick={() => editor.chain().focus().toggleStrike().run()} icon={<Strikethrough size={16} />} />
        <IconButton title={tr("行内代码")} onClick={() => editor.chain().focus().toggleCode().run()} icon={<CodeIcon size={16} />} />
        <ToolbarDivider />
        <IconButton title={tr("无序列表")} onClick={() => toggleListOrInsert(editor, "bullet")} icon={<List size={16} />} />
        <IconButton title={tr("有序列表")} onClick={() => toggleListOrInsert(editor, "ordered")} icon={<ListOrdered size={16} />} />
        <IconButton title={tr("任务列表")} onClick={() => toggleListOrInsert(editor, "task")} icon={<ListChecks size={16} />} />
        <IconButton title={tr("复选框")} onClick={() => insertTaskCheckbox(editor)} icon={<SquareCheckBig size={16} />} />
        <ToolbarDivider />
        <IconButton
          title={tr("链接")}
          onClick={() => {
            clearMarkdownSourceEditor(editor.view);
            openLinkDialog(editor, setLinkText, setLinkHref, setLinkRange, setLinkDialogOpen);
          }}
          icon={<Link2 size={16} />}
        />
        <IconButton
          title={tr("图片")}
          onClick={() => {
            void insertImage();
          }}
          icon={<ImageIcon size={16} />}
        />
        <IconButton title={tr("代码块")} onClick={() => insertCodeBlock(editor)} icon={<FileCode2 size={16} />} />
        <IconButton title={tr("表格")} onClick={(event) => setTableDialog(createAnchoredTableDialog(event.currentTarget))} icon={<Table2 size={16} />} />
        <IconButton
          title={tr("公式")}
          onClick={() => {
            insertMathBlockAndFocus(editor, "E = mc^2");
          }}
          icon={<Sigma size={16} />}
        />
        <IconButton title={tr("引用")} onClick={() => editor.chain().focus().toggleBlockquote().run()} icon={<Quote size={16} />} />
        <IconButton title={tr("分割线")} onClick={() => editor.chain().focus().setHorizontalRule().run()} icon={<Minus size={16} />} />
      </div>
      ) : null}
      {linkDialogOpen ? (
        <form
          className="link-popover"
          role="dialog"
          aria-label={tr("插入链接")}
          onSubmit={(event) => {
            event.preventDefault();
            markUserEditIntent();
            const text = linkText.trim();
            const href = linkHref.trim();
            if (href) {
              applyLink(editor, linkRange, text, href);
            } else {
              unsetLink(editor, linkRange);
            }
            setLinkRange(undefined);
            setLinkDialogOpen(false);
          }}
        >
          <label>
            <span>{tr("文本")}</span>
            <input value={linkText} autoFocus onChange={(event) => setLinkText(event.target.value)} placeholder={tr("文本描述")} aria-label={tr("链接文本")} />
          </label>
          <label>
            <span>{tr("链接")}</span>
            <input value={linkHref} onChange={(event) => setLinkHref(event.target.value)} placeholder={tr("添加链接地址")} aria-label={tr("链接地址")} />
          </label>
          <div className="link-popover-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setLinkRange(undefined);
                setLinkDialogOpen(false);
              }}
            >
              {tr("取消")}
            </button>
            <button type="submit" className="primary-button">
              {tr("确定")}
            </button>
          </div>
        </form>
      ) : null}
      <TableInsertDialog
        dialog={tableDialog}
        onChange={setTableDialog}
        onCancel={() => setTableDialog(undefined)}
        onSubmit={(rows, columns) => {
          editor.chain().focus().insertTable({ rows, cols: columns, withHeaderRow: true }).run();
          setTableDialog(undefined);
        }}
      />
      {editor.isActive("table") && tableMenuPosition ? (
        <TableOperationsMenu
          editor={editor}
          mode={tableMenuMode}
          open={tableMenuOpen}
          position={tableMenuPosition}
          onToggle={() => {
            setTableMenuModeSynced("toolbar");
            setTableMenuOpen((value) => !value);
          }}
          onClose={closeTableMenu}
          onResize={(rows, columns) => resizeSelectedTable(editor, rows, columns)}
          onAlign={(align) => setSelectedTableCellAlignment(editor, align)}
          onEditSource={() => {
            void openTableSourceEditor();
          }}
        />
      ) : null}
      {tableSourceEditor ? (
        <TableSourcePopover
          state={tableSourceEditor}
          onChange={(markdown) => setTableSourceEditor((current) => (current ? { ...current, markdown, error: undefined } : current))}
          onCancel={() => {
            setTableSourceEditor(undefined);
            editor.view.focus();
          }}
          onSubmit={(markdown) => {
            void applyTableSource(markdown);
          }}
        />
      ) : null}
      {codeLanguageControl ? <CodeLanguageSelectControl state={codeLanguageControl} onChange={applyCodeBlockLanguage} /> : null}
      <EditorContent editor={editor} className="wysiwyg-editor" />
    </div>
  );
});

function scrollToEditorHeading(editor: Editor | null, headingIndex: number): boolean {
  if (!editor || headingIndex < 0) {
    return false;
  }
  let currentIndex = -1;
  let targetPosition: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== "heading") {
      return;
    }
    currentIndex += 1;
    if (currentIndex === headingIndex) {
      targetPosition = position;
      return false;
    }
  });
  if (targetPosition === undefined) {
    return false;
  }
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, targetPosition + 1)).scrollIntoView());
  editor.view.focus();
  return true;
}

function containsRelatedTarget(event: React.FocusEvent<HTMLElement>): boolean {
  const relatedTarget = event.relatedTarget;
  return relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget);
}

function selectedTextLength(state: EditorState): number {
  return Array.from(selectedText(state)).length;
}

function selectedText(state: EditorState): string {
  const { from, to, empty } = state.selection;
  return empty ? "" : state.doc.textBetween(from, to, "\n", selectedAtomText);
}

function selectedAtomText(node: ProseMirrorNode): string {
  if (node.type.name === "mathBlock") {
    return `$$\n${String(node.attrs.latex ?? "")}\n$$`;
  }
  if (node.type.name === "markdownPreviewBlock") {
    return String(node.attrs.markdown ?? "");
  }
  return "";
}

function tableCellElementFromTarget(view: EditorView, target: Element | undefined): HTMLElement | undefined {
  const cell = target?.closest("th, td");
  if (cell instanceof HTMLElement && view.dom.contains(cell)) {
    return cell;
  }
  return undefined;
}

function tableCellRangeFromElement(view: EditorView, cell: HTMLElement): ActiveTableCellRange | undefined {
  const rect = cell.getBoundingClientRect();
  if (rect.width || rect.height) {
    const position = view.posAtCoords({
      left: rect.left + rect.width / 2,
      top: rect.top + rect.height / 2
    })?.pos;
    const range = position !== undefined ? tableCellRangeAtPosition(view.state, position) : undefined;
    if (range) {
      return range;
    }
  }
  try {
    for (const bias of [-1, 0, 1]) {
      const rawPos = view.posAtDOM(cell, 0, bias);
      for (const candidate of [rawPos, rawPos + 1, rawPos + 2]) {
        const range = tableCellRangeAtPosition(view.state, candidate);
        if (range) {
          return range;
        }
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function tableCellRangeAtPosition(state: EditorState, position: number): ActiveTableCellRange | undefined {
  if (position < 0 || position > state.doc.content.size) {
    return undefined;
  }
  const resolved = state.doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      return {
        from: resolved.before(depth),
        to: resolved.after(depth)
      };
    }
  }
  return undefined;
}

function activeTableCellRangeFromState(state: EditorState): ActiveTableCellRange | undefined {
  const decoration = activeTableCellPluginKey.getState(state)?.find(undefined, undefined, (spec) => spec.key === "nolia-active-table-cell").at(0);
  return decoration ? { from: decoration.from, to: decoration.to } : undefined;
}

function isTableCellNode(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return node?.type.name === "tableCell" || node?.type.name === "tableHeader";
}

function tableCellNodeFromRange(state: EditorState, range: ActiveTableCellRange): { from: number; to: number; node: ProseMirrorNode } | undefined {
  const directNode = state.doc.nodeAt(range.from);
  if (isTableCellNode(directNode)) {
    return { from: range.from, to: range.from + directNode.nodeSize, node: directNode };
  }
  const safePosition = Math.max(0, Math.min(range.from + 1, state.doc.content.size));
  const resolved = state.doc.resolve(safePosition);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (isTableCellNode(node)) {
      return {
        from: resolved.before(depth),
        to: resolved.after(depth),
        node
      };
    }
  }
  let cell: { from: number; to: number; node: ProseMirrorNode } | undefined;
  state.doc.nodesBetween(range.from, range.to, (node, position) => {
    if (isTableCellNode(node)) {
      cell = { from: position, to: position + node.nodeSize, node };
      return false;
    }
    return undefined;
  });
  return cell;
}

function activeTableCellNode(editor: Editor): { from: number; to: number; node: ProseMirrorNode } | undefined {
  const stateRange = activeTableCellRangeFromState(editor.state) ?? tableCellRangeAtPosition(editor.state, editor.state.selection.from);
  if (stateRange) {
    const node = tableCellNodeFromRange(editor.state, stateRange);
    if (node) {
      return node;
    }
  }
  const activeDomCell = editor.view.dom.querySelector("th.is-active-cell, td.is-active-cell");
  if (activeDomCell instanceof HTMLElement) {
    const domRange = tableCellRangeFromElement(editor.view, activeDomCell);
    return domRange ? tableCellNodeFromRange(editor.state, domRange) : undefined;
  }
  return undefined;
}

function setActiveTableCellRange(view: EditorView, range: ActiveTableCellRange | undefined) {
  const current = activeTableCellRangeFromState(view.state);
  if ((!current && !range) || (current && range && current.from === range.from && current.to === range.to)) {
    return;
  }
  view.dispatch(view.state.tr.setMeta(activeTableCellPluginKey, range ?? null));
}

function restoreSelectionInsideActiveTableCell(view: EditorView): boolean {
  const range = activeTableCellRangeFromState(view.state) ?? tableCellRangeAtPosition(view.state, view.state.selection.from);
  if (!range) {
    return false;
  }
  const position = textPositionInsideTableCell(view.state, range);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)).setMeta(activeTableCellPluginKey, range).scrollIntoView());
  return true;
}

function restoreSelectionInsideTableCell(view: EditorView, cell: HTMLElement): boolean {
  const range = tableCellRangeFromElement(view, cell);
  if (!range) {
    return false;
  }
  const position = textPositionInsideTableCell(view.state, range);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)).setMeta(activeTableCellPluginKey, range).scrollIntoView());
  return true;
}

function textPositionInsideTableCell(state: EditorState, range: ActiveTableCellRange): number {
  let position = Math.min(range.from + 1, range.to - 1);
  state.doc.nodesBetween(range.from + 1, range.to - 1, (node, pos) => {
    if (node.isTextblock) {
      position = Math.min(pos + 1, range.to - 1);
      return false;
    }
    return undefined;
  });
  return Math.max(0, Math.min(position, state.doc.content.size));
}

function tableRangeAtSelection(state: EditorState): { from: number; to: number; node: ProseMirrorNode } | undefined {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "table") {
      continue;
    }
    return {
      from: $from.before(depth),
      to: $from.after(depth),
      node
    };
  }
  return undefined;
}

function tableDimensionsAtSelection(state: EditorState): { rows: number; columns: number } | undefined {
  const range = tableRangeAtSelection(state);
  if (!range) {
    return undefined;
  }
  return tableDimensions(range.node);
}

function tableDimensions(tableNode: ProseMirrorNode): { rows: number; columns: number } {
  let columns = 0;
  tableNode.forEach((row) => {
    columns = Math.max(columns, row.childCount);
  });
  return {
    rows: tableNode.childCount,
    columns: Math.max(1, columns)
  };
}

function resizeSelectedTable(editor: Editor, rows: number, columns: number) {
  const range = tableRangeAtSelection(editor.state);
  if (!range) {
    return;
  }
  const nextTable = resizedTableNode(editor.schema, range.node, rows, columns);
  const transaction = editor.state.tr.replaceWith(range.from, range.to, nextTable);
  transaction.setMeta("noliaUserEdit", true);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function resizedTableNode(schema: Schema, tableNode: ProseMirrorNode, rows: number, columns: number): ProseMirrorNode {
  const rowType = schema.nodes.tableRow;
  const headerType = schema.nodes.tableHeader;
  const cellType = schema.nodes.tableCell;
  const paragraphType = schema.nodes.paragraph;
  const safeRows = clampInteger(rows, 1, 20);
  const safeColumns = clampInteger(columns, 1, 12);
  const firstRow = tableNode.childCount ? tableNode.child(0) : undefined;
  const useHeaderRow = Boolean(firstRow?.childCount && Array.from({ length: firstRow.childCount }).every((_, index) => firstRow.child(index).type.name === "tableHeader"));
  const nextRows: ProseMirrorNode[] = [];
  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    const existingRow = rowIndex < tableNode.childCount ? tableNode.child(rowIndex) : undefined;
    const nextCells: ProseMirrorNode[] = [];
    for (let columnIndex = 0; columnIndex < safeColumns; columnIndex += 1) {
      const existingCell = existingRow && columnIndex < existingRow.childCount ? existingRow.child(columnIndex) : undefined;
      if (existingCell) {
        nextCells.push(existingCell.type.create(existingCell.attrs, existingCell.content, existingCell.marks));
        continue;
      }
      const nextCellType = useHeaderRow && rowIndex === 0 ? headerType : cellType;
      nextCells.push(nextCellType.create(null, paragraphType.create()));
    }
    nextRows.push(rowType.create(null, nextCells));
  }
  return tableNode.type.create(tableNode.attrs, nextRows, tableNode.marks);
}

function setSelectedTableCellAlignment(editor: Editor, align: "left" | "center" | "right") {
  const cell = activeTableCellNode(editor);
  if (cell) {
    const transaction = editor.state.tr.setNodeMarkup(cell.from, undefined, {
      ...cell.node.attrs,
      align
    });
    const nextCell = transaction.doc.nodeAt(cell.from);
    transaction.setMeta("noliaUserEdit", true);
    transaction.setMeta(activeTableCellPluginKey, { from: cell.from, to: cell.from + (nextCell?.nodeSize ?? cell.node.nodeSize) });
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
    return;
  }
  editor.chain().focus().setCellAttribute("align", align).run();
}

function codeBlockRangeAtSelection(state: EditorState): { from: number; to: number; node: ProseMirrorNode } | undefined {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "codeBlock") {
      continue;
    }
    return {
      from: $from.before(depth),
      to: $from.after(depth),
      node
    };
  }
  return undefined;
}

function codeBlockElementForRange(view: EditorView, from: number): HTMLElement | undefined {
  const direct = view.nodeDOM(from);
  if (direct instanceof HTMLElement) {
    if (direct.matches("pre")) {
      return direct;
    }
    const nested = direct.querySelector("pre");
    if (nested instanceof HTMLElement) {
      return nested;
    }
  }
  const dom = view.domAtPos(Math.min(from + 1, view.state.doc.content.size)).node;
  const element = dom.nodeType === Node.ELEMENT_NODE ? (dom as Element) : dom.parentElement;
  const pre = element?.closest("pre");
  return pre instanceof HTMLElement ? pre : undefined;
}

async function markdownForTableNode(editor: Editor, tableNode: ProseMirrorNode): Promise<string> {
  const container = document.createElement("div");
  const serialized = DOMSerializer.fromSchema(editor.schema).serializeNode(tableNode);
  container.append(serialized);
  cleanupSerializedTable(container);
  return htmlToMarkdown(container.innerHTML);
}

async function tableNodeFromMarkdown(
  editor: Editor,
  markdown: string,
  options: { workspaceId?: string; documentPathRel?: string } = {}
): Promise<ProseMirrorNode | undefined> {
  const html = normalizeRenderedHtmlForWysiwyg(await renderMarkdownToHtml(markdown), options);
  const template = document.createElement("template");
  template.innerHTML = html;
  const table = template.content.querySelector("table");
  if (!table) {
    return undefined;
  }
  const container = document.createElement("div");
  container.append(table.cloneNode(true));
  const doc = ProseMirrorDOMParser.fromSchema(editor.schema).parse(container);
  let tableNode: ProseMirrorNode | undefined;
  doc.descendants((node) => {
    if (node.type.name === "table") {
      tableNode = node;
      return false;
    }
    return tableNode ? false : undefined;
  });
  return tableNode;
}

function cleanupSerializedTable(container: HTMLElement) {
  container.querySelectorAll("colgroup, .column-resize-handle").forEach((node) => node.remove());
  container.querySelectorAll<HTMLElement>("table, thead, tbody, tr, th, td").forEach((element) => {
    element.removeAttribute("style");
    element.removeAttribute("class");
    element.removeAttribute("data-colwidth");
  });
}

function selectionTouchesEditor(view: EditorView): boolean {
  const selection = view.root instanceof Document ? view.root.getSelection() : window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return false;
  }
  const nodes = [selection.anchorNode, selection.focusNode];
  if (nodes.some((node) => node && view.dom.contains(node))) {
    return true;
  }
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (view.dom.contains(range.commonAncestorContainer)) {
      return true;
    }
  }
  return false;
}

type ClipboardPayload = {
  html: string;
  text: string;
};

function copySelectedHtml(view: EditorView, event: ClipboardEvent, sourceText?: string): boolean {
  const clipboard = event.clipboardData;
  const payload = selectedHtmlPayload(view, sourceText);
  if (!clipboard || !payload) {
    return false;
  }
  clipboard.setData("text/html", payload.html);
  clipboard.setData("text/plain", payload.text);
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void writeClipboardPayload(payload);
  return true;
}

function selectedHtmlPayload(view: EditorView, sourceText?: string): ClipboardPayload | undefined {
  const selection = view.root instanceof Document ? view.root.getSelection() : window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return undefined;
  }
  const container = document.createElement("div");
  const selectedPreviewBlock = selectedMarkdownPreviewBlock(view, selection);
  if (selectedPreviewBlock) {
    container.append(selectedPreviewBlock.cloneNode(true));
  }
  const selectionTouchesEditor =
    (selection.anchorNode ? view.dom.contains(selection.anchorNode) : false) ||
    (selection.focusNode ? view.dom.contains(selection.focusNode) : false);
  if (!selectedPreviewBlock) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      const range = selection.getRangeAt(index);
      if (!view.dom.contains(range.commonAncestorContainer)) {
        if (!selectionTouchesEditor) {
          return undefined;
        }
        container.append(...Array.from(view.dom.cloneNode(true).childNodes));
        break;
      }
      container.append(range.cloneContents());
    }
  }
  normalizeCopiedMarkdownPreviewBlocks(container);
  if (!container.textContent?.trim() && !container.querySelector("img, table, input, .markdown-preview-block, .math-block")) {
    return undefined;
  }
  const selectedBlockMarkdown = selectedPreviewBlock?.dataset.markdown;
  const fullDocumentMarkdown = sourceText && (isFullDocumentSelection(view) || isFullDomSelection(view, selection)) ? sourceText : undefined;
  const markdownAttribute = fullDocumentMarkdown ? ` data-markdown="${escapeHtmlAttribute(fullDocumentMarkdown)}"` : "";
  return {
    html: `<div data-nolia-clipboard="true"${markdownAttribute}>${container.innerHTML}</div>`,
    text: fullDocumentMarkdown ?? selectedBlockMarkdown ?? (plainTextFromCopiedDom(container) || selectedText(view.state) || selection.toString())
  };
}

function isFullDocumentSelection(view: EditorView): boolean {
  const { from, to, empty } = view.state.selection;
  if (empty) {
    return false;
  }
  return from <= 1 && to >= view.state.doc.content.size - 1;
}

function isFullDomSelection(view: EditorView, selection: Selection): boolean {
  const editorText = compactComparableText(view.dom.textContent ?? "");
  const selectedText = compactComparableText(selection.toString());
  return editorText.length > 0 && selectedText.length >= editorText.length * 0.9;
}

function compactComparableText(value: string): string {
  return value.replace(/\s+/g, "");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeCopiedMarkdownPreviewBlocks(container: HTMLElement): void {
  container.querySelectorAll(".mermaid[data-markdown]").forEach((node) => {
    const element = node instanceof HTMLElement ? node : undefined;
    const markdown = element?.dataset.markdown;
    if (!element || !markdown || element.closest("[data-type='markdown-preview-block']")) {
      return;
    }
    element.replaceWith(createMarkdownPreviewBlock("mermaid", markdown, element.outerHTML));
  });
}

function selectedMarkdownPreviewBlock(view: EditorView, selection: Selection): HTMLElement | undefined {
  const blocks = [selection.anchorNode, selection.focusNode]
    .map((node) => closestElement(node, "[data-type='markdown-preview-block'][data-markdown]"))
    .filter((node): node is HTMLElement => Boolean(node));
  if (!blocks.length || blocks.some((block) => !view.dom.contains(block))) {
    return undefined;
  }
  const [first] = blocks;
  return blocks.every((block) => block === first) ? first : undefined;
}

function closestElement(node: Node | null, selector: string): HTMLElement | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  const match = element?.closest(selector);
  return match instanceof HTMLElement ? match : undefined;
}

async function writeClipboardPayload(payload: ClipboardPayload): Promise<void> {
  try {
    await window.nolia.clipboard.writeRich(payload);
    return;
  } catch {
    // Fall back to the Web Clipboard API when the native bridge is unavailable in tests or browsers.
  }
  try {
    if ("ClipboardItem" in window && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([payload.html], { type: "text/html" }),
          "text/plain": new Blob([payload.text], { type: "text/plain" })
        })
      ]);
      return;
    }
  } catch {
    // Fall back to plain text if rich clipboard writes are unavailable.
  }
  try {
    await navigator.clipboard?.writeText(payload.text);
  } catch {
    // Native copy will already have been prevented; there is no safer sync fallback here.
  }
}

function isCopyKeyboardShortcut(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "c" && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

function plainTextFromCopiedDom(container: HTMLElement): string {
  const text = Array.from(container.childNodes).map((node) => plainTextFromCopiedNode(node)).join("");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function plainTextFromCopiedNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  if (node.matches("br")) {
    return "\n";
  }
  if (node.matches("input[type='checkbox']")) {
    return (node as HTMLInputElement).checked ? "[x] " : "[ ] ";
  }
  const childText = Array.from(node.childNodes).map((child) => plainTextFromCopiedNode(child)).join("");
  if (node.matches("pre")) {
    return `${childText.replace(/\n+$/, "")}\n\n`;
  }
  if (node.matches("li")) {
    return `${childText.trimEnd()}\n`;
  }
  if (node.matches("p,h1,h2,h3,h4,h5,h6,blockquote,table,ul,ol,div")) {
    return `${childText.trimEnd()}\n`;
  }
  return childText;
}

async function insertMarkdownPlainText(
  editor: Editor | null,
  view: EditorView,
  markdown: string,
  options: { workspaceId?: string; documentPathRel?: string } = {},
  onChange?: (value: string) => void
) {
  try {
    const html = normalizeRenderedHtmlForWysiwyg(await renderMarkdownToHtml(markdown), options);
    const pasteHtml = splitTaskListItemsForParsing(html);
    if (editor && isEmptyEditorDocument(view.state)) {
      editor.commands.setContent(pasteHtml);
      restoreTaskTextFromMarkdown(editor, markdown);
      queueTaskDomTextRestore(editor, markdown, onChange);
      editor.view.focus();
      return;
    }
    const container = document.createElement("div");
    container.innerHTML = pasteHtml;
    const parsedDoc = ProseMirrorDOMParser.fromSchema(view.state.schema).parse(container);
    const slice = parsedDoc.slice(0, parsedDoc.content.size);
    const transaction = isEmptyEditorDocument(view.state)
      ? view.state.tr.replaceRange(0, view.state.doc.content.size, slice)
      : view.state.tr.replaceSelection(slice);
    view.dispatch(transaction.scrollIntoView());
    if (editor) {
      restoreTaskTextFromMarkdown(editor, markdown);
      queueTaskDomTextRestore(editor, markdown, onChange);
    }
    view.focus();
  } catch {
    view.dispatch(view.state.tr.insertText(markdown).scrollIntoView());
  }
}

async function insertMarkdownBlockAtSelection(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  markdown: string,
  options: { workspaceId?: string; documentPathRel?: string } = {}
) {
  const view = editor.view;
  try {
    const html = normalizeRenderedHtmlForWysiwyg(await renderMarkdownToHtml(markdown), options);
    const container = document.createElement("div");
    container.innerHTML = splitTaskListItemsForParsing(html);
    const parsedDoc = ProseMirrorDOMParser.fromSchema(view.state.schema).parse(container);
    const slice = parsedDoc.slice(0, parsedDoc.content.size);
    const transaction = view.state.tr.replaceSelection(slice);
    transaction.setMeta("noliaUserEdit", true);
    view.dispatch(transaction.scrollIntoView());
    view.focus();
  } catch {
    const transaction = view.state.tr.insertText(markdown).scrollIntoView();
    transaction.setMeta("noliaUserEdit", true);
    view.dispatch(transaction);
    view.focus();
  }
}

function queueTaskDomTextRestore(editor: Editor, markdown: string, onChange?: (value: string) => void) {
  restoreTaskDomTextFromMarkdown(editor, markdown);
  onChange?.(editor.view.dom.innerHTML);
  window.requestAnimationFrame(() => {
    restoreTaskDomTextFromMarkdown(editor, markdown);
    onChange?.(editor.view.dom.innerHTML);
  });
}

function restoreTaskDomTextFromMarkdown(editor: Editor, markdown: string) {
  const tasks = taskItemsFromMarkdown(markdown);
  if (!tasks.some((task) => task.text)) {
    return;
  }
  const items = Array.from(editor.view.dom.querySelectorAll<HTMLElement>("li[data-checked]"));
  items.forEach((item, index) => {
    const text = tasks[index]?.text ?? "";
    if (!text || item.textContent?.replace(/\u200b/g, "").trim()) {
      return;
    }
    const paragraph = item.querySelector("div p") ?? item.querySelector("p");
    if (paragraph) {
      paragraph.textContent = text;
    }
  });
}

function restoreTaskTextFromMarkdown(editor: Editor, markdown: string) {
  const tasks = taskItemsFromMarkdown(markdown);
  if (!tasks.some((task) => task.text)) {
    return;
  }
  const { state, view } = editor;
  let taskIndex = 0;
  let offset = 0;
  let transaction = state.tr;
  state.doc.descendants((node, position) => {
    if (node.type.name !== "taskItem") {
      return;
    }
    const task = tasks[taskIndex];
    taskIndex += 1;
    if (!task?.text || node.textContent.replace(/\u200b/g, "").trim()) {
      return;
    }
    const insertAt = position + 2 + offset;
    transaction = transaction.insertText(task.text, insertAt);
    offset += task.text.length;
  });
  if (transaction.docChanged) {
    view.dispatch(transaction);
  }
}

function taskItemsFromMarkdown(markdown: string): Array<{ checked: boolean; text: string }> {
  return [...markdown.matchAll(/^[ \t]*[-+*]\s+\[([ xX])]\s*(.*)$/gm)].map((match) => ({
    checked: match[1].toLowerCase() === "x",
    text: match[2].trim()
  }));
}

function splitTaskListItemsForParsing(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("ul[data-type='taskList']").forEach((list) => {
    const items = Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement);
    if (items.length <= 1) {
      return;
    }
    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const nextList = document.createElement("ul");
      nextList.dataset.type = "taskList";
      if (list.className) {
        nextList.className = list.className;
      }
      nextList.append(simplifiedTaskItemForParsing(item));
      fragment.append(nextList);
    });
    list.replaceWith(fragment);
  });
  return template.innerHTML;
}

function simplifiedTaskItemForParsing(item: HTMLLIElement): HTMLLIElement {
  const clone = item.cloneNode(true) as HTMLLIElement;
  clone.querySelectorAll("input[type='checkbox'], label").forEach((node) => node.remove());
  clone.querySelectorAll(":scope > div").forEach((node) => node.replaceWith(...Array.from(node.childNodes)));
  return clone;
}

function isEmptyEditorDocument(state: EditorState): boolean {
  return !state.doc.textContent.trim();
}

function shouldReplaceDocumentOnPaste(view: EditorView): boolean {
  return isEmptyEditorDocument(view.state) || isFullDocumentSelection(view);
}

function looksLikeMarkdownPlainText(value: string): boolean {
  const text = value.trim();
  if (!text) {
    return false;
  }
  return [
    /^#{1,6}\s+\S/m,
    /^[-+*]\s+\[[ xX]\]\s+\S/m,
    /^[-+*]\s+\S/m,
    /^\d+[.)]\s+\S/m,
    /^>\s?/m,
    /^(```|~~~)/m,
    /^\|.+\|\s*$/m,
    /^[-*_]{3,}\s*$/m,
    /^!\[[^\]]*]\([^)]+\)/m,
    /\[[^\]]+]\([^)]+\)/,
    /\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|==[^=\n]+?==|`[^`\n]+?`/,
    /(^|\n)\$\$\s*(\n|$)/,
    /\$[^$\n]+?\$/
  ].some((pattern) => pattern.test(text));
}

function looksLikeNoliaNoteRichHtml(value: string): boolean {
  return /\bdata-nolia-clipboard=["']true["']/.test(value) || /\bdata-type=["'](?:taskList|taskItem|markdown-preview-block|markdown-inline|inline-math|math-block)["']/.test(value);
}

function markdownFromNoliaNoteRichHtml(value: string): string | undefined {
  const template = document.createElement("template");
  template.innerHTML = value;
  const payload = template.content.querySelector<HTMLElement>("[data-nolia-clipboard='true'][data-markdown]");
  return payload?.dataset.markdown;
}

function elementFromEventTarget(target: EventTarget | null): Element | undefined {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement ?? undefined;
  }
  return undefined;
}

function recentCodeSelection(selection: { position: number; updatedAt: number } | undefined): number | undefined {
  if (!selection || nowMs() - selection.updatedAt > 1000) {
    return undefined;
  }
  return selection.position;
}

function firstTextNode(element: HTMLElement): Text | undefined {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  return node instanceof Text ? node : undefined;
}

function caretRangeFromPoint(documentRef: Document, clientX: number, clientY: number): { node: Node; offset: number } | undefined {
  const documentWithCaret = documentRef as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = documentWithCaret.caretPositionFromPoint?.(clientX, clientY);
  if (position) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = documentWithCaret.caretRangeFromPoint?.(clientX, clientY);
  return range ? { node: range.startContainer, offset: range.startOffset } : undefined;
}

function codePositionForEnter(view: EditorView): number | undefined {
  const domSelection = view.root instanceof Document ? view.root.getSelection() : window.getSelection();
  const anchorNode = domSelection?.anchorNode;
  if (domSelection && anchorNode && view.dom.contains(anchorNode)) {
    const anchorElement = anchorNode.nodeType === Node.ELEMENT_NODE ? (anchorNode as Element) : anchorNode.parentElement;
    if (!anchorElement?.closest("pre code")) {
      syncSelectionFromDom(view, anchorNode, domSelection.anchorOffset);
      return undefined;
    }

    try {
      const rawPos = view.posAtDOM(anchorNode, domSelection.anchorOffset, -1);
      return nearestCodeBlockTextPosition(view.state, rawPos);
    } catch {
      return undefined;
    }
  }

  const pmSelection = view.state.selection;
  if (pmSelection.$from.parent.type.name === "codeBlock" && pmSelection.$from.sameParent(pmSelection.$to)) {
    return pmSelection.from;
  }

  return undefined;
}

function syncSelectionFromDom(view: EditorView, anchorNode: Node, anchorOffset: number) {
  try {
    const rawPos = view.posAtDOM(anchorNode, anchorOffset, 1);
    const clamped = Math.max(0, Math.min(rawPos, view.state.doc.content.size));
    const current = view.state.selection;
    if (current.from === clamped && current.to === clamped) {
      return;
    }
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, clamped)));
  } catch {
    // Let ProseMirror fall back to its current selection if the DOM position cannot be mapped.
  }
}

function nearestCodeBlockTextPosition(state: EditorState, rawPos: number): number | undefined {
  const range = codeBlockTextRangeAround(state, rawPos);
  if (range) {
    return Math.max(range.from, Math.min(rawPos, range.to));
  }
  return undefined;
}

function codeBlockTextRangeAround(state: EditorState, rawPos: number): { from: number; to: number } | undefined {
  const maxPos = state.doc.content.size;
  for (const pos of [rawPos, rawPos - 1, rawPos + 1]) {
    const clamped = Math.max(0, Math.min(pos, maxPos));
    const resolved = state.doc.resolve(clamped);
    if (resolved.parent.type.name === "codeBlock") {
      return { from: resolved.start(), to: resolved.end() };
    }
  }
  let fallback: number | undefined;
  state.doc.descendants((node, pos) => {
    if (fallback !== undefined || node.type.name !== "codeBlock") {
      return;
    }
    const start = pos + 1;
    const end = pos + node.nodeSize - 1;
    if (rawPos >= start - 1 && rawPos <= end + 1) {
      fallback = pos;
    }
  });
  if (fallback === undefined) {
    return undefined;
  }
  const node = state.doc.nodeAt(fallback);
  if (!node) {
    return undefined;
  }
  return { from: fallback + 1, to: fallback + node.nodeSize - 1 };
}

function mathBlockPositionForEnter(view: EditorView): { from: number; to: number } | undefined {
  const mathBlock = view.state.schema.nodes.mathBlock;
  const selection = view.state.selection;
  if (!mathBlock || !selection.empty || selection.$from.parent.type.name !== "paragraph") {
    return undefined;
  }
  const beforeCursor = selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, "\ufffc");
  const afterCursor = selection.$from.parent.textBetween(selection.$from.parentOffset, selection.$from.parent.content.size, undefined, "\ufffc");
  if (beforeCursor.trim() !== "$$" || afterCursor.trim()) {
    return undefined;
  }
  return { from: selection.$from.before(), to: selection.$from.after() };
}

function focusSelectedMarkdownNodeSource(view: EditorView): boolean {
  const selection = view.state.selection;
  if (!(selection instanceof NodeSelection)) {
    return false;
  }
  if (!["image", "inlineMath", "mathBlock", "markdownInline", "markdownPreviewBlock"].includes(selection.node.type.name)) {
    return false;
  }
  const nodeDom = view.nodeDOM(selection.from);
  if (!(nodeDom instanceof HTMLElement)) {
    return false;
  }
  const sourceControl = nodeDom.querySelector<HTMLInputElement | HTMLTextAreaElement>(".markdown-source-control");
  if (!sourceControl) {
    return false;
  }
  nodeDom.classList.add("is-editing");
  window.requestAnimationFrame(() => {
    sourceControl.focus({ preventScroll: true });
    sourceControl.setSelectionRange(sourceControl.value.length, sourceControl.value.length);
  });
  return true;
}

function insertCodeBlock(editor: NonNullable<ReturnType<typeof useEditor>>) {
  const { state, dispatch } = editor.view;
  const codeBlock = state.schema.nodes.codeBlock;
  if (!codeBlock) {
    return;
  }
  const currentRange = codeBlockRangeAtSelection(state);
  if (currentRange) {
    focusCodeBlockText(editor.view, currentRange, state.selection.from);
    return;
  }
  if (state.selection.empty && editor.chain().focus().setCodeBlock().run()) {
    const insertedRange = codeBlockRangeAtSelection(editor.view.state);
    if (insertedRange) {
      focusCodeBlockText(editor.view, insertedRange, editor.view.state.selection.from);
    }
    return;
  }
  const selectedText = state.doc.textBetween(state.selection.from, state.selection.to, "\n");
  const tr = state.tr.replaceSelectionWith(codeBlock.create(null, selectedText ? state.schema.text(selectedText) : undefined), false);
  const insertedRange = codeBlockRangeNearPosition(tr.doc, tr.selection.from);
  if (insertedRange) {
    const nextPos = Math.min(insertedRange.to - 1, insertedRange.from + 1 + selectedText.length);
    tr.setSelection(TextSelection.create(tr.doc, nextPos));
  }
  tr.setMeta("noliaUserEdit", true);
  dispatch(tr.scrollIntoView());
  focusCodeBlockText(editor.view, codeBlockRangeAtSelection(editor.view.state), editor.view.state.selection.from);
}

function focusCodeBlockText(view: EditorView, range: { from: number; to: number } | undefined, preferredPosition: number) {
  if (!range) {
    view.focus();
    return;
  }
  const position = Math.max(range.from + 1, Math.min(preferredPosition, range.to - 1));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)).scrollIntoView());
  view.focus();
}

function codeBlockRangeNearPosition(doc: ProseMirrorNode, position: number): { from: number; to: number; node: ProseMirrorNode } | undefined {
  let match: { from: number; to: number; node: ProseMirrorNode } | undefined;
  doc.descendants((node, pos) => {
    if (match || node.type.name !== "codeBlock") {
      return false;
    }
    const from = pos;
    const to = pos + node.nodeSize;
    if (position >= from - 1 && position <= to + 1) {
      match = { from, to, node };
      return false;
    }
    return true;
  });
  return match;
}

function insertMathBlockAndFocus(editor: NonNullable<ReturnType<typeof useEditor>>, latex: string) {
  const { state } = editor.view;
  const insertAt = state.selection.from;
  const inserted = editor.chain().focus().insertMathBlock(latex).run();
  if (!inserted) {
    return;
  }
  focusMathBlockInput(editor.view, insertAt);
}

function focusMathBlockInput(view: EditorView, position: number) {
  window.requestAnimationFrame(() => {
    const node = view.nodeDOM(position);
    const input =
      (node instanceof Element ? node.querySelector<HTMLTextAreaElement>(".math-block-input") : undefined) ??
      Array.from(view.dom.querySelectorAll<HTMLTextAreaElement>(".math-block-input")).at(-1);
    input?.closest(".math-block")?.classList.add("is-editing");
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
  });
}

function toggleListOrInsert(editor: NonNullable<ReturnType<typeof useEditor>>, kind: "bullet" | "ordered" | "task") {
  const command =
    kind === "bullet"
      ? editor.chain().focus().toggleBulletList()
      : kind === "ordered"
        ? editor.chain().focus().toggleOrderedList()
        : editor.chain().focus().toggleTaskList();
  const changed = command.run();
  if (changed && (editor.isActive("bulletList") || editor.isActive("orderedList") || editor.isActive("taskList"))) {
    return;
  }
  const content =
    kind === "ordered"
      ? { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] }
      : kind === "task"
        ? { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] }
        : { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] };
  editor.chain().focus().insertContent(content).run();
}

function insertTaskCheckbox(editor: NonNullable<ReturnType<typeof useEditor>>) {
  editor
    .chain()
    .focus()
    .insertContent({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph" }]
        }
      ]
    })
    .run();
}

function openLinkDialog(
  editor: NonNullable<ReturnType<typeof useEditor>>,
  setText: (value: string) => void,
  setHref: (value: string) => void,
  setRange: (value: LinkRange) => void,
  setOpen: (value: boolean) => void
) {
  const selection = editor.state.selection;
  const activeRange = linkRangeAtPosition(editor.state, selection.from) ?? { from: selection.from, to: selection.to };
  const selected = activeRange.from === activeRange.to ? "" : editor.state.doc.textBetween(activeRange.from, activeRange.to, " ");
  setText(selected);
  setHref(linkHrefAtRange(editor.state, activeRange) || editor.getAttributes("link").href || "");
  setRange(activeRange);
  setOpen(true);
}

function openLinkSourceEditorAtPosition(
  view: EditorView,
  position: number,
  anchor: Element,
  ariaLabel: string
): boolean {
  const range = linkRangeAtPosition(view.state, position) ?? linkRangeFromAnchor(view, anchor);
  if (!range) {
    return false;
  }
  const href = linkHrefAtRange(view.state, range) || anchor.getAttribute("href") || "";
  const labelMarkdown = inlineMarkdownFromFragment(view.state.doc.slice(range.from, range.to).content, { excludedMarks: new Set(["link"]) });
  showMarkdownSourceEditor(view, {
    sourceType: "link",
    ...inlineMarkdownSourcePlacement("link", ariaLabel, range.from, range.to),
    range,
    markdown: linkMarkdown(labelMarkdown, href)
  }, range);
  return true;
}

function linkPositionFromPointer(view: EditorView, event: MouseEvent): number | undefined {
  return view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
}

function linkRangeFromAnchor(view: EditorView, anchor: Element): LinkRange | undefined {
  const textNode = anchor instanceof HTMLElement ? firstTextNode(anchor) : undefined;
  try {
    const position = textNode
      ? view.posAtDOM(textNode, Math.min(textNode.textContent?.length ?? 0, 1), -1)
      : view.posAtDOM(anchor, 0, 1);
    return linkRangeAtPosition(view.state, position);
  } catch {
    return undefined;
  }
}

function linkRangeAtPosition(state: EditorState, position: number): LinkRange | undefined {
  const linkType = state.schema.marks.link;
  if (!linkType) {
    return undefined;
  }
  for (const candidate of [position, position - 1, position + 1]) {
    if (candidate < 0 || candidate > state.doc.content.size) {
      continue;
    }
    const resolved = state.doc.resolve(candidate);
    const parent = resolved.parent;
    const offset = resolved.parentOffset;
    const child = parent.childAfter(offset).node ?? parent.childBefore(offset).node;
    const linkMark = child?.marks.find((mark) => mark.type === linkType);
    if (!linkMark) {
      continue;
    }
    let from = candidate;
    let to = candidate;
    while (from > resolved.start()) {
      const before = state.doc.resolve(from).nodeBefore;
      if (!before?.marks.some((mark) => mark.eq(linkMark))) {
        break;
      }
      from -= before.nodeSize;
    }
    while (to < resolved.end()) {
      const after = state.doc.resolve(to).nodeAfter;
      if (!after?.marks.some((mark) => mark.eq(linkMark))) {
        break;
      }
      to += after.nodeSize;
    }
    return { from, to };
  }
  return undefined;
}

function linkHrefAtRange(state: EditorState, range: LinkRange): string | undefined {
  const linkType = state.schema.marks.link;
  if (!linkType) {
    return undefined;
  }
  let href: string | undefined;
  state.doc.nodesBetween(range.from, range.to, (node) => {
    const mark = node.marks.find((item) => item.type === linkType);
    if (mark?.attrs.href) {
      href = String(mark.attrs.href);
      return false;
    }
    return undefined;
  });
  return href;
}

function applyLink(editor: NonNullable<ReturnType<typeof useEditor>>, range: LinkRange | undefined, text: string, href: string) {
  const { from, to } = range ?? editor.state.selection;
  if (from === to) {
    const label = text || href;
    editor.chain().focus().insertContentAt(from, { type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }).run();
    return;
  }
  if (text) {
    const linkType = editor.state.schema.marks.link;
    const transaction = editor.state.tr.replaceWith(from, to, editor.state.schema.text(text, linkType ? [linkType.create({ href })] : undefined));
    transaction.setMeta("noliaUserEdit", true);
    editor.view.dispatch(transaction.scrollIntoView());
    editor.view.focus();
    return;
  }
  editor.chain().focus().setTextSelection({ from, to }).setLink({ href }).run();
}

function unsetLink(editor: NonNullable<ReturnType<typeof useEditor>>, range: LinkRange | undefined) {
  if (range) {
    editor.chain().focus().setTextSelection(range).unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").unsetLink().run();
}

function linkMarkdown(text: string, href: string): string {
  const label = normalizeEditableInlineMarkdown(text).replace(/]/g, "\\]");
  const destination = normalizeEditableInlineMarkdown(href).replace(/\)/g, "%29");
  return `[${label}](${destination})`;
}

async function applyLinkSource(editor: NonNullable<ReturnType<typeof useEditor>>, state: LinkSourceEditorState) {
  const parsed = parseLinkMarkdown(state.markdown);
  if (!parsed) {
    editor.view.focus();
    return;
  }
  const linkType = editor.state.schema.marks.link;
  if (!linkType) {
    editor.view.focus();
    return;
  }
  const content = await inlineFragmentFromMarkdown(editor.state.schema, parsed.text);
  const transaction = editor.state.tr.replaceWith(state.range.from, state.range.to, markInlineFragment(content, linkType.create({ href: parsed.href })));
  transaction.setMeta("noliaUserEdit", true);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function parseLinkMarkdown(markdown: string): { text: string; href: string } | undefined {
  const match = markdown.trim().match(/^\[([^\]\n]*(?:\\][^\]\n]*)*)]\(([\s\S]+?)\)$/);
  if (!match) {
    return undefined;
  }
  const text = (match[1] ?? "").replace(/\\]/g, "]");
  let href = (match[2] ?? "").trim();
  const titleMatch = href.match(/\s+("((?:\\"|[^"])*)"|'((?:\\'|[^'])*)'|\(([^()]*)\))\s*$/);
  if (titleMatch && typeof titleMatch.index === "number") {
    href = href.slice(0, titleMatch.index).trim();
  }
  if (href.startsWith("<") && href.endsWith(">")) {
    href = href.slice(1, -1).trim();
  }
  return text && href
    ? {
        text: normalizeEditableInlineMarkdown(text),
        href: normalizeEditableInlineMarkdown(href)
      }
    : undefined;
}

function openMarkdownSyntaxSourceEditorAtPosition(
  view: EditorView,
  position: number,
  ariaLabel: string,
  target?: Element,
  event?: MouseEvent
): boolean {
  const inlineSource = inlineSyntaxSourceAtPosition(view, position, ariaLabel, target, event);
  if (inlineSource) {
    showMarkdownSourceEditor(view, { sourceType: "syntax", ...inlineSource }, inlineSource.range);
    return true;
  }
  const blockSource = blockSyntaxSourceAtPosition(view, position, ariaLabel);
  if (!blockSource) {
    return false;
  }
  const selectionRange = blockSourceSelectionRange(view.state, blockSource);
  const selectionPosition = firstTextSelectionPositionInRange(view.state, selectionRange.from, selectionRange.to);
  showMarkdownSourceEditor(view, { sourceType: "syntax", ...blockSource }, { from: selectionPosition });
  return true;
}

function blockSourceSelectionRange(state: EditorState, source: BlockSyntaxSourceEditorState): { from: number; to: number } {
  if (source.kind !== "list") {
    return source.range;
  }
  const listNode = state.doc.nodeAt(source.range.from);
  if (!listNode || !["bulletList", "orderedList", "taskList"].includes(listNode.type.name)) {
    return source.range;
  }
  const itemIndex = clampInteger(source.listItemIndex ?? 0, 0, Math.max(0, listNode.childCount - 1));
  let offset = source.range.from + 1;
  for (let index = 0; index < itemIndex; index += 1) {
    offset += listNode.child(index).nodeSize;
  }
  const item = listNode.child(itemIndex);
  return { from: offset, to: offset + item.nodeSize };
}

function firstTextSelectionPositionInRange(state: EditorState, from: number, to: number): number {
  let position: number | undefined;
  state.doc.nodesBetween(from, to, (node, nodePosition) => {
    if (position === undefined && node.isTextblock) {
      position = nodePosition + 1;
      return false;
    }
    return position === undefined ? undefined : false;
  });
  return Math.max(0, Math.min(position ?? from + 1, state.doc.content.size));
}

function inlineSyntaxSourceAtPosition(view: EditorView, position: number, ariaLabel: string, target?: Element, event?: MouseEvent): InlineSyntaxSourceEditorState | undefined {
  const targetKind = target ? inlineSyntaxKindFromTarget(target, event) : undefined;
  const targetPosition = target && targetKind ? inlineSyntaxPositionFromTarget(view, target, event) : undefined;
  const range = inlineSyntaxRangeAtPosition(view.state, position) ?? (targetPosition !== undefined ? inlineSyntaxRangeAtPosition(view.state, targetPosition) : undefined);
  if (!range) {
    return undefined;
  }
  if (targetKind && targetKind !== range.kind) {
    return undefined;
  }
  if (target && !targetKind && !targetMatchesInlineSyntaxKind(target, range.kind, event)) {
    return undefined;
  }
  const markdown = markdownForInlineSyntaxSource(range.kind, view.state.doc.slice(range.from, range.to).content);
  return {
    ...inlineMarkdownSourcePlacement(`syntax-${range.kind}`, ariaLabel, range.from, range.to),
    kind: range.kind,
    range,
    markdown
  };
}

function inlineSyntaxKindFromTarget(target: Element, event?: MouseEvent): InlineSyntaxKind | undefined {
  const hitTarget = event ? target.ownerDocument.elementFromPoint(event.clientX, event.clientY) : undefined;
  for (const candidate of [hitTarget, target]) {
    if (!(candidate instanceof Element)) {
      continue;
    }
    if (candidate.closest("code:not(pre code)")) {
      return "code";
    }
    if (candidate.closest("strong, b")) {
      return "bold";
    }
    if (candidate.closest("em, i")) {
      return "italic";
    }
    if (candidate.closest("s, del")) {
      return "strike";
    }
    if (candidate.closest("mark")) {
      return "highlight";
    }
  }
  return undefined;
}

function inlineSyntaxPositionFromTarget(view: EditorView, target: Element, event?: MouseEvent): number | undefined {
  const syntaxElement = inlineSyntaxElementFromTarget(target, event);
  if (!syntaxElement) {
    return undefined;
  }
  const caret = event ? caretRangeFromPoint(syntaxElement.ownerDocument, event.clientX, event.clientY) : undefined;
  try {
    if (caret && syntaxElement.contains(caret.node)) {
      return view.posAtDOM(caret.node, caret.offset, -1);
    }
    const textNode = firstTextNode(syntaxElement);
    if (textNode) {
      return view.posAtDOM(textNode, Math.min(textNode.textContent?.length ?? 0, 1), -1);
    }
    return view.posAtDOM(syntaxElement, 0, 1);
  } catch {
    return undefined;
  }
}

function inlineSyntaxElementFromTarget(target: Element, event?: MouseEvent): HTMLElement | undefined {
  const hitTarget = event ? target.ownerDocument.elementFromPoint(event.clientX, event.clientY) : undefined;
  for (const candidate of [hitTarget, target]) {
    if (!(candidate instanceof Element)) {
      continue;
    }
    const element = candidate.closest<HTMLElement>("code:not(pre code), strong, b, em, i, s, del, mark");
    if (element) {
      return element;
    }
  }
  return undefined;
}

function targetMatchesInlineSyntaxKind(target: Element, kind: InlineSyntaxKind, event?: MouseEvent): boolean {
  const selectors: Record<InlineSyntaxKind, string> = {
    bold: "strong, b",
    italic: "em, i",
    strike: "s, del",
    code: "code:not(pre code)",
    highlight: "mark"
  };
  const hitTarget = event ? target.ownerDocument.elementFromPoint(event.clientX, event.clientY) : undefined;
  return [hitTarget, target].some((candidate) => candidate instanceof Element && candidate.closest(selectors[kind]) !== null);
}

function inlineSyntaxRangeAtPosition(state: EditorState, position: number): (LinkRange & { kind: InlineSyntaxKind }) | undefined {
  const markOrder: InlineSyntaxKind[] = ["code", "bold", "italic", "strike", "highlight"];
  const candidates = [position, position - 1, position + 1];
  for (const candidate of candidates) {
    if (candidate < 0 || candidate > state.doc.content.size) {
      continue;
    }
    const resolved = state.doc.resolve(candidate);
    const start = resolved.start();
    const end = resolved.end();
    const adjacentMarks = [...(resolved.nodeAfter?.marks ?? []), ...(resolved.nodeBefore?.marks ?? [])];
    for (const kind of markOrder) {
      const markType = state.schema.marks[kind];
      const mark = markType ? adjacentMarks.find((item) => item.type === markType) : undefined;
      if (!mark) {
        continue;
      }
      let from = candidate;
      let to = candidate;
      while (from > start) {
        const before = state.doc.resolve(from).nodeBefore;
        if (!before?.marks.some((item) => item.eq(mark))) {
          break;
        }
        from -= before.nodeSize;
      }
      while (to < end) {
        const after = state.doc.resolve(to).nodeAfter;
        if (!after?.marks.some((item) => item.eq(mark))) {
          break;
        }
        to += after.nodeSize;
      }
      if (from < to) {
        return { kind, from, to };
      }
    }
  }
  return undefined;
}

function blockSyntaxSourceAtPosition(view: EditorView, position: number, ariaLabel: string): BlockSyntaxSourceEditorState | undefined {
  const resolved = view.state.doc.resolve(Math.max(0, Math.min(position, view.state.doc.content.size)));
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === "heading") {
      const range = { from: resolved.before(depth), to: resolved.after(depth) };
      return {
        ...blockMarkdownSourcePlacement("heading", ariaLabel, range.from + 1, range.to - 1, range.from + 1, "inline"),
        kind: "heading",
        range,
        markdown: `${"#".repeat(clampInteger(Number(node.attrs.level) || 1, 1, 6))} ${inlineMarkdownFromFragment(node.content)}`
      };
    }
    if (node.type.name === "blockquote") {
      const range = { from: resolved.before(depth), to: resolved.after(depth) };
      return {
        ...blockMarkdownSourcePlacement("blockquote", ariaLabel, range.from, range.to, range.from + 1, "node"),
        kind: "blockquote",
        range,
        markdown: markdownForBlockquoteSource(node)
      };
    }
    if (node.type.name === "listItem" || node.type.name === "taskItem") {
      const listDepth = depth - 1;
      if (listDepth <= 0) {
        continue;
      }
      const listNode = resolved.node(listDepth);
      if (!["bulletList", "orderedList", "taskList"].includes(listNode.type.name)) {
        continue;
      }
      const itemIndex = resolved.index(listDepth);
      const range = { from: resolved.before(listDepth), to: resolved.after(listDepth) };
      const itemRange = { from: resolved.before(depth), to: resolved.after(depth) };
      return {
        ...listMarkdownSourcePlacement(ariaLabel, itemRange.from, itemRange.to),
        kind: "list",
        range,
        listItemIndex: itemIndex,
        markdown: markdownForListItemSource(listNode, itemIndex)
      };
    }
  }
  return undefined;
}

function inlineMarkdownSourcePlacement(kind: string, ariaLabel: string, from: number, to: number): InlineMarkdownSourcePlacement {
  return {
    id: `${kind}-${from}-${to}`,
    ariaLabel,
    display: "inline",
    decorateType: "inline",
    decorateFrom: from,
    decorateTo: to,
    widgetAt: from
  };
}

function blockMarkdownSourcePlacement(
  kind: BlockSyntaxKind,
  ariaLabel: string,
  decorateFrom: number,
  decorateTo: number,
  widgetAt: number,
  decorateType: "inline" | "node"
): InlineMarkdownSourcePlacement {
  return {
    id: `syntax-${kind}-${decorateFrom}-${decorateTo}`,
    ariaLabel,
    display: "block",
    decorateType,
    decorateFrom: Math.max(0, decorateFrom),
    decorateTo: Math.max(0, decorateTo),
    widgetAt: Math.max(0, widgetAt)
  };
}

function listMarkdownSourcePlacement(ariaLabel: string, from: number, to: number): InlineMarkdownSourcePlacement {
  return {
    id: `syntax-list-${from}-${to}`,
    ariaLabel,
    display: "list",
    decorateType: "node",
    decorateFrom: from,
    decorateTo: to,
    widgetAt: from + 1
  };
}

function markdownForInlineSyntaxSource(kind: InlineSyntaxKind, fragment: Fragment): string {
  const inner = kind === "code" ? fragment.textBetween(0, fragment.size, "") : inlineMarkdownFromFragment(fragment, { excludedMarks: new Set([kind]) });
  switch (kind) {
    case "bold":
      return `**${inner}**`;
    case "italic":
      return `*${inner}*`;
    case "strike":
      return `~~${inner}~~`;
    case "code":
      return inlineCodeMarkdown(inner);
    case "highlight":
      return `==${inner}==`;
  }
}

function inlineCodeMarkdown(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  const padded = fence.length > 1 && (text.startsWith(" ") || text.endsWith(" ")) ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

function markdownForBlockquoteSource(node: ProseMirrorNode): string {
  const blocks = blockMarkdownLines(node);
  const lines = blocks.length ? blocks.flatMap((block, index) => (index === 0 ? block.split(/\n/) : ["", ...block.split(/\n/)])) : [""];
  return lines.map((line) => `> ${line}`).join("\n").trimEnd();
}

function markdownForListItemSource(listNode: ProseMirrorNode, itemIndex: number): string {
  const safeIndex = clampInteger(itemIndex, 0, Math.max(0, listNode.childCount - 1));
  const item = listNode.child(safeIndex);
  const text = markdownForListItemContent(item);
  if (listNode.type.name === "orderedList") {
    const start = Number(listNode.attrs.start) || 1;
    return `${start + safeIndex}. ${text}`;
  }
  if (listNode.type.name === "taskList") {
    return `- [${item.attrs.checked ? "x" : " "}] ${text}`;
  }
  return `- ${text}`;
}

function markdownForListItemContent(item: ProseMirrorNode): string {
  const blocks = blockMarkdownLines(item);
  return blocks.length ? blocks.join("\n  ") : "";
}

function blockMarkdownLines(node: ProseMirrorNode): string[] {
  const blocks: string[] = [];
  node.forEach((child) => {
    if (child.isTextblock) {
      blocks.push(inlineMarkdownFromFragment(child.content));
      return;
    }
    if (child.type.name === "bulletList" || child.type.name === "orderedList" || child.type.name === "taskList") {
      blocks.push(markdownForNestedList(child));
      return;
    }
    if (child.type.name === "blockquote") {
      blocks.push(markdownForBlockquoteSource(child));
      return;
    }
    if (child.type.name === "codeBlock") {
      blocks.push(fencedMarkdownForCodeBlock(child));
      return;
    }
    if (child.type.name === "mathBlock" || child.type.name === "markdownPreviewBlock") {
      blocks.push(String(child.attrs.markdown ?? child.textContent ?? ""));
      return;
    }
    if (child.isInline) {
      blocks.push(inlineMarkdownFromFragment(Fragment.from(child)));
    }
  });
  return blocks.map((block) => block.trimEnd()).filter((block) => block.length > 0);
}

function markdownForNestedList(listNode: ProseMirrorNode): string {
  const orderedStart = Number(listNode.attrs.start) || 1;
  const markerFor = (index: number, item: ProseMirrorNode) => {
    if (listNode.type.name === "orderedList") {
      return `${orderedStart + index}.`;
    }
    if (listNode.type.name === "taskList") {
      return `- [${item.attrs.checked ? "x" : " "}]`;
    }
    return "-";
  };
  const lines: string[] = [];
  listNode.forEach((item, _offset, index) => {
    const itemBlocks = blockMarkdownLines(item);
    const [firstBlock = "", ...restBlocks] = itemBlocks;
    lines.push(`${markerFor(index, item)} ${firstBlock}`.trimEnd());
    restBlocks.forEach((block) => {
      block.split(/\n/).forEach((line) => lines.push(`  ${line}`));
    });
  });
  return lines.join("\n");
}

function fencedMarkdownForCodeBlock(node: ProseMirrorNode): string {
  const language = normalizeCodeBlockLanguage(typeof node.attrs.language === "string" ? node.attrs.language : "");
  return `\`\`\`${language ? codeFenceLanguageForCodeBlock(language) : ""}\n${node.textContent.trimEnd()}\n\`\`\``;
}

type InlineMarkdownOptions = {
  excludedMarks?: ReadonlySet<string>;
};

function inlineMarkdownFromFragment(fragment: Fragment, options: InlineMarkdownOptions = {}): string {
  const schema = schemaForFragment(fragment);
  if (!schema) {
    return "";
  }
  const source = options.excludedMarks?.size ? removeMarksFromFragment(fragment, options.excludedMarks) : fragment;
  const container = document.createElement("p");
  container.append(DOMSerializer.fromSchema(schema).serializeFragment(source));
  return normalizeEditableInlineMarkdown(htmlToMarkdownSync(container.outerHTML).trim());
}

function normalizeEditableInlineMarkdown(markdown: string): string {
  let result = "";
  let start = 0;
  const codeSpanPattern = /(`+)([\s\S]*?)\1/g;
  for (const match of markdown.matchAll(codeSpanPattern)) {
    result += normalizeEscapedUrlPunctuation(markdown.slice(start, match.index));
    result += match[0];
    start = (match.index ?? 0) + match[0].length;
  }
  return result + normalizeEscapedUrlPunctuation(markdown.slice(start));
}

function normalizeEscapedUrlPunctuation(value: string): string {
  return value.replace(/\b[A-Za-z][A-Za-z0-9+.-]{1,31}\\*:[^\s<>()\]]*/g, (url) => url.replace(/\\+([/:])/g, "$1"));
}

function schemaForFragment(fragment: Fragment): Schema | undefined {
  let schema: Schema | undefined;
  fragment.forEach((node) => {
    schema ??= node.type.schema;
  });
  return schema;
}

function removeMarksFromFragment(fragment: Fragment, excludedMarks: ReadonlySet<string>): Fragment {
  return Fragment.fromArray(fragmentToNodes(fragment).map((node) => removeMarksFromNode(node, excludedMarks)));
}

function removeMarksFromNode(node: ProseMirrorNode, excludedMarks: ReadonlySet<string>): ProseMirrorNode {
  const marks = node.marks.filter((mark) => !excludedMarks.has(mark.type.name));
  if (node.isText) {
    return node.mark(marks);
  }
  const content = node.content.size ? removeMarksFromFragment(node.content, excludedMarks) : node.content;
  return node.copy(content).mark(marks);
}

async function inlineFragmentFromMarkdown(schema: Schema, markdown: string): Promise<Fragment> {
  const nodes = await blockNodesFromMarkdown(schema, markdown || "\u200b");
  const fragments: Fragment[] = [];
  nodes.forEach((node) => {
    if (node.isTextblock) {
      fragments.push(node.content);
    } else if (node.isInline) {
      fragments.push(Fragment.from(node));
    }
  });
  const fragment = Fragment.fromArray(fragments.flatMap(fragmentToNodes));
  return markdown ? fragment : Fragment.empty;
}

function markInlineFragment(fragment: Fragment, mark: Mark): Fragment {
  return Fragment.fromArray(
    fragmentToNodes(fragment).map((node) => {
      if (!node.isInline) {
        return node;
      }
      return node.mark(mark.addToSet(node.marks));
    })
  );
}

async function blockNodesFromMarkdown(schema: Schema, markdown: string): Promise<ProseMirrorNode[]> {
  const html = normalizeRenderedHtmlForWysiwyg(await renderMarkdownToHtml(markdown || "\u200b"));
  const container = document.createElement("div");
  container.innerHTML = splitTaskListItemsForParsing(html);
  const doc = ProseMirrorDOMParser.fromSchema(schema).parse(container);
  return fragmentToNodes(doc.content);
}

function fragmentToNodes(fragment: Fragment): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => nodes.push(node));
  return nodes;
}

async function applyMarkdownSyntaxSource(editor: NonNullable<ReturnType<typeof useEditor>>, state: MarkdownSyntaxSourceEditorState) {
  if (isBlockSyntaxSourceEditorState(state)) {
    await applyBlockSyntaxSource(editor, state);
    return;
  }
  await applyInlineSyntaxSource(editor, state);
}

function isBlockSyntaxSourceEditorState(state: MarkdownSyntaxSourceEditorState): state is BlockSyntaxSourceEditorState {
  return state.kind === "heading" || state.kind === "blockquote" || state.kind === "list";
}

async function applyInlineSyntaxSource(editor: NonNullable<ReturnType<typeof useEditor>>, state: InlineSyntaxSourceEditorState) {
  if (state.markdown === markdownForInlineSyntaxSource(state.kind, editor.state.doc.slice(state.range.from, state.range.to).content)) {
    editor.view.focus();
    return;
  }
  const { from, to } = state.range;
  let transaction = editor.state.tr;
  if (!state.markdown.trim()) {
    transaction = transaction.delete(from, to);
  } else {
    transaction = transaction.replaceWith(from, to, await inlineFragmentFromMarkdown(editor.state.schema, state.markdown));
  }
  transaction.setMeta("noliaUserEdit", true);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

async function applyBlockSyntaxSource(editor: NonNullable<ReturnType<typeof useEditor>>, state: BlockSyntaxSourceEditorState) {
  if (state.kind === "heading") {
    await applyHeadingSyntaxSource(editor, state);
    return;
  }
  if (state.kind === "blockquote") {
    await applyBlockquoteSyntaxSource(editor, state);
    return;
  }
  await applyListSyntaxSource(editor, state);
}

async function applyHeadingSyntaxSource(editor: NonNullable<ReturnType<typeof useEditor>>, state: BlockSyntaxSourceEditorState) {
  const parsed = parseHeadingSyntaxMarkdown(state.markdown);
  const nodeType = parsed.level ? editor.state.schema.nodes.heading : editor.state.schema.nodes.paragraph;
  if (!nodeType) {
    return;
  }
  const content = await inlineFragmentFromMarkdown(editor.state.schema, parsed.text);
  const node = nodeType.create(parsed.level ? { level: parsed.level } : null, content.size ? content : undefined);
  const transaction = editor.state.tr.replaceWith(state.range.from, state.range.to, node);
  transaction.setMeta("noliaUserEdit", true);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function parseHeadingSyntaxMarkdown(markdown: string): { level?: number; text: string } {
  const value = markdown.trim();
  const match = value.match(/^(#{1,6})(?:\s+|$)([\s\S]*)$/);
  if (!match) {
    return { text: value };
  }
  return {
    level: match[1].length,
    text: match[2] ?? ""
  };
}

async function applyBlockquoteSyntaxSource(editor: NonNullable<ReturnType<typeof useEditor>>, state: BlockSyntaxSourceEditorState) {
  const parsed = parseBlockquoteSyntaxMarkdown(state.markdown);
  const paragraphType = editor.state.schema.nodes.paragraph;
  const blockquoteType = editor.state.schema.nodes.blockquote;
  if (!paragraphType || !blockquoteType) {
    return;
  }
  const node = parsed.isBlockquote
    ? blockquoteType.create(null, await blockNodesFromMarkdown(editor.state.schema, parsed.text))
    : paragraphType.create(null, await inlineFragmentFromMarkdown(editor.state.schema, parsed.text));
  const transaction = editor.state.tr.replaceWith(state.range.from, state.range.to, node);
  transaction.setMeta("noliaUserEdit", true);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function parseBlockquoteSyntaxMarkdown(markdown: string): { isBlockquote: boolean; text: string } {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  if (!lines.some((line) => line.trim())) {
    return { isBlockquote: false, text: "" };
  }
  const isBlockquote = lines.every((line) => !line.trim() || /^\s*>\s?/.test(line));
  if (!isBlockquote) {
    return { isBlockquote: false, text: markdown.trim() };
  }
  return {
    isBlockquote: true,
    text: lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n").trimEnd()
  };
}

type ParsedListSyntax =
  | { kind: "paragraph"; markdown: string }
  | { kind: "bullet"; markdown: string }
  | { kind: "ordered"; start: number; markdown: string }
  | { kind: "task"; checked: boolean; markdown: string };

async function applyListSyntaxSource(editor: NonNullable<ReturnType<typeof useEditor>>, state: BlockSyntaxSourceEditorState) {
  const listNode = editor.state.doc.nodeAt(state.range.from);
  if (!listNode || !["bulletList", "orderedList", "taskList"].includes(listNode.type.name)) {
    return;
  }
  const itemIndex = clampInteger(state.listItemIndex ?? 0, 0, Math.max(0, listNode.childCount - 1));
  const parsed = parseListSyntaxMarkdown(state.markdown);
  const replacement =
    parsed.kind === "paragraph"
      ? await listReplacementWithParagraph(editor.state.schema, listNode, itemIndex, parsed.markdown)
      : [await convertedListNode(editor.state.schema, listNode, itemIndex, parsed)];
  const transaction = editor.state.tr.replaceWith(state.range.from, state.range.to, Fragment.fromArray(replacement));
  transaction.setMeta("noliaUserEdit", true);
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

function parseListSyntaxMarkdown(markdown: string): ParsedListSyntax {
  const value = markdown.trim();
  const taskMatch = value.match(/^[-+*]\s+\[([ xX])]\s*([\s\S]*)$/);
  if (taskMatch) {
    return { kind: "task", checked: taskMatch[1].toLowerCase() === "x", markdown: taskMatch[2] ?? "" };
  }
  const bulletMatch = value.match(/^[-+*]\s*([\s\S]*)$/);
  if (bulletMatch) {
    return { kind: "bullet", markdown: bulletMatch[1] ?? "" };
  }
  const orderedMatch = value.match(/^(\d+)[.)]\s*([\s\S]*)$/);
  if (orderedMatch) {
    return { kind: "ordered", start: Number(orderedMatch[1]) || 1, markdown: orderedMatch[2] ?? "" };
  }
  return { kind: "paragraph", markdown: value };
}

async function listReplacementWithParagraph(schema: Schema, listNode: ProseMirrorNode, itemIndex: number, markdown: string): Promise<ProseMirrorNode[]> {
  const nodes: ProseMirrorNode[] = [];
  const beforeItems = childNodesBetween(listNode, 0, itemIndex);
  const afterItems = childNodesBetween(listNode, itemIndex + 1, listNode.childCount);
  if (beforeItems.length) {
    nodes.push(listNode.type.create(listNode.attrs, beforeItems));
  }
  nodes.push(schema.nodes.paragraph.create(null, await inlineFragmentFromMarkdown(schema, markdown)));
  if (afterItems.length) {
    nodes.push(listNode.type.create(listAttrsAfterSplit(listNode, itemIndex), afterItems));
  }
  return nodes;
}

async function convertedListNode(schema: Schema, listNode: ProseMirrorNode, itemIndex: number, parsed: Exclude<ParsedListSyntax, { kind: "paragraph" }>): Promise<ProseMirrorNode> {
  const listTypeName = parsed.kind === "ordered" ? "orderedList" : parsed.kind === "task" ? "taskList" : "bulletList";
  const itemTypeName = parsed.kind === "task" ? "taskItem" : "listItem";
  const listType = schema.nodes[listTypeName] ?? listNode.type;
  const itemType = schema.nodes[itemTypeName] ?? listNode.child(0)?.type;
  const nextItems: ProseMirrorNode[] = [];
  for (let index = 0; index < listNode.childCount; index += 1) {
    const item = listNode.child(index);
    const markdown = index === itemIndex ? parsed.markdown : markdownForListItemContent(item);
    const checked = parsed.kind === "task" ? (index === itemIndex ? parsed.checked : Boolean(item.attrs.checked)) : false;
    nextItems.push(await convertedListItem(schema, item, itemType, markdown, checked));
  }
  const attrs = parsed.kind === "ordered" ? { ...listNode.attrs, start: parsed.start } : null;
  return listType.create(attrs, nextItems);
}

async function convertedListItem(schema: Schema, item: ProseMirrorNode, itemType: ProseMirrorNode["type"], markdown: string, checked: boolean): Promise<ProseMirrorNode> {
  const attrs = itemType.name === "taskItem" ? { checked } : null;
  const content: ProseMirrorNode[] = [];
  let updatedFirstTextblock = false;
  const inlineContent = await inlineFragmentFromMarkdown(schema, markdown);
  item.forEach((child) => {
    if (!updatedFirstTextblock && child.isTextblock) {
      content.push(child.type.create(child.attrs, inlineContent.size ? inlineContent : undefined));
      updatedFirstTextblock = true;
      return;
    }
    content.push(child);
  });
  if (!updatedFirstTextblock) {
    content.unshift(schema.nodes.paragraph.create(null, inlineContent.size ? inlineContent : undefined));
  }
  return itemType.create(attrs, content);
}

function childNodesBetween(node: ProseMirrorNode, from: number, to: number): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  for (let index = from; index < to; index += 1) {
    children.push(node.child(index));
  }
  return children;
}

function listAttrsAfterSplit(listNode: ProseMirrorNode, itemIndex: number): Record<string, unknown> | null {
  if (listNode.type.name !== "orderedList") {
    return listNode.attrs;
  }
  const start = Number(listNode.attrs.start) || 1;
  return { ...listNode.attrs, start: start + itemIndex + 1 };
}

function IconButton({
  title,
  onClick,
  icon
}: {
  title: string;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      className="toolbar-icon-button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="toolbar-divider" aria-hidden="true" />;
}

function TableInsertDialog({
  dialog,
  onChange,
  onCancel,
  onSubmit
}: {
  dialog?: TableDialogState;
  onChange: (dialog: TableDialogState) => void;
  onCancel: () => void;
  onSubmit: (rows: number, columns: number) => void;
}) {
  const { tr } = useRendererI18n();
  if (!dialog) {
    return null;
  }
  const rows = clampInteger(dialog.rows, 1, 20);
  const columns = clampInteger(dialog.columns, 1, 10);
  return (
    <div
      className="table-popover"
      role="dialog"
      aria-label={tr("插入表格")}
      style={{ left: dialog.x, top: dialog.y }}
      tabIndex={-1}
      onBlur={(event) => {
        if (!containsRelatedTarget(event)) {
          onCancel();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      ref={(node) => node?.focus()}
    >
      <div className="table-picker-header">
        <span>{tr("插入表格")}</span>
        <strong>{rows} x {columns}</strong>
      </div>
      <div className="table-picker-grid table-grid-picker" style={{ gridTemplateColumns: "repeat(10, 1fr)" }}>
        {Array.from({ length: 80 }).map((_, index) => {
          const row = Math.floor(index / 10) + 1;
          const column = (index % 10) + 1;
          const selected = row <= rows && column <= columns;
          return (
            <button
              key={index}
              type="button"
              className={selected ? "is-selected" : ""}
              aria-label={`${row} x ${column}`}
              onMouseEnter={() => onChange({ ...dialog, rows: row, columns: column })}
              onFocus={() => onChange({ ...dialog, rows: row, columns: column })}
              onClick={() => onSubmit(row, column)}
            />
          );
        })}
      </div>
    </div>
  );
}

function TableOperationsMenu({
  editor,
  mode,
  open,
  position,
  onToggle,
  onClose,
  onResize,
  onAlign,
  onEditSource
}: {
  editor: Editor;
  mode: TableMenuMode;
  open: boolean;
  position: FloatingMenuState;
  onToggle: () => void;
  onClose: () => void;
  onResize: (rows: number, columns: number) => void;
  onAlign: (align: "left" | "center" | "right") => void;
  onEditSource: () => void;
}) {
  const { tr } = useRendererI18n();
  const dimensions = tableDimensionsAtSelection(editor.state) ?? { rows: 3, columns: 3 };
  const run = (action: () => void) => {
    restoreSelectionInsideActiveTableCell(editor.view);
    action();
    onClose();
  };
  const menuItems = (
    <>
      <button type="button" role="menuitem" onClick={() => run(onEditSource)}>
        {tr("编辑 Markdown 源码")}
      </button>
      <span className="context-menu-separator" />
      <button type="button" role="menuitem" onClick={() => run(() => editor.chain().focus().addColumnBefore().run())}>
        {tr("在左侧新增列")}
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => editor.chain().focus().addColumnAfter().run())}>
        {tr("在右侧新增列")}
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => editor.chain().focus().addRowBefore().run())}>
        {tr("在上方新增行")}
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => editor.chain().focus().addRowAfter().run())}>
        {tr("在下方新增行")}
      </button>
      <span className="context-menu-separator" />
      <button type="button" role="menuitem" onClick={() => run(() => editor.chain().focus().deleteColumn().run())}>
        {tr("删除列")}
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => editor.chain().focus().deleteRow().run())}>
        {tr("删除行")}
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => editor.chain().focus().deleteTable().run())}>
        {tr("删除表格")}
      </button>
      <span className="context-menu-separator" />
      <button type="button" role="menuitem" onClick={() => run(() => editor.chain().focus().toggleHeaderRow().run())}>
        {tr("切换表头行")}
      </button>
      <button type="button" role="menuitem" onClick={() => run(() => editor.chain().focus().toggleHeaderColumn().run())}>
        {tr("切换表头列")}
      </button>
    </>
  );
  if (mode === "context") {
    return (
      <div className="table-controls table-controls-context" style={{ left: position.x, top: position.y }} onMouseDown={(event) => event.preventDefault()}>
        <div className="table-menu table-context-menu" role="menu">
          {menuItems}
        </div>
      </div>
    );
  }
  return (
    <div className="table-controls" style={{ left: position.x, top: position.y }} onMouseDown={(event) => event.preventDefault()}>
      <div className="table-inline-toolbar" role="toolbar" aria-label={tr("表格操作")}>
        <button type="button" className="table-control-trigger" title={tr("表格操作")} aria-label={tr("表格操作")} onClick={onToggle}>
          <span aria-hidden="true">⠿</span>
        </button>
        <button type="button" className="table-tool-button" title={tr("左对齐")} aria-label={tr("左对齐")} onClick={() => run(() => onAlign("left"))}>
          <AlignLeft size={16} />
        </button>
        <button type="button" className="table-tool-button" title={tr("居中对齐")} aria-label={tr("居中对齐")} onClick={() => run(() => onAlign("center"))}>
          <AlignCenter size={16} />
        </button>
        <button type="button" className="table-tool-button" title={tr("右对齐")} aria-label={tr("右对齐")} onClick={() => run(() => onAlign("right"))}>
          <AlignRight size={16} />
        </button>
        <button type="button" className="table-tool-button" title={tr("删除表格")} aria-label={tr("删除表格")} onClick={() => run(() => editor.chain().focus().deleteTable().run())}>
          <Trash2 size={16} />
        </button>
      </div>
      {open ? (
        <div className="table-menu" role="menu">
          <TableResizePicker rows={dimensions.rows} columns={dimensions.columns} onPick={(rows, columns) => run(() => onResize(rows, columns))} />
          <span className="context-menu-separator" />
          {menuItems}
        </div>
      ) : null}
    </div>
  );
}

function TableResizePicker({ rows, columns, onPick }: { rows: number; columns: number; onPick: (rows: number, columns: number) => void }) {
  const { tr } = useRendererI18n();
  const maxRows = 10;
  const maxColumns = 10;
  const safeRows = clampInteger(rows, 1, maxRows);
  const safeColumns = clampInteger(columns, 1, maxColumns);
  const [preview, setPreview] = useState({ rows: safeRows, columns: safeColumns });
  useEffect(() => {
    setPreview({ rows: safeRows, columns: safeColumns });
  }, [safeRows, safeColumns]);
  const previewRows = clampInteger(preview.rows, 1, maxRows);
  const previewColumns = clampInteger(preview.columns, 1, maxColumns);
  return (
    <div className="table-resize-picker" aria-label={`${previewRows} x ${previewColumns}`} onMouseLeave={() => setPreview({ rows: safeRows, columns: safeColumns })}>
      <div className="table-picker-header">
        <span>{tr("表格大小")}</span>
        <strong>{previewRows} x {previewColumns}</strong>
      </div>
      <div className="table-resize-grid table-grid-picker" style={{ gridTemplateColumns: `repeat(${maxColumns}, 1fr)` }}>
        {Array.from({ length: maxRows * maxColumns }).map((_, index) => {
          const row = Math.floor(index / maxColumns) + 1;
          const column = (index % maxColumns) + 1;
          const selected = row <= previewRows && column <= previewColumns;
          const current = row <= safeRows && column <= safeColumns;
          return (
            <button
              key={index}
              type="button"
              className={`${selected ? "is-selected" : ""}${current ? " is-current" : ""}`}
              aria-label={`${row} x ${column}`}
              onMouseEnter={() => setPreview({ rows: row, columns: column })}
              onFocus={() => setPreview({ rows: row, columns: column })}
              onClick={() => onPick(row, column)}
            />
          );
        })}
      </div>
    </div>
  );
}

function CodeLanguageSelectControl({ state, onChange }: { state: CodeLanguageControlState; onChange: (language: string) => void }) {
  const { tr } = useRendererI18n();
  return (
    <div className="code-language-floating-control" style={{ left: state.x, top: state.y }}>
      <select
        className="code-language-select"
        value={state.language}
        title={tr("代码语言")}
        aria-label={tr("代码语言")}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange(event.target.value)}
      >
        {getCodeBlockLanguageSelectOptions(state.language, tr).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TableSourcePopover({
  state,
  onChange,
  onCancel,
  onSubmit
}: {
  state: TableSourceEditorState;
  onChange: (markdown: string) => void;
  onCancel: () => void;
  onSubmit: (markdown: string) => void;
}) {
  const { tr } = useRendererI18n();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submitCurrent = () => onSubmit(textareaRef.current?.value ?? state.markdown);
  return (
    <form
      className={`table-source-popover${state.error ? " has-source-error" : ""}`}
      role="dialog"
      aria-label={tr("表格 Markdown 源码")}
      style={{ left: state.x, top: state.y }}
      onSubmit={(event) => {
        event.preventDefault();
        submitCurrent();
      }}
      onBlur={(event) => {
        const popover = event.currentTarget;
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : undefined;
        if (nextTarget && popover.contains(nextTarget)) {
          return;
        }
        submitCurrent();
      }}
    >
      <label>
        <span>{tr("Markdown 表格源码")}</span>
        <textarea
          ref={textareaRef}
          className="table-source-textarea markdown-source-control"
          value={state.markdown}
          rows={tableSourceRows(state.markdown)}
          spellCheck={false}
          autoFocus
          aria-label={tr("表格 Markdown 源码")}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submitCurrent();
            }
          }}
        />
      </label>
      {state.error ? <p className="table-source-error">{state.error}</p> : null}
      <div className="table-source-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          {tr("取消")}
        </button>
        <button type="submit" className="primary-button" disabled={state.applying}>
          {tr("应用")}
        </button>
      </div>
    </form>
  );
}

function tableSourceRows(markdown: string): number {
  return Math.min(14, Math.max(5, markdown.split(/\r?\n/).length + 1));
}

function createAnchoredTableDialog(button: HTMLElement): TableDialogState {
  const buttonRect = button.getBoundingClientRect();
  const width = Math.min(260, Math.max(0, window.innerWidth - 96));
  const x = Math.max(12, Math.min(buttonRect.left + buttonRect.width / 2 - width / 2, window.innerWidth - width - 12));
  const y = Math.min(buttonRect.bottom + 8, window.innerHeight - 24);
  return { rows: 3, columns: 3, x, y };
}

function imageSrcFromMarkdown(markdown: string): string | undefined {
  return markdown.match(/!\[[^\]]*]\(([^)]+)\)/)?.[1];
}

function normalizeRenderedHtmlForWysiwyg(
  html: string,
  options: { workspaceId?: string; documentPathRel?: string } = {}
): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  const workspaceId = options.workspaceId;
  if (workspaceId) {
    template.content.querySelectorAll("img[src]").forEach((node) => {
      const image = node instanceof HTMLImageElement ? node : undefined;
      const source = image?.getAttribute("src") ?? undefined;
      const existingMarkdownSrc = image?.getAttribute("data-markdown-src") ?? undefined;
      const pathRel = source
        ? workspaceAssetPathFromImageSource(source, options.documentPathRel) ??
          (existingMarkdownSrc ? workspaceAssetPathFromImageSource(existingMarkdownSrc, options.documentPathRel) : undefined)
        : undefined;
      if (!image || !pathRel) {
        return;
      }
      image.dataset.markdownSrc = existingMarkdownSrc || pathRel;
      image.src = assetUrl(workspaceId, pathRel);
    });
  }

  template.content.querySelectorAll(".katex-display").forEach((node) => {
    const latex = node.querySelector("annotation[encoding='application/x-tex']")?.textContent?.trim();
    if (!latex) {
      return;
    }
    const replacement = document.createElement("div");
    replacement.dataset.type = "math-block";
    replacement.dataset.markdown = `$$\n${latex}\n$$`;
    replacement.dataset.latex = latex;
    replacement.className = "math-block";
    replacement.textContent = latex;
    node.replaceWith(replacement);
  });

  template.content.querySelectorAll(".katex").forEach((node) => {
    if (node.closest(".katex-display")) {
      return;
    }
    const latex = node.querySelector("annotation[encoding='application/x-tex']")?.textContent?.trim();
    if (!latex) {
      return;
    }
    const replacement = document.createElement("span");
    replacement.dataset.type = "inline-math";
    replacement.dataset.markdown = `$${latex}$`;
    replacement.dataset.latex = latex;
    replacement.className = "inline-math";
    replacement.textContent = latex;
    node.replaceWith(replacement);
  });

  template.content.querySelectorAll("a.wikilink[data-wikilink-target]").forEach((node) => {
    const element = node instanceof HTMLElement ? node : undefined;
    if (!element) {
      return;
    }
    const target = element.dataset.wikilinkTarget ?? "";
    const heading = element.dataset.wikilinkHeading ?? "";
    const label = element.textContent?.trim() || target;
    const targetWithHeading = heading ? `${target}#${heading}` : target;
    const markdown = label && label !== target ? `[[${targetWithHeading}|${label}]]` : `[[${targetWithHeading}]]`;
    element.replaceWith(createMarkdownInline("wikilink", markdown, label, element.getAttribute("href") ?? ""));
  });

  template.content.querySelectorAll("ul.contains-task-list").forEach((node) => {
    const list = node instanceof HTMLElement ? node : undefined;
    if (!list) {
      return;
    }
    normalizeMixedTaskList(list);
  });

  template.content.querySelectorAll("sup a[data-footnote-ref]").forEach((node) => {
    const anchor = node instanceof HTMLElement ? node : undefined;
    const wrapper = anchor?.closest("sup");
    if (!anchor || !wrapper) {
      return;
    }
    const label = footnoteLabelFromAnchor(anchor);
    wrapper.replaceWith(createMarkdownInline("footnote-ref", `[^${label}]`, label, anchor.getAttribute("href") ?? ""));
  });

  template.content.querySelectorAll(".callout").forEach((node) => {
    const element = node instanceof HTMLElement ? node : undefined;
    if (!element) {
      return;
    }
    element.replaceWith(createMarkdownPreviewBlock("callout", element.dataset.markdown || markdownForCallout(element), element.outerHTML));
  });

  template.content.querySelectorAll("dl").forEach((node) => {
    const element = node instanceof HTMLElement ? node : undefined;
    if (!element) {
      return;
    }
    element.replaceWith(createMarkdownPreviewBlock("definition-list", element.dataset.markdown || markdownForDefinitionList(element), element.outerHTML));
  });

  template.content.querySelectorAll("details").forEach((node) => {
    const element = node instanceof HTMLElement ? node : undefined;
    if (!element) {
      return;
    }
    element.replaceWith(createMarkdownPreviewBlock("html", element.outerHTML, element.outerHTML));
  });

  template.content.querySelectorAll(".mermaid").forEach((node) => {
    const element = node instanceof HTMLElement ? node : undefined;
    if (!element) {
      return;
    }
    const markdown = mermaidMarkdownFromElement(element);
    element.replaceWith(createMarkdownPreviewBlock("mermaid", markdown, element.outerHTML));
  });

  template.content.querySelectorAll(".footnotes").forEach((node) => {
    const element = node instanceof HTMLElement ? node : undefined;
    if (!element) {
      return;
    }
    element.replaceWith(createMarkdownPreviewBlock("footnotes", markdownForFootnotes(element), element.outerHTML));
  });

  return template.innerHTML;
}

function normalizeMixedTaskList(list: HTMLElement) {
  const items = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li");
  if (!items.length) {
    list.dataset.type = "taskList";
    return;
  }
  const containsNonTask = items.some((item) => !taskMarkerForListItem(item));
  if (!containsNonTask) {
    list.dataset.type = "taskList";
    items.forEach(normalizeTaskListItem);
    return;
  }

  const fragment = document.createDocumentFragment();
  let currentList: HTMLUListElement | undefined;
  let currentKind: "task" | "bullet" | undefined;
  const appendToList = (kind: "task" | "bullet", item: HTMLElement) => {
    if (!currentList || currentKind !== kind) {
      currentKind = kind;
      currentList = document.createElement("ul");
      currentList.className = kind === "task" ? list.className : list.className.replace(/\bcontains-task-list\b/g, "").trim();
      if (kind === "task") {
        currentList.dataset.type = "taskList";
      }
      fragment.append(currentList);
    }
    if (kind === "task") {
      normalizeTaskListItem(item);
    }
    currentList.append(item);
  };

  items.forEach((item) => appendToList(taskMarkerForListItem(item) ? "task" : "bullet", item));
  list.replaceWith(fragment);
}

function normalizeTaskListItem(taskItem: HTMLElement) {
  const marker = taskMarkerForListItem(taskItem);
  if (!marker) {
    return;
  }
  taskItem.dataset.type = "taskItem";
  taskItem.dataset.checked = marker.checked ? "true" : "false";
  const label = document.createElement("label");
  const normalizedCheckbox = document.createElement("input");
  normalizedCheckbox.type = "checkbox";
  normalizedCheckbox.checked = marker.checked;
  label.append(normalizedCheckbox, document.createElement("span"));
  const content = document.createElement("div");
  appendTaskItemContent(content, taskItem);
  taskItem.replaceChildren(label, content);
}

function taskMarkerForListItem(item: HTMLElement): { checked: boolean } | undefined {
  const checkbox = item.querySelector<HTMLInputElement>("input[type='checkbox']");
  const literalMarker = item.textContent?.match(/^\s*\[([ xX])]\s*/);
  if (!checkbox && !item.classList.contains("task-list-item") && !literalMarker) {
    return undefined;
  }
  return { checked: Boolean(checkbox?.checked || literalMarker?.[1]?.toLowerCase() === "x") };
}

function workspaceAssetPathFromImageSource(source: string, documentPathRel?: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed) {
    return undefined;
  }
  const internalAssetPath = assetPathFromNoliaNoteUrl(trimmed);
  if (internalAssetPath) {
    return internalAssetPath;
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(trimmed)) {
    return undefined;
  }
  const match = trimmed.match(/^([^?#]*)([?#][\s\S]*)?$/);
  const pathPart = match?.[1] ?? trimmed;
  const suffix = match?.[2] ?? "";
  const baseDir = dirnameRel(documentPathRel ?? "");
  const joinedPath = pathPart.startsWith("/") ? pathPart.slice(1) : [baseDir, pathPart].filter(Boolean).join("/");
  const normalizedPath = normalizeWorkspaceAssetPath(joinedPath);
  return normalizedPath ? `${decodeWorkspaceAssetPath(normalizedPath)}${suffix}` : undefined;
}

function assetPathFromNoliaNoteUrl(src: string): string | undefined {
  try {
    const url = new URL(src);
    if (url.protocol !== "nolia-asset:") {
      return undefined;
    }
    if (url.hostname === "external") {
      return url.searchParams.get("markdown") || undefined;
    }
    const segments = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    const assetSegments = url.hostname === "workspace" ? segments.slice(1) : segments;
    const assetPath = decodeWorkspaceAssetPath(assetSegments.join("/"));
    return assetPath ? `${assetPath}${url.search}${url.hash}` : undefined;
  } catch {
    const assetMatch = src.match(/^nolia-asset:\/\/[^/]+\/([^?#]+)([?#][\s\S]*)?$/);
    return assetMatch ? `${decodeWorkspaceAssetPath(assetMatch[1])}${assetMatch[2] ?? ""}` : undefined;
  }
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

function createMarkdownPreviewBlock(kind: string, markdown: string, html: string): HTMLElement {
  const block = document.createElement("div");
  block.dataset.type = "markdown-preview-block";
  block.dataset.kind = kind;
  block.dataset.markdown = markdown;
  block.className = `markdown-preview-block markdown-preview-block-${kind}`;
  block.innerHTML = html;
  return block;
}

function mermaidMarkdownFromElement(element: HTMLElement): string {
  const previewBlock = element.closest<HTMLElement>("[data-type='markdown-preview-block'][data-markdown]");
  return previewBlock?.dataset.markdown || element.dataset.markdown || `\`\`\`mermaid\n${element.textContent?.trimEnd() ?? ""}\n\`\`\``;
}

function createMarkdownInline(kind: string, markdown: string, label: string, href = ""): HTMLElement {
  const tag = kind === "footnote-ref" ? "sup" : "span";
  const inline = document.createElement(tag);
  inline.dataset.type = "markdown-inline";
  inline.dataset.kind = kind;
  inline.dataset.markdown = markdown;
  inline.dataset.label = label;
  inline.dataset.href = href;
  inline.className = `markdown-inline markdown-inline-${kind}`;
  inline.textContent = label || markdown;
  return inline;
}

function footnoteLabelFromAnchor(anchor: HTMLElement): string {
  const href = anchor.getAttribute("href") ?? "";
  const id = anchor.id || href;
  return id.match(/fn(?:ref)?-([A-Za-z0-9_-]+)/)?.[1] ?? anchor.textContent?.trim() ?? "1";
}

function trimLeadingWhitespace(element: HTMLElement) {
  while (element.firstChild?.nodeType === Node.TEXT_NODE && !element.firstChild.textContent?.trim()) {
    element.firstChild.remove();
  }
  if (element.firstChild?.nodeType === Node.TEXT_NODE) {
    element.firstChild.textContent = element.firstChild.textContent?.replace(/^\s+/, "") ?? "";
  }
}

function removeLeadingTaskMarker(element: HTMLElement) {
  const first = element.firstChild;
  if (first?.nodeType === Node.TEXT_NODE) {
    first.textContent = first.textContent?.replace(/^\s*\[[ xX]\]\s*/, "") ?? "";
    if (!first.textContent) {
      first.remove();
    }
  }
}

function appendTaskItemContent(content: HTMLElement, taskItem: HTMLElement) {
  const clone = taskItem.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input[type='checkbox'], label").forEach((node) => node.remove());
  trimLeadingWhitespace(clone);
  removeLeadingTaskMarker(clone);
  const children = Array.from(clone.childNodes).filter((child) => child.nodeType !== Node.TEXT_NODE || Boolean(child.textContent?.trim()));
  children.forEach((child) => {
    if (child instanceof HTMLElement && child.tagName.toLowerCase() === "div") {
      content.append(...Array.from(child.childNodes));
      return;
    }
    content.append(child);
  });
  if (content.childNodes.length === 0) {
    const paragraph = document.createElement("p");
    paragraph.append("");
    content.append(paragraph);
    return;
  }
  if (Array.from(content.childNodes).every((child) => child.nodeType === Node.TEXT_NODE)) {
    const paragraph = document.createElement("p");
    paragraph.append(...Array.from(content.childNodes));
    content.append(paragraph);
  }
}

function markdownForCallout(element: HTMLElement): string {
  const kind = (element.dataset.callout || "note").toUpperCase();
  const title = element.querySelector(".callout-title")?.textContent?.trim() || kind;
  const body = Array.from(element.querySelectorAll("p"))
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .map((line) => `> ${line}`)
    .join("\n");
  return body ? `> [!${kind}] ${title}\n${body}` : `> [!${kind}] ${title}`;
}

function markdownForDefinitionList(element: HTMLElement): string {
  const terms = Array.from(element.querySelectorAll("dt"));
  return terms
    .map((term) => {
      const definition = term.nextElementSibling?.tagName.toLowerCase() === "dd" ? term.nextElementSibling.textContent?.trim() : "";
      return `${term.textContent?.trim() ?? ""}\n: ${definition ?? ""}`;
    })
    .join("\n");
}

function markdownForFootnotes(element: HTMLElement): string {
  return Array.from(element.querySelectorAll("li"))
    .map((item, index) => {
      const label = footnoteDefinitionLabel(item, index + 1);
      const text = item.textContent?.replace(/↩|Back to reference \d+/g, "").trim() || "";
      return `[^${label}]: ${text}`;
    })
    .join("\n");
}

function footnoteDefinitionLabel(item: HTMLElement, fallback: number): string {
  return item.id.match(/fn-([A-Za-z0-9_-]+)/)?.[1] ?? String(fallback);
}

function assetUrl(workspaceId: string, pathRel: string): string {
  return `nolia-asset://workspace/${encodeURIComponent(workspaceId)}/${pathRel.split("/").map(encodeURIComponent).join("/")}`;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function nowMs(): number {
  return Date.now();
}
