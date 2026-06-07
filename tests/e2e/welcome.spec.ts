import { expect, test, type Locator } from "@playwright/test";
import type { AppSettings, FileTreeNode, ParsedDocument, RecentWorkspace, WorkspaceInfo } from "../../src/shared/types";
import { installMockNolia } from "./helpers/mockNolia";

const shortcutModifier = process.platform === "darwin" ? "Meta" : "Control";
const shortcut = (key: string) => `${shortcutModifier}+${key}`;

const settings: AppSettings = {
  language: "zh-CN",
  theme: "light",
  editorMode: "wysiwyg",
  editorWidth: "medium",
  fontSize: "medium",
  focusMode: false,
  autoSaveDelayMs: 800,
  attachmentStrategy: "workspace_assets",
  pluginSafeMode: false,
  plugins: {}
};

test("welcome screen renders with preload API mocked", async ({ page }) => {
  await page.addInitScript((mockSettings) => {
    window.nolia = {
      workspace: {
        bootstrap: async () => ({ recentWorkspaces: [], settings: mockSettings }),
        open: async () => undefined,
        create: async () => undefined,
        listRecent: async () => [],
        listTags: async () => [],
        switch: async () => ({ ok: false }),
        close: async () => undefined
      },
      file: {
        listTree: async () => ({ nodes: [] }),
        read: async () => ({ content: "", stat: { size: 0, mtimeMs: 0, birthtimeMs: 0 }, sha256: "new", encoding: "utf-8" }),
        writeAtomic: async () => ({ status: "saved", sha256: "new", mtimeMs: 0 }),
        create: async () => ({ ok: true, affectedPaths: [] }),
        rename: async () => ({ ok: true, affectedPaths: [] }),
        trash: async () => ({ ok: true, affectedPaths: [] })
      },
      document: { parse: async () => ({ frontmatter: {}, title: "Untitled", body: "", plainText: "", headings: [], tags: [], links: [], wikilinks: [], attachments: [], diagnostics: [], wordCount: 0, lineCount: 0 }) },
      search: { query: async () => ({ items: [], indexVersion: 0, isPartial: false }) },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
      export: { document: async () => ({ status: "failed", warnings: [] }) },
      clipboard: { writeRich: async () => ({ ok: true }) },
      settings: { get: async () => mockSettings, set: async () => mockSettings },
      diagnostics: { openLogs: async () => "" },
      events: {
        onAppCommand: () => () => undefined,
        onExternalFileOpen: () => () => undefined
      }
    };
  }, settings);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Nolia" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "继续上次的工作" })).toBeVisible();
});

test("welcome recent workspace cards open available workspaces and remove unavailable paths", async ({ page }) => {
  const now = Date.now();
  const recentWorkspaces: RecentWorkspace[] = [
    {
      workspaceId: "missing-recent-workspace",
      name: "Missing Workspace",
      path: "/tmp/nolia-missing-workspace",
      createdAt: now - 4000,
      lastOpenedAt: now - 1000,
      exists: false
    },
    {
      workspaceId: "available-recent-workspace",
      name: "Available Workspace",
      path: "/tmp/nolia-available-workspace",
      createdAt: now - 8000,
      lastOpenedAt: now - 500,
      exists: true
    }
  ];

  await installMockNolia(page, {
    activeWorkspace: false,
    workspace: {
      workspaceId: "available-recent-workspace",
      name: "Available Workspace",
      rootPath: "/tmp/nolia-available-workspace",
      configPath: "/tmp/nolia-available-workspace/.nolia"
    },
    recentWorkspaces,
    files: { "home.md": "# Recent Home\n\nOpened from the welcome screen." }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "继续上次的工作" })).toBeVisible();
  await expect(page.locator(".welcome-content")).toBeVisible();
  await expect(page.locator(".welcome-recent-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: /Missing Workspace/ })).toContainText("路径不可用");

  await page.getByRole("button", { name: /Missing Workspace/ }).click();
  await expect(page.getByRole("button", { name: /Missing Workspace/ })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Nolia" })).toBeVisible();

  await page.getByRole("button", { name: /Available Workspace/ }).click();
  await expect(page.getByText("文件与资源")).toBeVisible();
  await expect(page.getByRole("banner").getByText("Available Workspace")).toBeVisible();
  await expect(page.getByRole("button", { name: "home.md", exact: true })).toBeVisible();
});

test("closing the active workspace returns to the recent workspace home", async ({ page }) => {
  await installMockNolia(page, {
    workspace: {
      workspaceId: "close-workspace",
      name: "Close Workspace",
      rootPath: "/tmp/nolia-close-workspace",
      configPath: "/tmp/nolia-close-workspace/.nolia"
    },
    recentWorkspaces: [
      {
        workspaceId: "close-workspace",
        name: "Close Workspace",
        path: "/tmp/nolia-close-workspace",
        createdAt: Date.now() - 5000,
        lastOpenedAt: Date.now(),
        exists: true
      }
    ],
    files: { "home.md": "# Close Home\n\nWorkspace content." }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "命令面板" }).click();
  await page.getByPlaceholder("输入命令").fill("关闭工作区");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Nolia" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "继续上次的工作" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Close Workspace/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Nolia" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toHaveCount(0);
});

test("workspace startup routes JSON recent results through the JSON editor", async ({ page }) => {
  const shellSettings: AppSettings = { ...settings, editorMode: "source" };

  await page.addInitScript((mockSettings: AppSettings) => {
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_json_startup",
      name: "JSON Startup Workspace",
      rootPath: "/tmp/json-startup-workspace",
      configPath: "/tmp/json-startup-workspace/.nolia",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 }
    };
    const files = new Map<string, string>([
      ["home.md", "# Home\n\nMarkdown body."],
      ["config.json", "{\"enabled\":true,\"count\":2}"]
    ]);
    const parsed: ParsedDocument = {
      frontmatter: {},
      title: "Home",
      body: "# Home",
      plainText: "Home",
      headings: [{ id: "home", text: "Home", depth: 1, line: 1 }],
      tags: [],
      links: [],
      wikilinks: [],
      attachments: [],
      diagnostics: [],
      wordCount: 1,
      lineCount: 1
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
        listTree: async () => ({
          nodes: [
            { pathRel: "config.json", name: "config.json", kind: "other", size: files.get("config.json")?.length ?? 0, mtimeMs: Date.now() },
            { pathRel: "home.md", name: "home.md", kind: "markdown", size: files.get("home.md")?.length ?? 0, mtimeMs: Date.now() }
          ]
        }),
        read: async ({ pathRel }) => {
          const content = files.get(pathRel) ?? "";
          return { content, stat: { size: content.length, mtimeMs: 0, birthtimeMs: 0 }, sha256: `${pathRel}-hash`, encoding: "utf-8" };
        },
        writeAtomic: async ({ pathRel, content }) => {
          files.set(pathRel, content);
          return { status: "saved", sha256: `${pathRel}-saved`, mtimeMs: Date.now() };
        },
        create: async () => ({ ok: true, affectedPaths: [] }),
        rename: async () => ({ ok: true, affectedPaths: [] }),
        trash: async () => ({ ok: true, affectedPaths: [] })
      },
      document: { parse: async () => parsed },
      search: {
        query: async () => ({
          items: [
            { pathRel: "config.json", title: "config.json", score: 1, snippets: ["config.json"] },
            { pathRel: "home.md", title: "Home", score: 1, snippets: ["home.md"] }
          ],
          indexVersion: 1,
          isPartial: false
        })
      },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
      export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
      clipboard: { writeRich: async () => ({ ok: true }) },
      settings: { get: async () => mockSettings, set: async () => mockSettings },
      diagnostics: { openLogs: async () => "" },
      events: {
        onAppCommand: () => () => undefined,
        onExternalFileOpen: () => () => undefined
      }
    };
  }, shellSettings);

  await page.goto("/");
  await expect(page.locator(".resource-kind-pill")).toHaveText("JSON 编辑器");
  await expect(page.getByTestId("builtin-json-editor")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "JSON 工具" })).toBeVisible();
  await expect(page.getByRole("button", { name: "MD", exact: true })).toHaveCount(0);
  await expect(page.locator(".editor-toolbar, .markdown-actionbar")).toHaveCount(0);
});

