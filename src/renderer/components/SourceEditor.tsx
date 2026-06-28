import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { insertNewlineContinueMarkup, markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { keymap, EditorView, type ViewUpdate } from "@codemirror/view";
import { exactMatchIndex, findPlainTextMatches, nextMatchIndex, type FindReplaceOptions, type FindReplaceResult } from "./findReplace";

interface SourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSelectionLengthChange?: (count: number) => void;
  onOpenFindReplace?: () => void;
  readOnly?: boolean;
  showLineNumbers?: boolean;
}

export interface SourceEditorAiSnapshot {
  selectionText: string;
  selectionRange?: { from: number; to: number };
  cursorOffset: number;
  line: number;
  column: number;
}

export interface SourceEditorHandle {
  view: ReactCodeMirrorRef["view"];
  getAiSnapshot: () => SourceEditorAiSnapshot | undefined;
  replaceDocument: (content: string) => boolean;
  findText: (query: string, options?: FindReplaceOptions) => FindReplaceResult;
  replaceCurrent: (query: string, replacement: string, options?: FindReplaceOptions) => FindReplaceResult;
  replaceAll: (query: string, replacement: string, options?: FindReplaceOptions) => FindReplaceResult;
}

export const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(function SourceEditor({ value, onChange, onSelectionLengthChange, onOpenFindReplace, readOnly, showLineNumbers = true }, ref) {
  const codeMirrorRef = useRef<ReactCodeMirrorRef>(null);
  const extensions = useMemo(
    () => [
      markdown({ addKeymap: false }),
      keymap.of([
        {
          key: "Mod-f",
          run: () => {
            onOpenFindReplace?.();
            return Boolean(onOpenFindReplace);
          }
        },
        { key: "Enter", run: insertNewlineContinueMarkup },
        ...markdownKeymap
      ]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (!update.selectionSet && !update.docChanged) {
          return;
        }
        onSelectionLengthChange?.(selectionLength(update));
      })
    ],
    [onOpenFindReplace, onSelectionLengthChange]
  );

  useImperativeHandle(ref, () => ({
    get view() {
      return codeMirrorRef.current?.view;
    },
    replaceDocument: (content: string) => {
      const view = codeMirrorRef.current?.view;
      if (!view) {
        return false;
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor: Math.min(content.length, view.state.selection.main.head) },
        scrollIntoView: true
      });
      view.focus();
      return true;
    },
    findText: (query: string, options: FindReplaceOptions = {}) => {
      const view = codeMirrorRef.current?.view;
      if (!view || !query) {
        return { total: 0, currentIndex: -1 };
      }
      return selectSourceMatch(view, query, options);
    },
    replaceCurrent: (query: string, replacement: string, options: FindReplaceOptions = {}) => {
      const view = codeMirrorRef.current?.view;
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
      const view = codeMirrorRef.current?.view;
      if (!view || !query) {
        return { total: 0, currentIndex: -1, replaced: 0 };
      }
      const text = view.state.doc.toString();
      const matches = findPlainTextMatches(text, query, options);
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
    },
    getAiSnapshot: () => {
      const view = codeMirrorRef.current?.view;
      if (!view) {
        return undefined;
      }
      const range = view.state.selection.main;
      const line = view.state.doc.lineAt(range.head);
      const selectionText = range.empty ? "" : view.state.sliceDoc(range.from, range.to);
      return {
        selectionText,
        selectionRange: range.empty ? undefined : { from: range.from, to: range.to },
        cursorOffset: range.head,
        line: line.number,
        column: range.head - line.from + 1
      };
    }
  }));

  return (
    <CodeMirror
      ref={codeMirrorRef}
      value={value}
      height="100%"
      extensions={extensions}
      editable={!readOnly}
      basicSetup={{
        lineNumbers: showLineNumbers,
        foldGutter: showLineNumbers,
        highlightActiveLine: true,
        highlightActiveLineGutter: showLineNumbers,
        searchKeymap: false
      }}
      onChange={onChange}
      className="source-editor"
    />
  );
});

function selectSourceMatch(view: NonNullable<ReactCodeMirrorRef["view"]>, query: string, options: FindReplaceOptions): FindReplaceResult {
  const text = view.state.doc.toString();
  const matches = findPlainTextMatches(text, query, options);
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

function selectionLength(update: ViewUpdate): number {
  let count = 0;
  update.state.selection.ranges.forEach((range) => {
    if (range.empty) {
      return;
    }
    count += Array.from(update.state.sliceDoc(range.from, range.to)).length;
  });
  return count;
}
