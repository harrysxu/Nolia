export interface FindReplaceOptions {
  caseSensitive?: boolean;
  backwards?: boolean;
}

export interface FindReplaceResult {
  total: number;
  currentIndex: number;
  replaced?: number;
}

export interface TextMatch {
  from: number;
  to: number;
}

export function findPlainTextMatches(text: string, query: string, options: Pick<FindReplaceOptions, "caseSensitive"> = {}): TextMatch[] {
  if (!query) {
    return [];
  }
  const haystack = options.caseSensitive ? text : text.toLocaleLowerCase();
  const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) {
      break;
    }
    matches.push({ from: index, to: index + query.length });
    from = index + Math.max(query.length, 1);
  }
  return matches;
}

export function exactMatchIndex(matches: TextMatch[], from: number, to: number): number {
  return matches.findIndex((match) => match.from === from && match.to === to);
}

export function nextMatchIndex(matches: TextMatch[], cursor: number, backwards = false): number {
  if (!matches.length) {
    return -1;
  }
  if (backwards) {
    const index = findLastIndex(matches, (match) => match.to <= cursor);
    return index >= 0 ? index : matches.length - 1;
  }
  const index = matches.findIndex((match) => match.from >= cursor);
  return index >= 0 ? index : 0;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }
  return -1;
}
