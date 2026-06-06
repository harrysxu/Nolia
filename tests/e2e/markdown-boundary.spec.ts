import { expect, test, type Page } from "@playwright/test";
import type { AppSettings, FileTreeNode, ParsedDocument, WorkspaceInfo } from "../../src/shared/types";

const settings: AppSettings = {
  language: "zh-CN",
  theme: "light",
  editorMode: "source",
  editorWidth: "wide",
  fontSize: "medium",
  focusMode: false,
  autoSaveDelayMs: 80,
  attachmentStrategy: "workspace_assets",
  pluginSafeMode: false,
  plugins: {}
};

const FULL_MARKDOWN = [
  "---",
  "title: Boundary Note",
  "tags:",
  "  - qa",
  "  - markdown",
  "---",
  "# Boundary Smoke",
  "",
  "## Inline",
  "",
  "### Heading 3",
  "#### Heading 4",
  "##### Heading 5",
  "###### Heading 6",
  "",
  "---",
  "",
  "Paragraph **bold** *italic* ~~strike~~ `inline code` ==mark== [[Alpha#Intro|Alpha link]] [external](https://example.com/path?a=1&b=2) [ref-link][ref] <https://openai.com>.",
  "Hard break line  ",
  "continued after hard break.",
  "",
  "Escaped punctuation: \\*not italic\\*, \\[not link\\], and C:\\tmp\\file.",
  "",
  "![mock image](assets/mock.png)",
  "![encoded image](assets/%E6%B5%8B%E8%AF%95.png)",
  "",
  "> Quote line one",
  "> Quote line two",
  "",
  "> [!WARNING] Warning title",
  "> Callout body.",
  "",
  "- [x] checked task",
  "- [ ] unchecked task",
  "- [ ]",
  "",
  "- bullet one",
  "  - nested bullet",
  "    - nested level two",
  "- bullet two",
  "",
  "1. ordered one",
  "2. ordered two",
  "   1. nested ordered",
  "",
  "| Column A | Column B |",
  "| --- | --- |",
  "| plain | **bold cell** |",
  "| pipe \\\\| value | `cell code` |",
  "",
  "```ts",
  "const answer: number = 42;",
  "console.log(answer);",
  "```",
  "",
  "```json",
  "{\"name\":\"nolia\",\"enabled\":true}",
  "```",
  "",
  "```mermaid",
  "graph TD; A[Markdown] --> B[Preview];",
  "```",
  "",
  "Term",
  ": Definition item",
  "",
  "Inline math $x^2 + y^2 = z^2$.",
  "",
  "$$",
  "E = mc^2",
  "$$",
  "",
  "<details open><summary>More</summary><kbd>Cmd</kbd></details>",
  "",
  "Footnote ref[^edge].",
  "",
  "[^edge]: Footnote body.",
  "",
  "[ref]: https://example.org/ref \"Reference Title\""
].join("\n");

test("all supported Markdown survives source, split, and edit mode switching", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "full-source.md": FULL_MARKDOWN,
    "empty.md": ""
  });

  await openWorkspaceNote(page, "full-source.md");
  await expect(page.locator(".cm-content")).toContainText("# Boundary Smoke");
  await expect(page.locator(".cm-content")).toContainText("- [ ]");
  await expect(page.locator(".cm-content")).toContainText("```mermaid");

  await page.getByRole("button", { name: "分屏", exact: true }).click();
  await expect(page.locator(".split-preview h1")).toHaveText("Boundary Smoke");
  await expect(page.locator(".split-preview h6", { hasText: "Heading 6" })).toBeVisible();
  await expect(page.locator(".split-preview hr")).toBeVisible();
  await expect(page.locator(".split-preview p").first().locator("strong")).toHaveText("bold");
  await expect(page.locator(".split-preview p").first().locator("mark")).toHaveText("mark");
  await expect(page.locator(".split-preview img").first()).toHaveAttribute("src", "nolia-asset://workspace/ws_markdown_boundary/assets/mock.png");
  await expect(page.locator(".split-preview img").nth(1)).toHaveAttribute("src", "nolia-asset://workspace/ws_markdown_boundary/assets/%E6%B5%8B%E8%AF%95.png");
  await expect(page.locator(".split-preview ul.contains-task-list li.task-list-item")).toHaveCount(3);
  await expect(page.locator(".split-preview table")).toBeVisible();
  await expect(page.locator('.split-preview pre[data-language="ts"] code')).toContainText("const answer");
  await expect(page.locator('.split-preview pre[data-language="ts"] code .hljs-keyword')).toContainText("const");
  await expect(page.locator('.split-preview pre[data-language="json"] code .hljs-attr').filter({ hasText: '"name"' })).toHaveCount(1);
  await expect(page.locator(".split-preview .katex").filter({ hasText: "E = mc" })).toBeVisible();
  await expect(page.locator(".split-preview .mermaid svg")).toBeVisible();
  await expect(page.locator(".split-preview .footnotes")).toBeVisible();

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await assertFullWysiwygRender(page);

  await page.getByRole("button", { name: "MD", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("# Boundary Smoke");
  await expect(page.locator(".cm-content")).toContainText("- [x] checked task");
  await expect(page.locator(".cm-content")).toContainText("- [ ] unchecked task");
  expect(await sourceContains(page, "\\*not italic\\*")).toBe(true);
  expect(await sourceContains(page, "\\[not link\\]")).toBe(true);
  expect(await sourceContains(page, "[ref-link][ref]")).toBe(true);
  expect(await sourceContains(page, "[ref]: https://example.org/ref \"Reference Title\"")).toBe(true);
  expect(await sourceContains(page, "\n  - nested bullet")).toBe(true);
  expect(await sourceContains(page, "\n    - nested level two")).toBe(true);
  expect(await sourceContains(page, "\n   1. nested ordered")).toBe(true);
  await expect(page.locator(".cm-content")).toContainText("```ts");
  await expect(page.locator(".cm-content")).toContainText("```json");
  await expect(page.locator(".cm-content")).toContainText("```mermaid");
  expect(await sourceContains(page, "\u200b")).toBe(false);

  await page.getByRole("button", { name: "分屏", exact: true }).click();
  await expect(page.locator(".split-preview ul.contains-task-list li.task-list-item")).toHaveCount(3);
  await expect(page.locator(".split-preview .mermaid svg")).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await assertFullWysiwygRender(page);
});

