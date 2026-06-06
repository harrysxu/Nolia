export type MarkdownOpenTarget =
  | {
      kind: "link";
      href: string;
    }
  | {
      kind: "wikilink";
      markdown: string;
      label: string;
      href?: string;
    }
  | {
      kind: "image";
      src: string;
      markdown?: string;
    };
