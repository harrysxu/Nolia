import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { installMockNolia } from "./helpers/mockNolia";

test("initializes a writable Markdown folder only after confirmation", async ({ page }) => {
  await installMockNolia(page, {
    activeWorkspace: false,
    session: null,
    workspaceProbe: {
      path: "/tmp/imported-notes",
      name: "Imported Notes",
      status: "initializable",
      readable: true,
      writable: true,
      markdownCount: 12,
      hasNoliaDirectory: false
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开工作区" }).click();
  const dialog = page.getByRole("dialog", { name: "初始化 Imported Notes？" });
  await expect(dialog).toContainText("发现 12 个 Markdown 文件");
  await dialog.getByRole("button", { name: "初始化并打开" }).click();
  await expect(page.getByRole("heading", { name: "Full Selftest Workspace" })).toBeVisible();
});

test("workspace home captures Inbox notes and passes its accessibility scan", async ({ page }) => {
  await installMockNolia(page, { session: null });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Full Selftest Workspace" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include(".workspace-home").analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "快速捕获" }).click();
  const dialog = page.getByRole("dialog", { name: "快速捕获" });
  await dialog.getByLabel("标题").fill("Meeting follow-up");
  await dialog.getByLabel("正文").fill("Call Alice and update the launch checklist.");
  await dialog.getByRole("button", { name: "捕获", exact: true }).click();

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { createdPaths: string[] } }).__noliaMock.createdPaths.some((path) => /^Inbox\/\d{4}-\d{2}\.md$/.test(path)))).toBe(true);
  await expect(page.locator(".source-editor .cm-content")).toContainText("Meeting follow-up");
});

test("workspace home creates Daily Notes and expands safe template variables", async ({ page }) => {
  await installMockNolia(page, {
    session: null,
    files: {
      "home.md": "# Home",
      "Templates/Project.md": "# {{title}}\n\nWorkspace: {{workspace}}\nDate: {{date}} {{time}}"
    }
  });
  await page.goto("/");

  await page.getByRole("button", { name: "今日笔记" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { createdPaths: string[] } }).__noliaMock.createdPaths.some((path) => /^Daily\/\d{4}-\d{2}-\d{2}\.md$/.test(path)))).toBe(true);
  await page.getByRole("button", { name: /关闭文档/ }).click();

  await page.getByRole("button", { name: "从模板新建" }).click();
  const templateDialog = page.getByRole("dialog", { name: "从模板新建" });
  await templateDialog.getByText("Project.md", { exact: true }).click();
  await templateDialog.getByLabel("新笔记标题").fill("Apollo");
  await templateDialog.getByRole("button", { name: "创建笔记" }).click();

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["Apollo.md"])).toContain("# Apollo");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["Apollo.md"])).toContain("Workspace: Full Selftest Workspace");
});

test("edits frontmatter properties and opens the keyboard-accessible local graph", async ({ page }) => {
  await installMockNolia(page, {
    files: {
      "project.md": "---\npriority: 2\npublished: false\n---\n# Project\n\nSee [[Roadmap]].",
      "Roadmap.md": "# Roadmap"
    }
  });
  await page.goto("/");

  const inspector = page.getByRole("tablist", { name: "文档检查器" });
  await inspector.getByRole("tab", { name: "属性" }).click();
  await page.getByRole("button", { name: "添加属性" }).click();
  await page.getByLabel("属性名").fill("status");
  await page.getByLabel("属性值").fill("active");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["project.md"])).toContain("status: active");
  const priority = page.locator(".property-row", { hasText: "priority" }).locator("input");
  await priority.fill("3");
  await priority.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["project.md"])).toContain("priority: 3");

  await inspector.getByRole("tab", { name: "关系" }).click();
  await expect.poll(() => page.evaluate(async () => (await window.nolia.graph.getLocal?.({ workspaceId: "ws_full_selftest", pathRel: "project.md", depth: 1, limit: 60 }))?.nodes.length)).toBe(1);
  await page.getByRole("button", { name: "打开局部关系图" }).click();
  await expect(page.getByRole("heading", { name: "Project 的关系" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "关系节点" }).getByRole("button", { name: "project project.md" })).toBeVisible();
  await page.getByLabel("关系深度").selectOption("2");
  await expect(page.getByLabel("关系深度")).toHaveValue("2");
});

test("keeps the export menu above split editor content", async ({ page }) => {
  await installMockNolia(page, {
    files: {
      "table.md": "| Service | Decision | Notes |\n| --- | --- | --- |\n| ai-voice-agent-core | required | Keep the existing pipeline |"
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "分屏", exact: true }).click();
  await page.getByLabel("导出", { exact: true }).click();

  const pdfItem = page.getByRole("menuitem", { name: "PDF" });
  await expect(pdfItem).toBeVisible();
  await expect.poll(() => pdfItem.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
});

test("runs exact and fallback hybrid search and persists a saved search", async ({ page }) => {
  await installMockNolia(page, {
    session: null,
    files: {
      "alpha.md": "# Alpha\n\nLaunch checklist and notes.",
      "beta.md": "# Beta\n\nUnrelated content."
    }
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "发现" }).click();

  await page.getByPlaceholder("搜索标题、正文、路径、标签或属性").fill("launch");
  await expect(page.getByRole("listbox", { name: "搜索结果" }).getByRole("option")).toHaveCount(1);
  await page.getByRole("button", { name: "混合" }).click();
  await expect(page.getByRole("status")).toContainText("已降级为精确搜索");

  await page.getByRole("button", { name: "保存搜索" }).click();
  await page.getByPlaceholder("搜索名称").fill("Launch notes");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "Launch notes", exact: true })).toBeVisible();
});

