export type CodeBlockLanguageOption = {
  value: string;
  label: string;
  aliases?: readonly string[];
};

export const CODE_BLOCK_LANGUAGE_OPTIONS = [
  { value: "text", label: "Plain Text", aliases: ["plaintext", "txt"] },
  { value: "json", label: "JSON" },
  { value: "xml", label: "XML", aliases: ["svg", "xhtml"] },
  { value: "yaml", label: "YAML", aliases: ["yml"] },
  { value: "toml", label: "TOML" },
  { value: "markdown", label: "Markdown", aliases: ["md", "mdown"] },
  { value: "javascript", label: "JavaScript", aliases: ["js", "mjs", "cjs"] },
  { value: "typescript", label: "TypeScript", aliases: ["ts"] },
  { value: "tsx", label: "TSX" },
  { value: "jsx", label: "JSX" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS", aliases: ["scss", "less"] },
  { value: "bash", label: "Bash", aliases: ["sh", "shell", "zsh"] },
  { value: "sql", label: "SQL" },
  { value: "python", label: "Python", aliases: ["py"] },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust", aliases: ["rs"] },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++", aliases: ["c++", "cc", "cxx"] },
  { value: "csharp", label: "C#", aliases: ["cs", "c#"] },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby", aliases: ["rb"] },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin", aliases: ["kt"] },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "diff", label: "Diff" }
] as const satisfies readonly CodeBlockLanguageOption[];

const codeBlockLanguageAliases: ReadonlyMap<string, string> = new Map(
  CODE_BLOCK_LANGUAGE_OPTIONS.flatMap((option) => {
    const aliases = "aliases" in option ? option.aliases : [];
    return [[option.value, option.value] as const, ...aliases.map((alias) => [alias, option.value] as const)];
  })
);

export function normalizeCodeBlockLanguage(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) {
    return "text";
  }
  return codeBlockLanguageAliases.get(normalized) ?? normalized;
}

export function codeFenceLanguageForCodeBlock(value: unknown): string {
  const normalized = normalizeCodeBlockLanguage(value);
  return normalized === "text" ? "" : normalized;
}