test("source toolbar inserts and refreshes a Markdown table of contents", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "toc.md": ["# Alpha", "", "## Beta", "", "Body."].join("\n")
  });

  await openWorkspaceNote(page, "toc.md");
  await page.locator(".markdown-actionbar").getByRole("button", { name: "目录" }).click();
  await expect.poll(() => sourceText(page)).toContain("<!-- nolia-toc:start -->");
  expect(await sourceContains(page, "- [Alpha](#alpha)")).toBe(true);
  expect(await sourceContains(page, "  - [Beta](#beta)")).toBe(true);

  const withToc = await sourceText(page);
  await setSourceText(page, withToc.replace("# Alpha", "# Renamed"));
  await expect.poll(() => sourceText(page)).toContain("# Renamed");
  await page.keyboard.press("Meta+S");

  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __getFileContent?: (pathRel: string) => string }).__getFileContent?.("toc.md") ?? ""))
    .toContain("- [Renamed](#renamed)");
  await expect.poll(() => sourceText(page)).toContain("- [Renamed](#renamed)");
  expect(await sourceContains(page, "- [Alpha](#alpha)")).toBe(false);
});

test("code block language controls update split preview and WYSIWYG source", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "code-languages.md": [
      "# Code Languages",
      "",
      "```ts",
      "{\"name\":\"nolia\",\"enabled\":true}",
      "```",
      "",
      "```",
      "<root><enabled>true</enabled></root>",
      "```"
    ].join("\n")
  });

  await openWorkspaceNote(page, "code-languages.md");
  await page.getByRole("button", { name: "分屏", exact: true }).click();

  const previewCodeBlocks = page.locator(".split-preview pre[data-code-block='true']");
  await expect(previewCodeBlocks).toHaveCount(2);
  await expect(previewCodeBlocks.first().locator(".code-language-select")).toHaveValue("typescript");
  await previewCodeBlocks.first().locator(".code-language-select").selectOption("json");
  await expect(page.locator('.split-preview pre[data-language="json"] code .hljs-attr').filter({ hasText: '"name"' })).toHaveCount(1);
  expect(await sourceContains(page, "```json\n{\"name\":\"nolia\",\"enabled\":true}")).toBe(true);

  await expect(previewCodeBlocks.nth(1).locator(".code-language-select")).toHaveValue("text");
  await previewCodeBlocks.nth(1).locator(".code-language-select").selectOption("xml");
  await expect(page.locator('.split-preview pre[data-language="xml"] code')).toContainText("<root>");
  expect(await sourceContains(page, "```xml\n<root><enabled>true</enabled></root>")).toBe(true);

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  await editor.locator('pre[data-language="json"] code').click();
  const languageControl = page.locator(".code-language-floating-control .code-language-select");
  await expect(languageControl).toBeVisible();
  await expect(languageControl).toHaveValue("json");
  await languageControl.selectOption("yaml");
  await expect(editor.locator('pre[data-language="yaml"] code')).toContainText('"name"');

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, "```yaml\n{\"name\":\"nolia\",\"enabled\":true}")).toBe(true);
  expect(await sourceContains(page, "```xml\n<root><enabled>true</enabled></root>")).toBe(true);
});

test("WYSIWYG Mermaid preview blocks expose editable Markdown source", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "diagram.md": ["# Diagram", "", "```mermaid", "graph TD; A[Markdown] --> B[Preview];", "```"].join("\n")
  });

  await openWorkspaceNote(page, "diagram.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const diagramBlock = page.locator(".markdown-preview-block-mermaid").first();
  await expect(diagramBlock).toBeVisible();
  await expect(diagramBlock.locator(".mermaid svg")).toBeVisible();
  await diagramBlock.click();
  const diagramSource = diagramBlock.getByLabel("Markdown 块源码");
  await expect(diagramSource).toBeVisible();
  await expect(diagramSource).toBeFocused();
  await replaceFocusedText(page, "```mermaid\nflowchart LR\n  C[Updated] --> D[Done]\n```");
  await expect(diagramSource).toHaveValue("```mermaid\nflowchart LR\n  C[Updated] --> D[Done]\n```");
  await page.keyboard.press("Escape");
  await expect(diagramSource).toBeHidden();
  await expect(diagramBlock.locator(".mermaid svg")).toBeVisible();

  await page.getByRole("button", { name: "MD", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("flowchart LR");
  await expect(page.locator(".cm-content")).toContainText("C[Updated] --> D[Done]");
});

test("WYSIWYG block source editors stay editable after clearing and typing Markdown", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "block-editors.md": [
      "# Block Editors",
      "",
      "$$",
      "E = mc^2",
      "$$",
      "",
      "Term",
      ": Definition item",
      "",
      "<details open><summary>More</summary><kbd>Cmd</kbd></details>",
      "",
      "Footnote ref[^edge].",
      "",
      "[^edge]: Footnote body."
    ].join("\n")
  });

  await openWorkspaceNote(page, "block-editors.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");

  const mathBlock = editor.locator(".math-block").first();
  await mathBlock.locator(".math-block-preview").click();
  const mathSource = mathBlock.getByLabel("块公式 Markdown 源码");
  await expect(mathSource).toBeVisible();
  await expect(mathSource).toBeFocused();
  await replaceFocusedText(page, "$$\nF = ma\n$$");
  await expect(mathSource).toHaveValue("$$\nF = ma\n$$");
  await page.keyboard.press("Meta+Enter");
  await expect(mathSource).toBeHidden();
  await expect(mathBlock.locator(".katex")).toContainText("F");

  const definitionBlock = editor.locator(".markdown-preview-block-definition-list").first();
  await definitionBlock.click();
  const definitionSource = definitionBlock.getByLabel("Markdown 块源码");
  await expect(definitionSource).toBeVisible();
  await expect(definitionSource).toBeFocused();
  await replaceFocusedText(page, "Updated term\n: Updated definition");
  await expect(definitionSource).toHaveValue("Updated term\n: Updated definition");
  await page.keyboard.press("Escape");
  await expect(definitionSource).toBeHidden();
  await expect(definitionBlock).toContainText("Updated definition");

  const htmlBlock = editor.locator(".markdown-preview-block-html").first();
  await htmlBlock.click();
  const htmlSource = htmlBlock.getByLabel("Markdown 块源码");
  await expect(htmlSource).toBeVisible();
  await expect(htmlSource).toBeFocused();
  await replaceFocusedText(page, "<details open><summary>Updated</summary><kbd>Ctrl</kbd></details>");
  await expect(htmlSource).toHaveValue("<details open><summary>Updated</summary><kbd>Ctrl</kbd></details>");
  await page.keyboard.press("Escape");
  await expect(htmlSource).toBeHidden();
  await expect(htmlBlock).toContainText("Updated");

  const footnotesBlock = editor.locator(".markdown-preview-block-footnotes").first();
  await footnotesBlock.click();
  const footnotesSource = footnotesBlock.getByLabel("Markdown 块源码");
  await expect(footnotesSource).toBeVisible();
  await expect(footnotesSource).toBeFocused();
  await replaceFocusedText(page, "[^edge]: Updated footnote body.");
  await expect(footnotesSource).toHaveValue("[^edge]: Updated footnote body.");
  await page.keyboard.press("Escape");
  await expect(footnotesSource).toBeHidden();
  await expect(footnotesBlock).toContainText("Updated footnote body");

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, "$$\nF = ma\n$$")).toBe(true);
  expect(await sourceContains(page, "Updated term\n: Updated definition")).toBe(true);
  expect(await sourceContains(page, "<details open><summary>Updated</summary><kbd>Ctrl</kbd></details>")).toBe(true);
  expect(await sourceContains(page, "[^edge]: Updated footnote body.")).toBe(true);
});

