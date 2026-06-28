/* eslint-disable react-hooks/exhaustive-deps -- Resource editors keep save handlers and parsed state in refs keyed by the active resource path. */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { redo, undo } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { defaultHighlightStyle, foldKeymap, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter, openLintPanel } from "@codemirror/lint";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate, WidgetType } from "@codemirror/view";
import {
  ArrowDownAZ,
  Braces,
  Bug,
  Eraser,
  FileCheck2,
  FileText,
  ListOrdered,
  Minimize2,
  Pilcrow,
  Redo2,
  RefreshCw,
  Search,
  TextCursorInput,
  Undo2,
  WrapText
} from "lucide-react";

import { formatFileSize as formatLocalizedFileSize, type Translator } from "../../shared/i18n";
import type { FileWriteResponse, ResolvedLocale } from "../../shared/types";
import { useRendererI18n } from "../app/i18n";
import { exactMatchIndex, findPlainTextMatches, nextMatchIndex, type FindReplaceOptions, type FindReplaceResult } from "./findReplace";

export type TextResourceInfo = {
  pathRel: string;
  name: string;
  size: number;
  initialText?: string;
  baseHash?: string;
  dirty?: boolean;
};

type ResourceEditorStatus = {
  tone: "ok" | "error" | "muted";
  label: string;
  detail: string;
};

type TextLanguageId = "plain" | "json" | "yaml" | "toml" | "xml" | "html" | "csv" | "javascript" | "typescript";
type JsonIndentValue = "2" | "4" | "tab";

type SelectionStats = {
  line: number;
  column: number;
  selectedChars: number;
};

const USER_ACTION_STATUS_PROTECT_MS = 1800;

export type TextResourceEditorProps = {
  resource: TextResourceInfo;
  workspaceId?: string;
  editorKind: "json" | "text";
  onDirtyChange: (pathRel: string, dirty: boolean) => void;
  onSaved: (pathRel: string, result: FileWriteResponse) => void;
  onStatus: (message: string) => void;
  onOpenFindReplace: () => void;
  onRegisterSaveHandler: (pathRel: string, handler: () => Promise<void>) => () => void;
};

export type TextResourceEditorHandle = {
  undoEdit: () => boolean;
  redoEdit: () => boolean;
  findText: (query: string, options?: FindReplaceOptions) => FindReplaceResult;
  replaceCurrent: (query: string, replacement: string, options?: FindReplaceOptions) => FindReplaceResult;
  replaceAll: (query: string, replacement: string, options?: FindReplaceOptions) => FindReplaceResult;
};

