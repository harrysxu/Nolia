import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_SETTINGS } from "../../src/shared/constants";
import type { AppSettings, ParsedDocument, WorkspaceInfo } from "../../src/shared/types";
import type { ExtensionManifest, PluginDescriptor } from "../../src/shared/extensions";
import { installMockNolia } from "./helpers/mockNolia";

const pluginManifest: ExtensionManifest = {
  id: "local.demo",
  name: "Local Demo",
  version: "1.0.0",
  apiVersion: 2,
  activationEvents: ["onStartup"],
  permissions: ["ui:contribute", "workspace:file:read"],
  renderer: "index.js",
  contributes: {
    sidebarPanels: [{ id: "local.demo.panel", title: "Demo", icon: "FolderOpen", order: 5, visibleInNav: true }],
    fileViewers: [{ id: "local.demo.viewer", title: "Demo Viewer", extensions: [".demo"], priority: 500, category: "text" }]
  }
};

const settings: AppSettings = {
  ...DEFAULT_SETTINGS,
  language: "zh-CN",
  theme: "light",
  editorMode: "source",
  editorWidth: "wide",
  fontSize: "medium",
  focusMode: false,
  autoSaveDelayMs: 80,
  attachmentStrategy: "workspace_assets",
  pluginSafeMode: false,
  plugins: {
    "local.demo": {
      enabled: true,
      permissionsAcceptedAt: 123,
      acceptedPermissionHash: "ui:contribute|workspace:file:read"
    }
  }
};

test("enabled local plugin renders a sidebar panel and file viewer", async ({ page }) => {
  const rendererModule = [
    "export function activate(context) {",
    "  context.api.ui.registerSidebarPanel('local.demo.panel', ({ workspace }) => `Plugin panel: ${workspace?.name ?? 'none'}`);",
    "  context.api.ui.registerFileViewer('local.demo.viewer', ({ name, pathRel }) => {",
    "    const node = document.createElement('div');",
    "    node.setAttribute('data-testid', 'demo-viewer');",
    "    node.textContent = `Plugin viewer: ${name} (${pathRel})`;",
    "    return node;",
    "  });",
    "}"
  ].join("\n");

  await page.route("**/plugin-demo.js*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: rendererModule
    });
  });

  await page.addInitScript(
    ({ mockSettings, manifest }: { mockSettings: AppSettings; manifest: ExtensionManifest }) => {
      const rendererUrl = "/plugin-demo.js";
      const workspace: WorkspaceInfo = {
        workspaceId: "ws_plugin_render",
        name: "Plugin Workspace",
        rootPath: "/tmp/plugin-workspace",
        configPath: "/tmp/plugin-workspace/.nolia",
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        permissions: { readable: true, writable: true },
        indexState: { status: "ready", progress: 1, version: 1 }
      };
      const descriptor: PluginDescriptor = {
        pluginId: "local.demo",
        pluginPath: "/tmp/plugins/local.demo",
        manifest,
        rendererUrl,
        enabled: true,
        permissionsAcceptedAt: 123,
        acceptedPermissionHash: "ui:contribute|workspace:file:read",
        permissionHash: "ui:contribute|workspace:file:read",
        diagnostics: []
      };
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
              { pathRel: "home.md", name: "home.md", kind: "markdown", size: 6, mtimeMs: Date.now() },
              { pathRel: "sample.demo", name: "sample.demo", kind: "other", size: 12, mtimeMs: Date.now() }
            ]
          }),
          read: async () => ({ content: "# Home", stat: { size: 6, mtimeMs: 0, birthtimeMs: 0 }, sha256: "home", encoding: "utf-8" }),
          writeAtomic: async () => ({ status: "saved", sha256: "saved", mtimeMs: Date.now() }),
          create: async () => ({ ok: true, affectedPaths: [] }),
          rename: async () => ({ ok: true, affectedPaths: [] }),
          trash: async () => ({ ok: true, affectedPaths: [] }),
          openExternal: async () => ({ ok: true }),
          revealInFinder: async () => ({ ok: true })
        },
        document: { parse: async () => parsed },
        search: { query: async () => ({ items: [{ pathRel: "home.md", title: "Home", score: 1, snippets: ["home.md"] }], indexVersion: 1, isPartial: false }) },
        graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
        attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
        export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
        clipboard: { writeRich: async () => ({ ok: true }) },
        settings: { get: async () => mockSettings, set: async () => mockSettings },
        plugins: {
          list: async () => [descriptor],
          setEnabled: async () => [descriptor],
          acceptPermissions: async () => [descriptor],
          recordFailure: async () => [descriptor]
        },
        extensions: { syncMenus: async () => ({ ok: true }) },
        diagnostics: { openLogs: async () => "" },
        events: {
          onAppCommand: () => () => undefined,
          onExternalFileOpen: () => () => undefined
        }
      };
    },
    { mockSettings: settings, manifest: pluginManifest }
  );

  await page.goto("/");

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "Demo" }).click();
  await expect(page.getByText("Plugin panel: Plugin Workspace")).toBeVisible();

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name: "sample.demo" }).click();
  await expect(page.getByTestId("demo-viewer")).toHaveText("Plugin viewer: sample.demo (sample.demo)");
});

