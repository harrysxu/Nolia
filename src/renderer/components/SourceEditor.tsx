import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { insertNewlineContinueMarkup, markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { keymap, EditorView, type ViewUpdate } from "@codemirror/view";

interface SourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSelectionLengthChange?: (count: number) => void;
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
}

export const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(function SourceEditor({ value, onChange, onSelectionLengthChange, readOnly, showLineNumbers = true }, ref) {
  const codeMirrorRef = useRef<ReactCodeMirrorRef>(null);
  const extensions = useMemo(
    () => [
      markdown({ addKeymap: false }),
      keymap.of([{ key: "Enter", run: insertNewlineContinueMarkup }, ...markdownKeymap]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (!update.selectionSet && !update.docChanged) {
          return;
        }
        onSelectionLengthChange?.(selectionLength(update));
      })
    ],
    [onSelectionLengthChange]
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
        highlightActiveLineGutter: showLineNumbers
      }}
      onChange={onChange}
      className="source-editor"
    />
  );
});

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
