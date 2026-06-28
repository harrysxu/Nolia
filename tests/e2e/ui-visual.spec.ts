import { expect, test, type Page } from "@playwright/test";
import { installMockNolia } from "./helpers/mockNolia";

test("workspace, settings, search, and resource editor layouts stay readable across themes and sizes", async ({ page }) => {
  await installMockNolia(page, {
    settings: { editorMode: "split", theme: "light" },
    files: {
      "layout.md": [
        "# Layout Smoke",
        "",
        "This document is long enough to render both source and preview panes.",
        "",
        "| Column A | Column B |",
        "| --- | --- |",
        "| alpha | beta |",
        "",
        "```ts",
        "const value = 42;",
        "```"
      ].join("\n"),
      "assets/config.json": "{\"z\":2,\"a\":{\"b\":1}}",
      "assets/notes.txt": "Text editor content"
    }
  });

  await page.setViewportSize({ width: 1320, height: 860 });
  await page.goto("/");
  await expect(page.locator(".split-preview")).toBeVisible();
  await assertWorkspaceLayout(page);
  await expectReadable(page, ".statusbar");
  await page.screenshot({ path: "test-results/ui-visual-light-workspace.png", fullPage: false });

  for (const viewport of [
    { width: 1320, height: 860 },
    { width: 1100, height: 760 },
    { width: 900, height: 700 }
  ]) {
    await page.setViewportSize(viewport);
    await assertWorkspaceLayout(page);
    await assertToolbarButtonsVisible(page, "Markdown 工具");
  }

  await page.setViewportSize({ width: 1100, height: 760 });
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expectReadable(page, ".settings-dialog");
  const settingsSize = await rectSize(settingsDialog.locator(".settings-dialog"));
  await settingsDialog.getByRole("tab", { name: "插件管理" }).click();
  await expect(rectSize(settingsDialog.locator(".settings-dialog"))).resolves.toEqual(settingsSize);
  await page.screenshot({ path: "test-results/ui-visual-settings-plugins.png", fullPage: false });

  await settingsDialog.getByRole("tab", { name: "基础设置" }).click();
  await page.getByLabel("主题").selectOption("dark");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await settingsDialog.locator(".settings-close-button").click();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索工作区").fill("layout");
  await expect(page.locator(".result-item").filter({ hasText: "Layout Smoke" })).toBeVisible();
  await assertWorkspaceLayout(page);
  await expectReadable(page, ".sidebar");
  await page.screenshot({ path: "test-results/ui-visual-dark-search.png", fullPage: false });

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByPlaceholder("搜索文件或资源").fill("");
  await page.getByRole("button", { name: /assets/ }).first().click();
  await page.getByRole("button", { name: "config.json", exact: true }).click();
  await page.getByRole("button", { name: "搜索/替换" }).click();
  await expect(page.locator(".editor-find-replace")).toBeVisible();
  await expect(page.locator(".text-resource-codemirror .cm-search")).toHaveCount(0);
  await expectReadable(page, ".resource-editor-toolbar");
  await assertToolbarButtonsVisible(page, "JSON 工具");
  await expectReadable(page, ".editor-find-replace");
  await page.screenshot({ path: "test-results/ui-visual-dark-json-editor.png", fullPage: false });

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "设置" }).click();
  await page.getByLabel("主题").selectOption("paper");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("paper");
  await expectReadable(page, ".settings-dialog");
  await page.getByLabel("主题").selectOption("technical");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("technical");
  await expectReadable(page, ".settings-dialog");
  await assertFloatingEditorsStayBelowModal(page);
  await page.screenshot({ path: "test-results/ui-visual-technical-settings.png", fullPage: false });
});

