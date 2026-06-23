import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../../src/shared/constants";
import type { AppSettings } from "../../src/shared/types";
import { installMockNolia } from "./helpers/mockNolia";

declare global {
  interface Window {
    __emitWorkspaceIndexed?: (event?: { pathRel?: string }) => void;
    __setMockFileContent?: (pathRel: string, content: string) => void;
  }
}

const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  language: "zh-CN",
  theme: "light",
  editorMode: "source",
  editorWidth: "wide",
  fontSize: "medium",
  focusMode: false,
  autoSaveDelayMs: 1000,
  attachmentStrategy: "workspace_assets",
  pluginSafeMode: false,
  plugins: {}
};

test("find and replace works in source, split, and WYSIWYG modes", async ({ page }) => {
  await setupEditorWorkspace(page);
  await openNote(page, "find.md");

  await openFindReplace(page);
  await page.locator(".editor-find-query").fill("alpha");
  await page.locator(".editor-replace-input").fill("omega");
  await page.locator(".editor-find-replace").getByRole("button", { name: "替换", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("omega beta alpha");

  await page.getByRole("button", { name: "分屏", exact: true }).click();
  await page.locator(".editor-find-query").fill("beta");
  await page.locator(".editor-replace-input").fill("delta");
  await page.locator(".editor-find-replace").getByRole("button", { name: "全部替换", exact: true }).click();
  await expect(page.locator(".split-editor .cm-content")).toContainText("omega delta alpha");
  await expect(page.locator(".split-preview")).toContainText("omega delta alpha");

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".editor-find-query").fill("visible");
  await page.locator(".editor-replace-input").fill("readable");
  await page.locator(".editor-find-replace").getByRole("button", { name: "全部替换", exact: true }).click();
  await expect(page.locator(".ProseMirror")).toContainText("readable text");
  await expect(page.locator(".ProseMirror")).not.toContainText("visible text");
});

test("find next, previous, and shortcut use the Nolia find bar", async ({ page }) => {
  await setupEditorWorkspace(page);
  await openNote(page, "cycle.md");

  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+F" : "Control+F");
  await expect(page.locator(".editor-find-replace")).toBeVisible();
  await expect(page.locator(".source-editor .cm-search")).toHaveCount(0);

  const selectionBeforeQuery = await sourceSelection(page);
  await page.locator(".editor-find-query").fill("Decision token");
  await expect.poll(() => sourceSelection(page)).toEqual(selectionBeforeQuery);

  await page.keyboard.press("Enter");
  await expect(page.locator(".editor-find-count")).toHaveText("1/3");
  await expectSourceSelection(page, "Decision token", 3);

  const findButtons = page.locator(".editor-find-replace .toolbar-icon-button");
  await findButtons.nth(1).click();
  await expect(page.locator(".editor-find-count")).toHaveText("2/3");
  await expectSourceSelection(page, "Decision token", 5);

  await findButtons.nth(1).click();
  await expect(page.locator(".editor-find-count")).toHaveText("3/3");
  await expectSourceSelection(page, "Decision token", 7);

  await findButtons.nth(1).click();
  await expect(page.locator(".editor-find-count")).toHaveText("1/3");
  await expectSourceSelection(page, "Decision token", 3);

  await findButtons.nth(0).click();
  await expect(page.locator(".editor-find-count")).toHaveText("3/3");
  await expectSourceSelection(page, "Decision token", 7);
});

test("typing replacement text does not run find or move the active match", async ({ page }) => {
  await setupEditorWorkspace(page);
  await openNote(page, "cycle.md");

  await openFindReplace(page);
  await page.locator(".editor-find-query").fill("Decision token");
  await page.keyboard.press("Enter");
  await expect(page.locator(".editor-find-count")).toHaveText("1/3");
  await expectSourceSelection(page, "Decision token", 3);

  await page.locator(".editor-replace-input").pressSequentially("Resolved token", { delay: 10 });
  await expect(page.locator(".editor-find-count")).toHaveText("1/3");
  await expect.poll(() => sourceActiveLine(page)).toBe(3);
  await expect(page.locator(".cm-content")).not.toContainText("Resolved token");

  await page.locator(".editor-find-replace").getByRole("button", { name: "替换", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("Resolved token: one.");
  await expect(page.locator(".editor-find-count")).toHaveText("1/2");
});

test("find replace bar wraps without overlapping when the history panel is open", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await setupEditorWorkspace(page);
  await openNote(page, "find.md");
  await openFindReplace(page);
  await page.locator(".editor-find-query").fill("Nolia");
  await page.locator(".editor-replace-input").fill("Noliaa");

  await page.locator(".editor-topbar-outline-slot .outline-toggle-button").nth(1).click();
  await expect(page.locator(".right-panel.history")).toBeVisible();

  await expect.poll(() => findBarLayoutIssues(page)).toEqual([]);
});

test("external changes refresh clean open documents and preserve dirty edits", async ({ page }) => {
  await setupEditorWorkspace(page);
  await openNote(page, "refresh.md");

  await page.evaluate(() => {
    window.__setMockFileContent?.("refresh.md", "# Refresh\n\nChanged outside.");
    window.__emitWorkspaceIndexed?.({ pathRel: "refresh.md" });
  });
  await expect(page.locator(".cm-content")).toContainText("Changed outside.");
  await expect(page.locator(".statusbar")).toContainText("已同步外部修改");
  await expect(page.locator(".statusbar")).not.toContainText("已同步外部修改：refresh.md");

  await page.locator(".cm-content").click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("# Refresh\n\nLocal unsaved edit.");
  await page.evaluate(() => {
    window.__setMockFileContent?.("refresh.md", "# Refresh\n\nSecond outside change.");
    window.__emitWorkspaceIndexed?.({ pathRel: "refresh.md" });
  });
  await expect(page.locator(".cm-content")).toContainText("Local unsaved edit.");
  await expect(page.locator(".cm-content")).not.toContainText("Second outside change.");

  await openNote(page, "manual.md");
  await page.evaluate(() => {
    window.__setMockFileContent?.("manual.md", "# Manual\n\nManual refresh content.");
  });
  await page.locator(".editor-topbar").getByRole("button", { name: "重新读取" }).click();
  await expect(page.locator(".cm-content")).toContainText("Manual refresh content.");
});

async function setupEditorWorkspace(page: Page) {
  await installMockNolia(page, {
    settings,
    workspace: {
      workspaceId: "ws_editor_find_refresh",
      name: "Editor Find Refresh",
      rootPath: "/tmp/editor-find-refresh",
      configPath: "/tmp/editor-find-refresh/.nolia"
    },
    files: {
      "find.md": "# Find\n\nalpha beta alpha\n\nvisible text",
      "cycle.md": "# Cycle\n\nDecision token: one.\n\nDecision token: two.\n\nDecision token: three.\n",
      "refresh.md": "# Refresh\n\nOriginal.",
      "manual.md": "# Manual\n\nOriginal manual."
    }
  });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
}

async function openNote(page: Page, pathRel: string) {
  await page.getByRole("button", { name: pathRel, exact: true }).click();
  await expect(page.locator(".statusbar")).toContainText(pathRel);
}

async function openFindReplace(page: Page) {
  await page.getByRole("button", { name: "查找和替换" }).click();
  await expect(page.locator(".editor-find-replace")).toBeVisible();
}

async function expectSourceSelection(page: Page, text: string, line: number) {
  await expect.poll(() => sourceSelection(page)).toEqual({ text, line });
}

async function sourceSelection(page: Page) {
  return page.locator(".cm-content").evaluate((element) => {
    const selectedText = window.getSelection()?.toString() ?? "";
    const lines = Array.from(element.querySelectorAll<HTMLElement>(".cm-line"));
    const activeLine = element.querySelector<HTMLElement>(".cm-activeLine");
    return {
      text: selectedText,
      line: activeLine ? lines.indexOf(activeLine) + 1 : -1
    };
  });
}

async function sourceActiveLine(page: Page) {
  return page.locator(".cm-content").evaluate((element) => {
    const lines = Array.from(element.querySelectorAll<HTMLElement>(".cm-line"));
    const activeLine = element.querySelector<HTMLElement>(".cm-activeLine");
    return activeLine ? lines.indexOf(activeLine) + 1 : -1;
  });
}

async function findBarLayoutIssues(page: Page) {
  return page.locator(".editor-find-replace").evaluate((bar) => {
    const parent = bar.closest(".editor-pane") ?? bar.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    const controls = Array.from(bar.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement && child.offsetParent !== null)
      .map((child, index) => ({ index, rect: child.getBoundingClientRect() }));
    const issues: string[] = [];
    if (parentRect) {
      controls.forEach(({ index, rect }) => {
        if (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1) {
          issues.push(`control ${index} overflows editor pane`);
        }
      });
    }
    for (let leftIndex = 0; leftIndex < controls.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < controls.length; rightIndex += 1) {
        const left = controls[leftIndex].rect;
        const right = controls[rightIndex].rect;
        const horizontallyOverlaps = left.left < right.right - 1 && right.left < left.right - 1;
        const verticallyOverlaps = left.top < right.bottom - 1 && right.top < left.bottom - 1;
        if (horizontallyOverlaps && verticallyOverlaps) {
          issues.push(`control ${controls[leftIndex].index} overlaps ${controls[rightIndex].index}`);
        }
      }
    }
    return issues;
  });
}