test("WYSIWYG tables can be edited as Markdown source and rendered back", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "table-source.md": [
      "# Table Source",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| alpha | **beta** |",
      "| pipe \\| value | `code` |"
    ].join("\n")
  });

  await openWorkspaceNote(page, "table-source.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("table")).toContainText("alpha");
  await editor.locator("td", { hasText: "alpha" }).click();
  await page.getByRole("button", { name: "表格操作" }).click();
  await page.getByRole("menuitem", { name: "编辑 Markdown 源码" }).click();

  const tableSource = page.getByRole("textbox", { name: "表格 Markdown 源码" });
  await expect(tableSource).toBeVisible();
  await expect(tableSource).toBeFocused();
  await expect(tableSource).toHaveValue(/alpha/);
  await replaceFocusedText(page, "| Name | Value |\n| --- | --- |\n| gamma | **delta** |\n| escaped \\| pipe | `next` |");
  await expect(tableSource).toHaveValue("| Name | Value |\n| --- | --- |\n| gamma | **delta** |\n| escaped \\| pipe | `next` |");
  await page.getByRole("heading", { name: "Table Source" }).click();

  await expect(tableSource).toBeHidden();
  await expect(editor.locator("table")).toContainText("gamma");
  await expect(editor.locator("table strong")).toHaveText("delta");
  await expect(editor.locator("table code")).toHaveText("next");

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, "| gamma")).toBe(true);
  expect(await sourceContains(page, "**delta** |")).toBe(true);
  expect(await sourceContains(page, "escaped \\| pipe")).toBe(true);
  expect(await sourceContains(page, "| alpha |")).toBe(false);
});

test("WYSIWYG inline code source does not add slash escapes when clicked repeatedly", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "inline-code-escapes.md": [
      "# Inline Code Escapes",
      "",
      "| Kind | CLI flag | Description |",
      "| --- | --- | --- |",
      "| at | `--at` | One-shot timestamp |",
      "| every | `--every` | Fixed interval |",
      "| cron | `--cron` | Cron expression |",
      "",
      "Blink check: `我` after."
    ].join("\n")
  });

  await openWorkspaceNote(page, "inline-code-escapes.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  const syntaxSource = page.getByRole("textbox", { name: "Markdown 语法源码" });
  const cronCode = editor.locator("td code", { hasText: "--cron" });

  for (let index = 0; index < 3; index += 1) {
    await cronCode.click();
    await expect(syntaxSource).toBeVisible();
    await expect(syntaxSource).toHaveValue("`--cron`");
    await page.keyboard.press("Enter");
    await expect(syntaxSource).toBeHidden();
    await expect(cronCode).toHaveText("--cron");
  }

  const inlineCode = editor.locator("p", { hasText: "Blink check" }).locator("code", { hasText: "我" });
  const openedAtBoundary = await clickInlineCodeTrailingBoundary(page, inlineCode);
  expect(openedAtBoundary).toBe(false);
  await expect(syntaxSource).toBeHidden();

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, "| cron | `--cron` | Cron expression |")).toBe(true);
  expect(await sourceContains(page, "\\\\--cron")).toBe(false);
  expect(await sourceContains(page, "`我` after")).toBe(true);
});

test("WYSIWYG code block text can be selected and copied", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "code-selection.md": [
      "# Code Selection",
      "",
      "```ts",
      "const selectedValue = 42;",
      "console.log(selectedValue);",
      "```"
    ].join("\n")
  });

  await openWorkspaceNote(page, "code-selection.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  const code = editor.locator("pre code");
  await expect(code).toContainText("selectedValue");

  const box = await code.boundingBox();
  expect(box).not.toBeNull();
  if (!box) {
    return;
  }
  await page.mouse.move(box.x + 8, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + Math.min(box.width - 8, 180), box.y + 10, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("selectedValue");
  const copied = await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData });
    element.dispatchEvent(event);
    return clipboardData.getData("text/plain");
  });
  expect(copied).toContain("selectedValue");
});

test("WYSIWYG table toolbar resizes tables and applies alignment", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "table-toolbar.md": [
      "# Table Toolbar",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| alpha | beta |",
      "| gamma | delta |"
    ].join("\n")
  });

  await openWorkspaceNote(page, "table-toolbar.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  await editor.locator("td", { hasText: "beta" }).click();
  await expect(page.getByRole("button", { name: "表格操作" })).toBeVisible();

  await page.getByRole("button", { name: "右对齐" }).click();
  await expect(editor.locator("td", { hasText: "beta" })).toHaveAttribute("align", "right");

  await page.getByRole("button", { name: "表格操作" }).click();
  await page.getByRole("button", { name: "5 x 6" }).hover();
  await expect(page.locator(".table-resize-picker strong")).toHaveText("5 x 6");
  await page.getByRole("button", { name: "5 x 6" }).click();
  await expect(editor.locator("table tr")).toHaveCount(5);
  await expect(editor.locator("table tr").first().locator("th, td")).toHaveCount(6);

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, "alpha")).toBe(true);
  expect(await sourceContains(page, "beta")).toBe(true);
  expect(await sourceContains(page, "----:")).toBe(true);
});

test("WYSIWYG table right-click menu is compact and highlights the active cell", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "table-context-menu.md": [
      "# Table Context Menu",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| alpha | beta |",
      "| gamma | delta |"
    ].join("\n")
  });

  await openWorkspaceNote(page, "table-context-menu.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  const targetCell = editor.locator("td", { hasText: "delta" });
  await targetCell.click({ button: "right" });

  const contextMenu = page.locator(".table-controls-context");
  await expect(contextMenu).toBeVisible();
  await expect(contextMenu.locator(".table-inline-toolbar")).toHaveCount(0);
  await expect(contextMenu.locator(".table-resize-picker")).toHaveCount(0);
  await expect(contextMenu.getByRole("button", { name: "左对齐" })).toHaveCount(0);
  await expect(contextMenu.getByRole("button", { name: "居中对齐" })).toHaveCount(0);
  await expect(contextMenu.getByRole("button", { name: "右对齐" })).toHaveCount(0);
  await expect(contextMenu.getByRole("menuitem", { name: "在右侧新增列" })).toBeVisible();
  await expect(editor.locator("td.is-active-cell", { hasText: "delta" })).toBeVisible();
});