test("enabled local plugin can edit and save a matched workspace file", async ({ page }) => {
  const editorManifest: ExtensionManifest = {
    id: "local.editor",
    name: "Local Editor",
    version: "1.0.0",
    apiVersion: 2,
    activationEvents: ["onStartup", "onFileOpen:.json"],
    permissions: ["ui:contribute", "workspace:file:read", "workspace:file:write"],
    renderer: "index.js",
    contributes: {
      fileEditors: [{ id: "local.editor.json", title: "JSON Editor", extensions: [".json"], priority: 500 }]
    }
  };
  const editorSettings: AppSettings = {
    ...settings,
    plugins: {
      "local.editor": {
        enabled: true,
        permissionsAcceptedAt: 123,
        acceptedPermissionHash: "ui:contribute|workspace:file:read|workspace:file:write"
      }
    }
  };
  const rendererModule = [
    "export function activate(context) {",
    "  context.api.ui.registerFileEditor('local.editor.json', (file) => {",
    "    const root = document.createElement('div');",
    "    root.setAttribute('data-testid', 'json-editor');",
    "    const textarea = document.createElement('textarea');",
    "    textarea.setAttribute('aria-label', 'JSON 内容');",
    "    textarea.value = file.initialText;",
    "    textarea.addEventListener('input', () => file.updateText(textarea.value));",
    "    const button = document.createElement('button');",
    "    button.type = 'button';",
    "    button.textContent = '插件保存';",
    "    button.addEventListener('click', () => void file.save(textarea.value));",
    "    root.append(textarea, button);",
    "    return root;",
    "  });",
    "}"
  ].join("\n");

  await page.route("**/plugin-editor.js*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: rendererModule
    });
  });

  await page.addInitScript(
    ({ mockSettings, manifest }: { mockSettings: AppSettings; manifest: ExtensionManifest }) => {
      const rendererUrl = "/plugin-editor.js";
      const testWindow = window as typeof window & {
        __savedPluginEditorContent?: string;
        __savedPluginEditorBaseHash?: string;
      };
      const workspace: WorkspaceInfo = {
        workspaceId: "ws_plugin_editor",
        name: "Plugin Editor Workspace",
        rootPath: "/tmp/plugin-editor-workspace",
        configPath: "/tmp/plugin-editor-workspace/.nolia",
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        permissions: { readable: true, writable: true },
        indexState: { status: "ready", progress: 1, version: 1 }
      };
      const descriptor: PluginDescriptor = {
        pluginId: "local.editor",
        pluginPath: "/tmp/plugins/local.editor",
        manifest,
        rendererUrl,
        enabled: true,
        permissionsAcceptedAt: 123,
        acceptedPermissionHash: "ui:contribute|workspace:file:read|workspace:file:write",
        permissionHash: "ui:contribute|workspace:file:read|workspace:file:write",
        diagnostics: []
      };
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
              { pathRel: "home.md", name: "home.md", kind: "markdown", size: 6, mtimeMs: Date.now() },
              { pathRel: "sample.json", name: "sample.json", kind: "other", size: 20, mtimeMs: Date.now() }
            ]
          }),
          read: async ({ pathRel }: { pathRel: string }) =>
            pathRel === "sample.json"
              ? { content: "{\n  \"title\": \"original\"\n}", stat: { size: 25, mtimeMs: 0, birthtimeMs: 0 }, sha256: "json-base", encoding: "utf-8" as const }
              : { content: "# Home", stat: { size: 6, mtimeMs: 0, birthtimeMs: 0 }, sha256: "home", encoding: "utf-8" as const },
          writeAtomic: async ({ content, baseHash }: { content: string; baseHash: string }) => {
            testWindow.__savedPluginEditorContent = content;
            testWindow.__savedPluginEditorBaseHash = baseHash;
            return { status: "saved" as const, sha256: "json-saved", mtimeMs: Date.now() };
          },
          create: async () => ({ ok: true, affectedPaths: [] }),
          rename: async () => ({ ok: true, affectedPaths: [] }),
          trash: async () => ({ ok: true, affectedPaths: [] }),
          openExternal: async () => ({ ok: true }),
          revealInFinder: async () => ({ ok: true })
        },
        document: { parse: async () => parsed },
        search: { query: async () => ({ items: [{ pathRel: "home.md", title: "Home", score: 1, snippets: ["home.md"] }], indexVersion: 1, isPartial: false }) },
        graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
        attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
        export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
        clipboard: { writeRich: async () => ({ ok: true }) },
        settings: { get: async () => mockSettings, set: async () => mockSettings },
        plugins: {
          list: async () => [descriptor],
          setEnabled: async () => [descriptor],
          acceptPermissions: async () => [descriptor],
          recordFailure: async () => [descriptor]
        },
        extensions: { syncMenus: async () => ({ ok: true }) },
        diagnostics: { openLogs: async () => "" },
        events: {
          onAppCommand: () => () => undefined,
          onExternalFileOpen: () => () => undefined
        }
      };
    },
    { mockSettings: editorSettings, manifest: editorManifest }
  );

  await page.goto("/");

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name: "sample.json" }).click();
  await expect(page.getByTestId("json-editor")).toBeVisible();
  await expect(page.getByLabel("JSON 内容")).toHaveValue("{\n  \"title\": \"original\"\n}");

  await page.getByLabel("JSON 内容").fill("{\n  \"title\": \"updated\"\n}");
  await expect(page.getByText("未保存")).toBeVisible();
  await page.getByRole("button", { name: "插件保存" }).click();

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __savedPluginEditorContent?: string }).__savedPluginEditorContent)).toBe("{\n  \"title\": \"updated\"\n}");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __savedPluginEditorBaseHash?: string }).__savedPluginEditorBaseHash)).toBe("json-base");
  await expect(page.locator(".statusbar")).toContainText("已保存");
});

