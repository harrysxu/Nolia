import type { Page } from "@playwright/test";
import type { PluginDescriptor } from "../../../src/shared/extensions";
import type { AppSettings, BacklinksResponse, FileTreeNode, ParsedDocument, RecentWorkspace, SearchResultItem, WorkspaceIndexedEvent, WorkspaceInfo } from "../../../src/shared/types";

const MOCK_PNG_BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 29, 99, 248, 255, 255, 255, 127, 0, 9, 251, 3, 254, 85, 140, 87, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

export const defaultTestSettings: AppSettings = {
  language: "zh-CN",
  theme: "light",
  editorMode: "source",
  editorWidth: "wide",
  fontSize: "medium",
  focusMode: false,
  autoSaveDelayMs: 60,
  attachmentStrategy: "workspace_assets",
  pluginSafeMode: false,
  plugins: {}
};

export interface MockBinaryFile {
  bytes?: number[];
  mimeType?: string;
  size?: number;
}

export interface MockWorkspaceOptions {
  activeWorkspace?: boolean;
  platform?: NodeJS.Platform;
  workspace?: Partial<WorkspaceInfo>;
  settings?: Partial<AppSettings>;
  files?: Record<string, string>;
  binaries?: Record<string, MockBinaryFile>;
  recentWorkspaces?: RecentWorkspace[];
  searchItems?: SearchResultItem[];
  backlinks?: BacklinksResponse;
  plugins?: PluginDescriptor[];
  createdAt?: number;
}

