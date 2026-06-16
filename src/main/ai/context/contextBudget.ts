export function excerpt(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const head = Math.floor(maxChars * 0.65);
  const tail = Math.max(0, maxChars - head - 40);
  return `${value.slice(0, head)}\n\n[...content truncated...]\n\n${tail ? value.slice(-tail) : ""}`;
}

export function aroundOffset(value: string, offset: number | undefined, maxChars: number): string {
  if (typeof offset !== "number" || value.length <= maxChars) {
    return excerpt(value, maxChars);
  }
  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, offset - half);
  const end = Math.min(value.length, offset + half);
  const prefix = start > 0 ? "[...content before omitted...]\n" : "";
  const suffix = end < value.length ? "\n[...content after omitted...]" : "";
  return `${prefix}${value.slice(start, end)}${suffix}`;
}