test("WYSIWYG exposes direct editors for image and inline-only Markdown syntax", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "editable-syntax.md": [
      "# Editable Syntax",
      "",
      "![old alt](assets/mock.png \"old title\")",
      "",
      "Inline math $x^2$ and [[Alpha#Intro|Alpha link]] with footnote[^edge].",
      "",
      "[external](https://example.com/old)",
      "",
      "[^edge]: Original footnote."
    ].join("\n")
  });

  await openWorkspaceNote(page, "editable-syntax.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");

  const imageNode = editor.locator(".editable-image-node").first();
  await expect(imageNode.locator("img")).toHaveAttribute("alt", "old alt");
  await imageNode.locator("img").click();
  await expect(imageNode).toContainText("选中后可编辑 Markdown 源码");
  await expect(imageNode).not.toContainText("双击或 Enter 编辑 Markdown 源码");
  const imageSource = page.getByRole("textbox", { name: "图片 Markdown 源码" });
  await expect(imageSource).toBeVisible();
  await expect(imageSource).toBeFocused();
  await expect(imageSource).toHaveValue('![old alt](assets/mock.png "old title")');
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await expect(imageSource).toHaveValue("");
  await expect(imageSource).toBeFocused();
  await replaceFocusedText(page, '![new alt](assets/updated.png "new title")');
  await expect(imageSource).toHaveValue('![new alt](assets/updated.png "new title")');
  await page.keyboard.press("Enter");

  const inlineMath = editor.locator(".inline-math").first();
  await inlineMath.locator(".inline-math-preview").click();
  await expect(inlineMath).toContainText("选中后可编辑源码");
  await expect(inlineMath).not.toContainText("双击或 Enter 编辑源码");
  const inlineMathSource = page.getByRole("textbox", { name: "行内公式源码" });
  await expect(inlineMathSource).toBeVisible();
  await expect(inlineMathSource).toBeFocused();
  await replaceFocusedText(page, "$a^2 + b^2$");
  await page.keyboard.press("Enter");

  const wikilink = editor.locator(".markdown-inline-wikilink").first();
  await wikilink.locator(".markdown-inline-label").click();
  await expect(wikilink).toContainText("选中后可编辑源码");
  await expect(wikilink).not.toContainText("双击或 Enter 编辑源码");
  const wikilinkSource = page.getByRole("textbox", { name: "双链源码" });
  await expect(wikilinkSource).toBeVisible();
  await expect(wikilinkSource).toBeFocused();
  await replaceFocusedText(page, "[[Beta#Usage|Beta usage]]");
  await page.keyboard.press("Enter");

  const footnote = editor.locator(".markdown-inline-footnote-ref").first();
  await footnote.locator(".markdown-inline-label").click();
  const footnoteSource = page.getByRole("textbox", { name: "脚注引用源码" });
  await expect(footnoteSource).toBeVisible();
  await expect(footnoteSource).toBeFocused();
  await replaceFocusedText(page, "[^renamed]");
  await page.keyboard.press("Enter");

  const external = editor.locator("a", { hasText: "external" });
  await external.click();
  await page.getByRole("button", { name: "链接" }).first().click();
  await expect(page.getByRole("textbox", { name: "链接地址" })).toHaveValue("https://example.com/old");
  await page.getByRole("textbox", { name: "链接文本" }).fill("external updated");
  await page.getByRole("textbox", { name: "链接地址" }).fill("https://example.com/new");
  await page.getByRole("button", { name: "确定" }).click();

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, '![new alt](assets/updated.png "new title")')).toBe(true);
  expect(await sourceContains(page, "替代文本路径标题")).toBe(false);
  expect(await sourceContains(page, "点击编辑 Markdown 源码")).toBe(false);
  expect(await sourceContains(page, "$a^2 + b^2$")).toBe(true);
  expect(await sourceContains(page, "[[Beta#Usage|Beta usage]]")).toBe(true);
  expect(await sourceContains(page, "[^renamed]")).toBe(true);
  expect(await sourceContains(page, "[^renamed]: Original footnote.")).toBe(true);
  expect(await sourceContains(page, "[^edge]: Original footnote.")).toBe(false);
  expect(await sourceContains(page, "[external updated](https://example.com/new)")).toBe(true);
});

test("WYSIWYG table wikilinks edit as frameless wrapped Markdown source", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "table-wikilink.md": [
      "# Table Wikilink",
      "",
      "| Rationale | Source |",
      "| --- | --- |",
      "| Keep notes local and friendly to review | [[03-research/local-first-notes]] |"
    ].join("\n")
  });

  await openWorkspaceNote(page, "table-wikilink.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  const sourceCell = editor.locator("td", { hasText: "local-first-notes" });
  const wikilink = sourceCell.locator(".markdown-inline-wikilink");
  await wikilink.locator(".markdown-inline-label").click();

  const wikilinkSource = page.getByRole("textbox", { name: "双链源码" });
  await expect(wikilinkSource).toBeVisible();
  await expect(wikilinkSource).toBeFocused();
  await expect(wikilinkSource).toHaveValue("[[03-research/local-first-notes]]");

  const metrics = await wikilinkSource.evaluate((node) => {
    const textarea = node as HTMLTextAreaElement;
    const style = window.getComputedStyle(textarea);
    const inputRect = textarea.getBoundingClientRect();
    const cellRect = textarea.closest("td")?.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      borderTopColor: style.borderTopColor,
      boxShadow: style.boxShadow,
      clientHeight: textarea.clientHeight,
      inputRight: inputRect.right,
      cellRight: cellRect?.right ?? inputRect.right,
      nodeName: textarea.nodeName,
      overflowY: style.overflowY,
      scrollHeight: textarea.scrollHeight
    };
  });
  expect(metrics.nodeName).toBe("TEXTAREA");
  expect(metrics.boxShadow).toBe("none");
  expect(metrics.backgroundColor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(metrics.borderTopColor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(metrics.inputRight).toBeLessThanOrEqual(metrics.cellRight + 1);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 2);
  expect(metrics.overflowY).toBe("hidden");
});

test("WYSIWYG opens Markdown link targets with modifier clicks", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "links.md": [
      "# Links",
      "",
      "[external](https://example.com/path?q=1)",
      "",
      "[target note](Target.md#Section)",
      "",
      "[[Target#Section|Target section]]",
      "",
      "![mock image](assets/mock.png)"
    ].join("\n"),
    "Target.md": ["# Target", "", "## Section", "", "Arrived."].join("\n")
  });

  await openWorkspaceNote(page, "links.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");

  const external = editor.locator("a", { hasText: "external" });
  await external.click();
  const linkSource = page.getByRole("textbox", { name: "链接 Markdown 源码" });
  await expect(linkSource).toBeVisible();
  await expect(editor.locator(".inline-markdown-source-input")).toBeVisible();
  await expect(page.locator(".link-source-popover")).toHaveCount(0);
  await expect(linkSource).toHaveValue("[external](https://example.com/path?q=1)");
  await page.keyboard.press("Escape");
  await expect(linkSource).toBeHidden();

  const modifierKey = process.platform === "darwin" ? "Meta" : "Control";
  await expect.poll(() => external.evaluate((element) => getComputedStyle(element).cursor)).not.toBe("pointer");
  await page.keyboard.down(modifierKey);
  await expect.poll(() => external.evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");
  await expect.poll(() => page.locator(".markdown-inline-wikilink").evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");
  await expect.poll(() => page.locator(".editable-image-node img").evaluate((element) => getComputedStyle(element).cursor)).toBe("pointer");
  await page.keyboard.up(modifierKey);

  await external.click({ modifiers: ["ControlOrMeta"] });
  await expect.poll(() => page.evaluate(() => (window as Window & { __openedUrls?: string[] }).__openedUrls ?? [])).toContain("https://example.com/path?q=1");

  await editor.locator("a", { hasText: "target note" }).click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".breadcrumb strong")).toHaveText("Target.md");

  await openWorkspaceNote(page, "links.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".markdown-inline-wikilink").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".breadcrumb strong")).toHaveText("Target.md");

  await openWorkspaceNote(page, "links.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".editable-image-node img").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.locator(".breadcrumb strong")).toHaveText("mock.png");
  await expect(page.locator(".resource-preview img")).toHaveAttribute("src", "nolia-asset://workspace/ws_markdown_boundary/assets/mock.png");
});