export async function installMockNolia(page: Page, options: MockWorkspaceOptions = {}) {
  await page.addInitScript((rawOptions: MockWorkspaceOptions & { defaultSettings: AppSettings; platform: NodeJS.Platform }) => {
    type MockFileNode = { pathRel: string; name: string; kind: FileTreeNode["kind"]; size: number; mtimeMs: number; children?: MockFileNode[] };
    type MockWindow = typeof window & {
      __emitWorkspaceIndexed?: (event?: Partial<WorkspaceIndexedEvent>) => void;
      __noliaMock: {
        files: Record<string, string>;
        binaries: Record<string, MockBinaryFile>;
        createdPaths: string[];
        renamedPaths: Array<{ sourcePathRel: string; targetPathRel: string }>;
        trashedPaths: string[];
        savedText: Record<string, string>;
        savedBinary: Record<string, number[]>;
        openedExternal: string[];
        revealed: string[];
        settingsHistory: Array<{ key: string; value: unknown }>;
        pluginEnabledHistory: Array<{ pluginId: string; enabled: boolean }>;
        acceptedPlugins: string[];
      };
    };

    const now = rawOptions.createdAt ?? Date.now();
    const workspace: WorkspaceInfo = {
      workspaceId: "ws_full_selftest",
      name: "Full Selftest Workspace",
      rootPath: "/tmp/nolia-full-selftest",
      configPath: "/tmp/nolia-full-selftest/.nolia",
      createdAt: now,
      lastOpenedAt: now,
      permissions: { readable: true, writable: true },
      indexState: { status: "ready", progress: 1, version: 1 },
      ...rawOptions.workspace
    };
    const workspaceClosedStorageKey = "__noliaMockWorkspaceClosed";
    let workspaceOpen = rawOptions.activeWorkspace !== false && window.localStorage.getItem(workspaceClosedStorageKey) !== "1";
    let mutableSettings: AppSettings = {
      ...rawOptions.defaultSettings,
      ...(rawOptions.settings ?? {}),
      plugins: {
        ...rawOptions.defaultSettings.plugins,
        ...(rawOptions.settings?.plugins ?? {})
      }
    };
    let pluginDescriptors = [...(rawOptions.plugins ?? [])];
    const files = new Map<string, string>(Object.entries(rawOptions.files ?? { "home.md": "# Home\n\nSelf test workspace." }));
    const binaries = new Map<string, MockBinaryFile>(Object.entries(rawOptions.binaries ?? {}));
    let recentWorkspaces = [...(rawOptions.recentWorkspaces ?? [])];
    const explicitSearchItems = rawOptions.searchItems;
    const backlinks = rawOptions.backlinks ?? { linked: [], unlinked: [] };
    const workspaceIndexedListeners = new Set<(event: WorkspaceIndexedEvent) => void>();

    const testWindow = window as MockWindow;
    testWindow.__noliaMock = {
      files: Object.fromEntries(files),
      binaries: Object.fromEntries(binaries),
      createdPaths: [],
      renamedPaths: [],
      trashedPaths: [],
      savedText: {},
      savedBinary: {},
      openedExternal: [],
      revealed: [],
      settingsHistory: [],
      pluginEnabledHistory: [],
      acceptedPlugins: []
    };
    testWindow.__emitWorkspaceIndexed = (event = {}) => {
      const indexedEvent: WorkspaceIndexedEvent = {
        workspaceId: workspace.workspaceId,
        pathRel: "home.md",
        indexVersion: Date.now(),
        ...event
      };
      workspaceIndexedListeners.forEach((listener) => listener(indexedEvent));
    };

    const syncFiles = () => {
      testWindow.__noliaMock.files = Object.fromEntries(files);
      testWindow.__noliaMock.binaries = Object.fromEntries(binaries);
    };

    const fileNameFor = (pathRel: string) => pathRel.split("/").filter(Boolean).pop() ?? pathRel;
    const parentPathFor = (pathRel: string) => pathRel.split("/").filter(Boolean).slice(0, -1).join("/");
    const extensionFor = (pathRel: string) => pathRel.match(/\.[^.\\/]+$/)?.[0].toLowerCase() ?? "";
    const kindFor = (pathRel: string): FileTreeNode["kind"] => {
      if (extensionFor(pathRel).match(/^\.md(own|arkdown)?$/)) {
        return "markdown";
      }
      return parentPathFor(pathRel).startsWith("assets") || pathRel.startsWith("assets/") ? "asset" : "other";
    };
    const parseDocument = (pathRel: string, content: string): ParsedDocument => {
      const title = content.match(/^#\s+(.+)$/m)?.[1] ?? fileNameFor(pathRel).replace(/\.md(?:own|arkdown)?$/i, "");
      const headings = [...content.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match, index) => ({
        id: match[2].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || `heading-${index + 1}`,
        text: match[2],
        depth: match[1].length,
        line: content.slice(0, match.index).split(/\r?\n/).length
      }));
      return {
        frontmatter: {},
        title,
        body: content,
        plainText: content.replace(/[#*_`>\-[\]()]/g, " "),
        headings,
        tags: [...content.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((match) => match[2]),
        links: [],
        wikilinks: [],
        attachments: [],
        diagnostics: [],
        wordCount: content.split(/\s+/).filter(Boolean).length,
        lineCount: content.split(/\r?\n/).length
      };
    };
    const ensureDirectory = (root: MockFileNode[], pathRel: string): MockFileNode[] => {
      if (!pathRel) {
        return root;
      }
      let current = root;
      let currentPath = "";
      for (const part of pathRel.split("/").filter(Boolean)) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        let node = current.find((item) => item.pathRel === currentPath);
        if (!node) {
          node = { pathRel: currentPath, name: part, kind: "directory", size: 0, mtimeMs: now, children: [] };
          current.push(node);
        }
        node.children ??= [];
        current = node.children;
      }
      return current;
    };
    const listNodes = (): FileTreeNode[] => {
      const root: MockFileNode[] = [];
      const allPaths = [...files.keys(), ...binaries.keys()].sort((a, b) => a.localeCompare(b));
      for (const pathRel of allPaths) {
        const parent = ensureDirectory(root, parentPathFor(pathRel));
        const content = files.get(pathRel);
        const binary = binaries.get(pathRel);
        parent.push({
          pathRel,
          name: fileNameFor(pathRel),
          kind: kindFor(pathRel),
          size: content?.length ?? binary?.size ?? binary?.bytes?.length ?? 0,
          mtimeMs: now
        });
      }
      const sortTree = (nodes: MockFileNode[]) => {
        nodes.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || a.name.localeCompare(b.name));
        for (const node of nodes) {
          if (node.children) {
            sortTree(node.children);
          }
        }
      };
      sortTree(root);
      return root;
    };
    const searchWorkspace = (query: string): SearchResultItem[] => {
      if (explicitSearchItems && !query.trim()) {
        return explicitSearchItems;
      }
      const normalizedQuery = query.trim().toLowerCase();
      return [...files.entries()]
        .filter(([pathRel, content]) => kindFor(pathRel) === "markdown" && (!normalizedQuery || `${pathRel}\n${content}`.toLowerCase().includes(normalizedQuery)))
        .map(([pathRel, content], index) => ({
          pathRel,
          title: parseDocument(pathRel, content).title,
          score: 1 - index / 100,
          snippets: [content.split(/\r?\n/).find((line) => (normalizedQuery ? line.toLowerCase().includes(normalizedQuery) : line.trim())) ?? pathRel]
        }));
    };

    window.nolia = {
      workspace: {
        bootstrap: async () => ({
          activeWorkspace: workspaceOpen ? workspace : undefined,
          recentWorkspaces,
          settings: mutableSettings,
          appInfo: {
            platform: rawOptions.platform,
            pluginDirectory: "/tmp/nolia-full-selftest/plugins",
            logsDirectory: "/tmp/nolia-full-selftest/logs"
          }
        }),
        open: async () => {
          workspaceOpen = true;
          window.localStorage.removeItem(workspaceClosedStorageKey);
          return workspace;
        },
        create: async () => {
          workspaceOpen = true;
          window.localStorage.removeItem(workspaceClosedStorageKey);
          return workspace;
        },
        listRecent: async () => recentWorkspaces,
        removeRecent: async ({ workspaceId }) => {
          recentWorkspaces = recentWorkspaces.filter((item) => item.workspaceId !== workspaceId);
          return recentWorkspaces;
        },
        listTags: async () => [],
        switch: async () => {
          workspaceOpen = true;
          window.localStorage.removeItem(workspaceClosedStorageKey);
          return { ok: true, restoredState: workspace };
        },
        close: async () => {
          workspaceOpen = false;
          window.localStorage.setItem(workspaceClosedStorageKey, "1");
        }
      },
      file: {
        listTree: async () => ({ nodes: listNodes() }),
        read: async ({ pathRel }) => {
          const content = files.get(pathRel) ?? "";
          return { content, stat: { size: content.length, mtimeMs: now, birthtimeMs: now }, sha256: `${pathRel}:${content.length}`, encoding: "utf-8" as const };
        },
        readBinary: async ({ pathRel }) => {
          const binary = binaries.get(pathRel) ?? { bytes: [] };
          const bytes = new Uint8Array(binary.bytes ?? []);
          return { data: bytes.buffer, stat: { size: binary.size ?? bytes.byteLength, mtimeMs: now, birthtimeMs: now }, sha256: `${pathRel}:binary:${bytes.byteLength}`, encoding: "binary" as const, mimeType: binary.mimeType };
        },
        writeAtomic: async ({ pathRel, content }) => {
          files.set(pathRel, content);
          testWindow.__noliaMock.savedText[pathRel] = content;
          syncFiles();
          return { status: "saved" as const, sha256: `${pathRel}:saved:${content.length}`, mtimeMs: Date.now() };
        },
        writeBinaryAtomic: async ({ pathRel, data }) => {
          const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          const bytes = [...view];
          binaries.set(pathRel, { ...(binaries.get(pathRel) ?? {}), bytes, size: bytes.length });
          testWindow.__noliaMock.savedBinary[pathRel] = bytes;
          syncFiles();
          return { status: "saved" as const, sha256: `${pathRel}:binary-saved:${bytes.length}`, mtimeMs: Date.now() };
        },
        create: async ({ pathRel, content, kind }) => {
          if (kind === "file") {
            files.set(pathRel, content ?? "");
          }
          testWindow.__noliaMock.createdPaths.push(pathRel);
          syncFiles();
          return { ok: true, affectedPaths: [pathRel] };
        },
        rename: async ({ sourcePathRel, targetPathRel }) => {
          if (files.has(sourcePathRel)) {
            files.set(targetPathRel, files.get(sourcePathRel) ?? "");
            files.delete(sourcePathRel);
          }
          if (binaries.has(sourcePathRel)) {
            binaries.set(targetPathRel, binaries.get(sourcePathRel) ?? {});
            binaries.delete(sourcePathRel);
          }
          testWindow.__noliaMock.renamedPaths.push({ sourcePathRel, targetPathRel });
          syncFiles();
          return { ok: true, affectedPaths: [sourcePathRel, targetPathRel] };
        },
        trash: async ({ pathRel }) => {
          files.delete(pathRel);
          binaries.delete(pathRel);
          testWindow.__noliaMock.trashedPaths.push(pathRel);
          syncFiles();
          return { ok: true, affectedPaths: [pathRel] };
        },
        openExternal: async ({ pathRel }) => {
          testWindow.__noliaMock.openedExternal.push(pathRel);
          return { ok: true };
        },
        revealInFinder: async ({ pathRel }) => {
          testWindow.__noliaMock.revealed.push(pathRel);
          return { ok: true };
        }
      },
      document: { parse: async ({ pathRel, content }) => parseDocument(pathRel, content) },
      search: { query: async ({ query }) => ({ items: searchWorkspace(query), indexVersion: 1, isPartial: false }) },
      graph: { getBacklinks: async () => backlinks },
      attachment: {
        import: async () => ({ assetPathRel: "assets/mock.png", markdown: "![mock.png](assets/mock.png)", mimeType: "image/png", size: MOCK_PNG_BYTES.length }),
        pickImage: async () => ({ path: "/tmp/mock.png" })
      },
      export: { document: async () => ({ status: "completed" as const, outputPath: "/tmp/nolia-export.html", warnings: [] }) },
      clipboard: { writeRich: async () => ({ ok: true }) },
      settings: {
        get: async () => mutableSettings,
        set: async ({ key, value }) => {
          mutableSettings = { ...mutableSettings, [key]: value };
          testWindow.__noliaMock.settingsHistory.push({ key, value });
          return mutableSettings;
        }
      },
      plugins: {
        list: async () => pluginDescriptors,
        setEnabled: async ({ pluginId, enabled }) => {
          testWindow.__noliaMock.pluginEnabledHistory.push({ pluginId, enabled });
          pluginDescriptors = pluginDescriptors.map((descriptor) => (descriptor.pluginId === pluginId ? { ...descriptor, enabled } : descriptor));
          mutableSettings = {
            ...mutableSettings,
            plugins: {
              ...mutableSettings.plugins,
              [pluginId]: {
                ...(mutableSettings.plugins[pluginId] ?? {}),
                enabled
              }
            }
          };
          return pluginDescriptors;
        },
        acceptPermissions: async ({ pluginId }) => {
          testWindow.__noliaMock.acceptedPlugins.push(pluginId);
          pluginDescriptors = pluginDescriptors.map((descriptor) =>
            descriptor.pluginId === pluginId
              ? { ...descriptor, permissionsAcceptedAt: Date.now(), acceptedPermissionHash: descriptor.permissionHash, needsPermissionReview: false }
              : descriptor
          );
          mutableSettings = {
            ...mutableSettings,
            plugins: {
              ...mutableSettings.plugins,
              [pluginId]: {
                ...(mutableSettings.plugins[pluginId] ?? {}),
                enabled: mutableSettings.plugins[pluginId]?.enabled ?? false,
                permissionsAcceptedAt: Date.now(),
                acceptedPermissionHash: pluginDescriptors.find((descriptor) => descriptor.pluginId === pluginId)?.permissionHash
              }
            }
          };
          return pluginDescriptors;
        },
        recordFailure: async ({ pluginId, message }) => {
          pluginDescriptors = pluginDescriptors.map((descriptor) =>
            descriptor.pluginId === pluginId ? { ...descriptor, diagnostics: [...descriptor.diagnostics, { level: "error" as const, message }] } : descriptor
          );
          return pluginDescriptors;
        }
      },
      extensions: { syncMenus: async () => ({ ok: true }) },
      diagnostics: { openLogs: async () => "" },
      events: {
        onAppCommand: () => () => undefined,
        onExternalFileOpen: () => () => undefined,
        onWorkspaceIndexed: (listener) => {
          workspaceIndexedListeners.add(listener);
          return () => workspaceIndexedListeners.delete(listener);
        }
      }
    };
  }, { ...options, defaultSettings: defaultTestSettings, platform: options.platform ?? process.platform });
}
