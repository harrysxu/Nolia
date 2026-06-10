import type { Page } from "@playwright/test";
import { BUILTIN_AI_COMMANDS, DEFAULT_AI_SETTINGS } from "../../../src/shared/ai";
import type { AiChatStreamEvent, AiIndexStatus } from "../../../src/shared/ai";
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
  ai: DEFAULT_AI_SETTINGS,
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
  await page.addInitScript((rawOptions: MockWorkspaceOptions & { defaultSettings: AppSettings; platform: NodeJS.Platform; builtInAiCommands: typeof BUILTIN_AI_COMMANDS }) => {
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
      ai: {
        ...rawOptions.defaultSettings.ai,
        ...(rawOptions.settings?.ai ?? {}),
        providers: {
          ...rawOptions.defaultSettings.ai.providers,
          ...(rawOptions.settings?.ai?.providers ?? {})
        },
        commands: {
          ...rawOptions.defaultSettings.ai.commands,
          ...(rawOptions.settings?.ai?.commands ?? {})
        },
        privacy: {
          ...rawOptions.defaultSettings.ai.privacy,
          ...(rawOptions.settings?.ai?.privacy ?? {})
        },
        index: {
          ...rawOptions.defaultSettings.ai.index,
          ...(rawOptions.settings?.ai?.index ?? {})
        }
      },
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
    const aiChatListeners = new Set<(event: AiChatStreamEvent) => void>();
    let aiIndexStatus: AiIndexStatus = mutableSettings.ai.index.enabled
      ? { status: "idle" as const, progress: 0, message: "AI index has not been built." }
      : { status: "disabled" as const, progress: 0, message: "AI index is disabled." };

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
    const isTextResourcePath = (pathRel: string) => [".txt", ".csv", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".log"].includes(extensionFor(pathRel));
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
      ai: {
        listCredentials: async () => [],
        setCredential: async ({ providerId, label }) => ({ keyRef: `ai:${providerId}:mock`, providerId, label, createdAt: now, updatedAt: Date.now() }),
        deleteCredential: async () => ({ ok: true }),
        testProvider: async () => ({ ok: true, message: "Mock provider is ready." }),
        listModels: async () => ({ models: [{ id: "mock-fast", providerId: "mock", label: "Mock Fast" }] }),
        previewContext: async ({ prompt, editor, includeSelection, includeCurrentDocument }) => {
          const items = [];
          if (includeSelection !== false && editor?.selectionText?.trim()) {
            items.push({
              id: "selection",
              kind: "selection" as const,
              label: "选区",
              pathRel: editor.pathRel,
              title: editor.title,
              excerpt: editor.selectionText.slice(0, 400),
              charCount: editor.selectionText.length
            });
          }
          if (includeCurrentDocument !== false && editor?.sourceText?.trim()) {
            items.push({
              id: "current-document",
              kind: "current-document" as const,
              label: "当前文档",
              pathRel: editor.pathRel,
              title: editor.title,
              excerpt: editor.sourceText.slice(0, 400),
              charCount: editor.sourceText.length
            });
          }
          return {
            previewId: `preview:${Date.now()}`,
            providerId: "mock",
            model: "mock-fast",
            estimatedInputChars: (prompt?.length ?? 0) + items.reduce((sum, item) => sum + item.charCount, 0),
            items,
            warnings: [],
            expiresAt: Date.now() + 60_000
          };
        },
        startChat: async ({ prompt, editor }) => {
          const requestId = `ai:${Date.now()}`;
          const text = `Mock AI: ${prompt || "当前文档"}`;
          const citations = editor?.pathRel
            ? [{ contextItemId: "current-document", pathRel: editor.pathRel, title: editor.title, line: 1 }]
            : [];
          window.setTimeout(() => {
            aiChatListeners.forEach((listener) => listener({ requestId, type: "started", providerId: "mock", model: "mock-fast" }));
            aiChatListeners.forEach((listener) => listener({ requestId, type: "delta", text }));
            aiChatListeners.forEach((listener) => listener({ requestId, type: "result", result: { requestId, text, citations } }));
            aiChatListeners.forEach((listener) => listener({ requestId, type: "done" }));
          }, 0);
          return { requestId };
        },
        cancelChat: async ({ requestId }) => {
          aiChatListeners.forEach((listener) => listener({ requestId, type: "cancelled" }));
          return { ok: true };
        },
        listCommands: async () => [...rawOptions.builtInAiCommands, ...Object.values(mutableSettings.ai.commands)].filter((command) => command.enabled).sort((left, right) => left.order - right.order || left.name.localeCompare(right.name)),
        runCommand: async (request) => window.nolia.ai!.startChat(request),
        indexStatus: async () => mutableSettings.ai.index.enabled ? aiIndexStatus : { status: "disabled" as const, progress: 0, message: "AI index is disabled." },
        rebuildIndex: async () => {
          if (!mutableSettings.ai.index.enabled) {
            aiIndexStatus = { status: "disabled" as const, progress: 0, message: "AI index is disabled." };
            return aiIndexStatus;
          }
          const indexedTextCount = mutableSettings.ai.index.includeTextResources
            ? [...files.keys()].filter((pathRel) => kindFor(pathRel) === "markdown" || isTextResourcePath(pathRel)).length
            : 0;
          aiIndexStatus = { status: "ready" as const, progress: 1, message: "AI index is ready.", chunkCount: indexedTextCount, updatedAt: Date.now() };
          return aiIndexStatus;
        },
        clearIndex: async () => {
          aiIndexStatus = { status: "idle" as const, progress: 0, message: "AI index has been cleared.", chunkCount: 0, embeddingChunkCount: 0, updatedAt: Date.now() };
          return aiIndexStatus;
        },
        cancelIndex: async () => {
          aiIndexStatus = { ...aiIndexStatus, status: "paused" as const, paused: true, message: "AI indexing pause requested." };
          return aiIndexStatus;
        },
        webSearch: async () => ({
          providerId: "disabled",
          results: []
        }),
        extractAttachment: async ({ pathRel }) => ({
          pathRel,
          kind: isTextResourcePath(pathRel) ? "text" as const : "unsupported" as const,
          title: pathRel.split("/").pop() ?? pathRel,
          text: files.get(pathRel) ?? "",
          warnings: files.has(pathRel) ? [] : [`No extractable mock attachment for ${pathRel}`]
        }),
        prepareChangePlan: async ({ sourceText }) => {
          const candidates: string[] = [];
          const fenced = [...sourceText.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
          candidates.push(...fenced);
          const firstObject = sourceText.indexOf("{");
          const lastObject = sourceText.lastIndexOf("}");
          if (firstObject >= 0 && lastObject > firstObject) {
            candidates.push(sourceText.slice(firstObject, lastObject + 1));
          }
          const parsed = candidates.reduce<unknown | undefined>((result, candidate) => {
            if (result) {
              return result;
            }
            try {
              return JSON.parse(candidate) as unknown;
            } catch {
              return undefined;
            }
          }, undefined);
          const rawChanges = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "changes" in parsed
            ? (parsed as { changes?: unknown }).changes
            : parsed;
          const operations = Array.isArray(rawChanges)
            ? rawChanges.flatMap((raw, index) => {
                if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
                  return [];
                }
                const change = raw as Record<string, unknown>;
                const action = change.action === "create" || change.action === "modify" || change.action === "rename" || change.action === "delete"
                  ? change.action as "create" | "modify" | "rename" | "delete"
                  : undefined;
                const pathRel = typeof change.pathRel === "string" ? change.pathRel.replace(/^\/+|\/+$/g, "") : undefined;
                const targetPathRel = typeof change.targetPathRel === "string" ? change.targetPathRel.replace(/^\/+|\/+$/g, "") : undefined;
                const content = typeof change.content === "string" ? change.content : undefined;
                if (!action || !pathRel) {
                  return [];
                }
                const before = files.get(pathRel);
                return [{
                  id: `mock-change-${index + 1}`,
                  action,
                  pathRel,
                  targetPathRel,
                  title: typeof change.title === "string" ? change.title : undefined,
                  content,
                  before,
                  after: content,
                  baseHash: before === undefined ? "new" : `${pathRel}:${before.length}`,
                  diff: [
                    `--- a/${pathRel}`,
                    `+++ b/${targetPathRel ?? pathRel}`,
                    action === "rename" ? `rename ${pathRel} -> ${targetPathRel ?? ""}` : content ?? ""
                  ].join("\n"),
                  status: "pending" as const
                }];
              })
            : [];
          return {
            planId: `mock-plan:${Date.now()}`,
            sourceText,
            operations,
            warnings: [],
            error: operations.length ? undefined : "未识别到有效的 AI 变更计划。"
          };
        },
        applyChangePlan: async ({ plan, acceptedOperationIds }) => {
          const accepted = acceptedOperationIds?.length ? new Set(acceptedOperationIds) : undefined;
          const operations = plan.operations.map((operation) => {
            if (accepted && !accepted.has(operation.id)) {
              return { ...operation, status: "rejected" as const };
            }
            if (operation.action === "create") {
              files.set(operation.pathRel, operation.content ?? operation.after ?? "");
              testWindow.__noliaMock.createdPaths.push(operation.pathRel);
            } else if (operation.action === "modify") {
              files.set(operation.pathRel, operation.content ?? operation.after ?? "");
              testWindow.__noliaMock.savedText[operation.pathRel] = operation.content ?? operation.after ?? "";
            } else if (operation.action === "rename" && operation.targetPathRel) {
              const current = files.get(operation.pathRel);
              if (current !== undefined) {
                files.set(operation.targetPathRel, current);
                files.delete(operation.pathRel);
              }
              testWindow.__noliaMock.renamedPaths.push({ sourcePathRel: operation.pathRel, targetPathRel: operation.targetPathRel });
            } else if (operation.action === "delete") {
              files.delete(operation.pathRel);
              binaries.delete(operation.pathRel);
              testWindow.__noliaMock.trashedPaths.push(operation.pathRel);
            }
            return { ...operation, status: "applied" as const, message: "已应用" };
          });
          syncFiles();
          return {
            planId: plan.planId,
            operations,
            appliedCount: operations.filter((operation) => operation.status === "applied").length,
            conflictCount: 0,
            errorCount: 0
          };
        },
        insights: async ({ pathRel, sourceText, limit }) => {
          const text = sourceText ?? (pathRel ? files.get(pathRel) ?? "" : "");
          const firstOtherFile = [...files.keys()].find((candidate) => candidate !== pathRel);
          return {
            items: [
              {
                id: "mock-insight-tag",
                kind: "tag" as const,
                label: "建议标签：#ai",
                target: "ai",
                score: 0.82,
                excerpt: "工作区中已有相关 AI 内容。"
              },
              ...(firstOtherFile ? [{
                id: "mock-insight-similar",
                kind: "similar" as const,
                label: `相关笔记：${fileNameFor(firstOtherFile)}`,
                pathRel: firstOtherFile,
                score: 0.74,
                excerpt: (files.get(firstOtherFile) ?? text).slice(0, 160)
              }] : [])
            ].slice(0, limit ?? 8),
            warnings: text.trim() ? [] : ["当前文档内容为空，整理建议有限。"]
          };
        },
        onChatEvent: (listener) => {
          aiChatListeners.add(listener);
          return () => aiChatListeners.delete(listener);
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
  }, { ...options, defaultSettings: defaultTestSettings, platform: options.platform ?? process.platform, builtInAiCommands: BUILTIN_AI_COMMANDS });
}
