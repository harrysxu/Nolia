import type { Page } from "@playwright/test";
import { DEFAULT_SETTINGS } from "../../../src/shared/constants";
import type { PluginDescriptor } from "../../../src/shared/extensions";
import type { AiApiMode, AiEmbeddingSettings, AiProviderId, AiProviderProfilePublic, AiProviderTestRequest, AiRunEvent, AiSettingsPublic } from "../../../src/shared/ai";
import type { AppSettings, BacklinksResponse, FileTreeNode, ParsedDocument, RecentWorkspace, SearchResultItem, WorkspaceIndexedEvent, WorkspaceInfo } from "../../../src/shared/types";

const MOCK_PNG_BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 29, 99, 248, 255, 255, 255, 127, 0, 9, 251, 3, 254, 85, 140, 87, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

export const defaultTestSettings: AppSettings = {
  ...DEFAULT_SETTINGS,
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
  legacyAiPublicSettingsWithoutEmbedding?: boolean;
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
        clipboardWrites: Array<{ text?: string; html?: string }>;
        historySnapshots: Array<{ id: number; pathRel: string; reason: string; content: string }>;
        aiProviderTests: AiProviderTestRequest[];
        aiRuns: Array<{ runId: string; taskId?: string; via?: "task" | "run"; instruction: string; entryPoint?: string; actionId?: string; clientContext?: unknown; conversation?: unknown; options?: unknown }>;
      };
    };

    const now = rawOptions.createdAt ?? Date.now();
    const isAiProviderId = (value: unknown): value is AiProviderId => value === "openai-compatible" || value === "ollama";
    const fallbackProviderFor = (providerId: AiProviderId): AppSettings["ai"]["providers"][number] => providerId === "ollama"
      ? {
          id: "ollama-local",
          name: "Local Ollama",
          providerId: "ollama",
          model: "",
          baseUrl: "http://localhost:11434",
          apiMode: "ollama-native",
          disabled: false
        }
      : {
          id: "openai-compatible",
          name: "OpenAI-compatible",
          providerId: "openai-compatible",
          model: "",
          baseUrl: "",
          apiMode: "chat-completions",
          disabled: false
        };
    const safeProviderProfileId = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "provider";
    const normalizeMockProvider = (value: unknown, fallback?: AppSettings["ai"]["providers"][number]): AppSettings["ai"]["providers"][number] | undefined => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return fallback;
      }
      const raw = value as Partial<AppSettings["ai"]["providers"][number]>;
      const providerId = isAiProviderId(raw.providerId) ? raw.providerId : fallback?.providerId ?? "ollama";
      const base = fallback ?? fallbackProviderFor(providerId);
      const apiMode: AiApiMode = providerId === "ollama" ? "ollama-native" : raw.apiMode === "responses" ? "responses" : "chat-completions";
      return {
        id: typeof raw.id === "string" && raw.id.trim() ? safeProviderProfileId(raw.id.trim()) : base.id,
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : base.name,
        providerId,
        model: typeof raw.model === "string" ? raw.model : base.model,
        baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim() ? raw.baseUrl.trim() : providerId === "ollama" ? "http://localhost:11434" : "",
        apiMode,
        disabled: typeof raw.disabled === "boolean" ? raw.disabled : Boolean(base.disabled)
      };
    };
    const normalizeMockEmbeddingSettings = (value: unknown): AiEmbeddingSettings => {
      const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<AiEmbeddingSettings>) : {};
      const providerId = isAiProviderId(raw.providerId) ? raw.providerId : "ollama";
      return {
        enabled: Boolean(raw.enabled),
        providerId,
        model: typeof raw.model === "string" ? raw.model : "",
        baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim() ? raw.baseUrl.trim() : providerId === "ollama" ? "http://localhost:11434" : "",
        apiMode: providerId === "ollama" ? "ollama-native" : "openai-embeddings"
      };
    };
    const dedupeMockProviders = (providers: AppSettings["ai"]["providers"]) => {
      const used = new Set<string>();
      return providers.map((provider) => {
        const baseId = safeProviderProfileId(provider.id);
        let id = baseId;
        let index = 2;
        while (used.has(id)) {
          id = `${baseId}-${index}`;
          index += 1;
        }
        used.add(id);
        return { ...provider, id };
      });
    };
    const normalizeMockAiSettings = (value: unknown): AppSettings["ai"] => {
      const raw = value && typeof value === "object" && !Array.isArray(value)
        ? value as Partial<AppSettings["ai"]> & { providerId?: unknown; model?: unknown; baseUrl?: unknown; apiMode?: unknown }
        : {};
      const legacyProviderId = isAiProviderId(raw.providerId) ? raw.providerId : undefined;
      const legacyProfile = legacyProviderId
        ? normalizeMockProvider({
            id: legacyProviderId === "ollama" ? "ollama-local" : "openai-compatible",
            name: legacyProviderId === "ollama" ? "Local Ollama" : "OpenAI-compatible",
            providerId: legacyProviderId,
            model: raw.model,
            baseUrl: raw.baseUrl,
            apiMode: raw.apiMode
          })
        : undefined;
      const normalizedProviders = Array.isArray(raw.providers)
        ? raw.providers.flatMap((item) => {
            const provider = normalizeMockProvider(item);
            return provider ? [provider] : [];
          })
        : [];
      const providers = dedupeMockProviders(normalizedProviders.length ? normalizedProviders : [legacyProfile ?? fallbackProviderFor("ollama")]);
      const defaultProviderId =
        typeof raw.defaultProviderId === "string" && providers.some((provider) => provider.id === raw.defaultProviderId)
          ? raw.defaultProviderId
          : legacyProfile?.id && providers.some((provider) => provider.id === legacyProfile.id)
            ? legacyProfile.id
            : providers[0].id;
      return {
        enabled: Boolean(raw.enabled),
        defaultProviderId,
        providers,
        embedding: normalizeMockEmbeddingSettings(raw.embedding),
        conversationHistoryTurns: typeof raw.conversationHistoryTurns === "number" && Number.isFinite(raw.conversationHistoryTurns)
          ? Math.max(0, Math.min(50, Math.trunc(raw.conversationHistoryTurns)))
          : 3,
        agentMaxSteps: typeof raw.agentMaxSteps === "number" && Number.isFinite(raw.agentMaxSteps)
          ? Math.max(1, Math.min(30, Math.trunc(raw.agentMaxSteps)))
          : 12,
        allowCurrentNoteContent: Boolean(raw.allowCurrentNoteContent),
        allowWorkspaceSearch: Boolean(raw.allowWorkspaceSearch),
        allowReadSearchResults: Boolean(raw.allowWorkspaceSearch && raw.allowReadSearchResults),
        allowWorkspaceRead: Boolean(raw.allowWorkspaceRead),
        allowWorkspaceOperations: Boolean(raw.allowWorkspaceRead && raw.allowWorkspaceOperations)
      };
    };
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
    mutableSettings = { ...mutableSettings, ai: normalizeMockAiSettings(mutableSettings.ai) };
    let pluginDescriptors = [...(rawOptions.plugins ?? [])];
    const publicAiSettings = (hasApiKeyByProviderId: Record<string, string> = {}): AiSettingsPublic => {
      const ai = normalizeMockAiSettings(mutableSettings.ai);
      const providers: AiProviderProfilePublic[] = ai.providers.map((provider) => ({ ...provider, hasApiKey: Boolean(hasApiKeyByProviderId[provider.id]) }));
      const activeProvider =
        providers.find((provider) => provider.id === ai.defaultProviderId && !provider.disabled) ??
        providers.find((provider) => !provider.disabled) ??
        providers.find((provider) => provider.id === ai.defaultProviderId) ??
        providers[0] ??
        { ...fallbackProviderFor("ollama"), hasApiKey: false };
      return {
        ...ai,
        providers,
        activeProvider,
        providerId: activeProvider.providerId,
        model: activeProvider.model,
        baseUrl: activeProvider.baseUrl,
        apiMode: activeProvider.apiMode,
        hasApiKey: activeProvider.hasApiKey,
        secretStorageAvailable: true,
        secretStorageBackend: "mock",
        embeddingHasApiKey: Boolean(hasApiKeyByProviderId["embedding:openai-compatible"]),
        requireApprovalForWrites: true
      };
    };
    const publicAiSettingsResponse = (settings: AiSettingsPublic): AiSettingsPublic => {
      if (!rawOptions.legacyAiPublicSettingsWithoutEmbedding) {
        return settings;
      }
      const legacySettings = { ...settings } as Partial<AiSettingsPublic>;
      delete legacySettings.embedding;
      return legacySettings as AiSettingsPublic;
    };
    let aiApiKeys: Record<string, string> = {};
    let mutableAiSettings: AiSettingsPublic = publicAiSettings(aiApiKeys);
    let semanticIndexReady = false;
    const files = new Map<string, string>(Object.entries(rawOptions.files ?? { "home.md": "# Home\n\nSelf test workspace." }));
    const binaries = new Map<string, MockBinaryFile>(Object.entries(rawOptions.binaries ?? {}));
    let snapshotCounter = 0;
    const snapshots: Array<{ id: number; pathRel: string; snapshotPath: string; sha256: string; reason: string; size: number; createdAt: number; content: string }> = [];
    let recentWorkspaces = [...(rawOptions.recentWorkspaces ?? [])];
    const explicitSearchItems = rawOptions.searchItems;
    const backlinks = rawOptions.backlinks ?? { linked: [], unlinked: [] };
    const workspaceIndexedListeners = new Set<(event: WorkspaceIndexedEvent) => void>();
    const aiRunListeners = new Set<(event: AiRunEvent) => void>();
    let aiRunCounter = 0;

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
      acceptedPlugins: [],
      clipboardWrites: [],
      historySnapshots: [],
      aiProviderTests: [],
      aiRuns: []
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
    const hasPatchFallback = (value: unknown): boolean => Boolean(value && typeof value === "object" && (value as { patchFallback?: unknown }).patchFallback);
    const createMockSnapshot = (pathRel: string, reason = "manual", content = files.get(pathRel) ?? "") => {
      const latestSnapshot = snapshots
        .filter((snapshot) => snapshot.pathRel === pathRel)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (latestSnapshot?.content === content) {
        return undefined;
      }
      const snapshot = {
        id: ++snapshotCounter,
        pathRel,
        snapshotPath: `${pathRel}.${snapshotCounter}.md`,
        sha256: `${pathRel}:history:${snapshotCounter}`,
        reason,
        size: content.length,
        createdAt: Date.now() + snapshotCounter,
        content
      };
      snapshots.push(snapshot);
      testWindow.__noliaMock.historySnapshots.push({ id: snapshot.id, pathRel, reason, content: snapshot.content });
      return snapshot;
    };
    const snapshotEntry = (snapshot: { id: number; pathRel: string; snapshotPath: string; sha256: string; reason: string; size: number; createdAt: number }) => ({
      id: snapshot.id,
      pathRel: snapshot.pathRel,
      snapshotPath: snapshot.snapshotPath,
      sha256: snapshot.sha256,
      reason: snapshot.reason,
      size: snapshot.size,
      createdAt: snapshot.createdAt
    });

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
        writeAtomic: async ({ pathRel, content, createSnapshot }) => {
          if (createSnapshot && files.has(pathRel)) {
            createMockSnapshot(pathRel, "autosave");
          }
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
        listHistory: async ({ pathRel, limit = 50 }) => ({
          entries: snapshots
            .filter((snapshot) => snapshot.pathRel === pathRel)
            .slice()
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit)
            .map(snapshotEntry)
        }),
        readHistory: async ({ snapshotId }) => {
          const snapshot = snapshots.find((entry) => entry.id === snapshotId);
          return snapshot ? { entry: snapshotEntry(snapshot), content: snapshot.content } : undefined;
        },
        createHistorySnapshot: async ({ pathRel, reason = "manual", content }) => {
          const snapshot = createMockSnapshot(pathRel, reason, content ?? files.get(pathRel) ?? "");
          return { entry: snapshot ? snapshotEntry(snapshot) : undefined };
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
      clipboard: {
        writeRich: async (payload) => {
          testWindow.__noliaMock.clipboardWrites.push(payload);
          return { ok: true };
        }
      },
      settings: {
        get: async () => mutableSettings,
        set: async ({ key, value }) => {
          mutableSettings = { ...mutableSettings, [key]: value };
          if (key === "ai") {
            mutableSettings = { ...mutableSettings, ai: normalizeMockAiSettings(value) };
            mutableAiSettings = publicAiSettings(aiApiKeys);
          }
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
      ai: {
        getSettings: async () => publicAiSettingsResponse(mutableAiSettings),
        setSettings: async ({ settings }) => {
          mutableSettings = { ...mutableSettings, ai: normalizeMockAiSettings({ ...mutableSettings.ai, ...settings, embedding: { ...mutableSettings.ai.embedding, ...(settings.embedding ?? {}) } }) };
          mutableAiSettings = publicAiSettings(aiApiKeys);
          testWindow.__noliaMock.settingsHistory.push({ key: "ai", value: settings });
          return mutableAiSettings;
        },
        setApiKey: async ({ providerProfileId, apiKey }) => {
          aiApiKeys = { ...aiApiKeys, [providerProfileId]: apiKey };
          mutableAiSettings = publicAiSettings(aiApiKeys);
          return mutableAiSettings;
        },
        clearApiKey: async ({ providerProfileId }) => {
          const next = { ...aiApiKeys };
          delete next[providerProfileId];
          aiApiKeys = next;
          mutableAiSettings = publicAiSettings(aiApiKeys);
          return mutableAiSettings;
        },
        getApiKey: async ({ providerProfileId }) => ({ apiKey: aiApiKeys[providerProfileId] }),
        testProvider: async (request = {}) => {
          const { provider } = request;
          testWindow.__noliaMock.aiProviderTests.push(request);
          return {
            ok: true,
            providerId: provider?.providerId ?? mutableAiSettings.providerId,
            model: provider?.model ?? mutableAiSettings.model,
            message: "Mock AI provider connected",
            localOnly: (provider?.providerId ?? mutableAiSettings.providerId) === "ollama"
          };
        },
        listModels: async ({ provider } = {}) => {
          const providerId = provider?.providerId ?? mutableAiSettings.providerId;
          return [{ id: providerId === "ollama" ? "llama3.2" : "gpt-4.1", label: providerId === "ollama" ? "llama3.2" : "gpt-4.1" }];
        },
        testEmbedding: async ({ settings } = {}) => ({
          ok: true,
          providerId: settings?.providerId ?? mutableAiSettings.embedding.providerId,
          model: settings?.model ?? mutableAiSettings.embedding.model,
          message: "Mock embedding connected",
          localOnly: (settings?.providerId ?? mutableAiSettings.embedding.providerId) === "ollama"
        }),
        semanticIndexStatus: async () => ({
          state: semanticIndexReady ? "ready" : mutableAiSettings.embedding.enabled && mutableAiSettings.embedding.model ? "not_created" : "not_configured",
          enabled: mutableAiSettings.embedding.enabled,
          providerId: mutableAiSettings.embedding.providerId,
          model: mutableAiSettings.embedding.model,
          updatedAt: semanticIndexReady ? Date.now() : undefined,
          totalFiles: files.size,
          indexedFiles: semanticIndexReady ? files.size : 0,
          staleFiles: 0,
          chunkCount: semanticIndexReady ? files.size : 0
        }),
        updateSemanticIndex: async () => {
          semanticIndexReady = true;
          return {
            status: {
              state: "ready",
              enabled: mutableAiSettings.embedding.enabled,
              providerId: mutableAiSettings.embedding.providerId,
              model: mutableAiSettings.embedding.model,
              updatedAt: Date.now(),
              totalFiles: files.size,
              indexedFiles: files.size,
              staleFiles: 0,
              chunkCount: files.size
            }
          };
        },
        resetSemanticIndex: async () => {
          semanticIndexReady = true;
          return {
            status: {
              state: "ready",
              enabled: mutableAiSettings.embedding.enabled,
              providerId: mutableAiSettings.embedding.providerId,
              model: mutableAiSettings.embedding.model,
              updatedAt: Date.now(),
              totalFiles: files.size,
              indexedFiles: files.size,
              staleFiles: 0,
              chunkCount: files.size
            }
          };
        },
        startTask: async ({ instruction, clientContext, entryPoint, actionId, conversation, options, title }) => {
          const runId = `mock-ai-${++aiRunCounter}`;
          const taskId = `mock-task-${aiRunCounter}`;
          testWindow.__noliaMock.aiRuns.push({ runId, taskId, via: "task", instruction, entryPoint, actionId, clientContext, conversation, options });
          aiRunListeners.forEach((listener) =>
            listener({
              type: "task-updated",
              runId,
              task: {
                id: taskId,
                runId,
                workspaceId: clientContext.workspaceId,
                title: title ?? instruction.slice(0, 80),
                status: "queued",
                createdAt: Date.now(),
                updatedAt: Date.now()
              }
            })
          );
          const response = await runMockAi({ runId, instruction, clientContext, conversation, options });
          return { ...response, taskId };
        },
        startRun: async ({ instruction, clientContext, entryPoint, actionId, conversation, options }) => {
          const runId = `mock-ai-${++aiRunCounter}`;
          testWindow.__noliaMock.aiRuns.push({ runId, via: "run", instruction, entryPoint, actionId, clientContext, conversation, options });
          return runMockAi({ runId, instruction, clientContext, conversation, options });
        },
        cancelRun: async ({ runId }) => {
          aiRunListeners.forEach((listener) => listener({ type: "cancelled", runId }));
          return { ok: true };
        },
        onRunEvent: (listener) => {
          aiRunListeners.add(listener);
          return () => aiRunListeners.delete(listener);
        }
      },
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

    const runMockAi = async ({ runId, instruction, clientContext, conversation, options }: {
      runId: string;
      instruction: string;
      clientContext: { workspaceId?: string; activeDocument?: { pathRel?: string; title?: string; baseHash?: string; sourceText?: string } };
      conversation?: unknown;
      options?: unknown;
    }) => {
          if (!mutableAiSettings.model) {
            aiRunListeners.forEach((listener) => listener({ type: "error", runId, code: "missing_model", message: "AI model is not configured", retryable: false }));
            await Promise.resolve();
            return { runId };
          }
          if (instruction.includes("模拟启动无响应")) {
            return await new Promise<{ runId: string }>(() => undefined);
          }
          if (instruction.includes("保持运行直到取消")) {
            window.setTimeout(() => {
              aiRunListeners.forEach((listener) => listener({ type: "run-started", runId }));
            }, 0);
            window.setTimeout(() => {
              aiRunListeners.forEach((listener) => listener({ type: "done", runId }));
            }, 20_000);
            return { runId };
          }
          if (instruction.includes("模拟无终止事件")) {
            window.setTimeout(() => {
              aiRunListeners.forEach((listener) => listener({ type: "run-started", runId }));
            }, 0);
            return { runId };
          }
          window.setTimeout(() => {
            aiRunListeners.forEach((listener) => listener({ type: "run-started", runId }));
            if (instruction.includes("触发错误")) {
              aiRunListeners.forEach((listener) => listener({ type: "error", runId, code: "provider_bad_request", message: "Mock AI failure", retryable: true }));
              return;
            }
            if (instruction.includes("模拟空回复")) {
              aiRunListeners.forEach((listener) => listener({ type: "done", runId }));
              return;
            }
            const responseText = instruction.includes("流式 Mermaid 图表")
              ? "```mermaid\ngraph TD\n  A[开始] --> B[完成]\n```"
              : instruction.includes("长 Markdown 回复")
              ? [
                  "# 大模型分类笔记",
                  "",
                  "- GPT-4/GPT-4o：当前主流商用版，多模态能力强",
                  "- Claude 系列：长上下文处理强，安全性高",
                  "- Gemini 系列：搜索和多模态生态整合较好",
                  "",
                  "## 新兴趋势",
                  "",
                  "1. 参数效率提升：MoE 架构让训练更快速高效",
                  "2. 多模态融合：图像、音频与文本理解结合",
                  "3. 端侧部署优化：手机和 PC 上的轻量化模型",
                  "",
                  "你可以把这些信息整理成一份新的文档。"
                ].join("\n")
              : instruction.includes("Markdown 回复")
                ? "# 渲染标题\n\n- 第一项\n- 第二项"
              : instruction.includes("刚才") && Array.isArray(conversation) && conversation.length
                ? `Mock history: ${conversation.map((item) => typeof item === "object" && item && "content" in item ? String(item.content) : "").filter(Boolean).join(" / ")}`
                : `Mock response: ${instruction}`;
            aiRunListeners.forEach((listener) => listener({ type: "text-delta", runId, text: responseText }));
            if (instruction.includes("工作区操作提案")) {
              aiRunListeners.forEach((listener) =>
                listener({
                  type: "patch-proposal",
                  runId,
                  proposal: {
                    id: `mock-workspace-proposal-${Date.now()}`,
                    runId,
                    workspaceId: clientContext.workspaceId ?? workspace.workspaceId,
                    pathRel: "ai.md",
                    title: "Workspace proposal",
                    summary: "Mock workspace operations",
                    sourceSnapshotHash: clientContext.activeDocument?.baseHash ?? "",
                    baseHash: clientContext.activeDocument?.baseHash ?? "",
                    operations: [
                      {
                        type: "replaceDocument",
                        pathRel: "ai.md",
                        beforeText: files.get("ai.md") ?? "",
                        afterText: "# AI Workspace Applied\n\nExisting note updated."
                      },
                      {
                        type: "createFile",
                        pathRel: "ai-created.md",
                        afterText: "# AI Created\n\nNew workspace note."
                      }
                    ]
                  }
                })
              );
            } else if (instruction.includes("提案") && clientContext.activeDocument) {
              aiRunListeners.forEach((listener) =>
                listener({
                  type: "patch-proposal",
                  runId,
                  proposal: {
                    id: `mock-proposal-${Date.now()}`,
                    runId,
                    workspaceId: clientContext.workspaceId ?? workspace.workspaceId,
                    pathRel: clientContext.activeDocument?.pathRel ?? "home.md",
                    title: clientContext.activeDocument?.title ?? "Home",
                    summary: "Mock patch proposal",
                    sourceSnapshotHash: clientContext.activeDocument?.baseHash ?? "",
                    baseHash: clientContext.activeDocument?.baseHash ?? "",
                    operations: [
                      {
                        type: "replaceDocument",
                        beforeText: clientContext.activeDocument?.sourceText ?? "",
                        afterText: instruction.includes("长表格提案")
                          ? [
                              "# 🏆 历届世界杯回顾与解析指南",
                              "",
                              "## 引言",
                              "",
                              "自1930年乌拉圭主办首届足球世界杯以来，这项全球最受瞩目的体育赛事已走过近一个世纪的辉煌历程。",
                              "",
                              "---",
                              "",
                              "## 📅 历届赛事概览（待完善）",
                              "",
                              "| 届数 | 年份 | 举办国/地 | 冠军 | 比分/决赛对手 |",
                              "| --- | --- | --- | --- | --- |",
                              "| 第1届 | 1930 | 🇺🇾乌拉圭 | 🇺🇾乌拉圭 | vs 🇦🇷 4-2 |",
                              "| 第2届 | 1934 | 🇮🇹意大利 | 🇮🇹意大利 | vs 捷克斯洛伐克 2-1 |",
                              "| 第3届 | 1938 | 🇫🇷法国 | 🇮🇹意大利 | vs 匈牙利 4-2 |",
                              "| 第4届 | 1950 | 🇧🇷巴西 | 🇺🇾乌拉圭 | 马拉卡纳之战 |",
                              "| 第5届 | 1954 | 🇨🇭瑞士 | 🇩🇪西德 | 伯尔尼奇迹 |",
                              "",
                              "<details>",
                              "<summary>影响范围</summary>",
                              "",
                              "- 文档标题",
                              "- 引言段落",
                              "- 赛事表格",
                              "",
                              "</details>"
                            ].join("\n")
                          : "# AI Patch Applied\n\nMock patch proposal body."
                      }
                    ]
                  }
                })
              );
            }
            if (hasPatchFallback(options) && !instruction.includes("提案") && clientContext.activeDocument) {
              aiRunListeners.forEach((listener) =>
                listener({
                  type: "patch-proposal",
                  runId,
                  proposal: {
                    id: `mock-fallback-proposal-${Date.now()}`,
                    runId,
                    workspaceId: clientContext.workspaceId ?? workspace.workspaceId,
                    pathRel: clientContext.activeDocument?.pathRel ?? "home.md",
                    title: clientContext.activeDocument?.title ?? "Home",
                    summary: "Generated document update",
                    sourceSnapshotHash: clientContext.activeDocument?.baseHash ?? "",
                    baseHash: clientContext.activeDocument?.baseHash ?? "",
                    operations: [
                      {
                        type: "replaceDocument",
                        beforeText: clientContext.activeDocument?.sourceText ?? "",
                        afterText: responseText
                      }
                    ]
                  }
                })
              );
            }
            if (instruction.includes("流式 Mermaid 图表")) {
              window.setTimeout(() => {
                aiRunListeners.forEach((listener) => listener({ type: "done", runId }));
              }, 180);
              return;
            }
            aiRunListeners.forEach((listener) => listener({ type: "done", runId }));
          }, 0);
          return { runId };
    };
  }, { ...options, defaultSettings: defaultTestSettings, platform: options.platform ?? process.platform });
}