export const TextResourceEditor = forwardRef<TextResourceEditorHandle, TextResourceEditorProps>(function TextResourceEditor(
  { resource, workspaceId, editorKind, onDirtyChange, onSaved, onStatus, onOpenFindReplace, onRegisterSaveHandler },
  ref
) {
  const { tr, locale } = useRendererI18n();
  const initialLanguage = editorKind === "json" ? "json" : languageForPath(resource.pathRel);
  const [content, setContent] = useState(resource.initialText ?? "");
  const [language, setLanguage] = useState<TextLanguageId>(initialLanguage);
  const [indent, setIndent] = useState<JsonIndentValue>("2");
  const [wrap, setWrap] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [selectionStats, setSelectionStats] = useState<SelectionStats>({ line: 1, column: 1, selectedChars: 0 });
  const [status, setStatus] = useState<ResourceEditorStatus>(() => statusForContent(resource.initialText ?? "", initialLanguage, undefined, resource.pathRel, tr, locale));
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const contentRef = useRef(resource.initialText ?? "");
  const baseHashRef = useRef(resource.baseHash);
  const pendingDirtyNotificationRef = useRef(false);
  const userActionStatusProtectedUntilRef = useRef(0);
  const isJson = language === "json";
  const testId = editorKind === "json" ? "builtin-json-editor" : "builtin-text-editor";
  const toolbarLabel = editorKind === "json" ? tr("JSON 工具") : tr("文本工具");
  const editorLabel = editorKind === "json" ? tr("JSON 内容") : tr("文本内容");

  const setEditorContent = (nextContent: string, options?: { dirty?: boolean; status?: ResourceEditorStatus }) => {
    const changed = nextContent !== contentRef.current;
    if (!changed) {
      if (options?.status) {
        setStatus(options.status);
      }
      return;
    }
    contentRef.current = nextContent;
    setContent(nextContent);
    if (options?.dirty !== false) {
      pendingDirtyNotificationRef.current = true;
    }
    setStatus(options?.status ?? statusForContent(nextContent, language, tr("已修改"), resource.pathRel, tr, locale));
  };

  const setUserActionStatus = (nextStatus: ResourceEditorStatus, message: string) => {
    userActionStatusProtectedUntilRef.current = Date.now() + USER_ACTION_STATUS_PROTECT_MS;
    setStatus(nextStatus);
    onStatus(message);
  };

  const reportError = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    setStatus({ tone: "error", label: fallback, detail: message });
    onStatus(`${fallback}：${message}`);
  };

  async function reloadCurrent() {
    if (!workspaceId) {
      reportError(new Error(tr("未打开工作区")), tr("重新读取失败"));
      return;
    }
    try {
      const file = await window.nolia.file.read({ workspaceId, pathRel: resource.pathRel });
      contentRef.current = file.content;
      baseHashRef.current = file.sha256;
      setContent(file.content);
      onDirtyChange(resource.pathRel, false);
      setStatus(statusForContent(file.content, language, tr("已重新读取"), resource.pathRel, tr, locale));
      onStatus(tr("已重新读取 {path}", { path: resource.pathRel }));
    } catch (error) {
      reportError(error, tr("重新读取失败"));
    }
  }

  async function saveCurrent() {
    if (!workspaceId) {
      throw new Error(tr("未打开工作区"));
    }
    if (!baseHashRef.current) {
      throw new Error(tr("缺少文件版本信息"));
    }
    const result = await window.nolia.file.writeAtomic({
      workspaceId,
      pathRel: resource.pathRel,
      content: contentRef.current,
      baseHash: baseHashRef.current,
      createSnapshot: true
    });
    if (result.status !== "saved") {
      throw new Error(result.status === "conflict" ? tr("文件已在磁盘上变化，请重新读取后再保存") : tr("保存失败"));
    }
    baseHashRef.current = result.sha256 ?? baseHashRef.current;
    onDirtyChange(resource.pathRel, false);
    onSaved(resource.pathRel, result);
    if (Date.now() > userActionStatusProtectedUntilRef.current) {
      setStatus(statusForContent(contentRef.current, language, tr("已保存"), resource.pathRel, tr, locale));
      onStatus(tr("已保存 {path}", { path: resource.pathRel }));
    }
  }

  const openDiagnostics = () => {
    const view = editorRef.current?.view;
    const nextStatus = statusForContent(contentRef.current, language, undefined, resource.pathRel, tr, locale);
    if (nextStatus.tone === "error") {
      setUserActionStatus(nextStatus, `${nextStatus.label}：${nextStatus.detail}`);
      if (view) {
        openLintPanel(view);
        view.focus();
      }
      return;
    }
    const cleanStatus: ResourceEditorStatus = {
      ...nextStatus,
      tone: "ok",
      label: tr("无诊断问题")
    };
    setUserActionStatus(cleanStatus, tr("无诊断问题 {path}", { path: resource.pathRel }));
    view?.focus();
  };

  const validateCurrent = () => {
    const nextStatus = statusForContent(contentRef.current, language, undefined, resource.pathRel, tr, locale);
    setUserActionStatus(nextStatus, nextStatus.tone === "error" ? `${nextStatus.label}：${nextStatus.detail}` : `${nextStatus.label}：${resource.pathRel}`);
  };

  const formatCurrent = () => {
    if (!isJson) {
      return;
    }
    const parsed = parseJsonDocument(contentRef.current);
    if (!parsed.ok) {
      reportError(parsed.error, tr("格式化失败"));
      return;
    }
    const formatted = JSON.stringify(parsed.value, undefined, jsonIndent(indent));
    const nextStatus: ResourceEditorStatus = { tone: "ok", label: tr("已格式化"), detail: jsonDocumentStats(formatted, tr, locale) };
    setEditorContent(formatted, { status: nextStatus });
    setUserActionStatus(nextStatus, tr("已格式化 {path}", { path: resource.pathRel }));
  };

  const compactCurrent = () => {
    if (!isJson) {
      return;
    }
    const parsed = parseJsonDocument(contentRef.current);
    if (!parsed.ok) {
      reportError(parsed.error, tr("压缩失败"));
      return;
    }
    const compacted = JSON.stringify(parsed.value);
    const nextStatus: ResourceEditorStatus = { tone: "ok", label: tr("已压缩"), detail: jsonDocumentStats(compacted, tr, locale) };
    setEditorContent(compacted, { status: nextStatus });
    setUserActionStatus(nextStatus, tr("已压缩 {path}", { path: resource.pathRel }));
  };

  const sortKeys = () => {
    if (!isJson) {
      return;
    }
    const parsed = parseJsonDocument(contentRef.current);
    if (!parsed.ok) {
      reportError(parsed.error, tr("排序键失败"));
      return;
    }
    const formatted = JSON.stringify(sortJsonKeys(parsed.value), undefined, jsonIndent(indent));
    const nextStatus: ResourceEditorStatus = { tone: "ok", label: tr("已排序键"), detail: jsonDocumentStats(formatted, tr, locale) };
    setEditorContent(formatted, { status: nextStatus });
    setUserActionStatus(nextStatus, tr("已排序 JSON 键 {path}", { path: resource.pathRel }));
  };

  const cleanupTextCurrent = () => {
    const normalized = contentRef.current
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n");
    const nextStatus: ResourceEditorStatus = { tone: "ok", label: tr("已清理空白"), detail: textDocumentStats(normalized, tr, locale) };
    setEditorContent(normalized, { status: nextStatus });
    setUserActionStatus(nextStatus, tr("已清理空白 {path}", { path: resource.pathRel }));
  };

  const dispatchEditorCommand = (command: (target: EditorView) => boolean): boolean => {
    const view = editorRef.current?.view;
    if (!view) {
      return false;
    }
    const handled = command(view);
    view.focus();
    return handled;
  };

  useImperativeHandle(ref, () => ({
    undoEdit: () => dispatchEditorCommand(undo),
    redoEdit: () => dispatchEditorCommand(redo),
    findText: (query: string, options: FindReplaceOptions = {}) => {
      const view = editorRef.current?.view;
      if (!view || !query) {
        return { total: 0, currentIndex: -1 };
      }
      return selectTextResourceMatch(view, query, options);
    },
    replaceCurrent: (query: string, replacement: string, options: FindReplaceOptions = {}) => {
      const view = editorRef.current?.view;
      if (!view || !query) {
        return { total: 0, currentIndex: -1, replaced: 0 };
      }
      const text = view.state.doc.toString();
      const matches = findPlainTextMatches(text, query, options);
      if (!matches.length) {
        return { total: 0, currentIndex: -1, replaced: 0 };
      }
      const range = view.state.selection.main;
      let index = exactMatchIndex(matches, range.from, range.to);
      if (index < 0) {
        index = nextMatchIndex(matches, range.head, Boolean(options.backwards));
      }
      const match = matches[index];
      view.dispatch({
        changes: { from: match.from, to: match.to, insert: replacement },
        selection: { anchor: match.from, head: match.from + replacement.length },
        scrollIntoView: true
      });
      view.focus();
      const nextText = `${text.slice(0, match.from)}${replacement}${text.slice(match.to)}`;
      const nextMatches = findPlainTextMatches(nextText, query, options);
      return { total: nextMatches.length, currentIndex: nextMatchIndex(nextMatches, match.from + replacement.length), replaced: 1 };
    },
    replaceAll: (query: string, replacement: string, options: FindReplaceOptions = {}) => {
      const view = editorRef.current?.view;
      if (!view || !query) {
        return { total: 0, currentIndex: -1, replaced: 0 };
      }
      const matches = findPlainTextMatches(view.state.doc.toString(), query, options);
      if (!matches.length) {
        return { total: 0, currentIndex: -1, replaced: 0 };
      }
      view.dispatch({
        changes: matches.map((match) => ({ from: match.from, to: match.to, insert: replacement })),
        selection: { anchor: matches[0].from + replacement.length },
        scrollIntoView: true
      });
      view.focus();
      return { total: 0, currentIndex: -1, replaced: matches.length };
    }
  }));

  const announceEditorOption = (label: string) => {
    setUserActionStatus(statusForContent(contentRef.current, language, label, resource.pathRel, tr, locale), `${label} ${resource.pathRel}`);
  };

  const toggleWrap = () => {
    const next = !wrap;
    setWrap(next);
    announceEditorOption(next ? tr("已开启自动换行") : tr("已关闭自动换行"));
  };

  const toggleLineNumbers = () => {
    const next = !lineNumbers;
    setLineNumbers(next);
    announceEditorOption(next ? tr("已显示行号") : tr("已隐藏行号"));
  };

  const toggleWhitespace = () => {
    const next = !showWhitespace;
    setShowWhitespace(next);
    announceEditorOption(next ? tr("已显示空白符") : tr("已隐藏空白符"));
  };

  useEffect(() => {
    const initialContent = resource.initialText ?? "";
    const nextLanguage = editorKind === "json" ? "json" : languageForPath(resource.pathRel);
    pendingDirtyNotificationRef.current = false;
    contentRef.current = initialContent;
    baseHashRef.current = resource.baseHash;
    userActionStatusProtectedUntilRef.current = 0;
    setContent(initialContent);
    setLanguage(nextLanguage);
    setStatus(statusForContent(initialContent, nextLanguage, undefined, resource.pathRel, tr, locale));
  }, [resource.pathRel]);

  useEffect(() => {
    if (!pendingDirtyNotificationRef.current) {
      return;
    }
    pendingDirtyNotificationRef.current = false;
    onDirtyChange(resource.pathRel, true);
  }, [content, resource.pathRel]);

  useEffect(() => onRegisterSaveHandler(resource.pathRel, saveCurrent), [resource.pathRel, onRegisterSaveHandler]);

  return (
    <div className="resource-preview builtin-resource-editor text-resource-editor" data-testid={testId}>
      <div className="resource-editor-toolbar" role="toolbar" aria-label={toolbarLabel}>
        <ResourceToolbarButton title={tr("撤销")} icon={<Undo2 size={16} />} onClick={() => dispatchEditorCommand(undo)} />
        <ResourceToolbarButton title={tr("重做")} icon={<Redo2 size={16} />} onClick={() => dispatchEditorCommand(redo)} />
        <ResourceToolbarButton title={tr("搜索/替换")} icon={<Search size={16} />} onClick={onOpenFindReplace} />
        <ToolbarDivider />
        <ResourceToolbarButton title={tr("自动换行（长行时生效）")} ariaLabel={tr("自动换行")} icon={<WrapText size={16} />} active={wrap} pressed={wrap} onClick={toggleWrap} />
        <ResourceToolbarButton title={tr("行号")} icon={<ListOrdered size={16} />} active={lineNumbers} pressed={lineNumbers} onClick={toggleLineNumbers} />
        <ResourceToolbarButton title={tr("空白符")} icon={<Pilcrow size={16} />} active={showWhitespace} pressed={showWhitespace} onClick={toggleWhitespace} />
        {editorKind === "text" ? (
          <span
            className="resource-editor-language"
            aria-label={tr("自动识别文本类型：{language}", { language: languageLabel(language, resource.pathRel, tr) })}
            title={tr("根据文件后缀自动识别为 {language}", { language: languageLabel(language, resource.pathRel, tr) })}
          >
            <FileText size={15} aria-hidden="true" />
            <span>{languageLabel(language, resource.pathRel, tr)}</span>
          </span>
        ) : null}
        {isJson ? (
          <>
            <ToolbarDivider />
            <ResourceToolbarButton title={tr("校验")} icon={<FileCheck2 size={16} />} onClick={validateCurrent} />
            <ResourceToolbarButton title={tr("格式化")} icon={<Braces size={16} />} onClick={formatCurrent} />
            <ResourceToolbarButton title={tr("排序键")} icon={<ArrowDownAZ size={16} />} onClick={sortKeys} />
            <ResourceToolbarButton title={tr("压缩")} icon={<Minimize2 size={16} />} onClick={compactCurrent} />
            <label className="resource-editor-select">
              <TextCursorInput size={15} aria-hidden="true" />
              <span className="sr-only">{tr("缩进")}</span>
              <select aria-label={tr("JSON 缩进")} value={indent} onChange={(event) => setIndent(event.target.value as JsonIndentValue)}>
                <option value="2">{tr("2 空格")}</option>
                <option value="4">{tr("4 空格")}</option>
                <option value="tab">Tab</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <ToolbarDivider />
            <ResourceToolbarButton title={tr("清理空白")} icon={<Eraser size={16} />} onClick={cleanupTextCurrent} />
          </>
        )}
        <ToolbarDivider />
        <ResourceToolbarButton title={tr("诊断 / 问题面板")} ariaLabel={tr("诊断")} icon={<Bug size={16} />} onClick={openDiagnostics} />
        <ResourceToolbarButton title={tr("重新读取")} icon={<RefreshCw size={16} />} onClick={() => void reloadCurrent()} />
      </div>
      <div className="text-resource-workbench">
        <TextEditorCore
          ref={editorRef}
          value={content}
          language={language}
          showLineNumbers={lineNumbers}
          wrap={wrap}
          showWhitespace={showWhitespace}
          ariaLabel={editorLabel}
          onOpenFindReplace={onOpenFindReplace}
          onChange={setEditorContent}
          onSelectionStats={setSelectionStats}
        />
      </div>
      <footer className="resource-editor-statusbar">
        <span data-testid={editorKind === "json" ? "builtin-json-status" : undefined} className={`resource-editor-status is-${status.tone}`}>
          {status.label}
        </span>
        <span>{status.detail}</span>
        <span>{tr("Ln {line}, Col {column}", { line: selectionStats.line, column: selectionStats.column })}</span>
        <span>{tr("选中 {count} 字符", { count: selectionStats.selectedChars })}</span>
        <span>{languageLabel(language, resource.pathRel, tr)}</span>
      </footer>
    </div>
  );
});

