import { expect, test } from "@playwright/test";
import { installMockNolia } from "./helpers/mockNolia";

const shortcutModifier = process.platform === "darwin" ? "Meta" : "Control";
const shortcut = (key: string) => `${shortcutModifier}+${key}`;

test("full workspace smoke covers startup, file workflow, search, settings, and autosave", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    activeWorkspace: false,
    settings: { editorMode: "source", autoSaveDelayMs: 40 },
    files: {
      "alpha.md": "# Alpha\n\n中文搜索内容 and baseline body.\n\n[[Target]]\n\n".repeat(35) + "## Deep Section\n\nFinal outline target.",
      "target.md": "# Target\n\nBacklink destination.",
      "projects/nested.md": "# Nested\n\nNested body.",
      "assets/config.json": "{\"z\":2,\"a\":{\"b\":1}}",
      "assets/readme.txt": "plain text"
    },
    backlinks: {
      linked: [{ pathRel: "alpha.md", title: "Alpha", line: 3, context: "[[Target]]" }],
      unlinked: [{ pathRel: "projects/nested.md", title: "Nested", line: 1, context: "Target mention" }]
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Nolia" })).toBeVisible();
  await expect(page.getByText("暂无最近工作区。")).toBeVisible();

  await page.getByRole("button", { name: "创建工作区" }).click();
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await expect(page.locator(".statusbar")).toContainText("alpha.md");
  await expect(page.locator(".source-editor .cm-content")).toContainText("中文搜索内容");
  await page.locator(".app-nav").getByRole("button", { name: "目录" }).click();
  await page.locator(".right-panel").getByRole("button", { name: "Deep Section" }).click();
  await expect(page.locator(".source-editor .cm-content")).toContainText("Deep Section");
  await expect(page.locator(".statusbar")).toContainText("已跳转到第");

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: "新建笔记" }).click();
  await page.getByRole("dialog", { name: "新建笔记" }).locator("input").fill("Release Smoke");
  await page.getByRole("dialog", { name: "新建笔记" }).getByRole("button", { name: "创建" }).click();
  await expect(page.locator(".statusbar")).toContainText("Release-Smoke.md");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { createdPaths: string[] } }).__noliaMock.createdPaths))
    .toContain("Release-Smoke.md");

  const source = page.locator(".source-editor .cm-content");
  await source.click();
  await page.keyboard.press(shortcut("A"));
  await page.keyboard.insertText("# Release Smoke\n\nAutosave body with 中文搜索内容.\n");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { savedText: Record<string, string> } }).__noliaMock.savedText["Release-Smoke.md"]))
    .toContain("Autosave body");
  await expect(page.locator(".statusbar")).toContainText("已保存");

  await page.getByRole("button", { name: "Release-Smoke.md", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名" }).click();
  await page.getByRole("dialog", { name: "重命名笔记" }).locator("input").fill("Renamed Smoke");
  await page.getByRole("dialog", { name: "重命名笔记" }).getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".statusbar")).toContainText("Renamed-Smoke.md");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { renamedPaths: Array<{ targetPathRel: string }> } }).__noliaMock.renamedPaths))
    .toContainEqual(expect.objectContaining({ targetPathRel: "Renamed-Smoke.md" }));

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索工作区").fill("中文搜索内容");
  await expect(page.locator(".result-item").filter({ hasText: "Release Smoke" })).toBeVisible();
  await expect(page.locator(".result-item").filter({ hasText: "Alpha" })).toBeVisible();
  await expect(page.locator(".search-hit").filter({ hasText: "中文搜索内容" }).first()).toBeVisible();
  await page.getByPlaceholder("搜索工作区").fill("not-found-search-boundary");
  await expect(page.getByText("没有匹配的搜索结果。")).toBeVisible();

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await expect(page.getByPlaceholder("搜索文件或资源")).toHaveValue("");
  await page.getByPlaceholder("搜索文件或资源").fill("");
  await page.getByRole("button", { name: "target.md", exact: true }).click();
  await expect(page.locator(".statusbar")).toContainText("target.md");
  await page.getByRole("button", { name: "命令面板" }).click();
  await page.getByPlaceholder("输入命令").fill("反向链接");
  await page.keyboard.press("Enter");
  await expect(page.locator(".result-item", { hasText: "Alpha" })).toContainText("[[Target]]");

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByPlaceholder("搜索文件或资源").fill("");
  await page.getByRole("button", { name: "target.md", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "收藏", exact: true }).click();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "收藏" }).click();
  await expect(page.getByRole("button", { name: "target.md", exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  const dialogSize = await settingsDialog.locator(".settings-dialog").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
  await page.getByLabel("主题").selectOption("dark");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.getByLabel("编辑区宽度").selectOption("narrow");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.editorWidth)).toBe("narrow");
  await page.getByLabel("字体大小").selectOption("large");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-font-size").trim())).toBe("16px");
  await page.getByLabel("专注模式").check();
  await expect(page.locator(".app-shell")).toHaveClass(/is-focus/);
  await page.getByLabel("专注模式").uncheck();
  await expect(page.locator(".app-shell")).not.toHaveClass(/is-focus/);
  await settingsDialog.getByRole("tab", { name: "插件管理" }).click();
  const dialogSizeAfterTab = await settingsDialog.locator(".settings-dialog").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
  expect(dialogSizeAfterTab).toEqual(dialogSize);
  await settingsDialog.locator(".settings-close-button").click();

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByPlaceholder("搜索文件或资源").fill("");
  await page.getByRole("button", { name: "Renamed-Smoke.md", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除" }).click();
  await page.getByRole("dialog", { name: "移到废纸篓" }).getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("button", { name: "Renamed-Smoke.md", exact: true })).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { trashedPaths: string[] } }).__noliaMock.trashedPaths))
    .toContain("Renamed-Smoke.md");
});