test("recent list keeps current order while active and refreshes on re-entry", async ({ page }) => {
  const shellSettings: AppSettings = { ...settings, editorMode: "source" };

  await page.addInitScript((mockSettings: AppSettings) => {
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_recent_freeze",
      name: "Recent Freeze Workspace",
      rootPath: "/tmp/recent-freeze-workspace",
      configPath: "/tmp/recent-freeze-workspace/.nolia",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 }
    };
    const docs: Record<string, string> = {
      "alpha.md": "# Alpha\n\nAlpha content",
      "beta.md": "# Beta\n\nBeta content"
    };
    window.localStorage.setItem(
      "nolia:ws_recent_freeze:recentViewed",
      JSON.stringify([
        { pathRel: "alpha.md", title: "Alpha", timestamp: 2000 },
        { pathRel: "beta.md", title: "Beta", timestamp: 1000 }
      ])
    );
    const parseDocument = (pathRel: string, content: string): ParsedDocument => {
      const title = pathRel === "beta.md" ? "Beta" : "Alpha";
      return {
        frontmatter: {},
        title,
        body: content,
        plainText: content,
        headings: [{ id: title.toLowerCase(), text: title, depth: 1, line: 1 }],
        tags: [],
        links: [],
        wikilinks: [],
        attachments: [],
        diagnostics: [],
        wordCount: content.split(/\s+/).filter(Boolean).length,
        lineCount: content.split(/\r?\n/).length
      };
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
        listTree: async () => ({
          nodes: Object.entries(docs).map(([pathRel, content]) => ({ pathRel, name: pathRel, kind: "markdown", size: content.length, mtimeMs: Date.now() }))
        }),
        read: async ({ pathRel }) => ({ content: docs[pathRel] ?? "", stat: { size: docs[pathRel]?.length ?? 0, mtimeMs: 0, birthtimeMs: 0 }, sha256: `${pathRel}-hash`, encoding: "utf-8" }),
        writeAtomic: async () => ({ status: "saved", sha256: "saved", mtimeMs: Date.now() }),
        create: async () => ({ ok: true, affectedPaths: [] }),
        rename: async () => ({ ok: true, affectedPaths: [] }),
        trash: async () => ({ ok: true, affectedPaths: [] })
      },
      document: { parse: async ({ pathRel, content }) => parseDocument(pathRel, content) },
      search: {
        query: async () => ({
          items: [
            { pathRel: "alpha.md", title: "Alpha", score: 1, snippets: ["alpha.md"] },
            { pathRel: "beta.md", title: "Beta", score: 0.9, snippets: ["beta.md"] }
          ],
          indexVersion: 1,
          isPartial: false
        })
      },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
      export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
      clipboard: { writeRich: async () => ({ ok: true }) },
      settings: { get: async () => mockSettings, set: async () => mockSettings },
      diagnostics: { openLogs: async () => "" },
      events: {
        onAppCommand: () => () => undefined,
        onExternalFileOpen: () => () => undefined
      }
    };
  }, shellSettings);

  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "最近", exact: true }).click();
  const recentItems = page.locator(".document-simple-list .document-simple-item");
  await expect(recentItems.nth(0).locator(".document-simple-name")).toHaveText("alpha.md");
  await expect(recentItems.nth(1).locator(".document-simple-name")).toHaveText("beta.md");

  await page.getByRole("button", { name: "beta.md", exact: true }).click();
  await expect(page.locator(".breadcrumb strong")).toHaveText("beta.md");
  await expect(recentItems.nth(0).locator(".document-simple-name")).toHaveText("alpha.md");
  await expect(recentItems.nth(1).locator(".document-simple-name")).toHaveText("beta.md");

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "最近", exact: true }).click();
  await expect(recentItems.nth(0).locator(".document-simple-name")).toHaveText("beta.md");
  await expect(recentItems.nth(1).locator(".document-simple-name")).toHaveText("alpha.md");
});

test("settings apply theme, focus, and editor width preferences", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  const shellSettings: AppSettings = { ...settings, theme: "system", editorMode: "source", editorWidth: "full" };

  await page.addInitScript((mockSettings: AppSettings) => {
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_settings",
      name: "Settings Workspace",
      rootPath: "/tmp/settings-workspace",
      configPath: "/tmp/settings-workspace/.nolia",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 }
    };
    let mutableSettings = { ...mockSettings };
    const content = "# Settings\n\n" + Array.from({ length: 20 }, (_, index) => `Line ${index + 1}`).join("\n");
    const parsed: ParsedDocument = {
      frontmatter: {},
      title: "Settings",
      body: content,
      plainText: content,
      headings: [{ id: "settings", text: "Settings", depth: 1, line: 1 }],
      tags: [],
      links: [],
      wikilinks: [],
      attachments: [],
      diagnostics: [],
      wordCount: content.split(/\s+/).filter(Boolean).length,
      lineCount: content.split(/\r?\n/).length
    };

    window.nolia = {
      workspace: {
        bootstrap: async () => ({
          activeWorkspace: workspace,
          recentWorkspaces: [],
          settings: mutableSettings,
          appInfo: {
            platform: "linux",
            pluginDirectory: "/tmp/nolia-full-selftest/plugins",
            logsDirectory: "/tmp/nolia-full-selftest/logs"
          }
        }),
        open: async () => workspace,
        create: async () => workspace,
        listRecent: async () => [],
        listTags: async () => [],
        switch: async () => ({ ok: true, restoredState: workspace }),
        close: async () => undefined
      },
      file: {
        listTree: async () => ({ nodes: [{ pathRel: "settings.md", name: "settings.md", kind: "markdown", size: content.length, mtimeMs: Date.now() }] }),
        read: async () => ({ content, stat: { size: content.length, mtimeMs: 0, birthtimeMs: 0 }, sha256: "settings-hash", encoding: "utf-8" }),
        writeAtomic: async () => ({ status: "saved", sha256: "settings-saved", mtimeMs: Date.now() }),
        create: async () => ({ ok: true, affectedPaths: [] }),
        rename: async () => ({ ok: true, affectedPaths: [] }),
        trash: async () => ({ ok: true, affectedPaths: [] })
      },
      document: { parse: async () => parsed },
      search: { query: async () => ({ items: [{ pathRel: "settings.md", title: "Settings", score: 1, snippets: ["settings.md"] }], indexVersion: 1, isPartial: false }) },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
      export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
      clipboard: { writeRich: async () => ({ ok: true }) },
      settings: {
        get: async () => mutableSettings,
        set: async ({ key, value }) => {
          mutableSettings = { ...mutableSettings, [key]: value };
          return mutableSettings;
        }
      },
      diagnostics: { openLogs: async () => "" },
      events: {
        onAppCommand: () => () => undefined,
        onExternalFileOpen: () => () => undefined
      }
    };
  }, shellSettings);

  await page.goto("/");
  await expect(page.locator(".source-editor .cm-content")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");

  const fullWidth = await page.locator(".source-editor .cm-content").evaluate((element) => element.getBoundingClientRect().width);
  await expect
    .poll(() =>
      page.locator(".source-editor .cm-gutters").evaluate((gutters) => {
        const scroller = gutters.closest(".cm-scroller");
        return scroller instanceof HTMLElement ? gutters.getBoundingClientRect().height >= scroller.getBoundingClientRect().height - 1 : false;
      })
    )
    .toBe(true);
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByText("显示 Markdown 工具栏")).toHaveCount(0);
  await expect(settingsDialog.getByText("显示源码行号")).toHaveCount(0);
  await expect(settingsDialog.getByText("打字机模式")).toHaveCount(0);
  const selectLeftOffsets = await settingsDialog.locator("select").evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().left)));
  expect(new Set(selectLeftOffsets).size).toBe(1);
  const dialogBoxBefore = await settingsDialog.locator(".settings-dialog").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
  expect(dialogBoxBefore.width).toBeGreaterThanOrEqual(760);
  expect(dialogBoxBefore.height).toBeGreaterThanOrEqual(560);
  await settingsDialog.getByRole("tab", { name: "插件管理" }).click();
  await expect(settingsDialog.getByLabel("外部插件安全模式")).toBeVisible();
  const pluginSafeModeRow = await settingsDialog.locator(".plugin-control-form .setting-row").first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  });
  const externalPluginHeader = await settingsDialog.locator(".plugin-settings header").first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  });
  expect(pluginSafeModeRow.bottom).toBeLessThan(externalPluginHeader.top);
  await expect(settingsDialog.locator(".plugin-settings header").getByText("外部插件", { exact: true })).toBeVisible();
  await expect(settingsDialog.getByText("插件目录：/tmp/nolia-full-selftest/plugins")).toBeVisible();
  await expect(settingsDialog.locator(".plugin-settings header").getByText("内置扩展", { exact: true })).toBeVisible();
  const dialogBoxAfter = await settingsDialog.locator(".settings-dialog").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: Math.round(box.width), height: Math.round(box.height) };
  });
  expect(dialogBoxAfter).toEqual(dialogBoxBefore);
  await settingsDialog.getByRole("tab", { name: "基础设置" }).click();

  await page.getByLabel("编辑区宽度").selectOption("narrow");
  await expect.poll(() => page.locator(".source-editor .cm-content").evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(fullWidth - 80);
  await page.getByLabel("字体大小").selectOption("large");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-font-size").trim())).toBe("16px");

  await settingsDialog.locator(".settings-close-button").click();

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "设置" }).click();
  await page.getByLabel("专注模式").check();
  await expect(page.locator(".app-shell")).toHaveClass(/is-focus/);
  await page.getByRole("dialog", { name: "设置" }).locator(".settings-close-button").click();
  await expect.poll(() => page.locator(".app-nav").evaluate((element) => Number(getComputedStyle(element).opacity))).toBeLessThan(0.5);
});