function ResourceToolbarButton({ title, ariaLabel, icon, active, pressed, primary, disabled, onClick }: { title: string; ariaLabel?: string; icon: ReactNode; active?: boolean; pressed?: boolean; primary?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`toolbar-icon-button${active ? " is-active" : ""}${primary ? " is-primary" : ""}`}
      title={title}
      aria-label={ariaLabel ?? title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="toolbar-divider" aria-hidden="true" />;
}

type TextEditorCoreProps = {
  value: string;
  language: TextLanguageId;
  showLineNumbers: boolean;
  wrap: boolean;
  showWhitespace: boolean;
  ariaLabel: string;
  onOpenFindReplace: () => void;
  onChange: (value: string) => void;
  onSelectionStats: (stats: SelectionStats) => void;
};

const TextEditorCore = forwardRef<ReactCodeMirrorRef, TextEditorCoreProps>(function TextEditorCore({ value, language, showLineNumbers, wrap, showWhitespace, ariaLabel, onOpenFindReplace, onChange, onSelectionStats }, ref) {
  const { tr } = useRendererI18n();
  const extensions = useMemo(
    () => [
      languageExtension(language),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorState.phrases.of({
        Find: tr("查找"),
        Replace: tr("替换"),
        next: tr("下一个"),
        previous: tr("上一个"),
        all: tr("全部"),
        "match case": tr("区分大小写"),
        regexp: tr("正则"),
        "by word": tr("整词"),
        replace: tr("替换"),
        "replace all": tr("全部替换"),
        close: tr("关闭"),
        "current match": tr("当前匹配"),
        "on line": tr("在第")
      }),
      lintGutter(),
      ...(language === "json" ? [linter(jsonParseLinter())] : []),
      keymap.of([
        {
          key: "Mod-f",
          run: () => {
            onOpenFindReplace();
            return true;
          }
        },
        ...foldKeymap
      ]),
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.selectionSet || update.docChanged) {
          onSelectionStats(selectionStats(update.state));
        }
      }),
      ...(wrap ? [EditorView.lineWrapping] : []),
      ...(showWhitespace ? [visibleWhitespace()] : [])
    ],
    [language, onOpenFindReplace, onSelectionStats, showWhitespace, tr, wrap]
  );

  return (
    <CodeMirror
      ref={ref}
      value={value}
      height="100%"
      extensions={extensions}
      editable
      basicSetup={{
        lineNumbers: showLineNumbers,
        foldGutter: showLineNumbers,
        highlightActiveLine: true,
        highlightActiveLineGutter: showLineNumbers,
        bracketMatching: true,
        closeBrackets: true,
        searchKeymap: false
      }}
      onChange={onChange}
      className="text-resource-codemirror"
      aria-label={ariaLabel}
    />
  );
});