test("json editor plugin formats, validates, sorts, minifies, and autosaves JSON", async ({ page }) => {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "examples/plugins/local.jsonEditor/plugin.json"), "utf8")) as ExtensionManifest;
  const rendererModule = readFileSync(path.join(process.cwd(), "examples/plugins/local.jsonEditor/index.js"), "utf8");
  const jsonSettings: AppSettings = {
    ...settings,
    plugins: {
      [manifest.id]: {
        enabled: true,
        permissionsAcceptedAt: 123,
        acceptedPermissionHash: "ui:contribute|workspace:file:read|workspace:file:write"
      }
    }
  };

  await page.route("**/json-editor-plugin.js*", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/javascript", body: rendererModule });
  });

  await page.addInitScript(
    ({ mockSettings, pluginManifest }: { mockSettings: AppSettings; pluginManifest: ExtensionManifest }) => {
      const testWindow = window as typeof window & {
        __savedJsonEditorContent?: string;
        __savedJsonEditorBaseHash?: string;
      };
      const workspace: WorkspaceInfo = {
        workspaceId: "ws_json_editor_plugin",
        name: "JSON Editor Workspace",
        rootPath: "/tmp/json-editor-plugin-workspace",
        configPath: "/tmp/json-editor-plugin-workspace/.nolia",
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        permissions: { readable: true, writable: true },
        indexState: { status: "ready", progress: 1, version: 1 }
      };
      const descriptor: PluginDescriptor = {
        pluginId: pluginManifest.id,
        pluginPath: "/tmp/plugins/local.jsonEditor",
        manifest: pluginManifest,
        rendererUrl: "/json-editor-plugin.js",
        enabled: true,
        permissionsAcceptedAt: 123,
        acceptedPermissionHash: "ui:contribute|workspace:file:read|workspace:file:write",
        permissionHash: "ui:contribute|workspace:file:read|workspace:file:write",
        diagnostics: []
      };
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
              { pathRel: "home.md", name: "home.md", kind: "markdown", size: 6, mtimeMs: Date.now() },
              { pathRel: "config.json", name: "config.json", kind: "other", size: 31, mtimeMs: Date.now() }
            ]
          }),
          read: async ({ pathRel }: { pathRel: string }) =>
            pathRel === "config.json"
              ? { content: "{\"z\":2,\"a\":{\"b\":1},\"list\":[{\"d\":4,\"c\":3}]}", stat: { size: 44, mtimeMs: 0, birthtimeMs: 0 }, sha256: "json-plugin-base", encoding: "utf-8" as const }
              : { content: "# Home", stat: { size: 6, mtimeMs: 0, birthtimeMs: 0 }, sha256: "home", encoding: "utf-8" as const },
          writeAtomic: async ({ content, baseHash }: { content: string; baseHash: string }) => {
            testWindow.__savedJsonEditorContent = content;
            testWindow.__savedJsonEditorBaseHash = baseHash;
            return { status: "saved" as const, sha256: "json-plugin-saved", mtimeMs: Date.now() };
          },
          create: async () => ({ ok: true, affectedPaths: [] }),
          rename: async () => ({ ok: true, affectedPaths: [] }),
          trash: async () => ({ ok: true, affectedPaths: [] }),
          openExternal: async () => ({ ok: true }),
          revealInFinder: async () => ({ ok: true })
        },
        document: { parse: async () => parsed },
        search: { query: async () => ({ items: [{ pathRel: "home.md", title: "Home", score: 1, snippets: ["home.md"] }], indexVersion: 1, isPartial: false }) },
        graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
        attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
        export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
        clipboard: { writeRich: async () => ({ ok: true }) },
        settings: { get: async () => mockSettings, set: async () => mockSettings },
        plugins: {
          list: async () => [descriptor],
          setEnabled: async () => [descriptor],
          acceptPermissions: async () => [descriptor],
          recordFailure: async () => [descriptor]
        },
        extensions: { syncMenus: async () => ({ ok: true }) },
        diagnostics: { openLogs: async () => "" },
        events: {
          onAppCommand: () => () => undefined,
          onExternalFileOpen: () => () => undefined
        }
      };
    },
    { mockSettings: jsonSettings, pluginManifest: manifest }
  );

  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name: "config.json" }).click();
  await expect(page.getByTestId("json-editor-plugin")).toBeVisible();
  await expect(page.getByTestId("json-editor-status")).toHaveText("JSON 有效");
  await expect(page.getByRole("toolbar", { name: "Markdown 工具" })).toHaveCount(0);
  await expect(page.locator(".editor-toolbar, .markdown-actionbar")).toHaveCount(0);

  const textarea = page.getByLabel("JSON 内容");
  await page.getByRole("button", { name: "格式化" }).click();
  await expect(textarea).toHaveValue("{\n  \"z\": 2,\n  \"a\": {\n    \"b\": 1\n  },\n  \"list\": [\n    {\n      \"d\": 4,\n      \"c\": 3\n    }\n  ]\n}");
  await expect(page.getByTestId("json-editor-status")).toHaveText("已格式化");

  await page.getByRole("button", { name: "排序键" }).click();
  await expect(textarea).toHaveValue("{\n  \"a\": {\n    \"b\": 1\n  },\n  \"list\": [\n    {\n      \"c\": 3,\n      \"d\": 4\n    }\n  ],\n  \"z\": 2\n}");
  await expect(page.getByTestId("json-editor-status")).toHaveText("已排序键");

  await page.getByRole("button", { name: "压缩" }).click();
  await expect(textarea).toHaveValue("{\"a\":{\"b\":1},\"list\":[{\"c\":3,\"d\":4}],\"z\":2}");
  await expect(page.getByTestId("json-editor-status")).toHaveText("已压缩");
  await expect(page.getByTestId("json-editor-plugin").getByRole("button", { name: "保存" })).toHaveCount(0);

  await textarea.fill("{ bad json");
  await page.getByRole("button", { name: "校验" }).click();
  await expect(page.getByTestId("json-editor-status")).toHaveText("JSON 无效");

  await textarea.fill("{\"ok\":true}");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __savedJsonEditorContent?: string }).__savedJsonEditorContent)).toBe("{\"ok\":true}");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __savedJsonEditorBaseHash?: string }).__savedJsonEditorBaseHash)).toBe("json-plugin-base");
  await expect(page.locator(".statusbar")).toContainText("已保存");
});