async function assertWorkspaceLayout(page: Page) {
  const problems = await page.evaluate(() => {
    const selectors = [".app-nav", ".sidebar", ".editor-zone", ".right-panel", ".statusbar"];
    const rects = selectors.flatMap((selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        return [];
      }
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return [];
      }
      const rect = element.getBoundingClientRect();
      return [{ selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }];
    });
    const viewportProblems = rects.flatMap((rect) => {
      const issues: string[] = [];
      if (rect.width <= 0 || rect.height <= 0) {
        issues.push(`${rect.selector} has no visible size`);
      }
      if (rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1) {
        issues.push(`${rect.selector} is outside viewport`);
      }
      return issues;
    });
    const overlapProblems: string[] = [];
    for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
        const left = rects[leftIndex];
        const right = rects[rightIndex];
        const overlapWidth = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
        const overlapHeight = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
        if (overlapWidth * overlapHeight > 4) {
          overlapProblems.push(`${left.selector} overlaps ${right.selector}`);
        }
      }
    }
    const chromeProblems: string[] = [];
    if (document.querySelector(".titlebar")) {
      chromeProblems.push("app shell should not render a duplicate titlebar");
    }
    for (const selector of [".app-nav", ".app-nav-main"]) {
      const element = document.querySelector(selector);
      if (element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1) {
        chromeProblems.push(`${selector} has horizontal overflow`);
      }
    }
    return [...viewportProblems, ...overlapProblems, ...chromeProblems, document.body.scrollWidth > document.body.clientWidth + 1 ? "body has horizontal overflow" : ""].filter(Boolean);
  });
  expect(problems).toEqual([]);
}

async function expectReadable(page: Page, selector: string) {
  const ratio = await page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!(element instanceof HTMLElement)) {
      return 0;
    }
    const parseRgb = (value: string): [number, number, number, number] | undefined => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([.\d]+))?\)/);
      if (!match) {
        return undefined;
      }
      return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
    };
    const relativeLuminance = ([red, green, blue]: [number, number, number]) => {
      const channel = [red, green, blue].map((value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2];
    };
    const foreground = parseRgb(getComputedStyle(element).color);
    let cursor: HTMLElement | null = element;
    let background: [number, number, number, number] | undefined;
    while (cursor && !background) {
      const candidate = parseRgb(getComputedStyle(cursor).backgroundColor);
      if (candidate && candidate[3] > 0.8) {
        background = candidate;
      }
      cursor = cursor.parentElement;
    }
    background ??= parseRgb(getComputedStyle(document.body).backgroundColor);
    if (!foreground || !background) {
      return 0;
    }
    const lighter = Math.max(relativeLuminance([foreground[0], foreground[1], foreground[2]]), relativeLuminance([background[0], background[1], background[2]]));
    const darker = Math.min(relativeLuminance([foreground[0], foreground[1], foreground[2]]), relativeLuminance([background[0], background[1], background[2]]));
    return (lighter + 0.05) / (darker + 0.05);
  }, selector);
  expect(ratio).toBeGreaterThan(3);
}

async function assertToolbarButtonsVisible(page: Page, toolbarLabel: string) {
  const problems = await page.evaluate((label) => {
    const toolbar = document.querySelector(`[role="toolbar"][aria-label="${label}"]`);
    if (!(toolbar instanceof HTMLElement)) {
      return [`${label} toolbar is missing`];
    }
    const toolbarRect = toolbar.getBoundingClientRect();
    return [...toolbar.querySelectorAll("button")].flatMap((button) => {
      const rect = button.getBoundingClientRect();
      const name = button.getAttribute("aria-label") ?? button.getAttribute("title") ?? button.textContent?.trim() ?? "unnamed";
      if (
        rect.left < toolbarRect.left - 1 ||
        rect.top < toolbarRect.top - 1 ||
        rect.right > toolbarRect.right + 1 ||
        rect.bottom > toolbarRect.bottom + 1
      ) {
        return [`${label} button ${name} is clipped`];
      }
      return [];
    });
  }, toolbarLabel);
  expect(problems).toEqual([]);
}

async function rectSize(locator: ReturnType<Page["locator"]>) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
}

async function assertFloatingEditorsStayBelowModal(page: Page) {
  const problems = await page.evaluate(() => {
    const modal = document.querySelector(".settings-dialog");
    if (!(modal instanceof HTMLElement)) {
      return ["settings dialog missing"];
    }
    const modalRect = modal.getBoundingClientRect();
    return [...document.querySelectorAll(".editor-find-replace")].flatMap((searchPanel) => {
      if (!(searchPanel instanceof HTMLElement)) {
        return [];
      }
      const panelRect = searchPanel.getBoundingClientRect();
      const left = Math.max(modalRect.left, panelRect.left);
      const right = Math.min(modalRect.right, panelRect.right);
      const top = Math.max(modalRect.top, panelRect.top);
      const bottom = Math.min(modalRect.bottom, panelRect.bottom);
      if (right <= left || bottom <= top) {
        return [];
      }
      const elementAtOverlap = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      if (!elementAtOverlap || modal.contains(elementAtOverlap)) {
        return [];
      }
      return ["editor search panel is rendered above settings dialog"];
    });
  });
  expect(problems).toEqual([]);
}