function languageExtension(language: TextLanguageId) {
  switch (language) {
    case "json":
      return json();
    case "yaml":
      return yaml();
    case "xml":
      return xml();
    case "html":
      return html();
    case "javascript":
      return javascript({ jsx: true });
    case "typescript":
      return javascript({ jsx: true, typescript: true });
    case "toml":
    case "csv":
    case "plain":
    default:
      return [];
  }
}

function languageForPath(pathRel: string): TextLanguageId {
  const ext = fileExtension(pathRel);
  if (ext === ".json") {
    return "json";
  }
  if (ext === ".yaml" || ext === ".yml") {
    return "yaml";
  }
  if (ext === ".toml") {
    return "toml";
  }
  if (ext === ".xml") {
    return "xml";
  }
  if (ext === ".html" || ext === ".htm") {
    return "html";
  }
  if (ext === ".ts" || ext === ".tsx") {
    return "typescript";
  }
  if (ext === ".js" || ext === ".jsx") {
    return "javascript";
  }
  if (ext === ".csv") {
    return "csv";
  }
  return "plain";
}

function languageLabel(language: TextLanguageId, pathRel = "", tr?: Translator): string {
  const ext = fileExtension(pathRel);
  if (ext === ".txt") {
    return "TXT";
  }
  if (ext === ".log") {
    return "LOG";
  }
  if (ext === ".toml") {
    return "TOML";
  }
  switch (language) {
    case "json":
      return "JSON";
    case "yaml":
      return ext === ".yml" ? "YML" : "YAML";
    case "xml":
      return "XML";
    case "html":
      return ext === ".htm" ? "HTM" : "HTML";
    case "csv":
      return "CSV";
    case "javascript":
      return ext === ".jsx" ? "JSX" : "JavaScript";
    case "typescript":
      return ext === ".tsx" ? "TSX" : "TypeScript";
    case "toml":
      return "TOML";
    case "plain":
    default:
      return tr ? tr("纯文本") : "纯文本";
  }
}