test("split source typing keeps latest text while parse and autosave resolve out of order", async ({ page }) => {
  const shellSettings: AppSettings = { ...settings, editorMode: "split", autoSaveDelayMs: 30 };

  await page.addInitScript((mockSettings: AppSettings) => {
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_split_typing",
      name: "Split Typing Workspace",
      rootPath: "/tmp/split-typing-workspace",
      configPath: "/tmp/split-typing-workspace/.nolia",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 }
    };
    let content = "# Split Typing\n\n";
    let saveCount = 0;
    const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const parseDocument = (value: string): ParsedDocument => ({
      frontmatter: {},
      title: "Split Typing",
      body: value,
      plainText: value,
      headings: [{ id: "split-typing", text: "Split Typing", depth: 1, line: 1 }],
      tags: [],
      links: [],
      wikilinks: [],
      attachments: [],
      diagnostics: [],
      wordCount: value.split(/\s+/).filter(Boolean).length,
      lineCount: value.split(/\r?\n/).length
    });

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
        listTree: async () => ({ nodes: [{ pathRel: "split.md", name: "split.md", kind: "markdown", size: content.length, mtimeMs: Date.now() }] }),
        read: async () => ({ content, stat: { size: content.length, mtimeMs: 0, birthtimeMs: 0 }, sha256: "split-hash", encoding: "utf-8" }),
        writeAtomic: async ({ content: savedContent }) => {
          saveCount += 1;
          await delay(saveCount === 1 ? 220 : 30);
          content = savedContent;
          return { status: "saved", sha256: `split-saved-${saveCount}`, mtimeMs: Date.now() };
        },
        create: async () => ({ ok: true, affectedPaths: [] }),
        rename: async () => ({ ok: true, affectedPaths: [] }),
        trash: async () => ({ ok: true, affectedPaths: [] })
      },
      document: {
        parse: async ({ content: value }) => {
          if (value.endsWith("a")) {
            await delay(240);
          } else if (value.endsWith("ab")) {
            await delay(160);
          } else if (value.endsWith("abc")) {
            await delay(10);
          }
          return parseDocument(value);
        }
      },
      search: { query: async () => ({ items: [{ pathRel: "split.md", title: "Split Typing", score: 1, snippets: ["split.md"] }], indexVersion: 1, isPartial: false }) },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
      export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
      clipboard: { writeRich: async () => ({ ok: true }) },
      settings: { get: async () => mockSettings, set: async () => mockSettings },
      diagnostics: { openLogs: async () => "" },
      events: {
        onAppCommand: () => () => undefined,
        onExternalFileOpen: () => () => undefined
      }
    };
  }, shellSettings);

  await page.goto("/");
  const source = page.locator(".split-editor .source-editor .cm-content");
  await expect(source).toBeVisible();
  await source.click();
  await page.keyboard.press(shortcut("End"));
  await page.keyboard.type("a");
  await page.waitForTimeout(70);
  await page.keyboard.type("bc");
  await expect(source).toContainText("abc");
  await page.waitForTimeout(360);
  await expect(source).toContainText("abc");
  await expect(page.locator(".split-preview")).toContainText("abc");
});