test("enabled local plugin can edit and save a binary workspace file", async ({ page }) => {
  const manifest: ExtensionManifest = {
    id: "local.binary",
    name: "Local Binary",
    version: "1.0.0",
    apiVersion: 2,
    activationEvents: ["onStartup", "onFileOpen:.bin"],
    permissions: ["ui:contribute", "workspace:file:read", "workspace:file:write"],
    renderer: "binary-plugin.js",
    contributes: {
      fileEditors: [{ id: "local.binary.editor", title: "Binary Editor", extensions: [".bin"], priority: 500 }]
    }
  };
  const binarySettings: AppSettings = {
    ...settings,
    plugins: {
      "local.binary": {
        enabled: true,
        permissionsAcceptedAt: 123,
        acceptedPermissionHash: "ui:contribute|workspace:file:read|workspace:file:write"
      }
    }
  };
  const rendererModule = [
    "export function activate(context) {",
    "  context.api.ui.registerFileEditor('local.binary.editor', (file) => {",
    "    const root = document.createElement('div');",
    "    const status = document.createElement('div');",
    "    status.setAttribute('data-testid', 'binary-status');",
    "    status.textContent = `Initial bytes: ${file.initialBytes?.byteLength ?? 0}`;",
    "    const save = document.createElement('button');",
    "    save.type = 'button';",
    "    save.textContent = '保存二进制';",
    "    save.onclick = async () => {",
    "      const data = new Uint8Array([7, 8, 9]).buffer;",
    "      file.updateBinary(data);",
    "      await file.saveBinary();",
    "      status.textContent = 'Saved binary';",
    "    };",
    "    root.append(status, save);",
    "    return root;",
    "  });",
    "}"
  ].join("\n");

  await page.route("**/binary-plugin.js*", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/javascript", body: rendererModule });
  });

  await page.addInitScript(
    ({ mockSettings, manifest }: { mockSettings: AppSettings; manifest: ExtensionManifest }) => {
      const testWindow = window as typeof window & {
        __savedBinaryBytes?: number[];
        __savedBinaryBaseHash?: string;
      };
      const workspace: WorkspaceInfo = {
        workspaceId: "ws_binary_plugin",
        name: "Binary Plugin Workspace",
        rootPath: "/tmp/binary-plugin-workspace",
        configPath: "/tmp/binary-plugin-workspace/.nolia",
        createdAt: Date.now(),
        lastOpenedAt: Date.now(),
        permissions: { readable: true, writable: true },
        indexState: { status: "ready", progress: 1, version: 1 }
      };
      const descriptor: PluginDescriptor = {
        pluginId: "local.binary",
        pluginPath: "/tmp/plugins/local.binary",
        manifest,
        rendererUrl: "/binary-plugin.js",
        enabled: true,
        permissionsAcceptedAt: 123,
        acceptedPermissionHash: "ui:contribute|workspace:file:read|workspace:file:write",
        permissionHash: "ui:contribute|workspace:file:read|workspace:file:write",
        diagnostics: []
      };
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
              { pathRel: "home.md", name: "home.md", kind: "markdown", size: 6, mtimeMs: Date.now() },
              { pathRel: "sample.bin", name: "sample.bin", kind: "other", size: 4, mtimeMs: Date.now() }
            ]
          }),
          read: async () => ({ content: "# Home", stat: { size: 6, mtimeMs: 0, birthtimeMs: 0 }, sha256: "home", encoding: "utf-8" as const }),
          readBinary: async () => ({ data: new Uint8Array([1, 2, 3, 4]).buffer, stat: { size: 4, mtimeMs: 0, birthtimeMs: 0 }, sha256: "bin-base", encoding: "binary" as const, mimeType: "application/octet-stream" }),
          writeAtomic: async () => ({ status: "saved" as const, sha256: "text-saved", mtimeMs: Date.now() }),
          writeBinaryAtomic: async ({ data, baseHash }: { data: ArrayBuffer | ArrayBufferView; baseHash: string }) => {
            const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            testWindow.__savedBinaryBytes = [...bytes];
            testWindow.__savedBinaryBaseHash = baseHash;
            return { status: "saved" as const, sha256: "bin-saved", mtimeMs: Date.now() };
          },
          create: async () => ({ ok: true, affectedPaths: [] }),
          rename: async () => ({ ok: true, affectedPaths: [] }),
          trash: async () => ({ ok: true, affectedPaths: [] }),
          openExternal: async () => ({ ok: true }),
          revealInFinder: async () => ({ ok: true })
        },
        document: { parse: async () => parsed },
        search: { query: async () => ({ items: [{ pathRel: "home.md", title: "Home", score: 1, snippets: ["home.md"] }], indexVersion: 1, isPartial: false }) },
        graph: { getBacklinks: async () => ({ linked: [], unlinked: [] }) },
        attachment: { import: async () => ({ assetPathRel: "", markdown: "", mimeType: "", size: 0 }), pickImage: async () => ({}) },
        export: { document: async () => ({ status: "completed", outputPath: "/tmp/export.html", warnings: [] }) },
        clipboard: { writeRich: async () => ({ ok: true }) },
        settings: { get: async () => mockSettings, set: async () => mockSettings },
        plugins: {
          list: async () => [descriptor],
          setEnabled: async () => [descriptor],
          acceptPermissions: async () => [descriptor],
          recordFailure: async () => [descriptor]
        },
        extensions: { syncMenus: async () => ({ ok: true }) },
        diagnostics: { openLogs: async () => "" },
        events: {
          onAppCommand: () => () => undefined,
          onExternalFileOpen: () => () => undefined
        }
      };
    },
    { mockSettings: binarySettings, manifest }
  );

  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByRole("button", { name: "sample.bin" }).click();
  await expect(page.getByTestId("binary-status")).toHaveText("Initial bytes: 4");
  await page.getByRole("button", { name: "保存二进制" }).click();

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __savedBinaryBytes?: number[] }).__savedBinaryBytes)).toEqual([7, 8, 9]);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __savedBinaryBaseHash?: string }).__savedBinaryBaseHash)).toBe("bin-base");
  await expect(page.locator(".statusbar")).toContainText("已保存");
});