function statusForContent(content: string, language: TextLanguageId, okLabel?: string, pathRel = "", tr?: Translator, locale?: ResolvedLocale): ResourceEditorStatus {
  if (language === "json") {
    const parsed = parseJsonDocument(content);
    if (!parsed.ok) {
      return { tone: "error", label: tr ? tr("JSON 无效") : "JSON 无效", detail: parsed.error.message };
    }
    return { tone: "ok", label: okLabel ?? (tr ? tr("JSON 有效") : "JSON 有效"), detail: jsonDocumentStats(content, tr, locale) };
  }
  return { tone: okLabel ? "ok" : "muted", label: okLabel ?? languageLabel(language, pathRel, tr), detail: textDocumentStats(content, tr, locale) };
}

function parseJsonDocument(content: string): { ok: true; value: unknown } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(stripLeadingBom(content)) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error : new Error("无法解析 JSON") };
  }
}

export function stripLeadingBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function jsonIndent(value: JsonIndentValue): number | string {
  return value === "tab" ? "\t" : Number(value);
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }
  return Object.keys(value as Record<string, unknown>)
    .sort(compareJsonKeys)
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = sortJsonKeys((value as Record<string, unknown>)[key]);
      return sorted;
    }, {});
}

function compareJsonKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function jsonDocumentStats(content: string, tr?: Translator, locale: ResolvedLocale = "zh-CN"): string {
  const bytes = new TextEncoder().encode(content).length;
  const lines = content ? content.split(/\r?\n/).length : 0;
  return tr ? tr("{lines} 行 · {size}", { lines, size: formatFileSize(bytes, locale) }) : `${lines} 行 · ${formatFileSize(bytes, locale)}`;
}