test("WYSIWYG exposes editable Markdown markers for common block and text syntax", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "syntax-markers.md": [
      "# Marker Title",
      "",
      "Paragraph with **bold** and ~~strike~~ and `code` and ==mark==.",
      "",
      "> Quote text",
      "",
      "- Bullet item",
      "- Another item"
    ].join("\n")
  });

  await openWorkspaceNote(page, "syntax-markers.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");

  await editor.locator("h1", { hasText: "Marker Title" }).click();
  const syntaxSource = page.getByRole("textbox", { name: "Markdown 语法源码" });
  await expect(syntaxSource).toBeVisible();
  await expect(editor.locator(".inline-markdown-source-input")).toBeVisible();
  await expect(page.locator(".markdown-syntax-source-popover")).toHaveCount(0);
  await expect(syntaxSource).toBeFocused();
  await expect(syntaxSource).toHaveValue("# Marker Title");
  await replaceFocusedText(page, "## Marker Title Updated");
  await page.keyboard.press("Enter");
  await expect(editor.locator("h2", { hasText: "Marker Title Updated" })).toBeVisible();

  await editor.locator("strong", { hasText: "bold" }).click();
  await expect(syntaxSource).toHaveValue("**bold**");
  await replaceFocusedText(page, "__heavy__");
  await page.keyboard.press("Enter");
  await expect(editor.locator("strong", { hasText: "heavy" })).toBeVisible();

  await editor.locator("s", { hasText: "strike" }).click();
  await expect(syntaxSource).toHaveValue("~~strike~~");
  await replaceFocusedText(page, "strike");
  await page.keyboard.press("Enter");
  await expect(editor.locator("s", { hasText: "strike" })).toHaveCount(0);
  await expect(editor.locator("p", { hasText: "strike" })).toBeVisible();

  await editor.locator("blockquote", { hasText: "Quote text" }).click();
  await expect(syntaxSource).toHaveValue("> Quote text");
  await replaceFocusedText(page, "Quote text");
  await page.keyboard.press("Enter");
  await expect(editor.locator("blockquote", { hasText: "Quote text" })).toHaveCount(0);
  await expect(editor.locator("p", { hasText: "Quote text" })).toBeVisible();

  await editor.locator("li", { hasText: "Bullet item" }).click();
  await expect(syntaxSource).toHaveValue("- Bullet item");
  await replaceFocusedText(page, "- [ ] Bullet task");
  await page.keyboard.press("Enter");
  await expect(editor.locator("li[data-checked]", { hasText: "Bullet task" })).toBeVisible();

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, "## Marker Title Updated")).toBe(true);
  expect(await sourceContains(page, "__heavy__")).toBe(false);
  expect(await sourceContains(page, "**heavy**")).toBe(true);
  expect(await sourceContains(page, "~~strike~~")).toBe(false);
  expect(await sourceContains(page, "\n> Quote text")).toBe(false);
  expect(await sourceContains(page, "- [ ] Bullet task")).toBe(true);
});

test("WYSIWYG block source editing preserves nested inline Markdown syntax", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "nested-syntax.md": [
      "# Nested Syntax",
      "",
      "- **Dual registration:** Client accepts both `v1` and `v2` during a transition window.",
      "- **Agent prompt:** Tell the LLM which `catalogId` is active for the session.",
      "- **Server-side adapter:** Translate legacy messages to new shapes when possible."
    ].join("\n")
  });

  await openWorkspaceNote(page, "nested-syntax.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  const firstItem = editor.locator("li", { hasText: "Dual registration" });

  await firstItem.click();
  const syntaxSource = page.getByRole("textbox", { name: "Markdown 语法源码" });
  await expect(syntaxSource).toBeVisible();
  await expect(syntaxSource).toHaveValue("- **Dual registration:** Client accepts both `v1` and `v2` during a transition window.");
  await page.keyboard.press("Enter");

  await expect(firstItem.locator("strong", { hasText: "Dual registration:" })).toBeVisible();
  await expect(firstItem.locator("code", { hasText: "v1" })).toBeVisible();
  await expect(firstItem.locator("code", { hasText: "v2" })).toBeVisible();
  await expect(editor.locator("li", { hasText: "Agent prompt" }).locator("strong")).toBeVisible();
  await expect(editor.locator("li", { hasText: "Agent prompt" }).locator("code", { hasText: "catalogId" })).toBeVisible();

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, "- **Dual registration:** Client accepts both `v1` and `v2` during a transition window.")).toBe(true);
  expect(await sourceContains(page, "- **Agent prompt:** Tell the LLM which `catalogId` is active for the session.")).toBe(true);
});

test("WYSIWYG inline source editing preserves nested Markdown inside marks and links", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "nested-inline.md": [
      "# Nested Inline",
      "",
      "Paragraph with **outer [linked text](https://example.com/inner) and `inline code`** after.",
      "",
      "A link with [**bold label** text](https://example.com/bold-label) after."
    ].join("\n")
  });

  await openWorkspaceNote(page, "nested-inline.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  const syntaxSource = page.getByRole("textbox", { name: "Markdown 语法源码" });
  const linkSource = page.getByRole("textbox", { name: "链接 Markdown 源码" });

  const outerStrong = editor.locator("strong", { hasText: "outer" }).first();
  await outerStrong.click({ position: { x: 8, y: 8 } });
  await expect(syntaxSource).toBeVisible();
  await expect(syntaxSource).toHaveValue("**outer [linked text](https://example.com/inner) and `inline code`**");
  await page.keyboard.press("Enter");
  await expect(editor.locator("a", { hasText: "linked text" })).toHaveAttribute("href", "https://example.com/inner");
  await expect(editor.locator("a", { hasText: "linked text" }).locator("strong", { hasText: "linked text" })).toBeVisible();
  await expect(editor.locator("strong code", { hasText: "inline code" })).toBeVisible();

  const nestedLink = editor.locator("a", { hasText: "bold label" });
  await nestedLink.click();
  await expect(linkSource).toBeVisible();
  await expect(linkSource).toHaveValue("[**bold label** text](https://example.com/bold-label)");
  await page.keyboard.press("Enter");
  await expect(nestedLink.locator("strong", { hasText: "bold label" })).toBeVisible();
  await expect(nestedLink).toHaveAttribute("href", "https://example.com/bold-label");

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, "**outer [linked text](https://example.com/inner) and `inline code`**")).toBe(true);
  expect(await sourceContains(page, "[**bold label** text](https://example.com/bold-label)")).toBe(true);
});