test("discovery fills the editor area and searches title, body, and path while documents stay open", async ({ page }) => {
  await installMockNolia(page, {
    files: {
      "claude-notes.md": "# Claude Notes\n\nProvider comparison.",
      "research/providers.md": "# Providers\n\nThe body mentions claude as a fallback model.",
      "other.md": "# Other\n\nUnrelated content."
    }
  });
  await page.goto("/");
  await expect(page.locator(".document-tab")).toHaveCount(1);
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "发现" }).click();

  const discoverPage = page.locator(".discover-page");
  const editorZone = page.locator(".editor-zone");
  const [discoverHeight, editorHeight] = await Promise.all([
    discoverPage.evaluate((element) => element.getBoundingClientRect().height),
    editorZone.evaluate((element) => element.getBoundingClientRect().height)
  ]);
  expect(discoverHeight).toBeGreaterThan(editorHeight * 0.9);

  const search = page.getByPlaceholder("搜索标题、正文、路径、标签或属性");
  await search.fill("claude");
  await expect(page.getByRole("listbox", { name: "搜索结果" }).getByRole("option")).toHaveCount(2);
  await search.fill("research/providers");
  await expect(page.getByRole("status").filter({ hasText: "正在搜索" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "搜索结果" })).toHaveCount(0);
  await expect(page.getByRole("listbox", { name: "搜索结果" }).getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("Providers");
  await search.fill("missing-provider-boundary");
  await expect(page.getByText("没有匹配结果。")).toBeVisible();
});

test("keeps the newest search results when an older request finishes later", async ({ page }) => {
  await installMockNolia(page, {
    session: null,
    files: {
      "alpha.md": "# Alpha\n\nNewest result.",
      "slow.md": "# Slow\n\nOlder delayed result."
    }
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "发现" }).click();
  await page.evaluate(() => {
    const original = window.nolia.search.unified!;
    window.nolia.search.unified = async (request) => {
      if (request.query.text === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return original(request);
    };
  });

  const search = page.getByPlaceholder("搜索标题、正文、路径、标签或属性");
  await search.fill("slow");
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "正在搜索" }).first()).toBeVisible();
  await page.waitForTimeout(180);
  await search.fill("alpha");
  await expect(page.getByRole("option")).toContainText("Alpha");
  await page.waitForTimeout(550);
  await expect(page.getByRole("option")).toContainText("Alpha");
  await expect(page.getByRole("option")).not.toContainText("Slow");
});

test("filters by indexed tags and confirms transactional tag rename previews", async ({ page }) => {
  await installMockNolia(page, {
    session: null,
    files: {
      "alpha.md": "---\ntags: [dev]\n---\n# Alpha\n\nShip #dev notes.",
      "beta.md": "---\ntags: [research]\n---\n# Beta\n\nResearch notes."
    }
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "发现" }).click();

  await page.getByRole("button", { name: "#dev 1" }).click();
  await expect(page.getByRole("listbox", { name: "搜索结果" }).getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("Alpha");

  await page.getByRole("button", { name: "重命名标签 dev" }).click();
  await page.getByLabel("新标签名称").fill("engineering");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /重命名标签并更新/ });
  await expect(dialog).toContainText("#dev → #engineering");
  await dialog.getByRole("button", { name: "重命名并更新标签" }).click();

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["alpha.md"])).toContain("#engineering");
  await expect(page.getByRole("button", { name: "#engineering 1" })).toBeVisible();
});

test("completes wikilinks by title and creates missing notes without leaving the editor", async ({ page }) => {
  await installMockNolia(page, {
    settings: { editorMode: "source", autoSaveDelayMs: 30 },
    files: {
      "current.md": "# Current\n\n",
      "Roadmap.md": "# Product Roadmap\n"
    }
  });
  await page.goto("/");
  const editor = page.locator(".source-editor .cm-content");
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.insertText("[[Roa");
  const completion = page.locator(".cm-tooltip-autocomplete li", { hasText: "Product Roadmap" });
  await expect(completion).toBeVisible();
  await completion.click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { savedText: Record<string, string> } }).__noliaMock.savedText["current.md"])).toContain("[[Roadmap]]");

  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.insertText("\n[[Brand New");
  const createCompletion = page.locator(".cm-tooltip-autocomplete li", { hasText: "创建“Brand New”" });
  await expect(createCompletion).toBeVisible();
  await createCompletion.click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { createdPaths: string[] } }).__noliaMock.createdPaths)).toContain("Brand-New.md");
  await expect(page.locator(".source-editor .cm-content")).toBeVisible();
});