test("workspace shell creates notes without native dialogs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const shellSettings: AppSettings = { ...settings, editorMode: "source" };

  await page.addInitScript((mockSettings: AppSettings) => {
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_e2e",
      name: "E2E Workspace",
      rootPath: "/tmp/e2e-workspace",
      configPath: "/tmp/e2e-workspace/.nolia",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 }
    };
    const files = new Map<string, string>([
      ["alpha.md", "# Alpha\n\n```javascript\nconsole.log(\"ok\")\n```\n"]
    ]);
    const textResources = new Map<string, string>([
      ["assets/config.json", "{\"z\":2,\"a\":{\"b\":1}}"],
      ["assets/readme.txt", "Plain text resource\nNo Markdown toolbar should be visible."]
    ]);
    const assets = new Map<string, { kind: "asset" | "other"; size: number }>([
      ["assets/mock.png", { kind: "asset", size: 12 }],
      ["assets/config.json", { kind: "asset", size: textResources.get("assets/config.json")?.length ?? 0 }],
      ["assets/readme.txt", { kind: "asset", size: textResources.get("assets/readme.txt")?.length ?? 0 }]
    ]);
    const directories = new Set<string>(["Projects"]);
    const testWindow = window as typeof window & {
      __createdPath?: string;
      __renamedTarget?: string;
      __savedJsonContent?: string;
      __savedTextContent?: string;
    };
    const parseDocument = (pathRel: string, content: string): ParsedDocument => {
      const title = content.match(/^#\s+(.+)$/m)?.[1] ?? pathRel.replace(/\.md$/, "");
      return {
        frontmatter: {},
        title,
        body: content,
        plainText: content,
        headings: [{ id: title.toLowerCase(), text: title, depth: 1, line: 1 }],
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
      for (const pathRel of directories) {
        ensureDirectory(pathRel);
      }
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
        read: async ({ pathRel }) => {
          const content = files.get(pathRel) ?? textResources.get(pathRel) ?? "";
          return { content, stat: { size: content.length, mtimeMs: 0, birthtimeMs: 0 }, sha256: `${pathRel}-hash`, encoding: "utf-8" };
        },
        writeAtomic: async ({ pathRel, content }) => {
          if (textResources.has(pathRel)) {
            textResources.set(pathRel, content);
            const asset = assets.get(pathRel);
            if (asset) {
              assets.set(pathRel, { ...asset, size: content.length });
            }
          } else {
            files.set(pathRel, content);
          }
          if (pathRel === "assets/config.json") {
            testWindow.__savedJsonContent = content;
          }
          if (pathRel === "assets/readme.txt") {
            testWindow.__savedTextContent = content;
          }
          return { status: "saved", sha256: `${pathRel}-saved`, mtimeMs: Date.now() };
        },
        create: async ({ pathRel, kind, content }) => {
          if (kind === "directory") {
            directories.add(pathRel);
          } else {
            files.set(pathRel, content ?? "");
          }
          testWindow.__createdPath = pathRel;
          return { ok: true, affectedPaths: [pathRel] };
        },
        rename: async ({ sourcePathRel, targetPathRel }) => {
          if (files.has(sourcePathRel)) {
            files.set(targetPathRel, files.get(sourcePathRel) ?? "");
            files.delete(sourcePathRel);
          }
          if (directories.has(sourcePathRel)) {
            directories.delete(sourcePathRel);
            directories.add(targetPathRel);
          }
          testWindow.__renamedTarget = targetPathRel;
          return { ok: true, affectedPaths: [sourcePathRel, targetPathRel] };
        },
        trash: async ({ pathRel }) => {
          files.delete(pathRel);
          directories.delete(pathRel);
          return { ok: true, affectedPaths: [pathRel] };
        }
      },
      document: { parse: async ({ pathRel, content }) => parseDocument(pathRel, content) },
      search: { query: async () => ({ items: [...files.entries()].map(([pathRel, content]) => ({ pathRel, title: parseDocument(pathRel, content).title, score: 1, snippets: [pathRel] })), indexVersion: 1, isPartial: false }) },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: {
        import: async () => ({ assetPathRel: "assets/mock.png", markdown: "![mock.png](assets/mock.png)", mimeType: "image/png", size: 12 }),
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
  }, shellSettings);

  await page.goto("/");
  await expect(page.getByRole("banner").getByText("E2E Workspace")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "工作区导航" }).getByRole("button")).toContainText(["最近", "笔记", "收藏", "搜索"]);
  await expect(page.getByText("文件与资源")).toBeVisible();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await expect(page.getByText("最近浏览")).toBeVisible();
  await page.getByRole("button", { name: "笔记" }).click();
  await expect(page.getByPlaceholder("搜索文件或资源")).toBeVisible();
  await expect(page.locator(".tree-section-header").getByText("全部文件")).toBeVisible();
  await expect(page.getByTitle("收起左侧栏")).toBeVisible();
  const leftPanelResizer = page.getByRole("button", { name: "拖拽调整左侧栏宽度" });
  await expect(leftPanelResizer).toBeVisible();
  const configuredSidebarWidth = await page
    .locator(".workspace-grid")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("--left-panel-width").trim());
  expect(configuredSidebarWidth).toBe("300px");
  const sidebarWidthBeforeResize = await page.locator(".sidebar").evaluate((element) => element.getBoundingClientRect().width);
  expect(sidebarWidthBeforeResize).toBeGreaterThanOrEqual(260);
  expect(sidebarWidthBeforeResize).toBeLessThanOrEqual(305);
  const resizerBox = await leftPanelResizer.boundingBox();
  expect(resizerBox).not.toBeNull();
  if (resizerBox) {
    await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizerBox.x + resizerBox.width / 2 + 80, resizerBox.y + resizerBox.height / 2);
    await page.mouse.up();
  }
  const sidebarWidthAfterResize = await page.locator(".sidebar").evaluate((element) => element.getBoundingClientRect().width);
  expect(sidebarWidthAfterResize).toBeGreaterThan(sidebarWidthBeforeResize + 20);
  await expect(page.locator(".tree-section-header")).toContainText("1 篇笔记");
  await expect(page.locator(".tabs-bar")).toHaveCount(0);

  await page.locator(".tree-section-header").getByRole("button", { name: "新建" }).click();
  await page.getByRole("menuitem", { name: "新建笔记" }).click();
  await page.getByRole("textbox", { name: "笔记名称" }).fill("Modal Note");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("button", { name: "Modal-Note.md", exact: true })).toBeVisible();
  await expect(page.locator(".tree-section-header")).toContainText("2 篇笔记");

  await page.locator(".tree-section-header").getByRole("button", { name: "新建" }).click();
  await page.getByRole("menuitem", { name: "新建文件夹" }).click();
  await page.getByRole("textbox", { name: "文件夹名称" }).fill("Archive");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("button", { name: /Archive/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Archive/ }).first().click();
  await expect(page.locator(".tree-row.is-active")).toHaveCount(1);
  await page.getByRole("button", { name: "alpha.md", exact: true }).first().click();
  await expect(page.locator(".tree-row.is-active")).toHaveCount(1);

  await page.getByRole("button", { name: /Archive/ }).first().hover();
  await page.getByRole("button", { name: "在 Archive 中新建" }).click();
  await page.getByRole("menuitem", { name: "新建笔记" }).click();
  await page.getByRole("textbox", { name: "笔记名称" }).fill("Nested");
  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("button", { name: "Nested.md", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Archive/ }).first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "粘贴到此处" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "移动到..." })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "新建笔记" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "新建文件夹" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "alpha.md", exact: true }).first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "新建笔记" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "新建文件夹" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "复制" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "创建副本" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "移动到..." })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "收藏" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "重命名" })).toBeVisible();
  await page.getByRole("menuitem", { name: "复制" }).click();

  await page.getByRole("button", { name: /Archive/ }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "粘贴到此处" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __createdPath?: string }).__createdPath)).toBe("Archive/alpha.md");

  await page.getByRole("button", { name: "Modal-Note.md", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "创建副本" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __createdPath?: string }).__createdPath)).toBe("Modal-Note 副本.md");
  await expect(page.getByRole("button", { name: "Modal-Note 副本.md", exact: true })).toBeVisible();

  const duplicateRow = page.locator(".tree-row", { has: page.getByRole("button", { name: "Modal-Note 副本.md", exact: true }) }).first();
  const projectsRow = page.locator(".tree-row", { has: page.getByRole("button", { name: /Projects/ }) }).first();
  await duplicateRow.dragTo(projectsRow);
  await expect.poll(() => page.evaluate(() => (window as Window & { __renamedTarget?: string }).__renamedTarget)).toBe("Projects/Modal-Note 副本.md");

  await page.getByRole("button", { name: "Modal-Note.md", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名" }).click();
  const renameDialog = page.getByRole("dialog", { name: "重命名笔记" });
  await renameDialog.getByRole("textbox", { name: "笔记名称" }).fill("Renamed Note");
  await renameDialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("button", { name: "Renamed-Note.md", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Renamed-Note.md", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除" }).click();
  await page.getByRole("dialog", { name: "移到废纸篓" }).getByRole("button", { name: "删除" }).click();
  await expect(page.getByRole("button", { name: "Renamed-Note.md", exact: true })).toBeHidden();

  const folderRow = page.getByRole("button", { name: /Projects/ }).first();
  await folderRow.hover();
  await expect(page.getByRole("button", { name: "在 Projects 中新建" })).toBeVisible();

  const editorWidthBeforeCollapse = await page.locator(".editor-zone").evaluate((element) => element.getBoundingClientRect().width);
  await page.getByTitle("收起左侧栏").click();
  await expect(page.getByPlaceholder("搜索文件或资源")).toBeHidden();
  const editorWidthAfterCollapse = await page.locator(".editor-zone").evaluate((element) => element.getBoundingClientRect().width);
  expect(editorWidthAfterCollapse).toBeGreaterThan(editorWidthBeforeCollapse + 300);
  await page.getByTitle("展开左侧栏").click();
  await expect(page.getByPlaceholder("搜索文件或资源")).toBeVisible();

  await page.getByRole("button", { name: "alpha.md", exact: true }).first().click();
  await expect(page.locator(".breadcrumb strong")).toHaveText("alpha.md");
  await expect(page.locator(".breadcrumb strong")).not.toHaveText("Alpha");
  await expect(page.locator(".statusbar")).toContainText("全文");
  await expect(page.locator(".statusbar")).toContainText("选中 0 字符");
  await expect(page.locator(".statusbar")).not.toContainText("/tmp/e2e-workspace");
  await expect(page.locator(".statusbar")).not.toContainText("已打开 alpha.md");
  await expect(page.getByRole("button", { name: "一级标题" })).toBeVisible();
  await expect(page.getByRole("button", { name: "加粗" })).toBeVisible();
  await expect(page.getByRole("button", { name: "任务列表" })).toBeVisible();
  await expect(page.getByRole("button", { name: "复选框" })).toBeVisible();
  await page.getByRole("button", { name: "alpha.md", exact: true }).first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "收藏", exact: true }).click();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "收藏", exact: true }).click();
  await expect(page.getByText("暂无收藏文档。")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "alpha.md", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "alpha.md", exact: true }).first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "取消收藏" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "重命名" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "删除" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "最近" }).click();
  await expect(page.getByText("最近浏览")).toBeVisible();
  await expect(page.getByText("最近工作区")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "alpha.md", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Nested.md", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive/Nested.md" })).toHaveCount(0);
  await page.getByRole("button", { name: "alpha.md", exact: true }).first().click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "取消收藏" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "重命名" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "删除" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "最近编辑" }).click();
  await expect(page.getByRole("tab", { name: "最近编辑" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  const sourceContentWidth = await page.locator(".source-editor .cm-content").evaluate((element) => element.getBoundingClientRect().width);
  const sourceEditorWidth = await page.locator(".source-editor").evaluate((element) => element.getBoundingClientRect().width);
  expect(sourceContentWidth).toBeGreaterThan(sourceEditorWidth * 0.65);
  expect(sourceContentWidth).toBeLessThanOrEqual(sourceEditorWidth);

  await page.locator(".cm-content").click();
  await page.keyboard.press(shortcut("End"));
  await page.getByRole("button", { name: "链接" }).click();
  await page.getByRole("textbox", { name: "链接文本" }).fill("Docs");
  await page.getByRole("textbox", { name: "链接地址" }).fill("https://example.com/docs");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(page.locator(".cm-content")).toContainText("[Docs](https://example.com/docs)");

  await expect(page.getByRole("button", { name: "图片" })).toBeVisible();
  await expect(page.getByRole("button", { name: "表格" })).toBeVisible();
  await expect(page.getByRole("button", { name: "公式" })).toBeVisible();
  await page.getByRole("button", { name: "图片" }).click();
  await expect(page.locator(".cm-content")).toContainText("![mock.png](assets/mock.png)");
  await page.getByRole("button", { name: "公式" }).click();
  await expect(page.locator(".cm-content")).toContainText("E = mc^2");

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByRole("button", { name: /运行.*代码块/ })).toHaveCount(0);

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name: /assets/ }).click();
  await page.getByRole("button", { name: "mock.png", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("图片预览");
  await expect(page.locator(".resource-preview img")).toHaveAttribute("src", "nolia-asset://workspace/ws_e2e/assets/mock.png");
  await page.getByRole("button", { name: "config.json", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("JSON 编辑器");
  await expect(page.getByTestId("builtin-json-editor")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "JSON 工具" })).toBeVisible();
  await expect(page.getByRole("button", { name: "校验" })).toBeVisible();
  await expect(page.getByRole("button", { name: "格式化" })).toBeVisible();
  await expect(page.getByRole("button", { name: "排序键" })).toBeVisible();
  await expect(page.getByRole("button", { name: "压缩" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Markdown 工具" })).toHaveCount(0);
  await expect(page.locator(".editor-toolbar, .markdown-actionbar")).toHaveCount(0);
  const jsonEditor = page.getByTestId("builtin-json-editor");
  await expect(jsonEditor.getByRole("button", { name: "结构" })).toHaveCount(0);
  await expect(jsonEditor.getByRole("button", { name: "保存" })).toHaveCount(0);
  await expect(page.getByRole("tree", { name: "JSON 结构" })).toHaveCount(0);
  const jsonCode = jsonEditor.locator(".cm-content");
  await expect(jsonCode).toContainText("\"z\":2");
  await page.getByRole("button", { name: "格式化" }).click();
  await expect(jsonCode).toContainText("\"z\": 2");
  await page.getByRole("button", { name: "排序键" }).click();
  await expect(jsonCode).toContainText("\"a\": {");
  await expect.poll(() => page.evaluate(() => (window as Window & { __savedJsonContent?: string }).__savedJsonContent)).toBe("{\n  \"a\": {\n    \"b\": 1\n  },\n  \"z\": 2\n}");
  await page.getByRole("button", { name: "readme.txt", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("文本编辑器");
  await expect(page.getByTestId("builtin-text-editor")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "文本工具" })).toBeVisible();
  await expect(page.getByRole("button", { name: "自动换行" })).toBeVisible();
  await expect(page.getByRole("button", { name: "清理空白" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新读取" })).toBeVisible();
  await expect(page.getByTestId("builtin-text-editor").getByRole("button", { name: "保存" })).toHaveCount(0);
  const textCode = page.getByTestId("builtin-text-editor").locator(".cm-content");
  await expect(textCode).toContainText("Plain text resource");
  await textCode.click();
  await page.keyboard.press(shortcut("A"));
  await page.keyboard.insertText("Plain text resource\nEdited in text editor.");
  await expect.poll(() => page.evaluate(() => (window as Window & { __savedTextContent?: string }).__savedTextContent)).toBe("Plain text resource\nEdited in text editor.");
  await expect(page.getByRole("toolbar", { name: "Markdown 工具" })).toHaveCount(0);
  await expect(page.locator(".editor-toolbar, .markdown-actionbar")).toHaveCount(0);
});

test("source and split editors support long document scrolling", async ({ page }) => {
  const shellSettings: AppSettings = { ...settings, editorMode: "source" };

  await page.addInitScript((mockSettings: AppSettings) => {
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_scroll",
      name: "Scroll Workspace",
      rootPath: "/tmp/scroll-workspace",
      configPath: "/tmp/scroll-workspace/.nolia",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 }
    };
    const content = [
      "# Long Source",
      "",
      `Long unbroken text ${"x".repeat(180)}`,
      "",
      ...Array.from({ length: 180 }, (_, index) => `## Section ${index + 1}\n\nParagraph ${index + 1} with enough text to wrap in the source editor and preview pane.`)
    ].join("\n");
    const parseDocument = (_pathRel: string, value: string): ParsedDocument => ({
      frontmatter: {},
      title: "Long Source",
      body: value,
      plainText: value,
      headings: [{ id: "long-source", text: "Long Source", depth: 1, line: 1 }],
      tags: [],
      links: [],
      wikilinks: [],
      attachments: [],
      diagnostics: [],
      wordCount: value.split(/\s+/).filter(Boolean).length,
      lineCount: value.split(/\r?\n/).length
    });

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
        listTree: async () => ({ nodes: [{ pathRel: "long.md", name: "long.md", kind: "markdown", size: content.length, mtimeMs: Date.now() }] }),
        read: async () => ({ content, stat: { size: content.length, mtimeMs: 0, birthtimeMs: 0 }, sha256: "long-hash", encoding: "utf-8" }),
        writeAtomic: async () => ({ status: "saved", sha256: "long-saved", mtimeMs: Date.now() }),
        create: async () => ({ ok: true, affectedPaths: [] }),
        rename: async () => ({ ok: true, affectedPaths: [] }),
        trash: async () => ({ ok: true, affectedPaths: [] })
      },
      document: { parse: async ({ pathRel, content }) => parseDocument(pathRel, content) },
      search: { query: async () => ({ items: [{ pathRel: "long.md", title: "Long Source", score: 1, snippets: ["long.md"] }], indexVersion: 1, isPartial: false }) },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
      export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
      clipboard: { writeRich: async () => ({ ok: true }) },
      settings: { get: async () => mockSettings, set: async () => mockSettings },
      diagnostics: { openLogs: async () => "" },
      events: {
        onAppCommand: () => () => undefined,
        onExternalFileOpen: () => () => undefined
      }
    };
  }, shellSettings);

  await page.goto("/");
  const sourceScroller = page.locator(".source-editor .cm-scroller");
  await expect(sourceScroller).toBeVisible();
  await expect.poll(() => sourceScroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await sourceScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect.poll(() => sourceScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const wysiwygScroller = page.locator(".wysiwyg-editor");
  await expect(wysiwygScroller).toBeVisible();
  await expect.poll(() => scrollRatio(wysiwygScroller)).toBeGreaterThan(0.6);

  await page.getByRole("button", { name: "MD", exact: true }).click();
  await expect(sourceScroller).toBeVisible();
  await expect.poll(() => scrollRatio(sourceScroller)).toBeGreaterThan(0.6);

  await page.getByRole("button", { name: "分屏", exact: true }).click();
  const splitSourceScroller = page.locator(".split-editor .source-editor .cm-scroller");
  const splitPreviewScroller = page.locator(".split-preview");
  await expect(splitSourceScroller).toBeVisible();
  await expect(splitPreviewScroller).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const left = document.querySelector(".split-editor")?.getBoundingClientRect().width ?? 0;
        const right = document.querySelector(".split-preview")?.getBoundingClientRect().width ?? 0;
        return Math.abs(left - right);
      })
    )
    .toBeLessThan(4);
  await expect
    .poll(() => splitPreviewScroller.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true);
  const splitEditorWidthBeforeDrag = await page.locator(".split-editor").evaluate((element) => element.getBoundingClientRect().width);
  const resizerBox = await page.getByRole("button", { name: "拖拽调整分屏比例" }).boundingBox();
  expect(resizerBox).not.toBeNull();
  await page.mouse.move(resizerBox!.x + resizerBox!.width / 2, resizerBox!.y + resizerBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizerBox!.x + resizerBox!.width / 2 + 180, resizerBox!.y + resizerBox!.height / 2);
  await page.mouse.up();
  await expect.poll(() => page.locator(".split-editor").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(splitEditorWidthBeforeDrag + 80);
  await expect.poll(() => splitPreviewScroller.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await splitSourceScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect.poll(() => splitPreviewScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await splitPreviewScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect.poll(() => splitSourceScroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("immersive mode supports menu toggling and direct system Markdown files", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 860 });
  const shellSettings: AppSettings = { ...settings, editorMode: "wysiwyg" };

  await page.addInitScript((mockSettings: AppSettings) => {
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_immersive",
      name: "Immersive Workspace",
      rootPath: "/tmp/immersive-workspace",
      configPath: "/tmp/immersive-workspace/.nolia",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 }
    };
    const files = new Map<string, string>([
      ["alpha.md", "# Alpha\n\nWorkspace body.\n"]
    ]);
    const externalFiles = new Map<string, string>([
      ["/tmp/direct-note.md", "# Direct\n\nOpened from the system file manager.\n"]
    ]);
    const testWindow = window as Window & {
      __emitAppCommand?: (command: string) => void;
      __emitExternalFile?: (filePath: string) => void;
      __externalSaved?: string;
    };
    let appCommandListener: ((command: string) => void) | undefined;
    let externalFileListener: ((filePath: string) => void) | undefined;
    testWindow.__emitAppCommand = (command) => appCommandListener?.(command);
    testWindow.__emitExternalFile = (filePath) => externalFileListener?.(filePath);
    const parseDocument = (pathRel: string, content: string): ParsedDocument => {
      const title = content.match(/^#\s+(.+)$/m)?.[1] ?? pathRel.split("/").pop()?.replace(/\.md$/i, "") ?? "Untitled";
      return {
        frontmatter: {},
        title,
        body: content,
        plainText: content,
        headings: [{ id: title.toLowerCase(), text: title, depth: 1, line: 1 }],
        tags: [],
        links: [],
        wikilinks: [],
        attachments: [],
        diagnostics: [],
        wordCount: content.split(/\s+/).filter(Boolean).length,
        lineCount: content.split(/\r?\n/).length
      };
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
        listTree: async () => ({
          nodes: [{ pathRel: "alpha.md", name: "alpha.md", kind: "markdown", size: files.get("alpha.md")?.length ?? 0, mtimeMs: Date.now() }]
        }),
        read: async ({ pathRel }) => ({ content: files.get(pathRel) ?? "", stat: { size: files.get(pathRel)?.length ?? 0, mtimeMs: 0, birthtimeMs: 0 }, sha256: `${pathRel}-hash`, encoding: "utf-8" }),
        writeAtomic: async ({ pathRel, content }) => {
          files.set(pathRel, content);
          return { status: "saved", sha256: `${pathRel}-saved`, mtimeMs: Date.now() };
        },
        create: async () => ({ ok: true, affectedPaths: [] }),
        rename: async () => ({ ok: true, affectedPaths: [] }),
        trash: async () => ({ ok: true, affectedPaths: [] })
      },
      externalFile: {
        consumePendingOpen: async () => [],
        read: async ({ filePath }) => {
          const content = externalFiles.get(filePath) ?? "";
          return { content, stat: { size: content.length, mtimeMs: 0, birthtimeMs: 0 }, sha256: `${filePath}-hash`, encoding: "utf-8" };
        },
        writeAtomic: async ({ filePath, content }) => {
          externalFiles.set(filePath, content);
          testWindow.__externalSaved = content;
          return { status: "saved", sha256: `${filePath}-saved`, mtimeMs: Date.now() };
        }
      },
      document: { parse: async ({ pathRel, content }) => parseDocument(pathRel, content) },
      search: {
        query: async () => ({
          items: [{ pathRel: "alpha.md", title: "Alpha", score: 1, snippets: ["alpha.md"] }],
          indexVersion: 1,
          isPartial: false
        })
      },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
      export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
      clipboard: { writeRich: async () => ({ ok: true }) },
      settings: { get: async () => mockSettings, set: async () => mockSettings },
      diagnostics: { openLogs: async () => "" },
      events: {
        onAppCommand: (listener) => {
          appCommandListener = listener;
          return () => {
            appCommandListener = undefined;
          };
        },
        onExternalFileOpen: (listener) => {
          externalFileListener = listener;
          return () => {
            externalFileListener = undefined;
          };
        }
      }
    };
  }, shellSettings);

  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name: "alpha.md", exact: true }).click();
  await expect(page.locator(".breadcrumb strong")).toHaveText("alpha.md");

  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("view.immersive.toggle"));
  await expect(page.locator(".app-shell")).toHaveClass(/is-immersive/);
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toHaveCount(0);
  await expect(page.locator(".immersive-title strong")).toHaveText("alpha.md");
  await expect(page.locator(".immersive-topbar")).toHaveText("alpha.md");
  await expect(page.getByRole("button", { name: "MD", exact: true })).toHaveCount(0);
  await expect(page.locator(".editor-toolbar")).toHaveCount(0);
  await expect(page.locator(".immersive-title")).not.toContainText("/tmp");

  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("mode.source"));
  await expect(page.locator(".cm-gutters")).toBeVisible();
  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("view.lineNumbers.toggle"));
  await expect(page.locator(".cm-gutters")).toHaveCount(0);
  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("view.lineNumbers.toggle"));
  await expect(page.locator(".cm-gutters")).toBeVisible();
  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("mode.wysiwyg"));

  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("view.immersive.toggle"));
  await expect(page.locator(".app-shell")).not.toHaveClass(/is-immersive/);
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await expect(page.locator(".editor-toolbar")).toBeVisible();

  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("view.toolbar.toggle"));
  await expect(page.locator(".editor-toolbar")).toHaveCount(0);
  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("view.toolbar.toggle"));
  await expect(page.locator(".editor-toolbar")).toBeVisible();

  await page.evaluate(() => (window as Window & { __emitExternalFile?: (filePath: string) => void }).__emitExternalFile?.("/tmp/direct-note.md"));
  await expect(page.locator(".app-shell")).toHaveClass(/is-immersive/);
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toHaveCount(0);
  await expect(page.locator(".immersive-title strong")).toHaveText("direct-note.md");
  await expect(page.locator(".immersive-topbar")).toHaveText("direct-note.md");
  await expect(page.locator(".immersive-title")).not.toContainText("/tmp");
  await expect(page.locator(".editor-toolbar")).toHaveCount(0);
  await expect(page.locator(".ProseMirror")).toContainText("Direct");

  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("mode.source"));
  await page.locator(".cm-content").click();
  await page.keyboard.press(shortcut("A"));
  await page.keyboard.type("# Direct Changed\n\nSaved as one file.\n");
  await page.keyboard.press(shortcut("S"));
  await expect.poll(() => page.evaluate(() => (window as Window & { __externalSaved?: string }).__externalSaved)).toContain("Direct Changed");

  await page.evaluate(() => (window as Window & { __emitAppCommand?: (command: string) => void }).__emitAppCommand?.("view.immersive.toggle"));
  await expect(page.locator(".app-shell")).not.toHaveClass(/is-immersive/);
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await expect(page.locator(".breadcrumb strong")).toHaveText("alpha.md");
});