test("WYSIWYG source editing does not accumulate URL slash escapes or selection popovers", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "url-escapes.md": [
      "# URL Escapes",
      "",
      "[plain url](https://example.com/catalogs/product/semver.json)",
      "",
      "**https://example.com/catalogs/product/semver.json**"
    ].join("\n")
  });

  await openWorkspaceNote(page, "url-escapes.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  const linkSource = page.getByRole("textbox", { name: "链接 Markdown 源码" });

  for (let index = 0; index < 3; index += 1) {
    await editor.locator("a", { hasText: "plain url" }).click();
    await expect(linkSource).toBeVisible();
    await expect(linkSource).toHaveValue("[plain url](https://example.com/catalogs/product/semver.json)");
    await expect(page.locator(".selection-toolbar")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(linkSource).toBeHidden();
    await expect(page.locator(".selection-toolbar")).toHaveCount(0);
  }

  for (let index = 0; index < 3; index += 1) {
    await editor.locator("strong", { hasText: "https://example.com/catalogs" }).click();
    await expect(linkSource).toBeVisible();
    await expect(linkSource).toHaveValue("[**https://example.com/catalogs/product/semver.json**](https://example.com/catalogs/product/semver.json)");
    await expect(page.locator(".selection-toolbar")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(linkSource).toBeHidden();
    await expect(page.locator(".selection-toolbar")).toHaveCount(0);
  }

  await page.getByRole("button", { name: "MD", exact: true }).click();
  expect(await sourceContains(page, "[plain url](https://example.com/catalogs/product/semver.json)")).toBe(true);
  expect(await sourceContains(page, "**https://example.com/catalogs/product/semver.json**")).toBe(true);
  expect(await sourceContains(page, "https\\://")).toBe(false);
  expect(await sourceContains(page, "https:\\/\\/")).toBe(false);
});

test("WYSIWYG list source editor keeps selection on the clicked duplicate item", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "task-selection.md": [
      "# Actions",
      "",
      "- [ ] Mei: collect training questions.",
      "- [ ] Lona: turn rough notes into a structured brief.",
      "- [ ] Mei: collect training questions."
    ].join("\n")
  });

  await openWorkspaceNote(page, "task-selection.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  const taskItems = editor.locator("ul[data-type='taskList'] li[data-checked]");
  await expect(taskItems).toHaveCount(3);

  await taskItems.nth(2).click();
  const syntaxSource = page.getByRole("textbox", { name: "Markdown 语法源码" });
  await expect(syntaxSource).toBeVisible();
  await expect(syntaxSource).toHaveValue("- [ ] Mei: collect training questions.");
  await page.keyboard.press("Escape");
  await expect(syntaxSource).toBeHidden();

  await expect.poll(() => selectedTaskItemIndex(page)).toBe(2);
});

test("WYSIWYG list source editor expands for long wrapped Markdown", async ({ page }) => {
  const longListItem =
    "A long list item should open as editable Markdown without clipping the wrapped text, so authors can see the complete marker and the sentence while changing list syntax, task state, or emphasis directly in place.";

  await setupBoundaryWorkspace(page, {
    "long-list-source.md": ["# Long List", "", `- ${longListItem}`].join("\n")
  });

  await openWorkspaceNote(page, "long-list-source.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  await editor.locator("li", { hasText: "A long list item" }).click();

  const syntaxSource = page.getByRole("textbox", { name: "Markdown 语法源码" });
  await expect(syntaxSource).toBeVisible();
  await expect(syntaxSource).toHaveValue(`- ${longListItem}`);

  const metrics = await syntaxSource.evaluate((node) => {
    const textarea = node as HTMLTextAreaElement;
    const style = window.getComputedStyle(textarea);
    return {
      clientHeight: textarea.clientHeight,
      overflowY: style.overflowY,
      scrollHeight: textarea.scrollHeight
    };
  });
  expect(metrics.clientHeight).toBeGreaterThan(46);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 2);
  expect(metrics.overflowY).toBe("hidden");
});

test("clicking a split Mermaid preview focuses the matching source block", async ({ page }) => {
  await setupBoundaryWorkspace(page, {
    "diagram-click.md": [
      "# Diagram Click",
      "",
      "```mermaid",
      "flowchart TD",
      "  A[First] --> B[Preview]",
      "```",
      "",
      "Text between diagrams.",
      "",
      "```erDiagram",
      "CUSTOMER ||--o{ ORDER : places",
      "CUSTOMER {",
      "  string id",
      "}",
      "ORDER {",
      "  string id",
      "}",
      "```"
    ].join("\n")
  });

  await openWorkspaceNote(page, "diagram-click.md");
  await page.getByRole("button", { name: "分屏", exact: true }).click();
  const diagrams = page.locator(".split-preview .mermaid");
  await expect(diagrams).toHaveCount(2);
  await expect(diagrams.nth(1).locator("svg")).toBeVisible();

  await diagrams.nth(1).click();
  await page.keyboard.type("%% clicked\n");
  expect(await sourceContains(page, "```erDiagram\n%% clicked\nCUSTOMER ||--o{ ORDER : places")).toBe(true);
});

