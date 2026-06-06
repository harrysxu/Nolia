import { forwardRef, useMemo } from "react";
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

export const SourceEditor = forwardRef<ReactCodeMirrorRef, SourceEditorProps>(function SourceEditor({ value, onChange, onSelectionLengthChange, readOnly, showLineNumbers = true }, ref) {
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

  return (
    <CodeMirror
      ref={ref}
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
