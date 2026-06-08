import { describe, expect, it } from "vitest";

import { createMarkdownTocBlock, findEditableCodeFenceLocations, hasMarkdownToc, htmlToMarkdown, parseMarkdown, renderMarkdownToHtml, stringifyMarkdown, updateFencedCodeBlockLanguage, updateMarkdownToc } from "../src/shared/markdown";

describe("markdown engine", () => {
  it("extracts frontmatter, headings, tags, wikilinks, and attachments", () => {
    const parsed = parseMarkdown(
      `---
title: Alpha
tags:
  - Dev
---
# Heading

Text with #inline and [[Beta#Section|alias]].

![diagram](assets/diagram.png)
`,
      "alpha.md"
    );

    expect(parsed.title).toBe("Alpha");
    expect(parsed.headings[0]).toMatchObject({ text: "Heading", depth: 1 });
    expect(parsed.tags).toEqual(["dev", "inline"]);
    expect(parsed.wikilinks[0]).toMatchObject({ targetText: "Beta", targetHeading: "Section", alias: "alias" });
    expect(parsed.attachments[0]).toMatchObject({ refPath: "assets/diagram.png", kind: "image" });
  });

  it("preserves YAML frontmatter when stringifying", () => {
    const source = stringifyMarkdown({ title: "Note", tags: ["dev"] }, "# Body\n");
    expect(source).toContain("---\ntitle: Note\ntags:");
    expect(source).toContain("# Body");
  });

  it("renders and reserializes basic Markdown", async () => {
    const html = await renderMarkdownToHtml("# Title\n\n- one\n- two\n");
    expect(html).toContain('<h1 id="title">Title</h1>');
    const markdown = await htmlToMarkdown(html);
    expect(markdown).toContain("# Title");
    expect(markdown).toContain("- one");
  });

  it("keeps user typed Markdown shortcuts unescaped in normal text", async () => {
    const markdown = await htmlToMarkdown(
      [
        "<p>**bold**</p>",
        "<p>*italic*</p>",
        "<p>~~strike~~</p>",
        "<p>`code`</p>",
        "<p>[link](https://example.com)</p>",
        "<p>> quote</p>",
        "<p>- [ ] task</p>"
      ].join("")
    );

    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("*italic*");
    expect(markdown).toContain("~~strike~~");
    expect(markdown).toContain("`code`");
    expect(markdown).toContain("[link](https://example.com)");
    expect(markdown).toContain("> quote");
    expect(markdown).toContain("- [ ] task");
    expect(markdown).not.toContain("\\*\\*bold\\*\\*");
    expect(markdown).not.toContain("\\~\\~strike\\~\\~");
  });

  it("still escapes table cell pipes while preserving Markdown outside tables", async () => {
    const markdown = await htmlToMarkdown("<p>**bold**</p><table><tbody><tr><td>a | b</td></tr></tbody></table>");

    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("a \\| b");
  });

  it("preserves common Markdown blocks through HTML conversion", async () => {
    const html = await renderMarkdownToHtml(`## Blocks

> quote

- [x] done
- [ ] todo

| A | B |
| - | - |
| 1 | 2 |

\`\`\`ts
const value = 1;
\`\`\`
`);

    expect(html).toContain("<blockquote>");
    expect(html).toContain("<table>");
    expect(html).toContain('<pre data-language="ts" data-code-block="true"><code class="hljs language-ts">');
    expect(html).toContain('class="hljs-keyword"');

    const markdown = await htmlToMarkdown(html);
    expect(markdown).toContain("> quote");
    expect(markdown).toContain("- [x] done");
    expect(markdown).toContain("| A | B |");
    expect(markdown).toContain("```");
    expect(markdown).toContain("const value = 1;");
  });

  it("creates a controlled table of contents from document headings", () => {
    const body = "# Alpha\n\n## Beta\n\n### Gamma\n";
    const toc = createMarkdownTocBlock(body);
    const source = `${toc}\n\n${body}`;
    const parsed = parseMarkdown(source);

    expect(hasMarkdownToc(source)).toBe(true);
    expect(toc).toContain("- [Alpha](#alpha)");
    expect(toc).toContain("  - [Beta](#beta)");
    expect(toc).toContain("    - [Gamma](#gamma)");
    expect(parsed.headings.map((heading) => heading.text)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("updates an existing controlled table of contents after headings change", () => {
    const source = `${createMarkdownTocBlock("# Old\n")}\n\n# New\n\n## Child\n`;
    const updated = updateMarkdownToc(source);

    expect(updated).toContain("- [New](#new)");
    expect(updated).toContain("  - [Child](#child)");
    expect(updated).not.toContain("- [Old](#old)");
  });

  it("preserves table of contents blocks through WYSIWYG HTML conversion", async () => {
    const source = `${createMarkdownTocBlock("# Alpha\n\n## Beta\n")}\n\n# Alpha\n\n## Beta\n`;
    const html = await renderMarkdownToHtml(source);

    expect(html).toContain('data-type="markdown-preview-block"');
    expect(html).toContain('data-kind="toc"');

    const markdown = await htmlToMarkdown(html);
    expect(markdown).toContain("nolia-toc:start");
    expect(markdown).toContain("- [Alpha](#alpha)");
    expect(markdown).toContain("nolia-toc:end");
  });

  it("renders table of contents hierarchy as nested lists", async () => {
    const source = `${createMarkdownTocBlock("# Alpha\n\n## Beta\n\n### Gamma\n\n# Delta\n")}\n\n# Alpha\n\n## Beta\n\n### Gamma\n\n# Delta\n`;
    const html = await renderMarkdownToHtml(source);

    expect(html).toContain('<a href="#alpha">Alpha</a><ul><li><a href="#beta">Beta</a><ul><li><a href="#gamma">Gamma</a></li></ul></li></ul></li>');
    expect(html).toContain('</li><li><a href="#delta">Delta</a></li></ul>');
  });

  it("updates editable fenced-code languages by rendered code-block order", () => {
    const source = [
      "```ts",
      "const value = 1;",
      "```",
      "",
      "```mermaid",
      "graph TD; A --> B;",
      "```",
      "",
      "```",
      "plain",
      "```",
      "",
      "```xml title=\"Example\"",
      "<root />",
      "```"
    ].join("\n");

    const locations = findEditableCodeFenceLocations(source);
    expect(locations.map((location) => location.language)).toEqual(["ts", undefined, "xml"]);
    expect(updateFencedCodeBlockLanguage(source, 0, "json")).toContain("```json\nconst value = 1;");
    expect(updateFencedCodeBlockLanguage(source, 1, "yaml")).toContain("```yaml\nplain");
    expect(updateFencedCodeBlockLanguage(source, 2, "text")).toContain("``` title=\"Example\"\n<root />");
  });

  it("does not expose fenced-code closing newline to the WYSIWYG editor", async () => {
    const html = await renderMarkdownToHtml("```ts\nconst value = 1;\n```\n");
    expect(html).toMatch(/;<\/code><\/pre>$/);
    expect(html).not.toMatch(/\n<\/code><\/pre>$/);

    const htmlWithBlankLine = await renderMarkdownToHtml("```ts\nconst value = 1;\n\n```\n");
    expect(htmlWithBlankLine).toMatch(/\n<\/code><\/pre>$/);
    expect(htmlWithBlankLine).not.toMatch(/\n\n<\/code><\/pre>$/);
  });

  it("renders extended note Markdown syntax safely", async () => {
    const html = await renderMarkdownToHtml(`Text with [[Alpha#Intro|Alpha note]] and ==highlight==.

Term
: Definition

> [!WARNING] Check this
> Be careful.

<details open><summary>More</summary><kbd>Cmd</kbd></details>
<script>alert("x")</script>

\`\`\`mermaid
graph TD; A-->B;
\`\`\`
`);

    expect(html).toContain('class="wikilink"');
    expect(html).toContain("Alpha note");
    expect(html).toContain("<mark>highlight</mark>");
    expect(html).toContain("<dl");
    expect(html).toContain("<dt>Term</dt>");
    expect(html).toContain("<dd>Definition</dd>");
    expect(html).toContain("callout-warning");
    expect(html).toContain("Check this");
    expect(html).toContain("<details open>");
    expect(html).toContain("<kbd>Cmd</kbd>");
    expect(html).not.toContain("<script>");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("graph TD; A-->B;");
  });

  it("renders Mermaid diagram fences that use the diagram type as language", async () => {
    const html = await renderMarkdownToHtml(`\`\`\`erDiagram
CUSTOMER ||--o{ ORDER : places
CUSTOMER {
  string id PK
}
\`\`\``);

    expect(html).toContain('class="mermaid"');
    expect(html).toContain("erDiagram");
    expect(html).toContain("CUSTOMER ||--o{ ORDER : places");
    expect(html).toContain('data-markdown="&#x60;&#x60;&#x60;erDiagram');
  });

  it("normalizes Mermaid aliases that require canonical directives", async () => {
    const html = await renderMarkdownToHtml(`\`\`\`architecture
service api(server)[API]
service db(database)[Database]
api:R -- L:db
\`\`\`

\`\`\`requirement
requirement test_req {
id: 1
text: the system shall work
risk: high
verifyMethod: test
}
\`\`\`

\`\`\`treeView-beta
"root"
  "child"
\`\`\`

\`\`\`c4context
Person(user, "User")
System(app, "Nolia")
Rel(user, app, "Uses")
\`\`\``);

    expect(html).toContain("architecture-beta");
    expect(html).toContain("requirementDiagram");
    expect(html).toContain("treeView-beta");
    expect(html).toContain("C4Context");
    expect(html).toContain('data-markdown="&#x60;&#x60;&#x60;architecture');
    expect(html).toContain('data-markdown="&#x60;&#x60;&#x60;requirement');
  });

  it("keeps trailing prose punctuation outside autolinks", async () => {
    const html = await renderMarkdownToHtml("访问 https://example.com。");

    expect(html).toContain('<a href="https://example.com">https://example.com</a>。');
    expect(html).not.toContain("https://example.com%E3%80%82");
  });

  it("serializes WYSIWYG preview blocks back to original Markdown", async () => {
    const markdown = await htmlToMarkdown(
      [
        '<p>Text <mark>highlight</mark> <span data-type="markdown-inline" data-kind="wikilink" data-markdown="[[Alpha|A]]" data-label="A">A</span> foot<sup data-type="markdown-inline" data-kind="footnote-ref" data-markdown="[^1]" data-label="1">1</sup></p>',
        '<p>Formula <span data-type="inline-math" data-markdown="$x^2$" data-latex="x^2">x^2</span></p>',
        '<div data-type="math-block" data-markdown="$$&#10;E = mc^2&#10;$$" data-latex="E = mc^2">E = mc^2</div>',
        '<img data-markdown="![Alt](assets/mock.png &quot;Title&quot;)" data-markdown-src="assets/mock.png" src="nolia-asset://workspace/ws/assets/mock.png" alt="Alt" title="Title">',
        '<div data-type="markdown-preview-block" data-kind="callout" data-markdown="&gt; [!WARNING] Title&#10;&gt; Body"></div>',
        '<div data-type="markdown-preview-block" data-kind="footnotes" data-markdown="[^1]: Footnote body"></div>',
        '<div data-type="markdown-preview-block" data-kind="mermaid" data-markdown="```erDiagram&#10;CUSTOMER ||--o{ ORDER : places&#10;```"></div>'
      ].join("")
    );

    expect(markdown).toContain("Text ==highlight== [[Alpha|A]] foot[^1]");
    expect(markdown).toContain("Formula $x^2$");
    expect(markdown).toContain("$$\nE = mc^2\n$$");
    expect(markdown).toContain('![Alt](assets/mock.png "Title")');
    expect(markdown).toContain("> [!WARNING] Title\n> Body");
    expect(markdown).toContain("[^1]: Footnote body");
    expect(markdown).toContain("```erDiagram\nCUSTOMER ||--o{ ORDER : places\n```");
  });

  it("preserves Mermaid Markdown from rendered diagram clipboard HTML", async () => {
    const markdown = await htmlToMarkdown(
      [
        '<div data-type="markdown-preview-block" data-kind="mermaid" data-markdown="```mermaid&#10;flowchart TD&#10;  A --&gt; B&#10;```">',
        '<div class="mermaid" data-markdown="```mermaid&#10;flowchart TD&#10;  A --&gt; B&#10;```">',
        '<svg><style>#nolia-edit-mermaid-1{font-size:16px}.edge-animation-fast{stroke-dasharray:9,5}</style><text>A</text></svg>',
        "</div>",
        "</div>"
      ].join("")
    );

    expect(markdown).toContain("```mermaid\nflowchart TD\n  A --> B\n```");
    expect(markdown).not.toContain("nolia-edit-mermaid");
    expect(markdown).not.toContain("stroke-dasharray");
  });

  it("serializes TipTap task lists as GFM checkboxes", async () => {
    const markdown = await htmlToMarkdown(
      [
        '<ul data-type="taskList">',
        '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p><strong>done</strong> <code>v1</code></p></div></li>',
        '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p><a href="https://example.com">todo</a> <span data-type="inline-math" data-markdown="$x^2$" data-latex="x^2">x^2</span></p></div></li>',
        "</ul>"
      ].join("")
    );

    expect(markdown).toContain("- [x] **done** `v1`");
    expect(markdown).toContain("- [ ] [todo](https://example.com) $x^2$");
  });

  it("renders empty GFM checkbox items as task lists", async () => {
    const html = await renderMarkdownToHtml("- [ ]\n- [x]\n- [ ] todo\n");

    expect(html).toContain('class="contains-task-list"');
    expect(html.match(/class="task-list-item"/g)).toHaveLength(3);
    expect(html).toContain("todo");
  });

  it("serializes empty TipTap task items without persistent placeholders", async () => {
    const markdown = await htmlToMarkdown(
      [
        '<ul data-type="taskList">',
        '<li data-checked="false"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p></p></div></li>',
        '<li data-checked="false"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p>todo</p></div></li>',
        "</ul>"
      ].join("")
    );

    expect(markdown).toBe("- [ ]\n- [ ] todo");
    expect(markdown).not.toContain("\u200b");
  });
});