test("copy and paste keeps Markdown semantics across source and edit documents", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await setupBoundaryWorkspace(page, {
    "source-original.md": FULL_MARKDOWN,
    "source-copy.md": "",
    "edit-paste.md": "",
    "rich-copy.md": ""
  });

  await openWorkspaceNote(page, "source-original.md");
  await copyAllFromSource(page);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("# Boundary Smoke");

  await openWorkspaceNote(page, "source-copy.md");
  await pasteIntoSource(page);
  await expect(page.locator(".cm-content")).toContainText("# Boundary Smoke");
  await expect(page.locator(".cm-content")).toContainText("- [ ] unchecked task");
  await expect(page.locator(".cm-content")).toContainText("```mermaid");

  await openWorkspaceNote(page, "edit-paste.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await pasteMarkdownIntoWysiwyg(page, FULL_MARKDOWN);
  await assertFullWysiwygRender(page);
  await page.getByRole("button", { name: "MD", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("- [ ] unchecked task");
  await expect(page.locator(".cm-content")).toContainText("```ts");

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const richClipboard = await copyAllFromWysiwyg(page);
  expect(richClipboard.html).toContain("Boundary Smoke");
  expect(richClipboard.text).toContain("Boundary Smoke");

  await openWorkspaceNote(page, "rich-copy.md");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await pasteRichIntoWysiwyg(page, richClipboard);
  await assertFullWysiwygRender(page);
  await page.getByRole("button", { name: "MD", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("- [x] checked task");
  await expect(page.locator(".cm-content")).toContainText("- [ ] unchecked task");
  expect(await sourceContains(page, "\n  - nested bullet")).toBe(true);
  expect(await sourceContains(page, "\n    - nested level two")).toBe(true);
  expect(await sourceContains(page, "\n   1. nested ordered")).toBe(true);
  await expect(page.locator(".cm-content")).toContainText("```ts");
  expect(await sourceContains(page, "\u200b")).toBe(false);
});

async function setupBoundaryWorkspace(page: Page, initialFiles: Record<string, string>) {
  await page.setViewportSize({ width: 1500, height: 980 });
  await page.addInitScript(
    ({ mockSettings, filesSeed }: { mockSettings: AppSettings; filesSeed: Record<string, string> }) => {
      const workspace: WorkspaceInfo = {
        workspaceId: "ws_markdown_boundary",
        name: "Boundary Workspace",
        rootPath: "/tmp/boundary-workspace",
        configPath: "/tmp/boundary-workspace/.nolia",
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        permissions: { readable: true, writable: true },
        indexState: { status: "ready", progress: 1, version: 1 }
      };
      const files = new Map<string, string>(Object.entries(filesSeed));
      const assets = new Map<string, { kind: "asset" | "other"; size: number }>([
        ["assets/mock.png", { kind: "asset", size: 32 }]
      ]);
      const testWindow = window as typeof window & {
        __getFileContent?: (pathRel: string) => string;
        __openedUrls?: string[];
      };
      testWindow.__getFileContent = (pathRel: string) => files.get(pathRel) ?? "";
      const openedUrls: string[] = [];
      window.open = ((url?: string | URL) => {
        openedUrls.push(String(url));
        return null;
      }) as typeof window.open;
      testWindow.__openedUrls = openedUrls;

      const parseDocument = (pathRel: string, content: string): ParsedDocument => {
        const title = content.match(/^#\s+(.+)$/m)?.[1] ?? pathRel.replace(/\.md$/i, "");
        return {
          frontmatter: {},
          title,
          body: content,
          plainText: content,
          headings: [...content.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match, index) => ({
            id: match[2].toLowerCase().replace(/\s+/g, "-"),
            text: match[2],
            depth: match[1].length,
            line: index + 1
          })),
          tags: [],
          links: [],
          wikilinks: [],
          attachments: [],
          diagnostics: [],
          wordCount: content.split(/\s+/).filter(Boolean).length,
          lineCount: content.split(/\r?\n/).length
        };
      };

      const listNodes = (): FileTreeNode[] => {
        const root: FileTreeNode[] = [];
        const ensureDirectory = (pathRel: string) => {
          const parts = pathRel.split("/").filter(Boolean);
          let cursor = root;
          let currentPath = "";
          for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            let node = cursor.find((item) => item.pathRel === currentPath);
            if (!node) {
              node = {
                pathRel: currentPath,
                name: part,
                kind: "directory",
                size: 0,
                mtimeMs: Date.now(),
                children: []
              };
              cursor.push(node);
            }
            cursor = node.children ?? [];
          }
          return cursor;
        };

        for (const [pathRel, content] of files) {
          const parent = pathRel.includes("/") ? ensureDirectory(pathRel.split("/").slice(0, -1).join("/")) : root;
          parent.push({
            pathRel,
            name: pathRel.split("/").pop() ?? pathRel,
            kind: "markdown",
            size: content.length,
            mtimeMs: Date.now()
          });
        }
        for (const [pathRel, asset] of assets) {
          const parent = pathRel.includes("/") ? ensureDirectory(pathRel.split("/").slice(0, -1).join("/")) : root;
          parent.push({
            pathRel,
            name: pathRel.split("/").pop() ?? pathRel,
            kind: asset.kind,
            size: asset.size,
            mtimeMs: Date.now()
          });
        }
        const sortNodes = (nodes: FileTreeNode[]): FileTreeNode[] =>
          nodes
            .map((node) => ({ ...node, children: node.children ? sortNodes(node.children) : undefined }))
            .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1));
        return sortNodes(root);
      };

      window.nolia = {
        workspace: {
          bootstrap: async () => ({ activeWorkspace: workspace, recentWorkspaces: [], settings: mockSettings }),
          open: async () => workspace,
          create: async () => workspace,
          listRecent: async () => [],
          listTags: async () => [],
          switch: async () => ({ ok: true, restoredState: workspace }),
          close: async () => undefined
        },
        file: {
          listTree: async () => ({ nodes: listNodes() }),
          read: async ({ pathRel }) => ({ content: files.get(pathRel) ?? "", stat: { size: files.get(pathRel)?.length ?? 0, mtimeMs: Date.now(), birthtimeMs: Date.now() }, sha256: `${pathRel}-hash`, encoding: "utf-8" }),
          writeAtomic: async ({ pathRel, content }) => {
            files.set(pathRel, content);
            return { status: "saved", sha256: `${pathRel}-saved-${Date.now()}`, mtimeMs: Date.now() };
          },
          create: async ({ pathRel, kind, content }) => {
            if (kind === "file") {
              files.set(pathRel, content ?? "");
            }
            return { ok: true, affectedPaths: [pathRel] };
          },
          rename: async ({ sourcePathRel, targetPathRel }) => {
            files.set(targetPathRel, files.get(sourcePathRel) ?? "");
            files.delete(sourcePathRel);
            return { ok: true, affectedPaths: [sourcePathRel, targetPathRel] };
          },
          trash: async ({ pathRel }) => {
            files.delete(pathRel);
            return { ok: true, affectedPaths: [pathRel] };
          },
          openExternal: async () => ({ ok: true }),
          revealInFinder: async () => ({ ok: true })
        },
        document: { parse: async ({ pathRel, content }) => parseDocument(pathRel, content) },
        search: {
          query: async () => ({
            items: [...files.entries()].map(([pathRel, content]) => ({ pathRel, title: parseDocument(pathRel, content).title, score: 1, snippets: [pathRel] })),
            indexVersion: 1,
            isPartial: false
          })
        },
        graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
        attachment: {
          import: async () => ({ assetPathRel: "assets/mock.png", markdown: "![mock.png](assets/mock.png)", mimeType: "image/png", size: 32 }),
          pickImage: async () => ({ path: "/tmp/mock.png" })
        },
        export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
        clipboard: { writeRich: async () => ({ ok: true }) },
        settings: { get: async () => mockSettings, set: async () => mockSettings },
        diagnostics: { openLogs: async () => "" },
        events: {
          onAppCommand: () => () => undefined,
          onExternalFileOpen: () => () => undefined
        }
      };
    },
    { mockSettings: settings, filesSeed: initialFiles }
  );
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
}

async function openWorkspaceNote(page: Page, name: string) {
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".breadcrumb strong")).toHaveText(name);
}