test("plugin settings require permission acceptance and surface invalid manifests", async ({ page }) => {
  const manifest: ExtensionManifest = {
    id: "external.needsReview",
    name: "Needs Review",
    version: "1.0.0",
    apiVersion: 2,
    activationEvents: ["onStartup"],
    permissions: ["ui:contribute", "workspace:file:read"],
    renderer: "index.js",
    contributes: {
      sidebarPanels: [{ id: "external.needsReview.panel", title: "Needs Review", visibleInNav: true }]
    }
  };
  const permissionHash = "ui:contribute|workspace:file:read";
  const descriptors: PluginDescriptor[] = [
    {
      pluginId: manifest.id,
      pluginPath: "/tmp/plugins/external.needsReview",
      manifest,
      rendererUrl: "/plugins/external.needsReview/index.js",
      enabled: false,
      permissionHash,
      diagnostics: []
    },
    {
      pluginId: "broken.manifest",
      pluginPath: "/tmp/plugins/broken.manifest",
      enabled: false,
      diagnostics: [{ level: "error", message: "plugin.json 缺少 contributes 字段" }]
    }
  ];

  await page.route("**/plugins/external.needsReview/index.js*", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/javascript", body: "export function activate() {}" });
  });

  await installMockNolia(page, {
    settings: { editorMode: "source", plugins: { [manifest.id]: { enabled: false } } },
    files: { "home.md": "# Home\n\nPlugin settings smoke." },
    plugins: descriptors
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await settingsDialog.getByRole("tab", { name: "插件管理" }).click();

  const pluginItem = settingsDialog.locator(".plugin-settings-item", { hasText: "Needs Review" });
  await expect(pluginItem).toContainText("读取工作区文件");
  await expect(pluginItem.getByRole("button", { name: "接受权限" })).toBeVisible();
  await expect(pluginItem.getByRole("checkbox")).toBeDisabled();

  await pluginItem.getByRole("button", { name: "接受权限" }).click();
  const permissionDialog = page.getByRole("dialog", { name: "确认插件权限" });
  await expect(permissionDialog).toBeVisible();
  await expect(permissionDialog).toContainText("读取工作区文件");
  await permissionDialog.getByRole("button", { name: "确认权限" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { acceptedPlugins: string[] } }).__noliaMock.acceptedPlugins))
    .toContain(manifest.id);
  await expect(pluginItem.getByRole("button", { name: "接受权限" })).toHaveCount(0);
  await expect(pluginItem.getByRole("checkbox")).toBeEnabled();

  await pluginItem.getByRole("checkbox").check();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { pluginEnabledHistory: Array<{ pluginId: string; enabled: boolean }> } }).__noliaMock.pluginEnabledHistory))
    .toContainEqual({ pluginId: manifest.id, enabled: true });

  const invalidItem = settingsDialog.locator(".plugin-settings-item.is-invalid", { hasText: "broken.manifest" });
  await expect(invalidItem).toContainText("插件清单无效");
  await expect(invalidItem).toContainText("plugin.json 缺少 contributes 字段");
  await expect(settingsDialog.locator(".settings-dialog")).toBeVisible();
});