test("wysiwyg keeps Markdown list and code block editing behavior", async ({ page }) => {
  const shellSettings: AppSettings = { ...settings, editorMode: "wysiwyg", autoSaveDelayMs: 50 };

  await page.addInitScript((mockSettings: AppSettings) => {
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_wysiwyg",
      name: "WYSIWYG Workspace",
      rootPath: "/tmp/wysiwyg-workspace",
      configPath: "/tmp/wysiwyg-workspace/.nolia",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 }
    };
    const source = "# Alpha\n\n$$\nE = mc^2\n$$\n";
    const parseDocument = (content: string): ParsedDocument => ({
      frontmatter: {},
      title: "Alpha",
      body: content,
      plainText: content,
      headings: [{ id: "alpha", text: "Alpha", depth: 1, line: 1 }],
      tags: [],
      links: [],
      wikilinks: [],
      attachments: [],
      diagnostics: [],
      wordCount: content.split(/\s+/).filter(Boolean).length,
      lineCount: content.split(/\r?\n/).length
    });
    const openedUrls: string[] = [];
    window.open = (url) => {
      openedUrls.push(String(url));
      return null;
    };
    (window as Window & { __openedUrls?: string[] }).__openedUrls = openedUrls;

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
        listTree: async () => ({ nodes: [{ pathRel: "alpha.md", name: "alpha.md", kind: "markdown", size: source.length, mtimeMs: Date.now() }] }),
        read: async () => ({ content: source, stat: { size: source.length, mtimeMs: 0, birthtimeMs: 0 }, sha256: "alpha-hash", encoding: "utf-8" }),
        writeAtomic: async () => ({ status: "saved", sha256: "alpha-saved", mtimeMs: Date.now() }),
        create: async () => ({ ok: true, affectedPaths: [] }),
        rename: async () => ({ ok: true, affectedPaths: [] }),
        trash: async () => ({ ok: true, affectedPaths: [] })
      },
      document: { parse: async ({ content }) => parseDocument(content) },
      search: { query: async () => ({ items: [], indexVersion: 1, isPartial: false }) },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: {
        import: async () => ({ assetPathRel: "assets/mock.png", markdown: "![mock.png](assets/mock.png)", mimeType: "image/png", size: 12 }),
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
  }, shellSettings);

  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name: "alpha.md", exact: true }).click();

  const editor = page.locator(".ProseMirror");
  await expect(editor.locator(".math-block .katex")).toContainText("E");
  await expect(editor.locator(".math-block .math-block-input")).toBeHidden();
  await editor.locator(".math-block").click();
  await expect(page.getByRole("textbox", { name: "块公式 Markdown 源码" })).toBeFocused();
  await editor.locator("h1").click();
  await expect(editor.locator(".math-block .math-block-input")).toBeHidden();

  await editor.click();
  await page.keyboard.type("link text");
  await page.keyboard.press(shortcut("A"));
  await expect(page.locator(".statusbar")).toContainText("选中");
  await expect(page.getByRole("toolbar", { name: "文本选择工具" })).toHaveCount(0);
  const copiedText = await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData });
    element.dispatchEvent(event);
    return clipboardData.getData("text/plain");
  });
  expect(copiedText).toContain("link text");
  await page.getByRole("button", { name: "链接" }).first().click();
  await page.getByRole("textbox", { name: "链接文本" }).fill("OpenAI");
  await page.getByRole("textbox", { name: "链接地址" }).fill("https://openai.com");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(editor.locator("a", { hasText: "OpenAI" })).toHaveAttribute("href", "https://openai.com");
  await editor.locator("a", { hasText: "OpenAI" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __openedUrls?: string[] }).__openedUrls ?? [])).toEqual([]);
  await page.getByRole("button", { name: "链接" }).first().click();
  await expect(page.getByRole("textbox", { name: "链接地址" })).toHaveValue("https://openai.com");
  await page.getByRole("textbox", { name: "链接文本" }).fill("OpenAI Docs");
  await page.getByRole("textbox", { name: "链接地址" }).fill("https://openai.com/docs");
  await page.getByRole("button", { name: "确定" }).click();
  await expect(editor.locator("a", { hasText: "OpenAI Docs" })).toHaveAttribute("href", "https://openai.com/docs");

  await page.keyboard.press(shortcut("A"));
  await page.keyboard.press("Backspace");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "粘贴第一行\n粘贴第二行");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(editor).toContainText("粘贴第一行");
  await expect(editor).toContainText("粘贴第二行");

  await page.keyboard.press(shortcut("A"));
  await page.keyboard.press("Backspace");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "- [x] done\n- [ ] todo\n\n```js\nconst value = 1;\n```");
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await expect(editor.locator("ul[data-type='taskList'] li[data-checked]")).toHaveCount(2);
  await expect(editor.locator("pre code")).toContainText("const value = 1;");

  await page.keyboard.press(shortcut("A"));
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "图片" }).click();
  await expect(editor.locator("img")).toHaveAttribute("src", "nolia-asset://workspace/ws_wysiwyg/assets/mock.png");

  await page.keyboard.press(shortcut("A"));
  await page.keyboard.press("Backspace");
  const tableButton = page.getByRole("button", { name: "表格" });
  const tableButtonBox = await tableButton.boundingBox();
  await tableButton.click();
  await expect(page.getByRole("dialog", { name: "插入表格" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "插入表格" }).getByRole("button", { name: "取消" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "插入表格" }).getByRole("button", { name: "插入" })).toHaveCount(0);
  const tablePopoverBox = await page.getByRole("dialog", { name: "插入表格" }).boundingBox();
  expect(tablePopoverBox?.y ?? 0).toBeGreaterThan((tableButtonBox?.y ?? 0) + (tableButtonBox?.height ?? 0) - 4);
  expect(Math.abs((tablePopoverBox?.x ?? 0) + (tablePopoverBox?.width ?? 0) / 2 - ((tableButtonBox?.x ?? 0) + (tableButtonBox?.width ?? 0) / 2))).toBeLessThan(32);
  await page.getByRole("button", { name: "2 x 4" }).hover();
  await expect(page.getByText("2 x 4")).toBeVisible();
  await page.getByRole("button", { name: "2 x 4" }).click();
  await expect(page.getByRole("dialog", { name: "插入表格" })).toHaveCount(0);
  await expect(editor.locator("table tr")).toHaveCount(2);
  await expect(editor.locator("table tr").first().locator("th, td")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "表格操作" })).toBeVisible();
  const tableBox = await editor.locator("table").boundingBox();
  const controlsBox = await page.getByRole("button", { name: "表格操作" }).boundingBox();
  expect(controlsBox?.y ?? 0).toBeLessThan(tableBox?.y ?? 0);
  expect(Math.abs((controlsBox?.x ?? 0) - (tableBox?.x ?? 0))).toBeLessThan(24);
  await page.locator(".wysiwyg-editor").evaluate((element) => {
    const filler = document.createElement("div");
    filler.dataset.testFiller = "table-scroll";
    filler.style.height = "1200px";
    element.append(filler);
  });
  await page.locator(".wysiwyg-editor").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(page.getByRole("button", { name: "表格操作" })).toHaveCount(0);
  await page.locator(".wysiwyg-editor").evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(page.getByRole("button", { name: "表格操作" })).toBeVisible();
  await page.getByRole("button", { name: "表格操作" }).click();
  await expect(page.getByRole("menuitem", { name: "在右侧新增列" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "在右侧新增列" })).toHaveCount(0);
  await page.locator(".wysiwyg-editor").evaluate((element) => element.querySelector("[data-test-filler='table-scroll']")?.remove());

  await page.keyboard.press(shortcut("A"));
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "公式" }).click();
  await expect(editor.locator(".math-block .katex")).toContainText("E");
  await expect(page.getByRole("textbox", { name: "块公式 Markdown 源码" })).toBeFocused();
  await page.getByLabel("路径").click();
  await expect(editor.locator(".math-block .math-block-input")).toBeHidden();

  await editor.click();
  await page.keyboard.press(shortcut("A"));
  await page.keyboard.press("Backspace");
  await page.keyboard.type("$$");
  await page.keyboard.press("Enter");
  await expect(editor.locator(".math-block")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "块公式 Markdown 源码" })).toBeFocused();
  await expect(editor.locator(".math-block .math-block-input")).toBeVisible();

  await editor.click();
  await page.keyboard.press(shortcut("A"));
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "复选框" }).click();
  await page.keyboard.type("checkbox text");
  await expect(editor.locator("ul[data-type='taskList'] li[data-checked]")).toHaveCount(1);
  await expect(editor.locator("li[data-checked]")).toContainText("checkbox text");
  await page.getByRole("button", { name: "MD", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("- [ ] checkbox text");
  await page.locator(".cm-content").click();
  await page.keyboard.press(shortcut("A"));
  await page.keyboard.insertText("- [ ]\n- [ ]\n- [ ]\n");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(editor.locator("ul[data-type='taskList'] li[data-checked]")).toHaveCount(3);
  await expect(editor).not.toContainText("[ ]");

  await editor.click();
  await page.keyboard.press(shortcut("A"));
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "无序列表" }).click();
  await page.keyboard.type("one");
  await page.keyboard.press("Enter");
  await page.keyboard.type("two");
  await expect(editor.locator("li")).toHaveCount(2);

  await page.keyboard.press(shortcut("A"));
  await page.keyboard.press("Backspace");
  await page.getByRole("button", { name: "代码块", exact: true }).click();
  await expect(editor.locator("pre code")).toHaveCount(1);
  await editor.locator("pre code").click();
  await page.keyboard.type("const value = 1;");
  await page.keyboard.press("Enter");
  await page.keyboard.type("return value;");
  await expect
    .poll(async () => editor.locator("pre code").evaluate((element) => element.textContent?.replace(/\s+/g, " ").trim()))
    .toBe("const value = 1; return value;");
  await expect(editor.locator("pre")).toHaveCount(1);
});