async function assertFullWysiwygRender(page: Page) {
  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("h1")).toHaveText("Boundary Smoke");
  await expect(editor.locator("h2", { hasText: "Inline" })).toBeVisible();
  await expect(editor.locator("h6", { hasText: "Heading 6" })).toBeVisible();
  await expect(editor.locator("hr")).toBeVisible();
  const inlineParagraph = editor.locator("p", { hasText: "Paragraph" }).first();
  await expect(inlineParagraph.locator("strong")).toHaveText("bold");
  await expect(inlineParagraph.locator("em")).toHaveText("italic");
  await expect(inlineParagraph.locator("s")).toHaveText("strike");
  await expect(editor.locator("code", { hasText: "inline code" })).toBeVisible();
  await expect(editor.locator("mark", { hasText: "mark" })).toBeVisible();
  await expect(editor.locator(".markdown-inline-wikilink")).toContainText("Alpha link");
  await expect(editor.locator("a", { hasText: "external" })).toHaveAttribute("href", "https://example.com/path?a=1&b=2");
  await expect(editor.locator("a", { hasText: "ref-link" })).toHaveAttribute("href", "https://example.org/ref");
  const escapedParagraph = editor.locator("p", { hasText: "Escaped punctuation" }).first();
  await expect(escapedParagraph.locator("em")).toHaveCount(0);
  await expect(editor.locator("img").first()).toHaveAttribute("src", "nolia-asset://workspace/ws_markdown_boundary/assets/mock.png");
  await expect(editor.locator("img").nth(1)).toHaveAttribute("src", "nolia-asset://workspace/ws_markdown_boundary/assets/%E6%B5%8B%E8%AF%95.png");
  await expect(editor.locator("blockquote").filter({ hasText: "Quote line one" })).toBeVisible();
  await expect
    .poll(async () => editor.locator("ul[data-type='taskList'] li[data-checked]").count())
    .toBeGreaterThanOrEqual(3);
  await expect(editor).toContainText("checked task");
  await expect(editor).toContainText("unchecked task");
  await expect(editor.locator("ul[data-type='taskList']").filter({ hasText: "[ ]" })).toHaveCount(0);
  await expect(editor.locator("ol").filter({ hasText: "ordered one" }).locator(":scope > li")).toHaveCount(2);
  await expect(editor.locator("table tr")).toHaveCount(3);
  await expect(editor.locator("table td", { hasText: "plain" })).toHaveCSS("vertical-align", "middle");
  await expect(editor.locator('pre[data-language="ts"] code')).toContainText("const answer");
  await expect(editor.locator('pre[data-language="ts"] code .hljs-keyword')).toContainText("const");
  await expect(editor.locator('pre[data-language="json"] code')).toContainText('"name"');
  await expect(editor.locator('pre[data-language="json"] code .hljs-attr').filter({ hasText: '"name"' })).toHaveCount(1);
  await expect(editor.locator(".markdown-preview-block-mermaid .mermaid svg").first()).toBeVisible();
  await expect(editor.locator(".markdown-preview-block-definition-list").first()).toBeVisible();
  await expect(editor.locator(".inline-math .katex")).toContainText("x");
  await expect(editor.locator(".math-block .katex")).toContainText("E");
  await expect(editor.locator(".markdown-preview-block-html").first()).toContainText("Cmd");
  await expect(editor.locator(".markdown-inline-footnote-ref").first()).toContainText("edge");
  await expect(editor.locator(".markdown-preview-block-footnotes").first()).toContainText("Footnote body");
}

async function copyAllFromSource(page: Page) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Meta+C");
}

async function pasteIntoSource(page: Page) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Meta+V");
}

async function pasteMarkdownIntoWysiwyg(page: Page, markdown: string) {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await editor.evaluate((element, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, markdown);
}

async function copyAllFromWysiwyg(page: Page): Promise<{ html: string; text: string }> {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Meta+A");
  return editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData });
    element.dispatchEvent(event);
    return {
      html: clipboardData.getData("text/html"),
      text: clipboardData.getData("text/plain")
    };
  });
}

async function pasteRichIntoWysiwyg(page: Page, clipboard: { html: string; text: string }) {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await editor.evaluate((element, data) => {
    const clipboardData = new DataTransfer();
    if (data.html) {
      clipboardData.setData("text/html", data.html);
    }
    clipboardData.setData("text/plain", data.text);
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, clipboard);
}

async function replaceFocusedText(page: Page, text: string) {
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(text);
}

async function selectedTaskItemIndex(page: Page): Promise<number> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const element = anchor instanceof Element ? anchor : anchor?.parentElement;
    const item = element?.closest(".ProseMirror ul[data-type='taskList'] li[data-checked]");
    const items = Array.from(document.querySelectorAll(".ProseMirror ul[data-type='taskList'] li[data-checked]"));
    return item ? items.indexOf(item) : -1;
  });
}

async function clickInlineCodeTrailingBoundary(page: Page, inlineCode: ReturnType<Page["locator"]>): Promise<boolean> {
  const box = await inlineCode.boundingBox();
  if (!box) {
    return false;
  }
  await page.mouse.click(box.x + box.width + 2, box.y + box.height / 2);
  return page.getByRole("textbox", { name: "Markdown 语法源码" }).isVisible();
}

async function sourceContains(page: Page, text: string): Promise<boolean> {
  return (await sourceText(page)).includes(text);
}

async function sourceText(page: Page): Promise<string> {
  return page.locator(".cm-content").evaluate((element) => {
    const typedElement = element as HTMLElement & {
      cmTile?: { view?: { state?: { doc?: { toString: () => string } } } };
      cmView?: { view?: { state?: { doc?: { toString: () => string } } } };
    };
    const view = typedElement.cmView?.view ?? typedElement.cmTile?.view;
    return view?.state?.doc?.toString() ?? Array.from(element.querySelectorAll(".cm-line")).map((line) => line.textContent ?? "").join("\n");
  });
}

async function setSourceText(page: Page, text: string) {
  await page.locator(".cm-content").evaluate((element, nextText) => {
    const typedElement = element as HTMLElement & {
      cmTile?: { view?: { state: { doc: { length: number } }; dispatch: (spec: unknown) => void; focus: () => void } };
      cmView?: { view?: { state: { doc: { length: number } }; dispatch: (spec: unknown) => void; focus: () => void } };
    };
    const view = typedElement.cmView?.view ?? typedElement.cmTile?.view;
    if (!view) {
      throw new Error("CodeMirror view not found");
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextText },
      selection: { anchor: nextText.length },
      scrollIntoView: true
    });
    view.focus();
  }, text);
}
