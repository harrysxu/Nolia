import { autocompletion, selectedCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface WikiLinkCompletionTarget {
  pathRel: string;
  title: string;
}

export function wikiLinkCompletionExtension(targets: WikiLinkCompletionTarget[], onCreate?: (title: string) => void): Extension {
  return autocompletion({
    activateOnTyping: true,
    interactionDelay: 0,
    override: [(context) => wikiLinkCompletionSource(context, targets, onCreate)]
  });
}

export function wikiLinkCompletionSource(context: CompletionContext, targets: WikiLinkCompletionTarget[], onCreate?: (title: string) => void): CompletionResult | null {
  const token = context.matchBefore(/\[\[[^\]|\n]*/);
  if (!token) return null;
  const query = token.text.slice(2).trim();
  const normalizedQuery = query.toLowerCase();
  const options: Completion[] = targets
    .filter((target) => {
      if (!normalizedQuery) return true;
      return target.title.toLowerCase().includes(normalizedQuery) || target.pathRel.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 60)
    .map((target) => ({
      label: target.title,
      detail: target.pathRel,
      type: "text",
      apply: `${target.pathRel.replace(/\.md(?:own|arkdown)?$/i, "")}]]`
    }));

  const exactMatch = targets.some((target) =>
    target.title.toLowerCase() === normalizedQuery ||
    target.pathRel.replace(/\.md(?:own|arkdown)?$/i, "").toLowerCase() === normalizedQuery
  );
  if (query && onCreate && !exactMatch) {
    options.push({
      label: `创建“${query}”`,
      detail: "新建 Markdown 笔记",
      type: "keyword",
      boost: -10,
      apply: (view, _completion, from, to) => {
        view.dispatch({ changes: { from, to, insert: `${query}]]` }, selection: { anchor: from + query.length + 2 } });
        onCreate(query);
      }
    });
  }

  return {
    from: token.from + 2,
    options,
    validFor: /^[^\]|\n]*$/
  };
}

export function acceptWikiLinkCompletionFallback(view: EditorView, targets: WikiLinkCompletionTarget[], onCreate?: (title: string) => void): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const prefix = view.state.sliceDoc(0, selection.head);
  const token = /\[\[[^\]|\n]*$/.exec(prefix);
  if (!token) return false;

  const from = token.index + 2;
  const completion = selectedCompletion(view.state);
  if (completion) {
    const apply = completion.apply ?? completion.label;
    if (typeof apply === "string") {
      applyWikiLinkText(view, from, selection.head, apply);
    } else {
      apply(view, completion, from, selection.head);
    }
    return true;
  }

  const query = token[0].slice(2).trim();
  const normalizedQuery = query.toLowerCase();
  const target = targets.find((item) =>
    !normalizedQuery || item.title.toLowerCase().includes(normalizedQuery) || item.pathRel.toLowerCase().includes(normalizedQuery)
  );
  if (target) {
    applyWikiLinkText(view, from, selection.head, `${target.pathRel.replace(/\.md(?:own|arkdown)?$/i, "")}]]`);
    return true;
  }
  if (!query || !onCreate) return false;
  applyWikiLinkText(view, from, selection.head, `${query}]]`);
  onCreate(query);
  return true;
}

function applyWikiLinkText(view: EditorView, from: number, to: number, text: string): void {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length }
  });
}