test("wysiwyg keeps code block selection stable around autosave", async ({ page }) => {
  const shellSettings: AppSettings = { ...settings, editorMode: "wysiwyg", autoSaveDelayMs: 50 };

  await page.addInitScript((mockSettings: AppSettings) => {
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_code_block",
      name: "Code Block Workspace",
      rootPath: "/tmp/code-block-workspace",
      configPath: "/tmp/code-block-workspace/.nolia",
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 }
    };
    const source = "# Alpha\n\n```javascript\nconst value = 1;\n```\n\nafter\n";
    const testWindow = window as typeof window & { __saveCount?: number; __lastSavedContent?: string };
    testWindow.__saveCount = 0;
    const parseDocument = (content: string): ParsedDocument => ({
      frontmatter: {},
      title: "Alpha",
      body: content,
      plainText: content,
      headings: [{ id: "alpha", text: "Alpha", depth: 1, line: 1 }],
      tags: [],
      links: [],
      wikilinks: [],
      attachments: [],
      diagnostics: [],
      wordCount: content.split(/\s+/).filter(Boolean).length,
      lineCount: content.split(/\r?\n/).length
    });

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
        listTree: async () => ({ nodes: [{ pathRel: "alpha.md", name: "alpha.md", kind: "markdown", size: source.length, mtimeMs: Date.now() }] }),
        read: async () => ({ content: source, stat: { size: source.length, mtimeMs: 0, birthtimeMs: 0 }, sha256: "alpha-hash", encoding: "utf-8" }),
        writeAtomic: async ({ content }) => {
          testWindow.__saveCount = (testWindow.__saveCount ?? 0) + 1;
          testWindow.__lastSavedContent = content;
          return { status: "saved", sha256: `alpha-saved-${testWindow.__saveCount}`, mtimeMs: Date.now() };
        },
        create: async () => ({ ok: true, affectedPaths: [] }),
        rename: async () => ({ ok: true, affectedPaths: [] }),
        trash: async () => ({ ok: true, affectedPaths: [] })
      },
      document: { parse: async ({ content }) => parseDocument(content) },
      search: { query: async () => ({ items: [{ pathRel: "alpha.md", title: "Alpha", score: 1, snippets: ["alpha.md"] }], indexVersion: 1, isPartial: false }) },
      graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
      attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
      export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
      clipboard: { writeRich: async () => ({ ok: true }) },
      settings: { get: async () => mockSettings, set: async () => mockSettings },
      diagnostics: { openLogs: async () => "" },
      events: {
        onAppCommand: () => () => undefined,
        onExternalFileOpen: () => () => undefined
      }
    };
  }, shellSettings);

  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name: "alpha.md", exact: true }).click();

  const editor = page.locator(".ProseMirror");
  const code = editor.locator("pre code");
  await expect(code).toHaveText("const value = 1;");

  const codeBox = await code.boundingBox();
  await code.click({ position: { x: Math.max(1, (codeBox?.width ?? 160) - 1), y: 8 } });
  await page.keyboard.press("Enter");
  await page.keyboard.type("return value;");
  await expect
    .poll(async () => code.evaluate((element) => element.textContent?.split("\n").filter(Boolean)))
    .toEqual(["const value = 1;", "return value;"]);

  await expect.poll(async () => page.evaluate(() => (window as typeof window & { __saveCount?: number }).__saveCount ?? 0)).toBeGreaterThan(0);
  await page.keyboard.type(" // still code");
  await expect(code).toContainText("return value; // still code");

  await editor.locator("p", { hasText: "after" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("outside");
  await expect(code).not.toContainText("outside");
  await expect(editor.locator("p", { hasText: "outside" })).toBeVisible();
});

async function scrollRatio(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    return maxScrollTop > 0 ? element.scrollTop / maxScrollTop : 0;
  });
}