function textDocumentStats(content: string, tr?: Translator, locale: ResolvedLocale = "zh-CN"): string {
  const bytes = new TextEncoder().encode(content).length;
  const lines = content ? content.split(/\r?\n/).length : 0;
  const chars = Array.from(content).length;
  return tr ? tr("{lines} 行 · {chars} 字符 · {size}", { lines, chars, size: formatFileSize(bytes, locale) }) : `${lines} 行 · ${chars} 字符 · ${formatFileSize(bytes, locale)}`;
}

function selectionStats(state: EditorState): SelectionStats {
  const range = state.selection.main;
  const line = state.doc.lineAt(range.head);
  let selectedChars = 0;
  state.selection.ranges.forEach((selectionRange) => {
    if (!selectionRange.empty) {
      selectedChars += Array.from(state.sliceDoc(selectionRange.from, selectionRange.to)).length;
    }
  });
  return { line: line.number, column: range.head - line.from + 1, selectedChars };
}

function selectTextResourceMatch(view: EditorView, query: string, options: FindReplaceOptions): FindReplaceResult {
  const matches = findPlainTextMatches(view.state.doc.toString(), query, options);
  if (!matches.length) {
    return { total: 0, currentIndex: -1 };
  }
  const range = view.state.selection.main;
  const selectedIndex = exactMatchIndex(matches, range.from, range.to);
  const currentIndex = selectedIndex >= 0
    ? nextMatchIndex(matches, options.backwards ? range.from : range.to, Boolean(options.backwards))
    : nextMatchIndex(matches, range.head, Boolean(options.backwards));
  const match = matches[currentIndex];
  view.dispatch({
    selection: { anchor: match.from, head: match.to },
    scrollIntoView: true
  });
  view.focus();
  return { total: matches.length, currentIndex };
}

function visibleWhitespace() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildWhitespaceDecorations(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildWhitespaceDecorations(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
}

function buildWhitespaceDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === " " || char === "\t") {
        builder.add(from + index, from + index + 1, Decoration.replace({ widget: new WhitespaceWidget(char) }));
      }
    }
  }
  return builder.finish();
}

class WhitespaceWidget extends WidgetType {
  constructor(private readonly char: string) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-visible-whitespace";
    span.textContent = this.char === "\t" ? "→" : "·";
    return span;
  }
}

function fileExtension(pathRel: string): string {
  return pathRel.toLowerCase().split(/[?#]/)[0]?.match(/\.[^./]+$/)?.[0] ?? "";
}

function formatFileSize(size: number, locale: ResolvedLocale = "zh-CN"): string {
  return formatLocalizedFileSize(locale, size);
}
