import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

export interface WikiLinkCompletionTarget {
  pathRel: string;
  title: string;
}

export function wikiLinkCompletionExtension(targets: WikiLinkCompletionTarget[], onCreate?: (title: string) => void): Extension {
  return autocompletion({
    activateOnTyping: true,
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
