/* eslint-disable react-hooks/exhaustive-deps -- The shell coordinates IPC subscriptions and ref-backed debounced document state. */
import {
  useEffect,
  forwardRef,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from "react";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { redo as redoCodeMirror, redoDepth as redoDepthCodeMirror, undo as undoCodeMirror, undoDepth as undoDepthCodeMirror } from "@codemirror/commands";
import {
  Bold,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileArchive,
  FileAudio,
  FileCode2,
  Files,
  FileImage,
  FileQuestion,
  FileText,
  FileVideo,
  FilePlus,
  Folder,
  FolderSearch,
  FolderOpen,
  FolderPlus,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Rows3,
  Menu,
  Minus,
  Move,
  Pilcrow,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Pencil,
  Plug,
  Quote,
  Redo2,
  RefreshCw,
  Send,
  Search,
  Settings2,
  Sparkles,
  SquareCheckBig,
  Sigma,
  Star,
  Strikethrough,
  Table2,
  TableOfContents,
  Trash2,
  Undo2,
  Wrench,
  X
} from "lucide-react";

import { createMarkdownTocBlock, hasMarkdownToc, htmlToMarkdown, isMermaidFenceLanguage, mergeWysiwygBodyIntoSource, renderMarkdownToHtml, slugifyMarkdownHeadingId, updateFencedCodeBlockLanguage, updateMarkdownToc } from "../shared/markdown";
import { DEFAULT_SETTINGS } from "../shared/constants";
import { BUILTIN_AI_COMMANDS, DEFAULT_AI_SETTINGS, type AiApplyMode, type AiChangePlanOperation, type AiChangePlanPrepareResponse, type AiChatStreamEvent, type AiCitation, type AiCommandDefinition, type AiContextPreviewResponse, type AiEditorSnapshot, type AiGeneratedResult, type AiIndexStatus, type AiInsightItem, type AiModel, type AiProviderConfig } from "../shared/ai";
import { getBuiltInExtensionManifests } from "../shared/builtinExtensions";
import { createTranslator, formatFileSize as formatLocalizedFileSize, resolveLocale, type Translator } from "../shared/i18n";
import { hasExtensionPermission, type ExtensionContributions, type ExtensionManifest, type ExtensionPermission, type FileEditorContribution, type PluginDescriptor, type SettingContribution, type SidebarPanelContribution } from "../shared/extensions";
import type { AppSettings, BacklinksResponse, EditorMode, FileBinaryReadResponse, FileReadResponse, FileTreeNode, FileWriteResponse, RecentWorkspace, ResolvedLocale, SearchResultItem, WorkspaceInfo } from "../shared/types";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { SourceEditor } from "./components/SourceEditor";
import { TextResourceEditor, type TextResourceEditorHandle } from "./components/TextResourceEditor";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { WysiwygEditor, type WysiwygEditorHandle } from "./components/WysiwygEditor";
import type { MarkdownOpenTarget } from "./components/markdownOpenTarget";
import noliaIconUrl from "../../build/icon.svg";
import { RendererI18nProvider, useRendererI18n } from "./app/i18n";
import { useUiStore } from "./app/store";
import type {
  ActiveResource,
  CreateMenuState,
  DeleteTarget,
  DocumentListItem,
  FavoriteDocument,
  FileClipboard,
  ItemKind,
  LinkDraft,
  MoveDialogState,
  NewItemKind,
  OpenDocumentTab,
  RenameTarget,
  ResourceCategory,
  RightPanelView,
  SidebarView,
  StoredDocumentItem,
  SuspendedShellState,
  TreeSelection
} from "./app/types";
import { isDocumentListItem, isFavoriteDocument, loadWorkspaceLocalLists, saveWorkspaceLocalList, upsertDocumentListItem, workspaceStorageKey } from "./app/documentLists";
import {
  canDropTreeTarget,
  collectMarkdownNotes,
  collectMoveDestinationOptions,
  collectPathSet,
  countOpenableTreeItems,
  fileNameFor,
  filterTreeNodes,
  findFileTreeNode,
  firstOpenableFileTreeNode,
  joinPath,
  parentPathFor,
  pathParent,
  sanitizeItemName,
  uniqueCopiedFilePath,
  uniqueMovedPath
} from "./app/workspaceTree";
import {
  activateRendererPlugin,
  type Disposable,
  type PluginAttachmentExtractorHandler,
  type PluginFileEditorContext,
  type PluginFileViewerContext,
  type PluginRenderProvider,
  type PluginRenderResult,
  type PluginSidebarPanelContext
} from "./extensions/runtime";
import { createExtensionRegistry, filterMenuContributions, isExtensionEnabled, isExtensionPermissionAccepted, selectFileEditor, selectFileViewer } from "./extensions/registry";

const emptyBacklinks: BacklinksResponse = { linked: [], unlinked: [] };
const FLOATING_MENU_MARGIN = 8;
type ResolvedThemeId = "light" | "dark" | "paper" | "technical";
type RegisteredPluginRenderer<TContext> = {
  pluginId: string;
  render: PluginRenderProvider<TContext>;
};
type RegisteredPluginAttachmentExtractor = {
  pluginId: string;
  handler: PluginAttachmentExtractorHandler;
};
type AppRuntimeInfo = {
  platform: NodeJS.Platform;
  pluginDirectory: string;
  logsDirectory: string;
};
type AiPanelMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  status?: "pending" | "done" | "error";
  citations?: AiGeneratedResult["citations"];
  commandName?: string;
};

type AiChangePlanState = AiChangePlanPrepareResponse;

type AiPendingContextApproval = {
  prompt: string;
  scope: AiEditorSnapshot["scope"];
  commandId?: string;
  commandName?: string;
  displayPrompt: string;
  editor?: AiEditorSnapshot;
  preview: AiContextPreviewResponse;
  excludedContextItemIds: string[];
  contextOptions: AiContextRequestOptions;
};

type AiContextRequestOptions = {
  includeSelection?: boolean;
  includeCurrentDocument?: boolean;
  includeBacklinks?: boolean;
  includeAttachments?: boolean;
  includeWebSearch?: boolean;
};

const AI_CONVERSATION_STORAGE_NAME = "aiConversation.v1";
const AI_CONTEXT_APPROVAL_STORAGE_NAME = "aiContextApproval.v1";
const MAX_AI_LOCAL_CONVERSATION_MESSAGES = 50;
const LEFT_PANEL_WIDTH_STORAGE_KEY = "nolia.leftPanelWidth.v2";
const RIGHT_PANEL_WIDTH_STORAGE_KEY = "nolia.rightPanelWidth.v1";
const TOOLBAR_VISIBLE_STORAGE_KEY = "nolia.toolbarVisible.v1";
const LINE_NUMBERS_VISIBLE_STORAGE_KEY = "nolia.lineNumbersVisible.v1";
const DEFAULT_LEFT_PANEL_WIDTH = 300;
const MIN_LEFT_PANEL_WIDTH = 260;
const MAX_LEFT_PANEL_WIDTH = 420;
const DEFAULT_RIGHT_PANEL_WIDTH = 320;
const MIN_RIGHT_PANEL_WIDTH = 240;
const MAX_RIGHT_PANEL_WIDTH = 520;
const DEFAULT_SPLIT_LEFT_PERCENT = 50;
const MIN_SPLIT_LEFT_PERCENT = 25;
const MAX_SPLIT_LEFT_PERCENT = 75;
const EXTERNAL_PARSE_WORKSPACE_ID = "external";
const SPLIT_PREVIEW_RENDER_DELAY_MS = 180;
const USER_STATUS_PROTECT_MS = 1800;

type MarkdownWorkspaceTarget = {
  pathRel: string;
  fragment?: string;
};

export function App() {
  const [startupLocale, setStartupLocale] = useState<ResolvedLocale>("zh-CN");
  const startupLocaleInitializedRef = useRef(false);
  const tr = useMemo(() => createTranslator(startupLocale), [startupLocale]);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | undefined>();
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);
  const [welcomeOpeningWorkspaceId, setWelcomeOpeningWorkspaceId] = useState<string | undefined>();
  const [welcomeErrorMessage, setWelcomeErrorMessage] = useState<string | undefined>();
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [favoriteDocs, setFavoriteDocs] = useState<FavoriteDocument[]>([]);
  const [recentViewedDocs, setRecentViewedDocs] = useState<DocumentListItem[]>([]);
  const [recentEditedDocs, setRecentEditedDocs] = useState<DocumentListItem[]>([]);
  const [noteFilterQuery, setNoteFilterQuery] = useState("");
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState("");
  const [backlinks, setBacklinks] = useState(emptyBacklinks);
  const [openDocs, setOpenDocs] = useState<OpenDocumentTab[]>([]);
  const [activePathRel, setActivePathRel] = useState<string | undefined>();
  const [activeResource, setActiveResource] = useState<ActiveResource | undefined>();
  const [activeHtml, setActiveHtml] = useState("");
  const [statusMessage, setStatusMessage] = useState(() => tr("就绪"));
  const userStatusProtectedUntilRef = useRef(0);
  const [commandQuery, setCommandQuery] = useState("");
  const [newNoteDialogOpen, setNewNoteDialogOpen] = useState(false);
  const [newNoteName, setNewNoteName] = useState(() => tr("未命名"));
  const [newItemKind, setNewItemKind] = useState<NewItemKind>("file");
  const [newItemParentPath, setNewItemParentPath] = useState("");
  const [treeSelection, setTreeSelection] = useState<TreeSelection | undefined>();
  const [createMenu, setCreateMenu] = useState<CreateMenuState | undefined>();
  const [renameTarget, setRenameTarget] = useState<RenameTarget | undefined>();
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | undefined>();
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | undefined>();
  const [moveDialog, setMoveDialog] = useState<MoveDialogState | undefined>();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    target: RenameTarget;
  } | undefined>();
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(readStoredLeftPanelWidth);
  const [rightPanelWidth, setRightPanelWidth] = useState(readStoredRightPanelWidth);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | undefined>();
  const [appInfo, setAppInfo] = useState<AppRuntimeInfo | undefined>();
  const [pluginDescriptors, setPluginDescriptors] = useState<PluginDescriptor[]>([]);
  const [pluginRuntimeManifests, setPluginRuntimeManifests] = useState<ExtensionManifest[]>([]);
  const [pluginCommandIds, setPluginCommandIds] = useState<string[]>([]);
  const [pluginSidebarPanels, setPluginSidebarPanels] = useState<Map<string, PluginRenderProvider<PluginSidebarPanelContext>>>(new Map());
  const [pluginFileViewers, setPluginFileViewers] = useState<Map<string, RegisteredPluginRenderer<PluginFileViewerContext>>>(new Map());
  const [pluginFileEditors, setPluginFileEditors] = useState<Map<string, RegisteredPluginRenderer<PluginFileEditorContext>>>(new Map());
  const pluginAttachmentExtractorsRef = useRef<Map<string, RegisteredPluginAttachmentExtractor>>(new Map());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedCharCount, setSelectedCharCount] = useState(0);
  const [aiCommands, setAiCommands] = useState<AiCommandDefinition[]>([]);
  const [aiMessages, setAiMessages] = useState<AiPanelMessage[]>([]);
  const [aiPreview, setAiPreview] = useState<AiContextPreviewResponse | undefined>();
  const [aiRunningRequestId, setAiRunningRequestId] = useState<string | undefined>();
  const [aiIndexStatus, setAiIndexStatus] = useState<AiIndexStatus | undefined>();
  const [aiIndexRebuildRunning, setAiIndexRebuildRunning] = useState(false);
  const [aiChangePlan, setAiChangePlan] = useState<AiChangePlanState | undefined>();
  const [aiInsights, setAiInsights] = useState<AiInsightItem[]>([]);
  const [aiInsightsWarnings, setAiInsightsWarnings] = useState<string[]>([]);
  const [aiInsightsLoading, setAiInsightsLoading] = useState(false);
  const [aiContextApproval, setAiContextApproval] = useState<AiPendingContextApproval | undefined>();
  const aiMessageByRequestRef = useRef<Map<string, string>>(new Map());
  const aiMessagesRef = useRef<AiPanelMessage[]>([]);
  const aiHistoryWorkspaceRef = useRef<string | undefined>(undefined);
  const aiHistorySkipNextSaveRef = useRef(false);
  const [modifiedOpenCursorActive, setModifiedOpenCursorActive] = useState(false);
  const openDocsRef = useRef(openDocs);
  const activeResourceRef = useRef(activeResource);
  const suspendedShellRef = useRef<SuspendedShellState | undefined>(undefined);
  const leftPanelWidthRef = useRef(leftPanelWidth);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  const viewPreferencesLoadedRef = useRef(false);
  const autosaveTimers = useRef<Map<string, number>>(new Map());
  const renderToken = useRef(0);
  const sourceParseTokensRef = useRef<Map<string, number>>(new Map());
  const htmlDraftsRef = useRef<Map<string, string>>(new Map());
  const pluginCommandHandlersRef = useRef<Map<string, () => void | Promise<void>>>(new Map());
  const pluginEditorSaveHandlersRef = useRef<Map<string, () => Promise<void>>>(new Map());
  const runCommandRef = useRef<(command: string) => void | Promise<void>>(() => undefined);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const sidebarView = useUiStore((state) => state.sidebarView);
  const setSidebarView = useUiStore((state) => state.setSidebarView);
  const rightPanelView = useUiStore((state) => state.rightPanelView);
  const setRightPanelView = useUiStore((state) => state.setRightPanelView);
  const editorPaneRef = useRef<EditorPaneHandle>(null);
  const commandPaletteOpen = useUiStore((state) => state.commandPaletteOpen);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const editorModeSetting = useUiStore((state) => state.editorMode);
  const editorModeSettingRef = useRef(editorModeSetting);
  const setEditorModeSetting = useUiStore((state) => state.setEditorMode);
  const focusMode = useUiStore((state) => state.focusMode);
  const setFocusMode = useUiStore((state) => state.setFocusMode);
  const toolbarVisible = useUiStore((state) => state.toolbarVisible);
  const setToolbarVisible = useUiStore((state) => state.setToolbarVisible);
  const lineNumbersVisible = useUiStore((state) => state.lineNumbersVisible);
  const setLineNumbersVisible = useUiStore((state) => state.setLineNumbersVisible);
  const visibleDocument = activeResource ? undefined : currentDocument();
  const visibleResource = activeResource;
  const visibleDocumentFavorite = visibleDocument ? favoriteDocs.some((item) => item.pathRel === visibleDocument.pathRel) : false;
  const isExternalDocument = visibleDocument?.sourceKind === "external";
  const showWelcome = !workspace && !visibleDocument;
  const showWorkspacePanels = Boolean(workspace) && !immersiveMode;
  const effectiveSettings = appSettings ?? (DEFAULT_SETTINGS as AppSettings);
  const languageRestartRequired = appSettings ? resolveLocale(appSettings.language, navigator.language) !== startupLocale : false;
  const builtInExtensionManifests = useMemo(() => getBuiltInExtensionManifests(startupLocale), [startupLocale]);
  const pluginManifests = useMemo(() => pluginDescriptors.map((descriptor) => descriptor.manifest).filter(isExtensionManifest), [pluginDescriptors]);
  const allExtensionManifests = useMemo(
    () => [...builtInExtensionManifests, ...pluginManifests, ...pluginRuntimeManifests],
    [builtInExtensionManifests, pluginManifests, pluginRuntimeManifests]
  );
  const extensionRegistry = useMemo(() => createExtensionRegistry(allExtensionManifests, effectiveSettings), [allExtensionManifests, effectiveSettings]);
  const sidebarPanels = extensionRegistry.sidebarPanels;
  const settingContributions = extensionRegistry.settings;

  useEffect(() => {
    openDocsRef.current = openDocs;
  }, [openDocs]);

  useEffect(() => {
    aiMessagesRef.current = aiMessages;
  }, [aiMessages]);

  useEffect(() => {
    activeResourceRef.current = activeResource;
  }, [activeResource]);

  useEffect(() => {
    setStatusMessage((message) => (message === "就绪" || message === "Ready" ? tr("就绪") : message));
  }, [tr]);

  useEffect(() => {
    editorModeSettingRef.current = editorModeSetting;
  }, [editorModeSetting]);

  useEffect(() => {
    setSelectedCharCount(0);
  }, [visibleDocument?.pathRel, visibleDocument?.mode]);

  useEffect(() => {
    leftPanelWidthRef.current = leftPanelWidth;
    window.localStorage.setItem(LEFT_PANEL_WIDTH_STORAGE_KEY, String(leftPanelWidth));
  }, [leftPanelWidth]);

  useEffect(() => {
    rightPanelWidthRef.current = rightPanelWidth;
    window.localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(rightPanelWidth));
  }, [rightPanelWidth]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    setToolbarVisible(readStoredBoolean(TOOLBAR_VISIBLE_STORAGE_KEY, true));
    setLineNumbersVisible(readStoredBoolean(LINE_NUMBERS_VISIBLE_STORAGE_KEY, true));
    const timer = window.setTimeout(() => {
      viewPreferencesLoadedRef.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [setLineNumbersVisible, setToolbarVisible]);

  useEffect(() => {
    if (!viewPreferencesLoadedRef.current) {
      return;
    }
    window.localStorage.setItem(TOOLBAR_VISIBLE_STORAGE_KEY, String(toolbarVisible));
  }, [toolbarVisible]);

  useEffect(() => {
    if (!viewPreferencesLoadedRef.current) {
      return;
    }
    window.localStorage.setItem(LINE_NUMBERS_VISIBLE_STORAGE_KEY, String(lineNumbersVisible));
  }, [lineNumbersVisible]);

  useEffect(() => {
    if (!showWorkspacePanels) {
      return;
    }
    if (sidebarPanels.some((panel) => panel.id === sidebarView)) {
      return;
    }
    const fallbackPanel = sidebarPanels[0]?.id;
    if (fallbackPanel) {
      setSidebarView(fallbackPanel);
    }
  }, [showWorkspacePanels, sidebarPanels, sidebarView, setSidebarView]);

  useEffect(() => {
    void window.nolia?.extensions?.syncMenus({
      menus: filterMenuContributions(extensionRegistry.menus, {
        workspace: Boolean(workspace),
        document: Boolean(visibleDocument),
        resource: Boolean(visibleResource)
      })
    });
  }, [extensionRegistry.menus, visibleDocument?.pathRel, visibleResource?.pathRel, workspace?.workspaceId]);

  useEffect(() => {
    const activePlugins = pluginDescriptors.filter((descriptor) => descriptor.manifest && descriptor.rendererUrl && isExtensionEnabled(descriptor.manifest, effectiveSettings));
    const disposables: Disposable[] = [];
    let cancelled = false;
    for (const descriptor of activePlugins) {
      void activateRendererPlugin(descriptor, {
        registerContributions: (pluginId, contributions) => registerPluginRuntimeContributions(pluginId, contributions),
        registerCommand: (pluginId, id, handler) => registerPluginCommandHandler(pluginId, id, handler),
        registerSidebarPanel: (pluginId, id, render) => registerPluginSidebarPanel(pluginId, id, render),
        registerFileViewer: (pluginId, id, render) => registerPluginFileViewer(pluginId, id, render),
        registerFileEditor: (pluginId, id, render) => registerPluginFileEditor(pluginId, id, render),
        registerAttachmentExtractor: (pluginId, id, handler) => registerPluginAttachmentExtractor(pluginId, id, handler),
        getActiveWorkspace: () => (workspace ? { workspaceId: workspace.workspaceId, name: workspace.name, rootPath: workspace.rootPath } : undefined),
        readWorkspaceFile: async (pluginId, pathRel) => {
          assertPluginPermission(pluginId, "workspace:file:read");
          if (!workspace) {
            throw new Error("No active workspace");
          }
          return (await window.nolia.file.read({ workspaceId: workspace.workspaceId, pathRel })).content;
        },
        writeWorkspaceFile: async (pluginId, pathRel, content) => {
          assertPluginPermission(pluginId, "workspace:file:write");
          if (!workspace) {
            throw new Error("No active workspace");
          }
          const current = await window.nolia.file.read({ workspaceId: workspace.workspaceId, pathRel });
          const result = await window.nolia.file.writeAtomic({ workspaceId: workspace.workspaceId, pathRel, content, baseHash: current.sha256, createSnapshot: true });
          if (result.status !== "saved") {
            throw new Error(`Write failed: ${result.status}`);
          }
        },
        readWorkspaceBinaryFile: async (pluginId, pathRel) => {
          assertPluginPermission(pluginId, "workspace:file:read");
          if (!workspace) {
            throw new Error("No active workspace");
          }
          if (!window.nolia.file.readBinary) {
            throw new Error("Binary file reads are unavailable");
          }
          return window.nolia.file.readBinary({ workspaceId: workspace.workspaceId, pathRel });
        },
        writeWorkspaceBinaryFile: async (pluginId, pathRel, data) => {
          assertPluginPermission(pluginId, "workspace:file:write");
          if (!workspace) {
            throw new Error("No active workspace");
          }
          if (!window.nolia.file.readBinary || !window.nolia.file.writeBinaryAtomic) {
            throw new Error("Binary file writes are unavailable");
          }
          const current = await window.nolia.file.readBinary({ workspaceId: workspace.workspaceId, pathRel });
          const result = await window.nolia.file.writeBinaryAtomic({ workspaceId: workspace.workspaceId, pathRel, data, baseHash: current.sha256, createSnapshot: true });
          if (result.status !== "saved") {
            throw new Error(`Write failed: ${result.status}`);
          }
        },
        hasPermission: (pluginId, permission) => pluginHasPermission(pluginId, permission),
        requestNetwork: async (pluginId, url, options) => {
          assertNetworkPermission(pluginId, url);
          return fetch(url, options);
        }
      })
        .then((disposable) => {
          if (cancelled) {
            disposable.dispose();
            return;
          }
          disposables.push(disposable);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : tr("插件加载失败");
          setStatusMessage(tr("插件加载失败：{message}", { message }));
          void recordPluginFailure(descriptor.pluginId, message);
        });
    }
    return () => {
      cancelled = true;
      for (const disposable of disposables.reverse()) {
        disposable.dispose();
      }
    };
  }, [pluginDescriptors, effectiveSettings, workspace?.workspaceId]);

  useEffect(() => {
    if (!appSettings) {
      return;
    }
    setTheme(appSettings.theme);
    setEditorModeSetting(appSettings.editorMode);
    editorModeSettingRef.current = appSettings.editorMode;
    setFocusMode(appSettings.focusMode);
    document.documentElement.dataset.focusMode = String(appSettings.focusMode);
    document.documentElement.dataset.editorWidth = appSettings.editorWidth;
    document.documentElement.dataset.fontSize = appSettings.fontSize;
    document.documentElement.style.setProperty("--editor-width", editorWidthToCss(appSettings.editorWidth));
    document.documentElement.style.setProperty("--app-font-size", fontSizeToCss(appSettings.fontSize));
  }, [appSettings, setEditorModeSetting, setFocusMode, setTheme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.themeChoice = theme;
      document.documentElement.dataset.theme = resolveThemeId(theme, Boolean(mediaQuery?.matches));
    };
    applyTheme();
    if (theme !== "system" || !mediaQuery) {
      return;
    }
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    if (!workspace) {
      return;
    }
    void loadWorkspaceData(workspace);
  }, [workspace?.workspaceId]);

  useEffect(() => {
    void refreshAiCommands();
  }, [workspace?.workspaceId, appSettings?.ai.commands, appSettings?.ai.enabled]);

  useEffect(() => {
    void refreshAiIndexStatus(workspace);
  }, [workspace?.workspaceId, appSettings?.ai.index.enabled]);

  useEffect(() => {
    if (!appSettings) {
      return;
    }
    const workspaceId = workspace?.workspaceId;
    const sameWorkspace = aiHistoryWorkspaceRef.current === workspaceId;
    aiMessageByRequestRef.current.clear();
    setAiRunningRequestId(undefined);
    if (!workspaceId) {
      aiHistoryWorkspaceRef.current = undefined;
      aiHistorySkipNextSaveRef.current = true;
      setAiMessages([]);
      return;
    }
    aiHistoryWorkspaceRef.current = workspaceId;
    if (appSettings.ai.privacy.saveLocalConversationHistory) {
      if (sameWorkspace && aiMessagesRef.current.length > 0) {
        aiHistorySkipNextSaveRef.current = false;
        saveAiConversationHistory(workspaceId, aiMessagesRef.current);
        return;
      }
      aiHistorySkipNextSaveRef.current = true;
      setAiMessages(readAiConversationHistory(workspaceId));
      return;
    }
    aiHistorySkipNextSaveRef.current = true;
    removeAiConversationHistory(workspaceId);
    setAiMessages([]);
  }, [workspace?.workspaceId, appSettings?.ai.privacy.saveLocalConversationHistory]);

  useEffect(() => {
    if (!appSettings?.ai.privacy.saveLocalConversationHistory || !workspace?.workspaceId) {
      return;
    }
    if (aiHistoryWorkspaceRef.current !== workspace.workspaceId) {
      return;
    }
    if (aiHistorySkipNextSaveRef.current) {
      aiHistorySkipNextSaveRef.current = false;
      return;
    }
    saveAiConversationHistory(workspace.workspaceId, aiMessages);
  }, [workspace?.workspaceId, appSettings?.ai.privacy.saveLocalConversationHistory, aiMessages]);

  useEffect(() => {
    const unsub = window.nolia.ai?.onChatEvent(handleAiChatEvent);
    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    const indexedUnsub = window.nolia?.events?.onWorkspaceIndexed?.((event) => {
      if (!workspace || event.workspaceId !== workspace.workspaceId) {
        return;
      }
      void loadWorkspaceData(workspace);
      if (Date.now() > userStatusProtectedUntilRef.current) {
        setStatusMessage(event.pathRel ? tr("已更新文件树：{path}", { path: event.pathRel }) : tr("工作区索引已完成"));
      }
    });
    return () => {
      indexedUnsub?.();
    };
  }, [workspace?.workspaceId]);

  useEffect(() => {
    const commandUnsub = window.nolia.events.onAppCommand((command) => {
      void runCommandRef.current(command);
    });
    return () => {
      commandUnsub();
    };
  }, []);

  useEffect(() => {
    const externalUnsub = window.nolia.events.onExternalFileOpen((filePath) => {
      void handleExternalFileOpen(filePath);
    });
    void window.nolia.externalFile?.consumePendingOpen().then((filePaths) => {
      for (const filePath of filePaths) {
        void handleExternalFileOpen(filePath);
      }
    });
    return () => {
      externalUnsub();
    };
  }, [workspace?.rootPath, openDocs, immersiveMode]);

  useEffect(() => {
    const updateFromKeyboardEvent = (event: KeyboardEvent) => {
      setModifiedOpenCursorActive(event.metaKey || event.ctrlKey);
    };
    const clear = () => setModifiedOpenCursorActive(false);
    window.addEventListener("keydown", updateFromKeyboardEvent);
    window.addEventListener("keyup", updateFromKeyboardEvent);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.removeEventListener("keydown", updateFromKeyboardEvent);
      window.removeEventListener("keyup", updateFromKeyboardEvent);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);

  useEffect(() => {
    const activeDoc = currentDocument();
    if (!activeDoc) {
      setActiveHtml("");
      return;
    }
    if (activeDoc.mode === "wysiwyg" && activeDoc.pendingHtml) {
      setActiveHtml(activeDoc.pendingHtml);
      return;
    }
    const token = ++renderToken.current;
    const render = () => {
      void renderMarkdownToHtml(activeDoc.sourceText).then((html) => {
        if (renderToken.current === token) {
          setActiveHtml(rewritePreviewAssets(html, activeDoc, workspace?.workspaceId));
        }
      });
    };
    if (activeDoc.mode !== "split") {
      render();
      return;
    }
    const timer = window.setTimeout(render, SPLIT_PREVIEW_RENDER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activePathRel, openDocs.map((doc) => `${doc.pathRel}:${doc.mode}:${doc.pendingHtml ? "html-draft" : doc.sourceText}`).join("|"), workspace?.workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (workspace && sidebarView === "search") {
        void runSearch(workspaceSearchQuery);
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [workspaceSearchQuery, sidebarView, workspace?.workspaceId]);

  useEffect(() => {
    if (workspace && sidebarView === "backlinks" && activePathRel && currentDocument()?.sourceKind !== "external") {
      void refreshBacklinks(activePathRel);
    }
  }, [sidebarView, activePathRel, workspace?.workspaceId]);

  const commandHandlers = useMemo<Record<string, () => void | Promise<void>>>(
    () => ({
      "workspace.open": () => openWorkspace(),
      "workspace.create": () => createWorkspace(),
      "workspace.close": () => closeWorkspace(),
      "file.new": () => openNewNoteDialog(),
      "document.save": () => saveActiveDocument(),
      "document.export": () => exportActiveDocument(),
      "edit.undo": () => runEditorHistoryCommand("undo"),
      "edit.redo": () => runEditorHistoryCommand("redo"),
      "commandPalette.open": () => setCommandPaletteOpen(true),
      "view.files": () => setSidebarView("files"),
      "view.favorites": () => setSidebarView("favorites"),
      "view.tags": () => setSidebarView("favorites"),
      "view.search": () => setSidebarView("search"),
      "view.backlinks": () => setSidebarView("backlinks"),
      "view.recent": () => setSidebarView("recent"),
      "view.ai": () => openAiPanel(),
      "view.settings": () => setSettingsOpen(true),
      "view.immersive.toggle": () => toggleImmersiveMode(),
      "view.toolbar.toggle": () => setToolbarVisible(!toolbarVisible),
      "view.lineNumbers.toggle": () => setLineNumbersVisible(!lineNumbersVisible),
      "mode.wysiwyg": () => setActiveMode("wysiwyg"),
      "mode.source": () => setActiveMode("source"),
      "mode.split": () => setActiveMode("split")
    }),
    [workspace?.workspaceId, visibleDocument?.pathRel, immersiveMode, toolbarVisible, lineNumbersVisible, setCommandPaletteOpen, setLineNumbersVisible, setRightPanelView, setSidebarView, setToolbarVisible]
  );

  useEffect(() => {
    runCommandRef.current = runCommand;
  }, [commandHandlers]);

  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      ...extensionRegistry.commands
        .filter((command) => Boolean(commandHandlers[command.id] ?? pluginCommandIds.includes(command.id)))
        .map((command) => ({
          id: command.id,
          label: commandLabel(command.id, command.title, { immersiveMode, toolbarVisible, lineNumbersVisible }, tr),
          keywords: command.keywords ?? [],
          run: () => void runCommand(command.id)
        })),
      ...aiCommands
        .filter((command) => command.ui.commandPalette)
        .map((command) => ({
          id: command.id,
          label: tr("AI：{name}", { name: command.name }),
          description: command.description,
          keywords: ["ai", command.name, command.description ?? ""],
          run: () => void runAiCommandById(command.id)
        }))
    ],
    [extensionRegistry.commands, commandHandlers, pluginCommandIds, immersiveMode, toolbarVisible, lineNumbersVisible, aiCommands, tr]
  );

  if (showWelcome) {
    return (
      <RendererI18nProvider locale={startupLocale}>
        <CommandPalette
          open={commandPaletteOpen}
          query={commandQuery}
          actions={paletteActions}
          onQueryChange={setCommandQuery}
          onClose={() => {
            setCommandPaletteOpen(false);
            setCommandQuery("");
          }}
        />
        <NewNoteDialog
          open={newNoteDialogOpen}
          kind={newItemKind}
          value={newNoteName}
          parentPath={newItemParentPath}
          onChange={setNewNoteName}
          onCancel={() => setNewNoteDialogOpen(false)}
          onSubmit={() => void createNewNote(newNoteName, newItemKind, newItemParentPath)}
        />
        <RenameDialog
          target={renameTarget}
          value={renameValue}
          onChange={setRenameValue}
          onCancel={() => setRenameTarget(undefined)}
          onSubmit={() => void renameItem(renameValue)}
        />
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title={tr("移到废纸篓")}
          message={deleteTarget ? tr("确定要删除「{name}」吗？文件会进入系统废纸篓。", { name: deleteTarget.name }) : ""}
          confirmLabel={tr("删除")}
          onCancel={() => setDeleteTarget(undefined)}
          onConfirm={() => void deleteItem()}
        />
        <WelcomeScreen
          recentWorkspaces={recentWorkspaces}
          openingWorkspaceId={welcomeOpeningWorkspaceId}
          errorMessage={welcomeErrorMessage}
          onOpenWorkspace={() => void openWorkspace()}
          onCreateWorkspace={() => void createWorkspace()}
          onOpenRecent={(item) => void openRecentWorkspace(item)}
        />
      </RendererI18nProvider>
    );
  }

  const shellTitle = isExternalDocument && visibleDocument ? fileNameFor(visibleDocument.pathRel) : workspace?.name ?? tr("单文件编辑");
  const shellSubtitle = isExternalDocument && visibleDocument ? visibleDocument.filePath ?? visibleDocument.pathRel : workspace?.rootPath;
  const platformClass = appInfo?.platform ? ` is-platform-${appInfo.platform}` : "";

  return (
    <RendererI18nProvider locale={startupLocale}>
    <div className={`app-shell${platformClass}${focusMode ? " is-focus" : ""}${immersiveMode ? " is-immersive" : ""}${modifiedOpenCursorActive ? " is-modified-open-cursor" : ""}`}>
      <CommandPalette
        open={commandPaletteOpen}
        query={commandQuery}
        actions={paletteActions}
        onQueryChange={setCommandQuery}
        onClose={() => {
          setCommandPaletteOpen(false);
          setCommandQuery("");
        }}
      />
      <NewNoteDialog
        open={newNoteDialogOpen}
        kind={newItemKind}
        value={newNoteName}
        parentPath={newItemParentPath}
        onChange={setNewNoteName}
        onCancel={() => setNewNoteDialogOpen(false)}
        onSubmit={() => void createNewNote(newNoteName, newItemKind, newItemParentPath)}
      />
      <RenameDialog
        target={renameTarget}
        value={renameValue}
        onChange={setRenameValue}
        onCancel={() => setRenameTarget(undefined)}
        onSubmit={() => void renameItem(renameValue)}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={tr("移到废纸篓")}
        message={deleteTarget ? tr("确定要删除「{name}」吗？文件会进入系统废纸篓。", { name: deleteTarget.name }) : ""}
        confirmLabel={tr("删除")}
        onCancel={() => setDeleteTarget(undefined)}
        onConfirm={() => void deleteItem()}
      />
      <AiChangePlanDialog
        plan={aiChangePlan}
        onClose={() => setAiChangePlan(undefined)}
        onApplyChange={(changeId) => void applyAiChange(changeId)}
        onApplyAll={() => void applyAllAiChanges()}
        onSetChangeStatus={setAiChangeStatus}
      />
      <AiContextApprovalDialog
        pending={aiContextApproval}
        rememberEnabled={Boolean(effectiveSettings.ai.privacy.rememberContextApproval)}
        onToggleContextItem={(itemId: string) => {
          setAiContextApproval((current) => {
            if (!current) {
              return current;
            }
            const excluded = new Set(current.excludedContextItemIds);
            if (excluded.has(itemId)) {
              excluded.delete(itemId);
            } else {
              excluded.add(itemId);
            }
            return { ...current, excludedContextItemIds: [...excluded] };
          });
        }}
        onCancel={() => setAiContextApproval(undefined)}
        onConfirm={(remember: boolean) => void confirmAiContextApproval(remember)}
      />
          <MoveDialog
            dialog={moveDialog}
            folders={collectMoveDestinationOptions(fileTree, moveDialog?.target, tr)}
            onChangeDestination={(destinationPath) => setMoveDialog((current) => (current ? { ...current, destinationPath } : current))}
            onCancel={() => setMoveDialog(undefined)}
            onSubmit={() => void moveItem()}
      />
      <TreeContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(undefined)}
        fileClipboard={fileClipboard}
        isFavorite={(pathRel) => favoriteDocs.some((item) => item.pathRel === pathRel)}
        onCopyFile={(target) => copyFileTarget(target)}
        onDuplicateFile={(target) => void duplicateFileTarget(target)}
        onPasteFile={(target) => void pasteFileIntoFolder(target.pathRel)}
        onMove={(target) => openMoveDialog(target)}
        onToggleFavorite={(target) => toggleFavoriteTarget(target)}
        onRename={(target) => openRenameDialog(target)}
        onDelete={(target) => openDeleteDialog(target)}
      />
      <CreateItemMenu
        menu={createMenu}
        onClose={() => setCreateMenu(undefined)}
        onCreate={(kind, parentPath) => openNewNoteDialog(kind, parentPath)}
      />
      <SettingsDialog
        open={settingsOpen}
        settings={appSettings}
        workspace={workspace}
        aiIndexStatus={aiIndexStatus}
        aiIndexRebuildRunning={aiIndexRebuildRunning}
        extensionManifests={allExtensionManifests}
        pluginDescriptors={pluginDescriptors}
        settingContributions={settingContributions}
        onClose={() => setSettingsOpen(false)}
        onUpdate={updateAppSetting}
        onSetPluginEnabled={setPluginEnabled}
        onAcceptPluginPermissions={acceptPluginPermissions}
        onRebuildAiIndex={() => void rebuildAiIndex()}
        onCancelAiIndex={() => void cancelAiIndex()}
        onClearAiIndex={() => void clearAiIndex()}
        onReload={() => void bootstrap()}
        languageRestartRequired={languageRestartRequired}
        pluginDirectory={appInfo?.pluginDirectory}
      />
      <header className="titlebar">
        <div className="titlebar-left">
          <button type="button" className="icon-button" title={tr("命令面板")} aria-label={tr("命令面板")} onClick={() => setCommandPaletteOpen(true)}>
            <Menu size={16} />
          </button>
          <div className="workspace-title">
            <strong>{shellTitle}</strong>
            <span>{shellSubtitle}</span>
          </div>
        </div>
      </header>

      <div
        className={`workspace-grid${leftPanelCollapsed ? " is-left-collapsed" : ""}${rightPanelCollapsed ? " is-right-collapsed" : ""}${immersiveMode ? " is-immersive" : ""}${!showWorkspacePanels ? " is-single-file" : ""}`}
        style={{ "--left-panel-width": `${leftPanelWidth}px`, "--right-panel-width": `${rightPanelWidth}px` } as CSSProperties}
      >
        {showWorkspacePanels ? (
          <AppNav
            sidebarView={sidebarView}
            panels={sidebarPanels}
            onChange={(view) => {
              setLeftPanelCollapsed(false);
              setSidebarView(view);
            }}
            onOpenOutline={() => {
              setRightPanelView("outline");
              setRightPanelCollapsed(false);
            }}
            onOpenAi={openAiPanel}
            onToggleSettings={() => {
              setSettingsOpen(true);
            }}
            activeRightPanel={rightPanelCollapsed ? undefined : rightPanelView}
            settingsOpen={settingsOpen}
          />
        ) : null}

        {showWorkspacePanels ? (
        <aside className={`sidebar ${sidebarView === "files" ? "" : "is-condensed"}`} aria-hidden={leftPanelCollapsed}>
          {sidebarView === "files" ? (
            <NotesWorkspaceView
              nodes={fileTree}
              selection={treeSelection}
              searchQuery={noteFilterQuery}
              onSearchChange={setNoteFilterQuery}
              onRefresh={() => void refreshWorkspaceTree()}
              onSelectFolder={(pathRel) => setTreeSelection({ pathRel, kind: "directory" })}
              onOpen={(node) => void openTreeNode(node)}
              onOpenCreateMenu={setCreateMenu}
              onRename={openRenameDialog}
              onDelete={openDeleteDialog}
              onMoveToFolder={(target, destinationPath) => {
                void moveTargetToFolder(target, destinationPath);
              }}
              onContextMenu={setContextMenu}
            />
          ) : null}
          {sidebarView === "favorites" ? (
            <FavoritesView
              items={favoriteDocs}
              onOpen={(pathRel) => void openWorkspacePath(pathRel)}
              onContextMenu={setContextMenu}
            />
          ) : null}
          {sidebarView === "search" ? <SearchView query={workspaceSearchQuery} results={searchResults} onQueryChange={setWorkspaceSearchQuery} onOpen={(pathRel) => void openWorkspacePath(pathRel)} /> : null}
          {sidebarView === "backlinks" ? <BacklinksView backlinks={backlinks} onOpen={(pathRel) => void openWorkspacePath(pathRel)} /> : null}
          {sidebarView === "recent" ? (
            <RecentView
              key={workspace?.workspaceId}
              viewed={recentViewedDocs}
              edited={recentEditedDocs}
              onOpen={(pathRel) => void openWorkspacePath(pathRel)}
              onContextMenu={setContextMenu}
            />
          ) : null}
          {pluginSidebarPanels.has(sidebarView) ? (
            <PluginSidebarPanel
              panelId={sidebarView}
              title={sidebarPanels.find((panel) => panel.id === sidebarView)?.title ?? sidebarView}
              render={pluginSidebarPanels.get(sidebarView)}
              workspace={workspace}
              activeDocument={visibleDocument}
            />
          ) : null}
        </aside>
        ) : null}

        {showWorkspacePanels ? (
          <button
            type="button"
            className="left-panel-resizer"
            aria-label={tr("拖拽调整左侧栏宽度")}
            title={tr("拖拽调整左侧栏宽度")}
            onPointerDown={startLeftPanelResize}
            onKeyDown={handleLeftPanelResizeKeyDown}
            onDoubleClick={() => setLeftPanelWidth(DEFAULT_LEFT_PANEL_WIDTH)}
          />
        ) : null}

        <main className="editor-zone">
          <EditorTopBar
            document={visibleDocument}
            resource={visibleResource}
            workspaceName={workspace?.name ?? tr("单文件")}
            mode={visibleDocument?.mode ?? editorModeSetting}
            leftPanelCollapsed={leftPanelCollapsed}
            canToggleLeft={showWorkspacePanels}
            isImmersive={immersiveMode}
            isFavorite={visibleDocumentFavorite}
            onToggleLeft={() => setLeftPanelCollapsed((value) => !value)}
            onOpenOutline={() => {
              setRightPanelView("outline");
              setRightPanelCollapsed(false);
            }}
            onModeChange={(mode) => void setActiveMode(mode)}
            onToggleFavorite={() => toggleFavoriteDocument()}
          />
          <EditorPane
            ref={editorPaneRef}
            document={visibleDocument}
            resource={visibleResource}
            html={activeHtml}
            platform={appInfo?.platform}
            workspaceId={visibleDocument?.sourceKind === "external" ? undefined : workspace?.workspaceId}
            pluginFileViewers={pluginFileViewers}
            pluginFileEditors={pluginFileEditors}
            aiEnabled={Boolean(effectiveSettings.ai.enabled)}
            aiCommands={aiCommands}
            toolbarVisible={Boolean(visibleDocument && toolbarVisible && !immersiveMode)}
            lineNumbersVisible={lineNumbersVisible}
            onRunAiCommand={(commandId) => void runAiCommandById(commandId)}
            onToggleLineNumbers={() => setLineNumbersVisible(!lineNumbersVisible)}
            onSourceChange={(value) => void updateSourceText(value)}
            onHtmlChange={(value) => void updateHtmlDraft(value)}
            onMarkdownPaste={(value) => void updateSourceText(value)}
            onSelectionLengthChange={setSelectedCharCount}
            onOpenMarkdownTarget={(target) => void openMarkdownTarget(target)}
            onReadPluginFile={readPluginEditorFile}
            onWritePluginFile={writePluginEditorFile}
            onReadPluginBinaryFile={readPluginEditorBinaryFile}
            onWritePluginBinaryFile={writePluginEditorBinaryFile}
            onPluginEditorDirtyChange={setPluginEditorDirty}
            onPluginEditorSaved={markPluginEditorSaved}
            onPluginEditorStatus={setUserStatusMessage}
            onRegisterPluginEditorSaveHandler={registerPluginEditorSaveHandler}
          />
        </main>

        {showWorkspacePanels ? (
          <button
            type="button"
            className="right-panel-resizer"
            aria-label={tr("拖拽调整右侧面板宽度")}
            title={tr("拖拽调整右侧面板宽度")}
            onPointerDown={startRightPanelResize}
            onKeyDown={handleRightPanelResizeKeyDown}
            onDoubleClick={() => setRightPanelWidth(DEFAULT_RIGHT_PANEL_WIDTH)}
          />
        ) : null}

        {showWorkspacePanels ? (
        <aside className={`right-panel ${rightPanelView}`} aria-hidden={rightPanelCollapsed}>
          <PanelHeader
            title={rightPanelTitle(rightPanelView)}
            onToggle={() => setRightPanelCollapsed(true)}
          />
          <div className="right-panel-body">
            {rightPanelView === "outline" ? (
              <OutlinePanel
                doc={visibleDocument}
                onJump={(line, index) => {
                  const jumped = editorPaneRef.current?.jumpToHeading(line, index) ?? false;
                  setStatusMessage(jumped ? tr("已跳转到第 {line} 行", { line }) : tr("标题位于第 {line} 行", { line }));
                }}
              />
            ) : null}
            {rightPanelView === "details" ? <DocumentDetails doc={visibleDocument} backlinks={backlinks} /> : null}
            {rightPanelView === "errors" ? <ErrorPanel statusMessage={statusMessage} /> : null}
            {rightPanelView === "ai" ? (
              <AiAssistantPanel
                enabled={Boolean(effectiveSettings.ai.enabled)}
                workspace={workspace}
                document={visibleDocument}
                commands={aiCommands}
                messages={aiMessages}
                preview={aiPreview}
                indexStatus={aiIndexStatus}
                indexRebuildRunning={aiIndexRebuildRunning}
                insights={aiInsights}
                insightsWarnings={aiInsightsWarnings}
                insightsLoading={aiInsightsLoading}
                runningRequestId={aiRunningRequestId}
                onAsk={(prompt, scope) => void startAiRequest({ prompt, scope })}
                onRunCommand={(commandId) => void runAiCommandById(commandId)}
                onCancel={() => void cancelAiRequest()}
                onApply={(text, mode) => void applyAiText(text, mode)}
                onRebuildIndex={() => void rebuildAiIndex()}
                onRefreshInsights={() => void refreshAiInsights()}
                onOpenInsight={(insight) => void openAiInsight(insight)}
                onApplyInsight={(insight) => applyAiInsight(insight)}
                onOpenSettings={() => setSettingsOpen(true)}
                onOpenCitation={(citation) => void openAiCitation(citation)}
                onClearMessages={() => clearAiConversation()}
              />
            ) : null}
          </div>
        </aside>
        ) : null}
      </div>

      <footer className="statusbar">
        {visibleResource ? (
          <>
            <StatusPill label={resourceEditorKindLabel(visibleResource, tr)} />
            <StatusPill label={formatFileSize(visibleResource.size, startupLocale)} tone="muted" />
            <StatusPill label={visibleResource.dirty ? tr("未保存") : tr("已保存")} tone={visibleResource.dirty ? "warn" : "ok"} />
            <StatusPill label={statusBarMessage(statusMessage, tr)} tone="muted" />
          </>
        ) : (
          <>
            <StatusPill label={tr("全文 {count} 字词", { count: visibleDocument?.parsed.wordCount ?? 0 })} />
            <StatusPill label={tr("选中 {count} 字符", { count: selectedCharCount })} tone={selectedCharCount > 0 ? "ok" : "muted"} />
            <StatusPill label={visibleDocument?.dirty ? tr("未保存") : tr("已保存")} tone={visibleDocument?.dirty ? "warn" : "ok"} />
            <StatusPill label={editorModeLabel(visibleDocument?.mode ?? editorModeSetting, tr)} />
            <StatusPill label={statusBarMessage(statusMessage, tr)} tone="muted" />
          </>
        )}
      </footer>
    </div>
    </RendererI18nProvider>
  );

  function runEditorHistoryCommand(kind: "undo" | "redo") {
    const handled = kind === "undo" ? editorPaneRef.current?.undoEdit() : editorPaneRef.current?.redoEdit();
    if (handled) {
      return;
    }
    document.execCommand(kind);
  }

  function currentDocument(): OpenDocumentTab | undefined {
    return openDocs.find((doc) => doc.pathRel === activePathRel) ?? openDocs[0];
  }

  function startLeftPanelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (leftPanelCollapsed || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftPanelWidthRef.current;
    document.body.classList.add("is-resizing-left-panel");

    const onPointerMove = (moveEvent: PointerEvent) => {
      setLeftPanelWidth(clampLeftPanelWidth(startWidth + moveEvent.clientX - startX));
    };
    const stopResize = () => {
      document.body.classList.remove("is-resizing-left-panel");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function handleLeftPanelResizeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (leftPanelCollapsed) {
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setLeftPanelWidth((width) => clampLeftPanelWidth(width + (event.key === "ArrowRight" ? 16 : -16)));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setLeftPanelWidth(MIN_LEFT_PANEL_WIDTH);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setLeftPanelWidth(MAX_LEFT_PANEL_WIDTH);
    }
  }

  function startRightPanelResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (rightPanelCollapsed || event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightPanelWidthRef.current;
    document.body.classList.add("is-resizing-right-panel");

    const onPointerMove = (moveEvent: PointerEvent) => {
      setRightPanelWidth(clampRightPanelWidth(startWidth + startX - moveEvent.clientX));
    };
    const stopResize = () => {
      document.body.classList.remove("is-resizing-right-panel");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function handleRightPanelResizeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (rightPanelCollapsed) {
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setRightPanelWidth((width) => clampRightPanelWidth(width + (event.key === "ArrowLeft" ? 16 : -16)));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setRightPanelWidth(MIN_RIGHT_PANEL_WIDTH);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setRightPanelWidth(MAX_RIGHT_PANEL_WIDTH);
    }
  }

  function currentDocumentFromRef(): OpenDocumentTab | undefined {
    return openDocsRef.current.find((doc) => doc.pathRel === activePathRel) ?? openDocsRef.current[0];
  }

  function updateOpenDocs(updater: (docs: OpenDocumentTab[]) => OpenDocumentTab[]) {
    setOpenDocs((docs) => {
      const next = updater(docs);
      openDocsRef.current = next;
      return next;
    });
  }

  async function bootstrap() {
    const [state, plugins] = await Promise.all([
      window.nolia.workspace.bootstrap(),
      window.nolia.plugins?.list?.() ?? Promise.resolve([])
    ]);
    if (!startupLocaleInitializedRef.current) {
      startupLocaleInitializedRef.current = true;
      setStartupLocale(resolveLocale(state.settings.language, navigator.language));
    }
    setRecentWorkspaces(state.recentWorkspaces);
    setPluginDescriptors(plugins);
    setAppSettings(state.settings);
    setAppInfo(state.appInfo);
    setTheme(state.settings.theme);
    setEditorModeSetting(state.settings.editorMode);
    editorModeSettingRef.current = state.settings.editorMode;
    if (currentDocumentFromRef()?.sourceKind === "external") {
      return;
    }
    if (state.activeWorkspace) {
      await setWorkspaceState(state.activeWorkspace);
    }
  }

  async function loadWorkspaceData(workspaceInfo: WorkspaceInfo) {
    const [tree, recentDocs] = await Promise.all([
      window.nolia.file.listTree({ workspaceId: workspaceInfo.workspaceId, root: "", sortBy: "name", showHidden: false }),
      window.nolia.search.query({ workspaceId: workspaceInfo.workspaceId, query: "", limit: 30 })
    ]);
    setFileTree(tree.nodes);
    setSearchResults(recentDocs.items);
    if (openDocsRef.current.length === 0 && !activeResourceRef.current) {
      const firstOpenableNode =
        recentDocs.items.map((item) => findFileTreeNode(tree.nodes, item.pathRel)).find((node) => node && node.kind !== "directory") ??
        firstOpenableFileTreeNode(tree.nodes);
      if (firstOpenableNode) {
        void openTreeNode(firstOpenableNode, workspaceInfo);
      }
    }
  }

  function setUserStatusMessage(message: string): void {
    userStatusProtectedUntilRef.current = Date.now() + USER_STATUS_PROTECT_MS;
    setStatusMessage(message);
  }

  async function refreshWorkspaceTree(workspaceInfo = workspace) {
    if (!workspaceInfo) {
      return;
    }
    await loadWorkspaceData(workspaceInfo);
    setStatusMessage(tr("已刷新文件树"));
  }

  async function openWorkspacePath(pathRel: string, workspaceInfo = workspace, nodes = fileTree) {
    const node = findFileTreeNode(nodes, pathRel);
    if (!node) {
      setStatusMessage(tr("未找到文件 {path}", { path: pathRel }));
      return;
    }
    await openTreeNode(node, workspaceInfo);
  }

  async function openTreeNode(node: FileTreeNode, workspaceInfo = workspace) {
    if (!workspaceInfo || node.kind === "directory") {
      return;
    }
    if (node.kind === "markdown") {
      setTreeSelection({ pathRel: node.pathRel, kind: "file" });
      await openDocument(node.pathRel, workspaceInfo);
      return;
    }
    const editor = selectFileEditor(extensionRegistry.fileEditors, node.pathRel);
    if (editor?.id === "markdown.editor.fileEditor") {
      setTreeSelection({ pathRel: node.pathRel, kind: "file" });
      await openDocument(node.pathRel, workspaceInfo);
      return;
    }
    if (editor) {
      setTreeSelection({ pathRel: node.pathRel, kind: "resource" });
      await openPluginEditor(node, editor, workspaceInfo);
      return;
    }
    setTreeSelection({ pathRel: node.pathRel, kind: "resource" });
    await openResource(node, workspaceInfo);
  }

  async function openMarkdownTarget(target: MarkdownOpenTarget, document = currentDocumentFromRef()) {
    if (!document) {
      return;
    }
    if (target.kind === "link") {
      await openMarkdownHrefTarget(target.href, document);
      return;
    }
    if (target.kind === "image") {
      await openMarkdownHrefTarget(target.src, document);
      return;
    }
    const resolved = resolveWikilinkWorkspaceTarget(target, fileTree, document.pathRel);
    if (!resolved) {
      setStatusMessage(tr("未找到文件 {path}", { path: labelForMarkdownOpenTarget(target) }));
      return;
    }
    await openWorkspaceTarget(resolved, document);
  }

  async function openMarkdownHrefTarget(href: string, document: OpenDocumentTab) {
    const trimmed = href.trim();
    if (!trimmed) {
      return;
    }
    if (isExternalMarkdownHref(trimmed)) {
      window.open(trimmed, "_blank", "noopener,noreferrer");
      setStatusMessage(tr("已打开链接"));
      return;
    }
    if (trimmed.startsWith("#")) {
      jumpToMarkdownHeading(document.pathRel, trimmed.slice(1));
      return;
    }
    if (document.sourceKind === "external" || !workspace) {
      setStatusMessage(tr("单文件模式暂不支持工作区跳转"));
      return;
    }
    const target = workspaceTargetFromMarkdownHref(trimmed, document.pathRel);
    if (!target) {
      setStatusMessage(tr("无法打开链接 {path}", { path: trimmed }));
      return;
    }
    await openWorkspaceTarget(target, document);
  }

  async function openWorkspaceTarget(target: MarkdownWorkspaceTarget, document: OpenDocumentTab) {
    if (document.sourceKind === "external" || !workspace) {
      setStatusMessage(tr("单文件模式暂不支持工作区跳转"));
      return;
    }
    const node = resolveWorkspaceFileTreeNode(target.pathRel, fileTree);
    if (!node) {
      setStatusMessage(tr("未找到文件 {path}", { path: target.pathRel }));
      return;
    }
    await openTreeNode(node, workspace);
    if (target.fragment) {
      jumpToMarkdownHeading(node.pathRel, target.fragment);
    }
  }

  function jumpToMarkdownHeading(pathRel: string, fragment: string) {
    const normalizedFragment = normalizeMarkdownHeadingReference(fragment);
    window.setTimeout(() => {
      const document = openDocsRef.current.find((doc) => doc.pathRel === pathRel) ?? (currentDocumentFromRef()?.pathRel === pathRel ? currentDocumentFromRef() : undefined);
      if (!document) {
        return;
      }
      const headingIndex = headingIndexForReference(document, normalizedFragment);
      if (headingIndex === undefined) {
        setStatusMessage(tr("未找到标题 {path}", { path: normalizedFragment }));
        return;
      }
      const heading = document.parsed.headings[headingIndex];
      const jumped = editorPaneRef.current?.jumpToHeading(heading.line, headingIndex) ?? false;
      setStatusMessage(jumped ? tr("已跳转到第 {line} 行", { line: heading.line }) : tr("标题位于第 {line} 行", { line: heading.line }));
    }, 0);
  }

  async function refreshBacklinks(pathRel: string, workspaceInfo = workspace) {
    if (!workspaceInfo) {
      return;
    }
    setBacklinks(await window.nolia.graph.getBacklinks({ workspaceId: workspaceInfo.workspaceId, pathRel, includeUnlinkedMentions: true }));
  }

  async function runSearch(query: string) {
    if (!workspace) {
      return;
    }
    setSearchResults((await window.nolia.search.query({ workspaceId: workspace.workspaceId, query, limit: 50 })).items);
  }

  function rememberViewedDocument(pathRel: string, title: string, workspaceId = workspace?.workspaceId) {
    if (!workspaceId) {
      return;
    }
    setRecentViewedDocs((current) => {
      const next = upsertDocumentListItem(current, { pathRel, title, timestamp: Date.now(), kind: "file" });
      saveWorkspaceLocalList(workspaceId, "recentViewed", next);
      return next;
    });
  }

  function rememberEditedDocument(pathRel: string, title: string, workspaceId = workspace?.workspaceId) {
    if (!workspaceId) {
      return;
    }
    setRecentEditedDocs((current) => {
      const next = upsertDocumentListItem(current, { pathRel, title, timestamp: Date.now(), kind: "file" });
      saveWorkspaceLocalList(workspaceId, "recentEdited", next);
      return next;
    });
  }

  function rememberViewedResource(pathRel: string, workspaceId = workspace?.workspaceId) {
    if (!workspaceId) {
      return;
    }
    setRecentViewedDocs((current) => {
      const next = upsertDocumentListItem(current, { pathRel, title: fileNameFor(pathRel), timestamp: Date.now(), kind: "resource" });
      saveWorkspaceLocalList(workspaceId, "recentViewed", next);
      return next;
    });
  }

  function rememberEditedResource(pathRel: string, workspaceId = workspace?.workspaceId) {
    if (!workspaceId) {
      return;
    }
    setRecentEditedDocs((current) => {
      const next = upsertDocumentListItem(current, { pathRel, title: fileNameFor(pathRel), timestamp: Date.now(), kind: "resource" });
      saveWorkspaceLocalList(workspaceId, "recentEdited", next);
      return next;
    });
  }

  function toggleFavoriteDocument() {
    const active = currentDocument();
    if (!active || active.sourceKind === "external") {
      return;
    }
    toggleFavoriteTarget({ pathRel: active.pathRel, kind: "file", name: active.pathRel.split("/").pop() ?? active.pathRel }, active.title);
  }

  function toggleFavoriteTarget(target: RenameTarget, title = target.name.replace(/\.md$/i, "")) {
    const workspaceId = workspace?.workspaceId;
    if (!workspaceId || target.kind !== "file") {
      return;
    }
    setFavoriteDocs((current) => {
      const exists = current.some((item) => item.pathRel === target.pathRel);
      const next = exists
        ? current.filter((item) => item.pathRel !== target.pathRel)
        : [{ pathRel: target.pathRel, title, addedAt: Date.now() }, ...current].slice(0, 30);
      saveWorkspaceLocalList(workspaceId, "favorites", next);
      setStatusMessage(exists ? tr("已取消收藏 {path}", { path: target.pathRel }) : tr("已收藏 {path}", { path: target.pathRel }));
      return next;
    });
  }

  function updateWorkspaceDocumentLists(transform: (item: StoredDocumentItem) => StoredDocumentItem | undefined) {
    const workspaceId = workspace?.workspaceId;
    if (!workspaceId) {
      return;
    }
    setFavoriteDocs((current) => {
      const next = current.map((item) => transform(item)).filter(isFavoriteDocument);
      saveWorkspaceLocalList(workspaceId, "favorites", next);
      return next;
    });
    setRecentViewedDocs((current) => {
      const next = current.map((item) => transform(item)).filter(isDocumentListItem);
      saveWorkspaceLocalList(workspaceId, "recentViewed", next);
      return next;
    });
    setRecentEditedDocs((current) => {
      const next = current.map((item) => transform(item)).filter(isDocumentListItem);
      saveWorkspaceLocalList(workspaceId, "recentEdited", next);
      return next;
    });
  }

  async function openWorkspace() {
    setWelcomeErrorMessage(undefined);
    try {
      const info = await window.nolia.workspace.open({});
      if (!info) {
        return;
      }
      await setWorkspaceState(info);
    } catch (error) {
      const message = tr("打开工作区失败：{message}", { message: errorMessageFor(error, tr("未知错误")) });
      setWelcomeErrorMessage(message);
      setStatusMessage(message);
    }
  }

  async function createWorkspace() {
    setWelcomeErrorMessage(undefined);
    try {
      const info = await window.nolia.workspace.create({});
      if (!info) {
        return;
      }
      await setWorkspaceState(info);
    } catch (error) {
      const message = tr("创建工作区失败：{message}", { message: errorMessageFor(error, tr("未知错误")) });
      setWelcomeErrorMessage(message);
      setStatusMessage(message);
    }
  }

  async function openRecentWorkspace(item: RecentWorkspace) {
    setWelcomeErrorMessage(undefined);
    if (!item.exists) {
      const next =
        (await window.nolia.workspace.removeRecent?.({ workspaceId: item.workspaceId })) ??
        recentWorkspaces.filter((workspaceItem) => workspaceItem.workspaceId !== item.workspaceId);
      setRecentWorkspaces(next);
      setStatusMessage(tr("已移除不可用工作区 {name}", { name: item.name }));
      return;
    }
    setWelcomeOpeningWorkspaceId(item.workspaceId);
    try {
      const info = await window.nolia.workspace.open({ path: item.path, createIfMissing: false });
      if (!info) {
        setWelcomeErrorMessage(tr("未能打开「{name}」。请使用“打开工作区”重新选择目录。", { name: item.name }));
        return;
      }
      await setWorkspaceState(info);
    } catch (error) {
      const message = tr("无法打开「{name}」：{message}", { name: item.name, message: errorMessageFor(error, tr("未知错误")) });
      setWelcomeErrorMessage(message);
      setStatusMessage(tr("最近工作区打开失败"));
    } finally {
      setWelcomeOpeningWorkspaceId(undefined);
    }
  }

  async function closeWorkspace() {
    if (!workspace) {
      setStatusMessage(tr("未打开工作区"));
      return;
    }
    try {
      const active = currentDocumentFromRef();
      if (active?.dirty) {
        await saveActiveDocument();
      }
      const resource = activeResourceRef.current;
      if (resource?.editorId && resource.dirty) {
        await saveActivePluginEditorResource(resource.pathRel);
      }
      await window.nolia.workspace.close();
      clearWorkspaceState();
      setRecentWorkspaces(await window.nolia.workspace.listRecent());
      setStatusMessage(tr("工作区已关闭"));
    } catch (error) {
      setStatusMessage(tr("关闭工作区失败：{message}", { message: errorMessageFor(error, tr("未知错误")) }));
    }
  }

  function clearWorkspaceState() {
    suspendedShellRef.current = undefined;
    setImmersiveMode(false);
    setWorkspace(undefined);
    setFileTree([]);
    setSearchResults([]);
    setFavoriteDocs([]);
    setRecentViewedDocs([]);
    setRecentEditedDocs([]);
    updateOpenDocs(() => []);
    htmlDraftsRef.current.clear();
    sourceParseTokensRef.current.clear();
    setActivePathRel(undefined);
    activeResourceRef.current = undefined;
    setActiveResource(undefined);
    setActiveHtml("");
    setTreeSelection(undefined);
    setBacklinks(emptyBacklinks);
    setAiIndexStatus(undefined);
    setAiIndexRebuildRunning(false);
    setAiChangePlan(undefined);
    setAiInsights([]);
    setAiInsightsWarnings([]);
    setAiInsightsLoading(false);
    aiMessageByRequestRef.current.clear();
    setAiRunningRequestId(undefined);
    setAiPreview(undefined);
    setAiMessages([]);
    setNoteFilterQuery("");
    setWorkspaceSearchQuery("");
    setCreateMenu(undefined);
    setWelcomeErrorMessage(undefined);
    setWelcomeOpeningWorkspaceId(undefined);
    for (const timer of autosaveTimers.current.values()) {
      window.clearTimeout(timer);
    }
    autosaveTimers.current.clear();
  }

  async function setWorkspaceState(info: WorkspaceInfo) {
    suspendedShellRef.current = undefined;
    setWelcomeErrorMessage(undefined);
    setWelcomeOpeningWorkspaceId(undefined);
    setImmersiveMode(false);
    setWorkspace(info);
    setOpenDocs([]);
    openDocsRef.current = [];
    htmlDraftsRef.current.clear();
    setActivePathRel(undefined);
    setActiveResource(undefined);
    setTreeSelection(undefined);
    setCreateMenu(undefined);
    const localLists = loadWorkspaceLocalLists(info.workspaceId);
    setFavoriteDocs(localLists.favorites);
    setRecentViewedDocs(localLists.recentViewed);
    setRecentEditedDocs(localLists.recentEdited);
    setNoteFilterQuery("");
    setWorkspaceSearchQuery("");
    setBacklinks(emptyBacklinks);
    setStatusMessage(tr("工作区已加载"));
    void loadWorkspaceData(info);
  }

  async function runCommand(command: string) {
    const handler = commandHandlers[command] ?? pluginCommandHandlersRef.current.get(command);
    if (!handler) {
      return;
    }
    await handler();
  }

  function openAiPanel() {
    setRightPanelView("ai");
    setRightPanelCollapsed(false);
  }

  async function refreshAiCommands() {
    if (!window.nolia.ai) {
      setAiCommands([]);
      return;
    }
    try {
      setAiCommands(await window.nolia.ai.listCommands({ workspaceId: workspace?.workspaceId }));
    } catch (error) {
      setStatusMessage(errorMessageFor(error, tr("AI 命令加载失败")));
    }
  }

  async function refreshAiIndexStatus(workspaceInfo = workspace) {
    if (!window.nolia.ai || !workspaceInfo) {
      setAiIndexStatus(undefined);
      return;
    }
    try {
      setAiIndexStatus(await window.nolia.ai.indexStatus({ workspaceId: workspaceInfo.workspaceId }));
    } catch (error) {
      setAiIndexStatus({ status: "error", progress: 0, message: errorMessageFor(error, tr("AI 索引状态读取失败")) });
    }
  }

  async function rebuildAiIndex() {
    if (!window.nolia.ai || !workspace) {
      return;
    }
    setAiIndexRebuildRunning(true);
    setAiIndexStatus({ status: "indexing", progress: 0, message: tr("正在重建 AI 索引...") });
    try {
      const status = await window.nolia.ai.rebuildIndex({ workspaceId: workspace.workspaceId });
      setAiIndexStatus(status);
      setStatusMessage(status.status === "ready" ? tr("AI 索引已重建") : status.message ?? tr("AI 索引状态已更新"));
    } catch (error) {
      const message = errorMessageFor(error, tr("AI 索引重建失败"));
      setAiIndexStatus({ status: "error", progress: 0, message });
      setStatusMessage(message);
    } finally {
      setAiIndexRebuildRunning(false);
    }
  }

  async function cancelAiIndex() {
    if (!window.nolia.ai || !workspace) {
      return;
    }
    try {
      const status = await window.nolia.ai.cancelIndex({ workspaceId: workspace.workspaceId });
      setAiIndexStatus(status);
      setAiIndexRebuildRunning(false);
      setStatusMessage(status.message ?? tr("AI 索引已暂停"));
    } catch (error) {
      setStatusMessage(errorMessageFor(error, tr("AI 索引暂停失败")));
    }
  }

  async function clearAiIndex() {
    if (!window.nolia.ai || !workspace) {
      return;
    }
    try {
      const status = await window.nolia.ai.clearIndex({ workspaceId: workspace.workspaceId });
      setAiIndexStatus(status);
      setAiIndexRebuildRunning(false);
      setStatusMessage(tr("AI 索引已清空"));
    } catch (error) {
      setStatusMessage(errorMessageFor(error, tr("AI 索引清空失败")));
    }
  }

  async function runAiCommandById(commandId: string) {
    const command = aiCommands.find((item) => item.id === commandId);
    if (!command) {
      return;
    }
    await startAiRequest({
      prompt: "",
      commandId,
      scope: inferAiScope(command)
    });
  }

  async function startAiRequest({
    prompt,
    scope,
    commandId
  }: {
    prompt: string;
    scope: AiEditorSnapshot["scope"];
    commandId?: string;
  }) {
    openAiPanel();
    if (!effectiveSettings.ai.enabled) {
      setAiMessages((messages) => [
        ...messages,
        {
          id: makeAiMessageId(),
          role: "system",
          text: tr("AI 尚未启用。请在设置中开启 AI，并配置 provider。"),
          status: "error"
        }
      ]);
      return;
    }
    if (!window.nolia.ai) {
      setAiMessages((messages) => [
        ...messages,
        {
          id: makeAiMessageId(),
          role: "system",
          text: tr("AI 请求失败"),
          status: "error"
        }
      ]);
      return;
    }
    const command = commandId ? aiCommands.find((item) => item.id === commandId) : undefined;
    const editor = buildAiEditorSnapshot(scope);
    const displayPrompt = prompt.trim() || command?.name || tr("基于当前上下文处理");
    const contextOptions = aiContextOptionsForCommand(command, scope);
    const previewPrompt = [command?.promptTemplate, prompt].filter(Boolean).join("\n\n");
    try {
      const preview = await window.nolia.ai.previewContext({
        workspaceId: workspace?.workspaceId,
        prompt: previewPrompt,
        scope,
        providerId: effectiveSettings.ai.defaultProviderId,
        model: effectiveSettings.ai.defaultModel,
        editor,
        ...contextOptions
      });
      setAiPreview(preview);
      const pending: AiPendingContextApproval = {
        prompt,
        scope,
        commandId,
        commandName: command?.name,
        displayPrompt,
        editor,
        preview,
        excludedContextItemIds: [],
        contextOptions
      };
      if (shouldBypassAiContextApproval(pending, effectiveSettings.ai.privacy.rememberContextApproval, workspace?.workspaceId)) {
        await sendApprovedAiRequest(pending);
        return;
      }
      setAiContextApproval(pending);
    } catch (error) {
      setAiMessages((messages) => [
        ...messages,
        {
          id: makeAiMessageId(),
          role: "system",
          text: errorMessageFor(error, tr("AI 请求失败")),
          status: "error"
        }
      ]);
      setAiRunningRequestId(undefined);
    }
  }

  async function confirmAiContextApproval(remember: boolean) {
    const pending = aiContextApproval;
    if (!pending) {
      return;
    }
    setAiContextApproval(undefined);
    if (remember && workspace?.workspaceId) {
      saveAiContextApproval(workspace.workspaceId, pending);
    }
    await sendApprovedAiRequest(pending);
  }

  async function sendApprovedAiRequest(pending: AiPendingContextApproval) {
    if (!window.nolia.ai) {
      return;
    }
    const userMessageId = makeAiMessageId();
    const assistantMessageId = makeAiMessageId();
    setAiMessages((messages) => [
      ...messages,
      { id: userMessageId, role: "user", text: pending.displayPrompt, commandName: pending.commandName },
      { id: assistantMessageId, role: "assistant", text: "", status: "pending", commandName: pending.commandName }
    ]);
    try {
      const response = pending.commandId
        ? await window.nolia.ai.runCommand({
            commandId: pending.commandId,
            workspaceId: workspace?.workspaceId,
            prompt: pending.prompt,
            scope: pending.scope,
            providerId: effectiveSettings.ai.defaultProviderId,
            model: effectiveSettings.ai.defaultModel,
            previewId: pending.preview.previewId,
            editor: pending.editor,
            ...pending.contextOptions,
            excludedContextItemIds: pending.excludedContextItemIds
          })
        : await window.nolia.ai.startChat({
            workspaceId: workspace?.workspaceId,
            prompt: pending.prompt,
            scope: pending.scope,
            providerId: effectiveSettings.ai.defaultProviderId,
            model: effectiveSettings.ai.defaultModel,
            previewId: pending.preview.previewId,
            editor: pending.editor,
            ...pending.contextOptions,
            excludedContextItemIds: pending.excludedContextItemIds
          });
      aiMessageByRequestRef.current.set(response.requestId, assistantMessageId);
      setAiRunningRequestId(response.requestId);
    } catch (error) {
      setAiMessages((messages) =>
        messages.map((message) =>
          message.id === assistantMessageId
            ? { ...message, text: errorMessageFor(error, tr("AI 请求失败")), status: "error" }
            : message
        )
      );
      setAiRunningRequestId(undefined);
    }
  }

  function handleAiChatEvent(event: AiChatStreamEvent) {
    const messageId = aiMessageByRequestRef.current.get(event.requestId);
    if (event.type === "started") {
      setAiRunningRequestId(event.requestId);
      return;
    }
    if (event.type === "delta" && messageId) {
      setAiMessages((messages) =>
        messages.map((message) =>
          message.id === messageId ? { ...message, text: `${message.text}${event.text}`, status: "pending" } : message
        )
      );
      return;
    }
    if (event.type === "result" && messageId) {
      setAiMessages((messages) =>
        messages.map((message) =>
          message.id === messageId ? { ...message, text: event.result.text, citations: event.result.citations, status: "done" } : message
        )
      );
      return;
    }
    if (event.type === "error" && messageId) {
      setAiMessages((messages) =>
        messages.map((message) =>
          message.id === messageId ? { ...message, text: event.error.message, status: "error" } : message
        )
      );
      setAiRunningRequestId(undefined);
      return;
    }
    if (event.type === "cancelled" && messageId) {
      setAiMessages((messages) =>
        messages.map((message) =>
          message.id === messageId ? { ...message, text: message.text || tr("AI 请求已取消。"), status: "error" } : message
        )
      );
      setAiRunningRequestId(undefined);
      return;
    }
    if (event.type === "done") {
      setAiRunningRequestId((current) => (current === event.requestId ? undefined : current));
      aiMessageByRequestRef.current.delete(event.requestId);
    }
  }

  function buildAiEditorSnapshot(scope: AiEditorSnapshot["scope"]): AiEditorSnapshot | undefined {
    const snapshot = editorPaneRef.current?.captureAiSnapshot(scope);
    if (snapshot) {
      return {
        ...snapshot,
        workspaceId: snapshot.workspaceId ?? workspace?.workspaceId
      };
    }
    const active = currentDocumentFromRef();
    if (!active) {
      return undefined;
    }
    return {
      workspaceId: active.sourceKind === "external" ? undefined : workspace?.workspaceId,
      pathRel: active.pathRel,
      title: active.title,
      sourceText: active.sourceText,
      scope,
      dirty: active.dirty
    };
  }

  async function cancelAiRequest() {
    if (!aiRunningRequestId) {
      return;
    }
    await window.nolia.ai?.cancelChat({ requestId: aiRunningRequestId });
  }

  function clearAiConversation() {
    if (aiRunningRequestId) {
      return;
    }
    if (workspace?.workspaceId) {
      removeAiConversationHistory(workspace.workspaceId);
    }
    aiMessageByRequestRef.current.clear();
    aiHistorySkipNextSaveRef.current = true;
    setAiMessages([]);
    setAiPreview(undefined);
    setStatusMessage(tr("AI 对话已清空"));
  }

  async function applyAiText(text: string, mode: AiApplyMode) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (mode === "copy") {
      await navigator.clipboard.writeText(text);
      setStatusMessage(tr("AI 结果已复制"));
      return;
    }
    if (mode === "new-document") {
      await createAiGeneratedDocument(text);
      return;
    }
    if (mode === "diff") {
      if (!workspace || !window.nolia.ai?.prepareChangePlan) {
        setStatusMessage(tr("当前无工作区"));
        return;
      }
      const plan = await window.nolia.ai.prepareChangePlan({ workspaceId: workspace.workspaceId, sourceText: text });
      setAiChangePlan(plan);
      setStatusMessage(plan.error ? plan.error : tr("AI 变更计划已生成"));
      return;
    }
    const appliedInEditor = editorPaneRef.current?.applyAiText(text, mode) ?? false;
    if (appliedInEditor) {
      setStatusMessage(tr("AI 结果已应用到当前文档"));
      return;
    }
    const active = currentDocumentFromRef();
    if (!active) {
      return;
    }
    if (mode === "append" || mode === "insert" || mode === "replace") {
      const nextSource = `${active.sourceText.trimEnd()}\n\n${text.trim()}\n`;
      updateSourceText(nextSource);
      setStatusMessage(tr("AI 结果已追加到当前文档"));
    }
  }

  async function createAiGeneratedDocument(text: string) {
    if (!workspace) {
      setStatusMessage(tr("当前无工作区"));
      return;
    }
    const title = titleFromMarkdown(text) ?? tr("AI 生成笔记");
    const active = currentDocumentFromRef();
    const parentPath = active?.sourceKind === "workspace" ? pathParent(active.pathRel) : "";
    const safeTitle = sanitizeItemName(title).replace(/\//g, "-") || tr("AI 生成笔记");
    const preferredPath = joinPath(parentPath, `${safeTitle.endsWith(".md") ? safeTitle : `${safeTitle}.md`}`);
    const pathRel = uniqueMovedPath(preferredPath, collectPathSet(fileTree), "file");
    await window.nolia.file.create({
      workspaceId: workspace.workspaceId,
      pathRel,
      kind: "file",
      content: ensureTrailingNewline(text.trim())
    });
    await loadWorkspaceData(workspace);
    await openDocument(pathRel, workspace);
    setStatusMessage(tr("已创建 AI 笔记 {path}", { path: pathRel }));
  }

  async function refreshAiInsights() {
    const active = currentDocumentFromRef();
    if (!workspace || !active || !window.nolia.ai?.insights) {
      setAiInsights([]);
      setAiInsightsWarnings([tr("打开文档后可使用 AI。")]);
      return;
    }
    setAiInsightsLoading(true);
    try {
      const result = await window.nolia.ai.insights({
        workspaceId: workspace.workspaceId,
        pathRel: active.sourceKind === "workspace" ? active.pathRel : undefined,
        sourceText: active.sourceText,
        limit: 8
      });
      setAiInsights(result.items);
      setAiInsightsWarnings(result.warnings);
      setStatusMessage(tr("整理建议已刷新"));
    } catch (error) {
      setAiInsightsWarnings([errorMessageFor(error, tr("整理建议刷新失败"))]);
      setStatusMessage(errorMessageFor(error, tr("整理建议刷新失败")));
    } finally {
      setAiInsightsLoading(false);
    }
  }

  async function openAiInsight(insight: AiInsightItem) {
    if (!insight.pathRel) {
      setStatusMessage(tr("该建议没有可打开的来源"));
      return;
    }
    await openWorkspacePath(insight.pathRel);
  }

  function applyAiInsight(insight: AiInsightItem) {
    const active = currentDocumentFromRef();
    const snippet = markdownForAiInsight(insight);
    if (!active || !snippet) {
      setStatusMessage(tr("该建议需要打开来源处理"));
      return;
    }
    const nextSource = appendUniqueMarkdownHint(active.sourceText, snippet);
    if (nextSource === active.sourceText) {
      setStatusMessage(tr("当前文档已包含该整理建议"));
      return;
    }
    updateSourceText(nextSource);
    setStatusMessage(tr("整理建议已应用到当前文档"));
  }

  async function applyAiChange(changeId: string) {
    if (!workspace || !aiChangePlan) {
      return;
    }
    const change = aiChangePlan.operations.find((item) => item.id === changeId);
    if (!change || !isAiChangeApplicable(change)) {
      return;
    }
    setAiChangePlan((plan) => updateAiChangeStatus(plan, changeId, "applying", tr("正在应用...")));
    try {
      assertAiOperationClean(change);
      const result = await window.nolia.ai?.applyChangePlan({
        workspaceId: workspace.workspaceId,
        plan: aiChangePlan,
        acceptedOperationIds: [changeId]
      });
      if (!result) {
        throw new Error(tr("应用失败"));
      }
      setAiChangePlan({ ...aiChangePlan, operations: result.operations });
      await syncAppliedAiOperations(result.operations);
      await loadWorkspaceData(workspace);
      setStatusMessage(tr("已应用 AI 变更：{path}", { path: aiChangeResultPath(change) }));
    } catch (error) {
      setAiChangePlan((plan) => updateAiChangeStatus(plan, changeId, "error", errorMessageFor(error, tr("应用失败"))));
      setStatusMessage(errorMessageFor(error, tr("应用失败")));
    }
  }

  async function applyAllAiChanges() {
    if (!workspace || !aiChangePlan) {
      return;
    }
    const applicable = aiChangePlan.operations.filter(isAiChangeApplicable);
    if (applicable.length === 0) {
      return;
    }
    try {
      for (const change of applicable) {
        assertAiOperationClean(change);
      }
      const acceptedOperationIds = applicable.map((change) => change.id);
      setAiChangePlan({
        ...aiChangePlan,
        operations: aiChangePlan.operations.map((operation) => acceptedOperationIds.includes(operation.id) ? { ...operation, status: "applying", message: tr("正在应用...") } : operation)
      });
      const result = await window.nolia.ai?.applyChangePlan({
        workspaceId: workspace.workspaceId,
        plan: aiChangePlan,
        acceptedOperationIds
      });
      if (!result) {
        throw new Error(tr("应用失败"));
      }
      setAiChangePlan({ ...aiChangePlan, operations: result.operations });
      await syncAppliedAiOperations(result.operations);
      await loadWorkspaceData(workspace);
      setStatusMessage(tr("已应用 AI 变更：{path}", { path: tr("全部") }));
    } catch (error) {
      setStatusMessage(errorMessageFor(error, tr("应用失败")));
    }
  }

  function setAiChangeStatus(changeId: string, status: AiChangePlanOperation["status"]) {
    setAiChangePlan((plan) => updateAiChangeStatus(plan, changeId, status));
  }

  function assertAiOperationClean(change: AiChangePlanOperation) {
    if (change.action === "create") {
      return;
    }
    assertAiTargetClean(change.pathRel);
  }

  async function syncAppliedAiOperations(operations: AiChangePlanOperation[]) {
    if (!workspace) {
      return;
    }
    for (const operation of operations) {
      if (operation.status !== "applied") {
        continue;
      }
      if (operation.action === "modify") {
        const file = await window.nolia.file.read({ workspaceId: workspace.workspaceId, pathRel: operation.pathRel });
        await refreshOpenDocumentAfterAiChange(operation.pathRel, file.content, file.sha256);
      } else if (operation.action === "rename" && operation.targetPathRel) {
        applyPathRelChange(pathTargetForAiChange(operation.pathRel), operation.targetPathRel, operation.title ?? fileNameFor(operation.targetPathRel).replace(/\.md$/i, ""));
      } else if (operation.action === "delete") {
        clearDeletedPathFromState(pathTargetForAiChange(operation.pathRel));
      }
    }
  }

  async function openAiCitation(citation: AiCitation) {
    if (!citation.pathRel) {
      setStatusMessage(tr("引用没有可打开的文件路径"));
      return;
    }
    await openWorkspacePath(citation.pathRel);
    if (citation.line !== undefined) {
      setStatusMessage(tr("引用位于第 {line} 行", { line: citation.line }));
    }
  }

  async function refreshOpenDocumentAfterAiChange(pathRel: string, content: string, sha256: string) {
    const openDoc = openDocsRef.current.find((doc) => doc.pathRel === pathRel);
    if (!openDoc) {
      return;
    }
    const parsed = await window.nolia.document.parse({ workspaceId: workspace?.workspaceId ?? EXTERNAL_PARSE_WORKSPACE_ID, pathRel, content, mode: "full" });
    updateOpenDocs((docs) =>
      docs.map((doc) =>
        doc.pathRel === pathRel
          ? {
              ...doc,
              sourceText: content,
              baseHash: sha256,
              lastSavedHash: sha256,
              dirty: false,
              pendingHtml: undefined,
              parsed,
              lastSavedAt: Date.now()
            }
          : doc
      )
    );
    htmlDraftsRef.current.delete(pathRel);
  }

  async function handleExternalFileOpen(filePath: string) {
    const active = currentDocumentFromRef();
    if (active?.dirty) {
      await saveActiveDocument();
    }
    const resource = activeResourceRef.current;
    if (resource?.editorId && resource.dirty) {
      await saveActivePluginEditorResource(resource.pathRel);
    }
    if (active?.sourceKind !== "external" && !suspendedShellRef.current) {
      suspendedShellRef.current = captureShellState();
    }
    await openExternalDocument(filePath);
    setImmersiveMode(true);
  }

  async function openExternalDocument(filePath: string) {
    if (!window.nolia.externalFile) {
      setStatusMessage(tr("当前版本不支持直接打开系统文件"));
      return;
    }
    const file = await window.nolia.externalFile.read({ filePath });
    const parsed = await window.nolia.document.parse({ workspaceId: EXTERNAL_PARSE_WORKSPACE_ID, pathRel: filePath, content: file.content, mode: "full" });
    const nextDoc: OpenDocumentTab = {
      pathRel: filePath,
      sourceKind: "external",
      filePath,
      title: parsed.title,
      sourceText: file.content,
      baseHash: file.sha256,
      lastSavedHash: file.sha256,
      dirty: false,
      mode: editorModeSettingRef.current,
      parsed
    };
    htmlDraftsRef.current.clear();
    updateOpenDocs(() => [nextDoc]);
    setActiveResource(undefined);
    setActivePathRel(filePath);
    setTreeSelection(undefined);
    setBacklinks(emptyBacklinks);
    setStatusMessage(tr("已打开 {path}", { path: fileNameFor(filePath) }));
  }

  async function toggleImmersiveMode() {
    if (!immersiveMode) {
      if (currentDocument()) {
        setImmersiveMode(true);
      }
      return;
    }
    await leaveImmersiveMode();
  }

  async function leaveImmersiveMode() {
    const active = currentDocumentFromRef();
    if (active?.dirty) {
      await saveActiveDocument();
    }
    const resource = activeResourceRef.current;
    if (resource?.editorId && resource.dirty) {
      await saveActivePluginEditorResource(resource.pathRel);
    }
    const suspended = suspendedShellRef.current;
    if (active?.sourceKind === "external" && suspended) {
      restoreSuspendedShell(suspended);
      suspendedShellRef.current = undefined;
      setImmersiveMode(false);
      setStatusMessage(suspended.workspace ? tr("已返回工作区") : tr("已退出沉浸式编辑"));
      return;
    }
    setImmersiveMode(false);
    setStatusMessage(tr("已退出沉浸式编辑"));
  }

  function captureShellState(): SuspendedShellState | undefined {
    if (!workspace && openDocsRef.current.length === 0 && !activeResource) {
      return undefined;
    }
    return {
      workspace,
      fileTree,
      searchResults,
      favoriteDocs,
      recentViewedDocs,
      recentEditedDocs,
      noteFilterQuery,
      workspaceSearchQuery,
      openDocs: openDocsRef.current,
      activePathRel,
      activeResource,
      treeSelection,
      backlinks,
      sidebarView,
      leftPanelCollapsed,
      rightPanelCollapsed
    };
  }

  function restoreSuspendedShell(state: SuspendedShellState) {
    setWorkspace(state.workspace);
    setFileTree(state.fileTree);
    setSearchResults(state.searchResults);
    setFavoriteDocs(state.favoriteDocs);
    setRecentViewedDocs(state.recentViewedDocs);
    setRecentEditedDocs(state.recentEditedDocs);
    setNoteFilterQuery(state.noteFilterQuery);
    setWorkspaceSearchQuery(state.workspaceSearchQuery);
    updateOpenDocs(() => state.openDocs);
    setActivePathRel(state.activePathRel);
    setActiveResource(state.activeResource);
    setTreeSelection(state.treeSelection);
    setBacklinks(state.backlinks);
    setSidebarView(state.sidebarView);
    setLeftPanelCollapsed(state.leftPanelCollapsed);
    setRightPanelCollapsed(state.rightPanelCollapsed);
    htmlDraftsRef.current.clear();
  }

  async function openDocument(pathRel: string, workspaceInfo = workspace) {
    if (!workspaceInfo) {
      return;
    }
    const existing = openDocsRef.current.find((doc) => doc.pathRel === pathRel);
    if (existing) {
      setActiveResource(undefined);
      setActivePathRel(pathRel);
      setTreeSelection({ pathRel, kind: "file" });
      rememberViewedDocument(existing.pathRel, existing.title, workspaceInfo.workspaceId);
      return;
    }
    const active = currentDocumentFromRef();
    if (active?.dirty) {
      await saveActiveDocument();
    }
    const resource = activeResourceRef.current;
    if (resource?.editorId && resource.dirty) {
      await saveActivePluginEditorResource(resource.pathRel);
    }
    const file = await window.nolia.file.read({ workspaceId: workspaceInfo.workspaceId, pathRel });
    const parsed = await window.nolia.document.parse({ workspaceId: workspaceInfo.workspaceId, pathRel, content: file.content, mode: "full" });
    const nextDoc: OpenDocumentTab = {
      pathRel,
      sourceKind: "workspace",
      title: parsed.title,
      sourceText: file.content,
      baseHash: file.sha256,
      lastSavedHash: file.sha256,
      dirty: false,
      mode: editorModeSettingRef.current,
      parsed
    };
    updateOpenDocs(() => [nextDoc]);
    setActiveResource(undefined);
    setActivePathRel(pathRel);
    setTreeSelection({ pathRel, kind: "file" });
    rememberViewedDocument(pathRel, parsed.title, workspaceInfo.workspaceId);
    setStatusMessage(tr("已打开 {path}", { path: pathRel }));
    await refreshBacklinks(pathRel, workspaceInfo);
  }

  async function openResource(node: FileTreeNode, workspaceInfo = workspace) {
    if (!workspaceInfo || node.kind === "directory" || node.kind === "markdown") {
      return;
    }
    const active = currentDocumentFromRef();
    if (active?.dirty) {
      await saveActiveDocument();
    }
    const resource = activeResourceRef.current;
    if (resource?.editorId && resource.dirty) {
      await saveActivePluginEditorResource(resource.pathRel);
    }
    updateOpenDocs(() => []);
    const viewer = selectFileViewer(extensionRegistry.fileViewers, node.pathRel);
    setActivePathRel(undefined);
    setActiveHtml("");
    setBacklinks(emptyBacklinks);
    setActiveResource({
      pathRel: node.pathRel,
      name: node.name,
      kind: node.kind === "asset" ? "asset" : "other",
      size: node.size,
      mtimeMs: node.mtimeMs,
      viewerId: viewer?.id,
      category: viewer?.category
    });
    setTreeSelection({ pathRel: node.pathRel, kind: "resource" });
    rememberViewedResource(node.pathRel, workspaceInfo.workspaceId);
    setStatusMessage(tr("已打开资源 {path}", { path: node.pathRel }));
  }

  async function openPluginEditor(node: FileTreeNode, editor: FileEditorContribution, workspaceInfo = workspace) {
    if (!workspaceInfo || node.kind === "directory") {
      return;
    }
    const pluginId = pluginIdForContribution(editor.id);
    if (pluginId) {
      try {
        assertPluginPermission(pluginId, "workspace:file:read");
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : tr("插件缺少文件读取权限"));
        return;
      }
    }
    const active = currentDocumentFromRef();
    if (active?.dirty) {
      await saveActiveDocument();
    }
    const resource = activeResourceRef.current;
    if (resource?.editorId && resource.dirty) {
      await saveActivePluginEditorResource(resource.pathRel);
    }
    const category = resourceCategoryFor(node.pathRel);
    const textLike = isTextLikeResourceCategory(category);
    const readBinaryFile = window.nolia.file.readBinary;
    const file = textLike || !readBinaryFile
      ? await window.nolia.file.read({ workspaceId: workspaceInfo.workspaceId, pathRel: node.pathRel })
      : undefined;
    const binaryFile = !file && readBinaryFile
      ? await readBinaryFile({ workspaceId: workspaceInfo.workspaceId, pathRel: node.pathRel })
      : undefined;
    const openedFile = file ?? binaryFile;
    if (!openedFile) {
      throw new Error("Unable to read plugin editor file");
    }
    updateOpenDocs(() => []);
    setActivePathRel(undefined);
    setActiveHtml("");
    setBacklinks(emptyBacklinks);
    const nextResource: ActiveResource = {
      pathRel: node.pathRel,
      name: node.name,
      kind: node.kind === "asset" ? "asset" : "other",
      size: openedFile.stat.size,
      mtimeMs: openedFile.stat.mtimeMs,
      editorId: editor.id,
      category,
      initialText: file?.content ?? "",
      initialBytes: binaryFile?.data,
      baseHash: openedFile.sha256,
      dirty: false
    };
    activeResourceRef.current = nextResource;
    setActiveResource(nextResource);
    setTreeSelection({ pathRel: node.pathRel, kind: "resource" });
    rememberViewedResource(node.pathRel, workspaceInfo.workspaceId);
    setStatusMessage(tr("已用 {editor} 打开 {path}", { editor: editor.title, path: node.pathRel }));
  }

  function updateSourceText(nextSource: string) {
    const active = currentDocumentFromRef();
    if (!active) {
      return;
    }
    const pathRel = active.pathRel;
    const parseToken = (sourceParseTokensRef.current.get(pathRel) ?? 0) + 1;
    sourceParseTokensRef.current.set(pathRel, parseToken);
    updateOpenDocs((docs) =>
      docs.map((doc) =>
        doc.pathRel === pathRel
          ? {
              ...doc,
              sourceText: nextSource,
              dirty: true,
              pendingHtml: undefined
            }
          : doc
      )
    );
    htmlDraftsRef.current.delete(pathRel);
    setUserStatusMessage(tr("正在编辑 {path}", { path: pathRel }));
    queueAutosave(pathRel);
    void window.nolia.document
      .parse({ workspaceId: workspace?.workspaceId ?? EXTERNAL_PARSE_WORKSPACE_ID, pathRel, content: nextSource, mode: "full" })
      .then((parsed) => {
        if (sourceParseTokensRef.current.get(pathRel) !== parseToken) {
          return;
        }
        updateOpenDocs((docs) =>
          docs.map((doc) =>
            doc.pathRel === pathRel && doc.sourceText === nextSource
              ? {
                  ...doc,
                  parsed
                }
              : doc
          )
        );
      })
      .catch((error: unknown) => {
        if (sourceParseTokensRef.current.get(pathRel) === parseToken) {
          setUserStatusMessage(error instanceof Error ? error.message : tr("Markdown 解析失败"));
        }
      });
  }

  async function updateHtmlDraft(nextHtml: string) {
    const active = currentDocument();
    if (!active) {
      return;
    }
    if (active.mode !== "wysiwyg") {
      return;
    }
    htmlDraftsRef.current.set(active.pathRel, nextHtml);
    setActiveHtml(nextHtml);
    updateOpenDocs((docs) =>
      docs.map((doc) =>
        doc.pathRel === active.pathRel
          ? {
              ...doc,
              dirty: true,
              pendingHtml: nextHtml
            }
          : doc
      )
    );
    queueAutosave(active.pathRel);
  }

  async function saveActiveDocument(pathRel?: string) {
    const document = pathRel ? openDocsRef.current.find((doc) => doc.pathRel === pathRel) : currentDocumentFromRef();
    if (!document) {
      if (!pathRel) {
        await saveActivePluginEditorResource();
      }
      return;
    }
    const pendingAutosave = autosaveTimers.current.get(document.pathRel);
    if (pendingAutosave) {
      window.clearTimeout(pendingAutosave);
      autosaveTimers.current.delete(document.pathRel);
    }
    let content = document.sourceText;
    const pendingHtml = htmlDraftsRef.current.get(document.pathRel) ?? document.pendingHtml;
    if (document.mode === "wysiwyg" && pendingHtml) {
      const markdownBody = await htmlToMarkdown(pendingHtml);
      content = mergeWysiwygBodyIntoSource(document.sourceText, markdownBody);
    }
    const contentBeforeTocRefresh = content;
    content = refreshMarkdownTocIfPresent(content);
    const contentChangedByTocRefresh = content !== contentBeforeTocRefresh;
    const result =
      document.sourceKind === "external"
        ? await window.nolia.externalFile?.writeAtomic({
            filePath: document.filePath ?? document.pathRel,
            content,
            baseHash: document.baseHash
          })
        : workspace
          ? await window.nolia.file.writeAtomic({
              workspaceId: workspace.workspaceId,
              pathRel: document.pathRel,
              content,
              baseHash: document.baseHash,
              createSnapshot: true
            })
          : undefined;
    if (!result) {
      setUserStatusMessage(tr("保存失败"));
      return;
    }
    if (result.status !== "saved") {
      setUserStatusMessage(result.status === "conflict" ? tr("保存冲突") : tr("保存失败"));
      return;
    }
    const parsed = await window.nolia.document.parse({ workspaceId: workspace?.workspaceId ?? EXTERNAL_PARSE_WORKSPACE_ID, pathRel: document.pathRel, content, mode: "full" });
    let savedCurrentRevision = false;
    let hasNewerChanges = false;
    updateOpenDocs((docs) =>
      docs.map((doc) => {
        if (doc.pathRel !== document.pathRel) {
          return doc;
        }
        const currentPendingHtml = htmlDraftsRef.current.get(doc.pathRel) ?? doc.pendingHtml;
        const pendingMatches = (currentPendingHtml ?? undefined) === (pendingHtml ?? undefined);
        const sourceMatches = doc.sourceText === document.sourceText;
        const revisionMatches = doc.mode === document.mode && sourceMatches && pendingMatches;
        savedCurrentRevision = revisionMatches;
        hasNewerChanges = !revisionMatches;
        if (!revisionMatches) {
          return {
            ...doc,
            baseHash: result.sha256 ?? doc.baseHash,
            lastSavedHash: result.sha256 ?? doc.lastSavedHash,
            dirty: true,
            lastSavedAt: Date.now()
          };
        }
        if (contentChangedByTocRefresh && doc.mode === "wysiwyg") {
          htmlDraftsRef.current.delete(doc.pathRel);
        }
        return {
          ...doc,
          sourceText: content,
          baseHash: result.sha256 ?? doc.baseHash,
          lastSavedHash: result.sha256 ?? doc.lastSavedHash,
          dirty: false,
          pendingHtml: document.mode === "wysiwyg" && !contentChangedByTocRefresh ? pendingHtml : undefined,
          parsed,
          lastSavedAt: Date.now()
        };
      })
    );
    if (workspace && document.sourceKind !== "external") {
      rememberEditedDocument(document.pathRel, parsed.title, workspace.workspaceId);
    }
    setUserStatusMessage(savedCurrentRevision ? tr("已保存 {path}", { path: document.pathRel }) : tr("已保存 {path}，仍有未保存更改", { path: document.pathRel }));
    if (hasNewerChanges) {
      queueAutosave(document.pathRel);
    }
    if (workspace && document.sourceKind !== "external") {
      await loadWorkspaceData(workspace);
      await refreshBacklinks(document.pathRel);
    }
  }

  async function saveActivePluginEditorResource(pathRel = activeResourceRef.current?.pathRel) {
    const resource = activeResourceRef.current;
    if (!resource?.editorId || !pathRel || resource.pathRel !== pathRel) {
      return;
    }
    const handler = pluginEditorSaveHandlersRef.current.get(pathRel);
    if (!handler) {
      setUserStatusMessage(tr("插件编辑器未提供保存处理"));
      return;
    }
    try {
      await handler();
    } catch (error) {
      setUserStatusMessage(error instanceof Error ? tr("保存失败：{message}", { message: error.message }) : tr("保存失败"));
    }
  }

  async function readPluginEditorFile(pluginId: string, pathRel: string): Promise<FileReadResponse> {
    assertPluginPermission(pluginId, "workspace:file:read");
    if (!workspace) {
      throw new Error("No active workspace");
    }
    return window.nolia.file.read({ workspaceId: workspace.workspaceId, pathRel });
  }

  async function writePluginEditorFile(pluginId: string, pathRel: string, content: string, baseHash?: string): Promise<FileWriteResponse> {
    assertPluginPermission(pluginId, "workspace:file:write");
    if (!workspace) {
      throw new Error("No active workspace");
    }
    if (!baseHash) {
      throw new Error("Missing base hash");
    }
    return window.nolia.file.writeAtomic({
      workspaceId: workspace.workspaceId,
      pathRel,
      content,
      baseHash,
      createSnapshot: true
    });
  }

  async function readPluginEditorBinaryFile(pluginId: string, pathRel: string): Promise<FileBinaryReadResponse> {
    assertPluginPermission(pluginId, "workspace:file:read");
    if (!workspace) {
      throw new Error("No active workspace");
    }
    if (!window.nolia.file.readBinary) {
      throw new Error("Binary file reads are unavailable");
    }
    return window.nolia.file.readBinary({ workspaceId: workspace.workspaceId, pathRel });
  }

  async function writePluginEditorBinaryFile(pluginId: string, pathRel: string, data: ArrayBuffer | ArrayBufferView, baseHash?: string): Promise<FileWriteResponse> {
    assertPluginPermission(pluginId, "workspace:file:write");
    if (!workspace) {
      throw new Error("No active workspace");
    }
    if (!window.nolia.file.writeBinaryAtomic) {
      throw new Error("Binary file writes are unavailable");
    }
    if (!baseHash) {
      throw new Error("Missing base hash");
    }
    return window.nolia.file.writeBinaryAtomic({
      workspaceId: workspace.workspaceId,
      pathRel,
      data,
      baseHash,
      createSnapshot: true
    });
  }

  function setPluginEditorDirty(pathRel: string, dirty: boolean) {
    if (activeResourceRef.current?.pathRel === pathRel) {
      activeResourceRef.current = { ...activeResourceRef.current, dirty };
    }
    setActiveResource((resource) => (resource?.pathRel === pathRel ? { ...resource, dirty } : resource));
    if (dirty) {
      if (Date.now() > userStatusProtectedUntilRef.current) {
        setUserStatusMessage(tr("正在编辑 {path}", { path: pathRel }));
      }
      queueAutosave(pathRel);
    }
  }

  function markPluginEditorSaved(pathRel: string, result: FileWriteResponse) {
    if (activeResourceRef.current?.pathRel === pathRel) {
      activeResourceRef.current = {
        ...activeResourceRef.current,
        baseHash: result.sha256 ?? activeResourceRef.current.baseHash,
        mtimeMs: result.mtimeMs ?? activeResourceRef.current.mtimeMs,
        dirty: false,
        lastSavedAt: Date.now()
      };
    }
    setActiveResource((resource) =>
      resource?.pathRel === pathRel
        ? {
            ...resource,
            baseHash: result.sha256 ?? resource.baseHash,
            mtimeMs: result.mtimeMs ?? resource.mtimeMs,
            dirty: false,
            lastSavedAt: Date.now()
          }
        : resource
    );
    rememberEditedResource(pathRel);
    if (workspace) {
      void loadWorkspaceData(workspace);
    }
  }

  function registerPluginEditorSaveHandler(pathRel: string, handler: () => Promise<void>): () => void {
    pluginEditorSaveHandlersRef.current.set(pathRel, handler);
    return () => {
      if (pluginEditorSaveHandlersRef.current.get(pathRel) === handler) {
        pluginEditorSaveHandlersRef.current.delete(pathRel);
      }
    };
  }

  async function exportActiveDocument() {
    const active = currentDocument();
    if (!workspace || !active || active.sourceKind === "external") {
      setStatusMessage(active?.sourceKind === "external" ? tr("单文件模式暂不支持导出") : tr("未打开文档"));
      return;
    }
    const result = await window.nolia.export.document({
      workspaceId: workspace.workspaceId,
      pathRel: active.pathRel,
      format: "html",
      includeAssets: true
    });
    setStatusMessage(result.status === "completed" ? tr("已导出 {path}", { path: result.outputPath ?? "" }) : tr("导出失败"));
  }

  function openNewNoteDialog(kind: NewItemKind = "file", parentPath = "") {
    if (!workspace) {
      return;
    }
    setNewItemKind(kind);
    setNewItemParentPath(parentPath);
    setNewNoteName(kind === "directory" ? tr("新建文件夹") : tr("未命名"));
    setNewNoteDialogOpen(true);
  }

  async function createNewNote(rawName: string, kind: NewItemKind, parentPath: string) {
    if (!workspace) {
      return;
    }
    const trimmedName = rawName.trim();
    if (!trimmedName) {
      setStatusMessage(kind === "directory" ? tr("请输入文件夹名称") : tr("请输入笔记名称"));
      return;
    }
    setNewNoteDialogOpen(false);
    const safeName = sanitizeItemName(trimmedName);
    const basePath = parentPath ? `${parentPath.replace(/\/+$/g, "")}/` : "";
    const pathRel = kind === "directory" ? `${basePath}${safeName}` : `${basePath}${safeName.endsWith(".md") ? safeName : `${safeName}.md`}`;
    await window.nolia.file.create({
      workspaceId: workspace.workspaceId,
      pathRel,
      kind,
      content: kind === "file" ? `# ${trimmedName.replace(/\.md$/i, "")}\n` : undefined
    });
    await loadWorkspaceData(workspace);
    if (kind === "file") {
      setTreeSelection({ pathRel, kind: "file" });
      await openDocument(pathRel);
    } else {
      setTreeSelection({ pathRel, kind: "directory" });
      setLeftPanelCollapsed(false);
      setSidebarView("files");
      setStatusMessage(tr("已创建文件夹 {path}", { path: pathRel }));
    }
  }

  function openRenameDialog(target: RenameTarget) {
    setRenameTarget(target);
    setRenameValue(target.kind === "file" ? target.name.replace(/\.md$/i, "") : target.name);
  }

  function openDeleteDialog(target: DeleteTarget) {
    setDeleteTarget(target);
  }

  function openMoveDialog(target: RenameTarget) {
    setMoveDialog({ target, destinationPath: pathParent(target.pathRel) });
  }

  function copyFileTarget(target: RenameTarget) {
    if (target.kind !== "file") {
      return;
    }
    setFileClipboard({ pathRel: target.pathRel, name: target.name });
    setStatusMessage(tr("已复制 {name}，可粘贴到文件夹", { name: target.name }));
  }

  async function duplicateFileTarget(target: RenameTarget) {
    if (target.kind !== "file") {
      return;
    }
    await copyFileToFolder(target.pathRel, pathParent(target.pathRel), "duplicate");
  }

  async function pasteFileIntoFolder(parentPath: string) {
    if (!fileClipboard) {
      setStatusMessage(tr("请先复制一个文件"));
      return;
    }
    await copyFileToFolder(fileClipboard.pathRel, parentPath, "paste");
  }

  async function copyFileToFolder(sourcePathRel: string, destinationPath: string, mode: "paste" | "duplicate") {
    if (!workspace) {
      return;
    }
    try {
      const source = await window.nolia.file.read({ workspaceId: workspace.workspaceId, pathRel: sourcePathRel });
      const existingPaths = collectPathSet(fileTree);
      const sourceName = fileNameFor(sourcePathRel);
      const preferredPath = joinPath(destinationPath, sourceName);
      const targetPathRel = uniqueCopiedFilePath(preferredPath, existingPaths, tr);
      await window.nolia.file.create({
        workspaceId: workspace.workspaceId,
        pathRel: targetPathRel,
        kind: "file",
        content: source.content
      });
      await loadWorkspaceData(workspace);
      setTreeSelection({ pathRel: targetPathRel, kind: "file" });
      await openDocument(targetPathRel);
      setStatusMessage(mode === "duplicate" ? tr("已创建副本 {path}", { path: targetPathRel }) : tr("已粘贴到 {path}", { path: targetPathRel }));
    } catch (error) {
      setStatusMessage(error instanceof Error ? tr("复制失败：{message}", { message: error.message }) : tr("复制失败"));
    }
  }

  async function moveItem() {
    if (!workspace || !moveDialog) {
      return;
    }
    const { target, destinationPath } = moveDialog;
    const result = await moveTargetToFolder(target, destinationPath);
    if (result !== "failed") {
      setMoveDialog(undefined);
    }
  }

  async function moveTargetToFolder(target: RenameTarget, destinationPath: string): Promise<"moved" | "noop" | "failed"> {
    if (!workspace) {
      return "failed";
    }
    if (target.kind === "directory" && (destinationPath === target.pathRel || destinationPath.startsWith(`${target.pathRel}/`))) {
      setStatusMessage(tr("不能移动到自身或子文件夹"));
      return "failed";
    }
    const preferredPath = joinPath(destinationPath, fileNameFor(target.pathRel));
    if (preferredPath === target.pathRel) {
      setStatusMessage(tr("已在当前文件夹"));
      return "noop";
    }
    const existingPaths = collectPathSet(fileTree);
    existingPaths.delete(target.pathRel);
    const targetPathRel = uniqueMovedPath(preferredPath, existingPaths, target.kind);
    try {
      await window.nolia.file.rename({
        workspaceId: workspace.workspaceId,
        sourcePathRel: target.pathRel,
        targetPathRel,
        updateReferences: true
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? tr("移动失败：{message}", { message: error.message }) : tr("移动失败"));
      return "failed";
    }
    applyPathRelChange(target, targetPathRel);
    await loadWorkspaceData(workspace);
    setStatusMessage(tr("已移动到 {path}", { path: targetPathRel }));
    return "moved";
  }

  async function renameItem(rawName: string) {
    if (!workspace || !renameTarget) {
      return;
    }
    const trimmedName = rawName.trim();
    if (!trimmedName) {
      setStatusMessage(renameTarget.kind === "directory" ? tr("请输入文件夹名称") : renameTarget.kind === "resource" ? tr("请输入资源名称") : tr("请输入笔记名称"));
      return;
    }
    const safeName = sanitizeItemName(trimmedName);
    const parentPath = pathParent(renameTarget.pathRel);
    const targetName = renameTarget.kind === "file" ? (safeName.endsWith(".md") ? safeName : `${safeName}.md`) : safeName;
    const targetPathRel = parentPath ? `${parentPath}/${targetName}` : targetName;
    if (targetPathRel === renameTarget.pathRel) {
      setRenameTarget(undefined);
      return;
    }
    try {
      await window.nolia.file.rename({
        workspaceId: workspace.workspaceId,
        sourcePathRel: renameTarget.pathRel,
        targetPathRel,
        updateReferences: true
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? tr("重命名失败：{message}", { message: error.message }) : tr("重命名失败"));
      return;
    }
    setRenameTarget(undefined);
    applyPathRelChange(renameTarget, targetPathRel, renameTarget.kind === "file" ? trimmedName.replace(/\.md$/i, "") : undefined);
    await loadWorkspaceData(workspace);
    setStatusMessage(tr("已重命名为 {path}", { path: targetPathRel }));
  }

  function applyPathRelChange(target: RenameTarget, targetPathRel: string, fileTitle?: string) {
    const renamedOpenPath = (pathRel: string) => {
      if (target.kind === "directory") {
        return pathRel === target.pathRel || pathRel.startsWith(`${target.pathRel}/`) ? `${targetPathRel}${pathRel.slice(target.pathRel.length)}` : pathRel;
      }
      return pathRel === target.pathRel ? targetPathRel : pathRel;
    };
    if (activePathRel) {
      const nextActivePath = renamedOpenPath(activePathRel);
      if (nextActivePath !== activePathRel) {
        setActivePathRel(nextActivePath);
      }
    }
    updateOpenDocs((docs) =>
      docs.map((doc) => {
        const nextPath = renamedOpenPath(doc.pathRel);
        if (nextPath === doc.pathRel) {
          return doc;
        }
        return {
          ...doc,
          pathRel: nextPath,
          title: target.kind === "file" && fileTitle ? fileTitle : doc.title
        };
      })
    );
    setTreeSelection((selection) => {
      if (!selection) {
        return selection;
      }
      if (selection.pathRel === target.pathRel) {
        return { ...selection, pathRel: targetPathRel };
      }
      if (target.kind === "directory" && selection.pathRel.startsWith(`${target.pathRel}/`)) {
        return { ...selection, pathRel: `${targetPathRel}${selection.pathRel.slice(target.pathRel.length)}` };
      }
      return selection;
    });
    updateWorkspaceDocumentLists((item) => {
      const nextPath = renamedOpenPath(item.pathRel);
      if (nextPath === item.pathRel) {
        return item;
      }
      return {
        ...item,
        pathRel: nextPath,
        title: target.kind === "file" && fileTitle ? fileTitle : item.title
      };
    });
    setActiveResource((resource) => {
      if (!resource) {
        return resource;
      }
      const nextPath = renamedOpenPath(resource.pathRel);
      if (nextPath === resource.pathRel) {
        return resource;
      }
      return {
        ...resource,
        pathRel: nextPath,
        name: fileNameFor(nextPath)
      };
    });
    setFileClipboard((clipboard) => {
      if (!clipboard) {
        return clipboard;
      }
      const nextPath = renamedOpenPath(clipboard.pathRel);
      return nextPath === clipboard.pathRel ? clipboard : { ...clipboard, pathRel: nextPath, name: fileNameFor(nextPath) };
    });
  }

  async function deleteItem() {
    if (!workspace || !deleteTarget) {
      return;
    }
    try {
      await window.nolia.file.trash({
        workspaceId: workspace.workspaceId,
        pathRel: deleteTarget.pathRel
      });
    } catch (error) {
      setStatusMessage(error instanceof Error ? tr("删除失败：{message}", { message: error.message }) : tr("删除失败"));
      return;
    }
    updateOpenDocs((docs) =>
      docs.filter((doc) => (deleteTarget.kind === "directory" ? !doc.pathRel.startsWith(`${deleteTarget.pathRel}/`) : doc.pathRel !== deleteTarget.pathRel))
    );
    if (activePathRel && (activePathRel === deleteTarget.pathRel || activePathRel.startsWith(`${deleteTarget.pathRel}/`))) {
      setActivePathRel(undefined);
    }
    setActiveResource((resource) => {
      if (!resource) {
        return resource;
      }
      const removed = resource.pathRel === deleteTarget.pathRel || (deleteTarget.kind === "directory" && resource.pathRel.startsWith(`${deleteTarget.pathRel}/`));
      return removed ? undefined : resource;
    });
    setTreeSelection((selection) => {
      if (!selection) {
        return selection;
      }
      if (selection.pathRel === deleteTarget.pathRel || (deleteTarget.kind === "directory" && selection.pathRel.startsWith(`${deleteTarget.pathRel}/`))) {
        return undefined;
      }
      return selection;
    });
    updateWorkspaceDocumentLists((item) => {
      const removed = item.pathRel === deleteTarget.pathRel || (deleteTarget.kind === "directory" && item.pathRel.startsWith(`${deleteTarget.pathRel}/`));
      return removed ? undefined : item;
    });
    setDeleteTarget(undefined);
    await loadWorkspaceData(workspace);
    setStatusMessage(tr("已删除 {path}", { path: deleteTarget.pathRel }));
  }

  async function setActiveMode(mode: OpenDocumentTab["mode"]) {
    const active = currentDocument();
    if (!active) {
      return;
    }
    if (active.mode !== mode) {
      editorPaneRef.current?.captureScrollForModeSwitch();
    }
    const pendingHtml = htmlDraftsRef.current.get(active.pathRel) ?? active.pendingHtml;
    if (active.mode === "wysiwyg" && mode !== "wysiwyg" && pendingHtml) {
      const markdownBody = await htmlToMarkdown(pendingHtml);
      const content = refreshMarkdownTocIfPresent(mergeWysiwygBodyIntoSource(active.sourceText, markdownBody));
      htmlDraftsRef.current.delete(active.pathRel);
      updateOpenDocs((docs) =>
        docs.map((doc) =>
          doc.pathRel === active.pathRel
            ? {
                ...doc,
                sourceText: content,
                mode,
                dirty: doc.dirty || content !== doc.sourceText,
                pendingHtml: undefined
              }
            : doc
        )
      );
    } else {
      updateOpenDocs((docs) => docs.map((doc) => (doc.pathRel === active.pathRel ? { ...doc, mode } : doc)));
    }
    setEditorModeSetting(mode);
    editorModeSettingRef.current = mode;
  }

  async function updateAppSetting(key: string, value: unknown) {
    const next = await window.nolia.settings.set({ key, value });
    setAppSettings(next);
    if (key === "editorMode" && isEditorMode(value) && currentDocument()) {
      await setActiveMode(value);
    }
  }

  async function setPluginEnabled(pluginId: string, enabled: boolean) {
    if (!appSettings) {
      return;
    }
    const manifest = allExtensionManifests.find((item) => item.id === pluginId);
    if (manifest?.required) {
      return;
    }
    if (manifest && !manifest.builtIn && window.nolia.plugins) {
      setPluginDescriptors(await window.nolia.plugins.setEnabled({ pluginId, enabled }));
      setAppSettings(await window.nolia.settings.get());
      return;
    }
    const nextPlugins = {
      ...appSettings.plugins,
      [pluginId]: {
        ...(appSettings.plugins[pluginId] ?? {}),
        enabled
      }
    };
    const next = await window.nolia.settings.set({ key: "plugins", value: nextPlugins });
    setAppSettings(next);
  }

  async function acceptPluginPermissions(pluginId: string) {
    if (!window.nolia.plugins) {
      return;
    }
    setPluginDescriptors(await window.nolia.plugins.acceptPermissions({ pluginId }));
    setAppSettings(await window.nolia.settings.get());
  }

  function registerPluginRuntimeContributions(pluginId: string, contributions: ExtensionContributions): Disposable {
    const manifest = allExtensionManifests.find((item) => item.id === pluginId);
    if (!manifest) {
      return { dispose: () => undefined };
    }
    assertPluginPermission(pluginId, "ui:contribute");
    assertPluginContributionScope(pluginId, contributions);
    const runtimeManifest: ExtensionManifest = {
      ...manifest,
      id: pluginId,
      name: `${manifest.name} Runtime`,
      required: false,
      enabledByDefault: true,
      contributes: contributions
    };
    setPluginRuntimeManifests((current) => [...current.filter((item) => item.id !== runtimeManifest.id), runtimeManifest]);
    return {
      dispose: () => {
        setPluginRuntimeManifests((current) => current.filter((item) => item.id !== runtimeManifest.id));
      }
    };
  }

  function registerPluginCommandHandler(pluginId: string, id: string, handler: () => void | Promise<void>): Disposable {
    assertPluginContributionScope(pluginId, { commands: [{ id, title: id }] });
    pluginCommandHandlersRef.current.set(id, handler);
    setPluginCommandIds((current) => (current.includes(id) ? current : [...current, id]));
    return {
      dispose: () => {
        pluginCommandHandlersRef.current.delete(id);
        setPluginCommandIds((current) => current.filter((commandId) => commandId !== id));
      }
    };
  }

  function registerPluginSidebarPanel(pluginId: string, id: string, render: PluginRenderProvider<PluginSidebarPanelContext>): Disposable {
    assertPluginPermission(pluginId, "ui:contribute");
    assertPluginContributionScope(pluginId, { sidebarPanels: [{ id, title: id }] });
    setPluginSidebarPanels((current) => new Map(current).set(id, render));
    return {
      dispose: () => {
        setPluginSidebarPanels((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }
    };
  }

  function registerPluginFileViewer(pluginId: string, id: string, render: PluginRenderProvider<PluginFileViewerContext>): Disposable {
    assertPluginPermission(pluginId, "ui:contribute");
    assertPluginContributionScope(pluginId, { fileViewers: [{ id, title: id }] });
    setPluginFileViewers((current) => new Map(current).set(id, { pluginId, render }));
    return {
      dispose: () => {
        setPluginFileViewers((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }
    };
  }

  function registerPluginFileEditor(pluginId: string, id: string, render: PluginRenderProvider<PluginFileEditorContext>): Disposable {
    assertPluginPermission(pluginId, "ui:contribute");
    assertPluginContributionScope(pluginId, { fileEditors: [{ id, title: id }] });
    setPluginFileEditors((current) => new Map(current).set(id, { pluginId, render }));
    return {
      dispose: () => {
        setPluginFileEditors((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }
    };
  }

  function registerPluginAttachmentExtractor(pluginId: string, id: string, handler: PluginAttachmentExtractorHandler): Disposable {
    assertPluginPermission(pluginId, "workspace:file:read");
    assertPluginContributionScope(pluginId, { aiExtractors: [{ id, title: id }] });
    pluginAttachmentExtractorsRef.current.set(id, { pluginId, handler });
    return {
      dispose: () => {
        pluginAttachmentExtractorsRef.current.delete(id);
      }
    };
  }

  function pluginIdForContribution(contributionId: string): string | undefined {
    return pluginDescriptors.find((descriptor) => descriptor.manifest && (contributionId === descriptor.pluginId || contributionId.startsWith(`${descriptor.pluginId}.`)))?.pluginId;
  }

  function assertPluginPermission(pluginId: string, permission: ExtensionPermission) {
    const manifest = pluginDescriptors.find((descriptor) => descriptor.pluginId === pluginId)?.manifest;
    if (!hasExtensionPermission(manifest, permission)) {
      throw new Error(`Plugin ${pluginId} lacks ${permission}`);
    }
  }

  function pluginHasPermission(pluginId: string, permission: ExtensionPermission): boolean {
    const manifest = pluginDescriptors.find((descriptor) => descriptor.pluginId === pluginId)?.manifest;
    return hasExtensionPermission(manifest, permission);
  }

  function assertNetworkPermission(pluginId: string, url: string) {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      throw new Error("Invalid network request URL");
    }
    if (!pluginHasPermission(pluginId, "network:request") && !pluginHasPermission(pluginId, `network:request:${host}`)) {
      throw new Error(`Plugin ${pluginId} lacks network permission for ${host}`);
    }
  }

  function assertPluginContributionScope(pluginId: string, contributions: ExtensionContributions) {
    const ids = [
      ...(contributions.commands?.map((item) => item.id) ?? []),
      ...(contributions.sidebarPanels?.map((item) => item.id) ?? []),
      ...(contributions.fileEditors?.map((item) => item.id) ?? []),
      ...(contributions.fileViewers?.map((item) => item.id) ?? []),
      ...(contributions.settings?.map((item) => item.id) ?? []),
      ...(contributions.markdownRenderers?.map((item) => item.id) ?? []),
      ...(contributions.markdownBlocks?.map((item) => item.id) ?? []),
      ...(contributions.editorExtensions?.map((item) => item.id) ?? []),
      ...(contributions.toolbarItems?.map((item) => item.id) ?? []),
      ...(contributions.importers?.map((item) => item.id) ?? []),
      ...(contributions.exporters?.map((item) => item.id) ?? []),
      ...(contributions.searchProviders?.map((item) => item.id) ?? []),
      ...(contributions.aiProviders?.map((item) => item.id) ?? []),
      ...(contributions.aiExtractors?.map((item) => item.id) ?? []),
      ...(contributions.aiCommands?.map((item) => item.id) ?? []),
      ...(contributions.automations?.map((item) => item.id) ?? [])
    ];
    for (const id of ids) {
      if (!id.startsWith(`${pluginId}.`) && id !== pluginId) {
        throw new Error(`Plugin ${pluginId} cannot register contribution ${id}`);
      }
    }
  }

  async function recordPluginFailure(pluginId: string, message: string) {
    if (!window.nolia.plugins?.recordFailure) {
      return;
    }
    setPluginDescriptors(await window.nolia.plugins.recordFailure({ pluginId, message }));
    setAppSettings(await window.nolia.settings.get());
  }

  function queueAutosave(pathRel: string) {
    const delay = appSettings?.autoSaveDelayMs ?? 800;
    const existing = autosaveTimers.current.get(pathRel);
    if (existing) {
      window.clearTimeout(existing);
    }
    autosaveTimers.current.set(
      pathRel,
      window.setTimeout(() => {
        autosaveTimers.current.delete(pathRel);
        if (activeResourceRef.current?.editorId && activeResourceRef.current.pathRel === pathRel) {
          void saveActivePluginEditorResource(pathRel);
          return;
        }
        void saveActiveDocument(pathRel);
      }, delay)
    );
  }

  function assertAiTargetClean(pathRel: string) {
    const openDoc = openDocsRef.current.find((doc) => doc.pathRel === pathRel);
    if (openDoc?.dirty) {
      throw new Error(tr("文件有未保存更改：{path}", { path: pathRel }));
    }
    const resource = activeResourceRef.current;
    if (resource?.pathRel === pathRel && resource.dirty) {
      throw new Error(tr("文件有未保存更改：{path}", { path: pathRel }));
    }
  }

  function pathTargetForAiChange(pathRel: string): RenameTarget {
    const node = findFileTreeNode(fileTree, pathRel);
    if (node?.kind === "directory") {
      return { pathRel, kind: "directory", name: node.name };
    }
    return {
      pathRel,
      kind: node?.kind === "markdown" || isMarkdownPath(pathRel) ? "file" : "resource",
      name: node?.name ?? fileNameFor(pathRel)
    };
  }

  function clearDeletedPathFromState(target: DeleteTarget | RenameTarget) {
    const isRemovedPath = (pathRel: string) =>
      target.kind === "directory"
        ? pathRel === target.pathRel || pathRel.startsWith(`${target.pathRel}/`)
        : pathRel === target.pathRel;

    updateOpenDocs((docs) => docs.filter((doc) => !isRemovedPath(doc.pathRel)));
    if (activePathRel && isRemovedPath(activePathRel)) {
      setActivePathRel(undefined);
    }
    setActiveResource((resource) => (resource && isRemovedPath(resource.pathRel) ? undefined : resource));
    setTreeSelection((selection) => (selection && isRemovedPath(selection.pathRel) ? undefined : selection));
    updateWorkspaceDocumentLists((item) => (isRemovedPath(item.pathRel) ? undefined : item));
    setFileClipboard((clipboard) => (clipboard && isRemovedPath(clipboard.pathRel) ? undefined : clipboard));
    for (const pathRel of htmlDraftsRef.current.keys()) {
      if (isRemovedPath(pathRel)) {
        htmlDraftsRef.current.delete(pathRel);
      }
    }
  }
}

function rightPanelTitle(view: RightPanelView, tr = createTranslator("zh-CN")): string {
  switch (view) {
    case "ai":
      return tr("AI 助手");
    case "details":
      return tr("详情");
    case "errors":
      return tr("诊断");
    case "outline":
    default:
      return tr("目录");
  }
}

function inferAiScope(command: AiCommandDefinition): AiEditorSnapshot["scope"] {
  if (command.defaultContext.includeWorkspaceResults) {
    return "workspace";
  }
  if (command.defaultContext.includeSelection) {
    return "selection";
  }
  if (command.defaultContext.includeCurrentDocument) {
    return command.scopes.includes("document") ? "document" : (command.scopes[0] ?? "document");
  }
  if (command.scopes.includes("workspace")) {
    return "workspace";
  }
  if (command.scopes.includes("selection")) {
    return "selection";
  }
  return command.scopes[0] ?? "document";
}

function aiContextOptionsForCommand(command: AiCommandDefinition | undefined, scope: AiEditorSnapshot["scope"]): AiContextRequestOptions {
  if (!command) {
    return {
      includeSelection: scope === "selection",
      includeCurrentDocument: scope === "selection" || scope === "document" || scope === "workspace",
      includeBacklinks: scope === "document" || scope === "workspace",
      includeAttachments: true,
      includeWebSearch: false
    };
  }
  return {
    includeSelection: Boolean(command.defaultContext.includeSelection),
    includeCurrentDocument: Boolean(command.defaultContext.includeCurrentDocument),
    includeBacklinks: Boolean(command.defaultContext.includeBacklinks),
    includeAttachments: Boolean(command.defaultContext.includeAttachments),
    includeWebSearch: false
  };
}

function makeAiMessageId(): string {
  return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function aiConversationStorageKey(workspaceId: string): string {
  return workspaceStorageKey(workspaceId, AI_CONVERSATION_STORAGE_NAME);
}

function aiContextApprovalStorageKey(workspaceId: string): string {
  return workspaceStorageKey(workspaceId, AI_CONTEXT_APPROVAL_STORAGE_NAME);
}

function shouldBypassAiContextApproval(pending: AiPendingContextApproval, rememberEnabled: boolean, workspaceId: string | undefined): boolean {
  if (pending.preview.items.length === 0) {
    return true;
  }
  if (!rememberEnabled || !workspaceId) {
    return false;
  }
  try {
    const remembered = JSON.parse(window.localStorage.getItem(aiContextApprovalStorageKey(workspaceId)) ?? "[]") as unknown;
    if (!Array.isArray(remembered)) {
      return false;
    }
    const rememberedKinds = new Set(remembered.filter((item): item is string => typeof item === "string"));
    return pending.preview.items.every((item) => rememberedKinds.has(item.kind));
  } catch {
    return false;
  }
}

function saveAiContextApproval(workspaceId: string, pending: AiPendingContextApproval) {
  const approvedKinds = [...new Set(
    pending.preview.items
      .filter((item) => !pending.excludedContextItemIds.includes(item.id))
      .map((item) => item.kind)
  )];
  window.localStorage.setItem(aiContextApprovalStorageKey(workspaceId), JSON.stringify(approvedKinds));
}

function readAiConversationHistory(workspaceId: string): AiPanelMessage[] {
  try {
    const raw = window.localStorage.getItem(aiConversationStorageKey(workspaceId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeStoredAiMessage).filter((message): message is AiPanelMessage => Boolean(message)).slice(-MAX_AI_LOCAL_CONVERSATION_MESSAGES);
  } catch {
    return [];
  }
}

function saveAiConversationHistory(workspaceId: string, messages: AiPanelMessage[]) {
  const serializableMessages = removeIncompleteAiMessages(messages)
    .filter((message) => message.status !== "pending")
    .map(normalizeStoredAiMessage)
    .filter((message): message is AiPanelMessage => Boolean(message))
    .slice(-MAX_AI_LOCAL_CONVERSATION_MESSAGES);
  if (serializableMessages.length === 0) {
    removeAiConversationHistory(workspaceId);
    return;
  }
  window.localStorage.setItem(aiConversationStorageKey(workspaceId), JSON.stringify(serializableMessages));
}

function removeIncompleteAiMessages(messages: AiPanelMessage[]): AiPanelMessage[] {
  const skippedIndexes = new Set<number>();
  messages.forEach((message, index) => {
    if (message.status !== "pending") {
      return;
    }
    skippedIndexes.add(index);
    const previous = messages[index - 1];
    if (previous?.role === "user" && previous.status === undefined) {
      skippedIndexes.add(index - 1);
    }
  });
  return messages.filter((_, index) => !skippedIndexes.has(index));
}

function removeAiConversationHistory(workspaceId: string) {
  window.localStorage.removeItem(aiConversationStorageKey(workspaceId));
}

function normalizeStoredAiMessage(value: unknown): AiPanelMessage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const message = value as Partial<AiPanelMessage>;
  if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") {
    return undefined;
  }
  if (typeof message.text !== "string") {
    return undefined;
  }
  if (message.status !== undefined && message.status !== "done" && message.status !== "error") {
    return undefined;
  }
  return {
    id: typeof message.id === "string" && message.id ? message.id : makeAiMessageId(),
    role: message.role,
    text: message.text,
    status: message.status,
    citations: Array.isArray(message.citations) ? message.citations.map(normalizeAiCitation).filter((citation): citation is AiCitation => Boolean(citation)).slice(0, 12) : undefined,
    commandName: typeof message.commandName === "string" ? message.commandName : undefined
  };
}

function normalizeAiCitation(value: unknown): AiCitation | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const citation = value as Partial<AiCitation>;
  if (typeof citation.contextItemId !== "string" || !citation.contextItemId) {
    return undefined;
  }
  return {
    contextItemId: citation.contextItemId,
    pathRel: typeof citation.pathRel === "string" ? citation.pathRel : undefined,
    title: typeof citation.title === "string" ? citation.title : undefined,
    line: typeof citation.line === "number" && Number.isFinite(citation.line) ? citation.line : undefined,
    excerpt: typeof citation.excerpt === "string" ? citation.excerpt : undefined
  };
}

function isAiChangeApplicable(change: AiChangePlanOperation): boolean {
  return change.status === "pending" || change.status === "accepted";
}

function aiChangeResultPath(change: AiChangePlanOperation): string {
  return change.action === "rename" && change.targetPathRel ? `${change.pathRel} -> ${change.targetPathRel}` : change.pathRel;
}

function aiChangeActionLabel(action: AiChangePlanOperation["action"], tr = createTranslator("zh-CN")): string {
  switch (action) {
    case "create":
      return tr("创建文件");
    case "modify":
      return tr("修改文件");
    case "rename":
      return tr("重命名文件");
    case "delete":
      return tr("删除文件");
    default:
      return action;
  }
}

function aiChangePreview(change: AiChangePlanOperation, tr = createTranslator("zh-CN")): string {
  if (change.diff?.trim()) {
    return change.diff;
  }
  if (change.action === "rename") {
    return tr("从 {source} 重命名为 {target}", { source: change.pathRel, target: change.targetPathRel ?? "" });
  }
  if (change.action === "delete") {
    return tr("移到废纸篓：{path}", { path: change.pathRel });
  }
  return change.content ?? "";
}

function isAiInsightApplicable(insight: AiInsightItem): boolean {
  return insight.kind === "tag" || insight.kind === "backlink" || insight.kind === "topic";
}

function markdownForAiInsight(insight: AiInsightItem): string | undefined {
  if (insight.kind === "tag" && insight.target) {
    return `#${insight.target.replace(/^#/, "")}`;
  }
  if ((insight.kind === "backlink" || insight.kind === "topic") && insight.target) {
    return `[[${insight.target.replace(/^\[\[|\]\]$/g, "")}]]`;
  }
  return undefined;
}

function appendUniqueMarkdownHint(sourceText: string, snippet: string): string {
  if (sourceText.includes(snippet)) {
    return sourceText;
  }
  return `${sourceText.trimEnd()}\n\n${snippet}\n`;
}

function updateAiChangeStatus(
  plan: AiChangePlanState | undefined,
  changeId: string,
  status: AiChangePlanOperation["status"],
  message?: string
): AiChangePlanState | undefined {
  if (!plan) {
    return plan;
  }
  return {
    ...plan,
    operations: plan.operations.map((change) => change.id === changeId ? { ...change, status, message } : change)
  };
}

function titleFromMarkdown(markdown: string): string | undefined {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  return heading?.[1]?.trim().replace(/[#*_`[\]]+/g, "") || undefined;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function optionalNumber(value: string, min: number, max: number): number | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.min(max, Math.max(min, parsed));
}

function optionalInteger(value: string, min: number, max: number): number | undefined {
  const parsed = optionalNumber(value, min, max);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

function uniqueProviderId(providers: Record<string, AiProviderConfig>, base: string): string {
  let index = 1;
  let candidate = base;
  while (providers[candidate]) {
    index += 1;
    candidate = `${base}-${index}`;
  }
  return candidate;
}

function uniqueCommandId(commands: Record<string, AiCommandDefinition>, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "") || "command";
  let index = 1;
  let candidate = `user.${slug}`;
  while (commands[candidate]) {
    index += 1;
    candidate = `user.${slug}-${index}`;
  }
  return candidate;
}

function parseAiListSetting(value: string): string[] {
  return [...new Set(
    value
      .split(/[\n,]/g)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function formatAiListSetting(value: string[]): string {
  return value.join("\n");
}

function toggleAiCommandScope(scopes: AiCommandDefinition["scopes"], scope: AiEditorSnapshot["scope"]): AiCommandDefinition["scopes"] {
  if (scopes.includes(scope)) {
    const nextScopes = scopes.filter((item) => item !== scope);
    return nextScopes.length ? nextScopes : [scope];
  }
  return [...scopes, scope];
}

function aiCommandSourceLabel(command: AiCommandDefinition, tr = createTranslator("zh-CN")): string {
  switch (command.source) {
    case "builtin":
      return tr("系统预置");
    case "workspace":
      return tr("工作区命令");
    case "plugin":
      return command.pluginId ? `${tr("插件命令")} · ${command.pluginId}` : tr("插件命令");
    case "user":
    default:
      return tr("用户自定义");
  }
}

function aiApplyModeLabel(mode: AiApplyMode, tr = createTranslator("zh-CN")): string {
  switch (mode) {
    case "copy":
      return tr("复制");
    case "insert":
      return tr("插入");
    case "replace":
      return tr("替换选区");
    case "append":
      return tr("追加");
    case "new-document":
      return tr("新建笔记");
    case "diff":
      return tr("变更计划");
    case "answer":
    default:
      return tr("仅回答");
  }
}

function formatAiCommandMeta(command: AiCommandDefinition, tr = createTranslator("zh-CN")): string {
  const scopes = command.scopes.map((scope) => aiScopeLabel(scope, tr)).join(" / ");
  return `${scopes} · ${tr("默认应用：{mode}", { mode: aiApplyModeLabel(command.defaultApplyMode, tr) })}`;
}

function refreshMarkdownTocIfPresent(source: string): string {
  return hasMarkdownToc(source) ? updateMarkdownToc(source) : source;
}

function editorModeLabel(mode: OpenDocumentTab["mode"], tr = createTranslator("zh-CN")): string {
  switch (mode) {
    case "source":
      return tr("源码");
    case "split":
      return tr("分屏");
    case "wysiwyg":
    default:
      return tr("编辑");
  }
}

function errorMessageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function containsRelatedTarget(event: Pick<ReactDragEvent<HTMLElement>, "currentTarget" | "relatedTarget">): boolean {
  const relatedTarget = event.relatedTarget;
  return relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget);
}

function resourceCategoryFor(pathRel: string): ResourceCategory {
  const ext = fileExtension(pathRel);
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"].includes(ext)) {
    return "image";
  }
  if (ext === ".pdf") {
    return "pdf";
  }
  if ([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"].includes(ext)) {
    return "audio";
  }
  if ([".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"].includes(ext)) {
    return "video";
  }
  if ([".drawio", ".dio"].includes(ext)) {
    return "diagram";
  }
  if ([".zip", ".tar", ".gz", ".tgz", ".7z", ".rar"].includes(ext)) {
    return "archive";
  }
  if ([".txt", ".csv", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".js", ".jsx", ".ts", ".tsx", ".log"].includes(ext)) {
    return "text";
  }
  return "other";
}

function resourceKindLabel(category: ResourceCategory, tr = createTranslator("zh-CN")): string {
  switch (category) {
    case "image":
      return tr("图片预览");
    case "pdf":
      return tr("PDF 预览");
    case "audio":
      return tr("音频预览");
    case "video":
      return tr("视频预览");
    case "diagram":
      return tr("draw.io 资源");
    case "archive":
      return tr("压缩包资源");
    case "text":
      return tr("文本资源");
    case "other":
    default:
      return tr("资源文件");
  }
}

function resourceEditorKindLabel(resource: ActiveResource, tr = createTranslator("zh-CN")): string {
  if (resource.editorId === "json.editor.fileEditor") {
    return tr("JSON 编辑器");
  }
  if (resource.editorId === "text.editor.fileEditor") {
    return tr("文本编辑器");
  }
  return resourceKindLabel(resource.category ?? resourceCategoryFor(resource.pathRel), tr);
}

function isTextLikeResourceCategory(category: ResourceCategory): boolean {
  return category === "text" || category === "diagram";
}

function binaryDataToArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  const source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy.buffer;
}

function resourcePreviewIcon(category: ResourceCategory) {
  if (category === "image") {
    return <FileImage size={24} />;
  }
  if (category === "audio") {
    return <FileAudio size={24} />;
  }
  if (category === "video") {
    return <FileVideo size={24} />;
  }
  if (category === "archive") {
    return <FileArchive size={24} />;
  }
  return <FileQuestion size={24} />;
}

function assetUrl(workspaceId: string, pathRel: string): string {
  return `nolia-asset://workspace/${encodeURIComponent(workspaceId)}/${pathRel.split("/").map(encodeURIComponent).join("/")}`;
}

function rewritePreviewAssets(html: string, document: OpenDocumentTab, workspaceId?: string): string {
  if (document.sourceKind === "external") {
    return rewriteExternalPreviewAssets(html, document.filePath ?? document.pathRel);
  }
  return rewriteWorkspacePreviewAssets(html, workspaceId, document.pathRel);
}

function rewriteWorkspacePreviewAssets(html: string, workspaceId?: string, documentPathRel?: string): string {
  if (!workspaceId) {
    return html;
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("img[src]").forEach((node) => {
    const image = node instanceof HTMLImageElement ? node : undefined;
    const source = image?.getAttribute("src");
    const pathRel = source ? workspaceAssetPathFromSource(source, documentPathRel) : undefined;
    if (!image || !pathRel) {
      return;
    }
    image.dataset.markdownSrc = source ?? pathRel;
    image.src = assetUrl(workspaceId, pathRel);
  });
  return template.innerHTML;
}

function rewriteExternalPreviewAssets(html: string, documentPath: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("img[src]").forEach((node) => {
    const image = node instanceof HTMLImageElement ? node : undefined;
    const source = image?.getAttribute("src");
    const asset = source ? externalAssetPathFromSource(source, documentPath) : undefined;
    if (!image || !asset) {
      return;
    }
    image.dataset.markdownSrc = source ?? asset.markdownSource;
    image.src = externalAssetUrl(asset.absolutePath, asset.markdownSource);
  });
  return template.innerHTML;
}

function workspaceAssetPathFromSource(source: string, documentPathRel?: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(trimmed)) {
    return undefined;
  }
  const match = trimmed.match(/^([^?#]*)([?#][\s\S]*)?$/);
  const pathPart = match?.[1] ?? trimmed;
  const suffix = match?.[2] ?? "";
  const baseDir = dirnameRel(documentPathRel ?? "");
  const joinedPath = pathPart.startsWith("/") ? pathPart.slice(1) : [baseDir, pathPart].filter(Boolean).join("/");
  const normalizedPath = normalizeWorkspaceAssetPath(joinedPath);
  return normalizedPath ? `${decodeWorkspaceAssetPath(normalizedPath)}${suffix}` : undefined;
}

function workspaceTargetFromMarkdownHref(href: string, documentPathRel?: string): MarkdownWorkspaceTarget | undefined {
  const trimmed = stripMarkdownHrefWrapper(href);
  if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) {
    return undefined;
  }
  const { pathPart, fragment } = splitMarkdownHref(trimmed);
  if (!pathPart && fragment) {
    return documentPathRel ? { pathRel: documentPathRel, fragment } : undefined;
  }
  if (!pathPart) {
    return undefined;
  }
  const baseDir = dirnameRel(documentPathRel ?? "");
  const joinedPath = pathPart.startsWith("/") ? pathPart.slice(1) : [baseDir, pathPart].filter(Boolean).join("/");
  const normalizedPath = normalizeWorkspaceAssetPath(joinedPath);
  return normalizedPath ? { pathRel: decodeWorkspaceAssetPath(normalizedPath), fragment } : undefined;
}

function isExternalMarkdownHref(href: string): boolean {
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

function resolveWorkspaceFileTreeNode(pathRel: string, nodes: FileTreeNode[]): FileTreeNode | undefined {
  const candidates = workspacePathCandidates(pathRel);
  for (const candidate of candidates) {
    const exact = findFileTreeNode(nodes, candidate);
    if (exact) {
      return exact;
    }
  }
  const allNodes = flattenFileTree(nodes);
  for (const candidate of candidates.map((value) => value.toLowerCase())) {
    const match = allNodes.find((node) => node.pathRel.toLowerCase() === candidate);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function resolveWikilinkWorkspaceTarget(target: Extract<MarkdownOpenTarget, { kind: "wikilink" }>, nodes: FileTreeNode[], documentPathRel?: string): MarkdownWorkspaceTarget | undefined {
  const parsed = parseWikilinkTarget(target.markdown, target.label);
  if (!parsed?.targetText) {
    return undefined;
  }
  const targetText = parsed.targetText.replace(/^\/+/, "");
  const pathLike = targetText.includes("/");
  const sameDirectoryTarget = documentPathRel ? [dirnameRel(documentPathRel), targetText].filter(Boolean).join("/") : targetText;
  const directCandidates = pathLike ? [targetText] : [sameDirectoryTarget, targetText];
  for (const candidate of directCandidates) {
    const node = resolveWorkspaceFileTreeNode(candidate, nodes);
    if (node?.kind === "markdown") {
      return { pathRel: node.pathRel, fragment: parsed.fragment };
    }
  }
  if (pathLike) {
    return undefined;
  }
  const normalizedTarget = normalizeWikilinkLookupKey(targetText);
  const markdownNodes = flattenFileTree(nodes).filter((node) => node.kind === "markdown");
  const sameName = markdownNodes.find((node) => normalizeWikilinkLookupKey(markdownFileStem(node.pathRel)) === normalizedTarget);
  return sameName ? { pathRel: sameName.pathRel, fragment: parsed.fragment } : undefined;
}

function labelForMarkdownOpenTarget(target: MarkdownOpenTarget): string {
  if (target.kind === "link") {
    return target.href;
  }
  if (target.kind === "image") {
    return target.src;
  }
  return target.label || target.markdown;
}

function headingIndexForReference(document: OpenDocumentTab, reference: string): number | undefined {
  const normalizedReference = normalizeMarkdownHeadingReference(reference);
  if (!normalizedReference) {
    return undefined;
  }
  const index = document.parsed.headings.findIndex((heading) => {
    const keys = [heading.id, heading.text, slugifyMarkdownHeadingId(heading.text)].map(normalizeMarkdownHeadingReference);
    return keys.includes(normalizedReference);
  });
  return index >= 0 ? index : undefined;
}

function normalizeMarkdownHeadingReference(value: string): string {
  const trimmed = decodeMarkdownUrlPart(value).trim().replace(/^#+/, "").replace(/^user-content-/i, "");
  return trimmed.toLowerCase();
}

function splitMarkdownHref(href: string): { pathPart: string; fragment?: string } {
  const hashIndex = href.indexOf("#");
  const pathAndQuery = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const rawFragment = hashIndex >= 0 ? href.slice(hashIndex + 1) : undefined;
  const queryIndex = pathAndQuery.indexOf("?");
  const rawPath = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
  const pathPart = decodeMarkdownUrlPart(rawPath);
  const fragment = rawFragment ? decodeMarkdownUrlPart(rawFragment) : undefined;
  return { pathPart, fragment };
}

function stripMarkdownHrefWrapper(href: string): string {
  const trimmed = href.trim();
  return trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1).trim() : trimmed;
}

function parseWikilinkTarget(markdown: string, fallbackLabel: string): { targetText: string; fragment?: string } | undefined {
  const raw = markdown.match(/^\s*\[\[([^\]\n]+)\]\]\s*$/)?.[1] ?? fallbackLabel;
  const [targetWithHeading] = raw.split("|");
  const hashIndex = targetWithHeading.indexOf("#");
  const targetText = (hashIndex >= 0 ? targetWithHeading.slice(0, hashIndex) : targetWithHeading).trim();
  const fragment = hashIndex >= 0 ? targetWithHeading.slice(hashIndex + 1).trim() : undefined;
  return targetText ? { targetText, fragment } : undefined;
}

function workspacePathCandidates(pathRel: string): string[] {
  const normalized = normalizeWorkspaceAssetPath(pathRel.split(/[?#]/)[0] ?? "");
  if (!normalized) {
    return [];
  }
  const decoded = decodeWorkspaceAssetPath(normalized);
  if (fileExtension(decoded)) {
    return [decoded];
  }
  return [decoded, `${decoded}.md`, `${decoded}.markdown`, `${decoded}.mdown`];
}

function flattenFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  const result: FileTreeNode[] = [];
  const visit = (items: FileTreeNode[]) => {
    items.forEach((item) => {
      result.push(item);
      if (item.children) {
        visit(item.children);
      }
    });
  };
  visit(nodes);
  return result;
}

function markdownFileStem(pathRel: string): string {
  return fileNameFor(pathRel).replace(/\.(?:md|markdown|mdown)$/i, "");
}

function normalizeWikilinkLookupKey(value: string): string {
  return decodeMarkdownUrlPart(value).trim().replace(/\.(?:md|markdown|mdown)$/i, "").toLowerCase();
}

function decodeMarkdownUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function externalAssetPathFromSource(source: string, documentPath: string): { absolutePath: string; markdownSource: string } | undefined {
  const trimmed = source.trim();
  if (!trimmed || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(trimmed)) {
    return undefined;
  }
  const match = trimmed.match(/^([^?#]*)([?#][\s\S]*)?$/);
  const pathPart = match?.[1] ?? trimmed;
  const documentDir = externalDirname(documentPath);
  const decodedPath = decodeExternalPath(pathPart);
  const absolutePath = normalizeAbsoluteExternalPath(decodedPath.startsWith("/") ? decodedPath : `${documentDir}/${decodedPath}`);
  if (!absolutePath || !isExternalPathInsideDir(documentDir, absolutePath)) {
    return undefined;
  }
  return {
    absolutePath,
    markdownSource: trimmed
  };
}

function externalAssetUrl(absolutePath: string, markdownSource: string): string {
  const encodedPath = absolutePath.split("/").map(encodeURIComponent).join("/");
  return `nolia-asset://external${encodedPath}?markdown=${encodeURIComponent(markdownSource)}`;
}

function externalDirname(filePath: string): string {
  const normalized = normalizeAbsoluteExternalPath(filePath) ?? filePath;
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function decodeExternalPath(value: string): string {
  return value
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function normalizeAbsoluteExternalPath(value: string): string | undefined {
  const absolute = value.startsWith("/");
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        return undefined;
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

function isExternalPathInsideDir(directory: string, filePath: string): boolean {
  const normalizedDir = directory.endsWith("/") ? directory : `${directory}/`;
  return filePath.startsWith(normalizedDir);
}

function dirnameRel(pathRel: string): string {
  const normalized = normalizeWorkspaceAssetPath(pathRel) ?? "";
  return normalized.includes("/") ? normalized.split("/").slice(0, -1).join("/") : "";
}

function normalizeWorkspaceAssetPath(pathRel: string): string | undefined {
  const parts: string[] = [];
  for (const part of pathRel.split(/[\\/]+/)) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (!parts.length) {
        return undefined;
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function decodeWorkspaceAssetPath(pathRel: string): string {
  try {
    return pathRel
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");
  } catch {
    return pathRel;
  }
}

function fileExtension(pathRel: string): string {
  return pathRel.toLowerCase().split(/[?#]/)[0]?.match(/\.[^./]+$/)?.[0] ?? "";
}

function isMarkdownPath(pathRel: string): boolean {
  return [".md", ".markdown", ".mdown"].includes(fileExtension(pathRel));
}

function formatFileSize(size: number, locale?: ResolvedLocale): string {
  if (locale) {
    return formatLocalizedFileSize(locale, size);
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function editorWidthToCss(width: AppSettings["editorWidth"]): string {
  switch (width) {
    case "narrow":
      return "clamp(320px, calc(100% - 160px), 700px)";
    case "medium":
      return "clamp(420px, calc(100% - 96px), 880px)";
    case "wide":
      return "clamp(520px, calc(100% - 48px), 1120px)";
    case "full":
    default:
      return "100%";
  }
}

function fontSizeToCss(size: AppSettings["fontSize"]): string {
  switch (size) {
    case "small":
      return "13px";
    case "large":
      return "16px";
    case "extraLarge":
      return "18px";
    case "medium":
    default:
      return "14px";
  }
}

function isEditorMode(value: unknown): value is EditorMode {
  return value === "wysiwyg" || value === "source" || value === "split";
}

function resolveThemeId(theme: string, systemPrefersDark: boolean): ResolvedThemeId {
  if (theme === "dark" || theme === "paper" || theme === "technical") {
    return theme;
  }
  return theme === "system" && systemPrefersDark ? "dark" : "light";
}

function readStoredLeftPanelWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_LEFT_PANEL_WIDTH;
  }
  const storedValue = window.localStorage.getItem(LEFT_PANEL_WIDTH_STORAGE_KEY);
  if (!storedValue) {
    return DEFAULT_LEFT_PANEL_WIDTH;
  }
  const stored = Number(storedValue);
  return Number.isFinite(stored) ? clampLeftPanelWidth(stored) : DEFAULT_LEFT_PANEL_WIDTH;
}

function readStoredRightPanelWidth(): number {
  if (typeof window === "undefined") {
    return DEFAULT_RIGHT_PANEL_WIDTH;
  }
  const storedValue = window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
  if (!storedValue) {
    return DEFAULT_RIGHT_PANEL_WIDTH;
  }
  const stored = Number(storedValue);
  return Number.isFinite(stored) ? clampRightPanelWidth(stored) : DEFAULT_RIGHT_PANEL_WIDTH;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  const storedValue = window.localStorage.getItem(key);
  if (storedValue === "true") {
    return true;
  }
  if (storedValue === "false") {
    return false;
  }
  return fallback;
}

function clampLeftPanelWidth(width: number): number {
  return Math.min(MAX_LEFT_PANEL_WIDTH, Math.max(MIN_LEFT_PANEL_WIDTH, Math.round(width)));
}

function clampRightPanelWidth(width: number): number {
  return Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, Math.round(width)));
}

function clampSplitLeftPercent(percent: number): number {
  return Math.min(MAX_SPLIT_LEFT_PERCENT, Math.max(MIN_SPLIT_LEFT_PERCENT, Math.round(percent)));
}

function statusBarMessage(message: string, tr = createTranslator("zh-CN")): string {
  if (
    message === "就绪" ||
    message === "Ready" ||
    /^已打开\s+/.test(message) ||
    /^Opened\s+/.test(message) ||
    /^已用\s+.+\s+打开\s+/.test(message) ||
    /^Opened\s+.+\s+with\s+/.test(message)
  ) {
    return tr("就绪");
  }
  if (/^已保存\s+/.test(message) || /^Saved\s+/.test(message)) {
    return tr("已保存");
  }
  return message;
}

function commandLabel(commandId: string, fallback: string, state: { immersiveMode: boolean; toolbarVisible: boolean; lineNumbersVisible: boolean }, tr = createTranslator("zh-CN")): string {
  if (commandId === "view.immersive.toggle") {
    return state.immersiveMode ? tr("退出沉浸式编辑") : tr("进入沉浸式编辑");
  }
  if (commandId === "view.toolbar.toggle") {
    return state.toolbarVisible ? tr("隐藏工具栏") : tr("显示工具栏");
  }
  if (commandId === "view.lineNumbers.toggle") {
    return state.lineNumbersVisible ? tr("隐藏行号") : tr("显示行号");
  }
  return fallback;
}

function revealInFileManagerLabel(platform: NodeJS.Platform | undefined, tr = createTranslator("zh-CN")): string {
  if (platform === "win32") {
    return tr("在资源管理器中显示");
  }
  if (platform === "darwin") {
    return tr("在访达中显示");
  }
  return tr("在文件管理器中显示");
}

function archiveResourceDescription(platform: NodeJS.Platform | undefined, tr = createTranslator("zh-CN")): string {
  if (platform === "win32") {
    return tr("压缩包不会在笔记内解压预览，可以用系统应用打开或在资源管理器中查看。");
  }
  if (platform === "darwin") {
    return tr("压缩包不会在笔记内解压预览，可以用系统应用打开或在访达中查看。");
  }
  return tr("压缩包不会在笔记内解压预览，可以用系统应用打开或在文件管理器中查看。");
}

function isExtensionManifest(value: ExtensionManifest | undefined): value is ExtensionManifest {
  return Boolean(value);
}

function dedupeExtensionManifests(manifests: ExtensionManifest[]): ExtensionManifest[] {
  const byId = new Map<string, ExtensionManifest>();
  for (const manifest of manifests) {
    if (!byId.has(manifest.id)) {
      byId.set(manifest.id, manifest);
    }
  }
  return [...byId.values()].sort((left, right) => {
    if (left.builtIn !== right.builtIn) {
      return left.builtIn ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function sidebarPanelIcon(panel: SidebarPanelContribution) {
  switch (panel.icon) {
    case "Clock3":
      return <Clock3 size={18} />;
    case "FolderOpen":
      return <FolderOpen size={18} />;
    case "Star":
      return <Star size={18} />;
    case "Search":
      return <Search size={18} />;
    case "Link2":
      return <Link2 size={18} />;
    default:
      return <FolderOpen size={18} />;
  }
}

function NewNoteDialog({
  open,
  kind,
  value,
  parentPath,
  onChange,
  onCancel,
  onSubmit
}: {
  open: boolean;
  kind: NewItemKind;
  value: string;
  parentPath: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { tr } = useRendererI18n();
  if (!open) {
    return null;
  }
  const title = kind === "directory" ? tr("新建文件夹") : tr("新建笔记");
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} aria-label={kind === "directory" ? tr("取消新建文件夹") : tr("取消新建笔记")} onClick={onCancel} />
      <form
        className="modal-surface"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="modal-copy">
          <strong>{title}</strong>
          {parentPath ? <p>{parentPath}</p> : null}
        </div>
        <label className="modal-field">
          <span>{kind === "directory" ? tr("文件夹名称") : tr("笔记名称")}</span>
          <input value={value} autoFocus onChange={(event) => onChange(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            {tr("取消")}
          </button>
          <button type="submit" className="primary-button">
            {tr("创建")}
          </button>
        </div>
      </form>
    </div>
  );
}

function RenameDialog({
  target,
  value,
  onChange,
  onCancel,
  onSubmit
}: {
  target?: RenameTarget;
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { tr } = useRendererI18n();
  if (!target) {
    return null;
  }
  const title = target.kind === "directory" ? tr("重命名文件夹") : target.kind === "resource" ? tr("重命名资源") : tr("重命名笔记");
  const fieldLabel = target.kind === "directory" ? tr("文件夹名称") : target.kind === "resource" ? tr("资源名称") : tr("笔记名称");
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} aria-label={tr("取消重命名")} onClick={onCancel} />
      <form
        className="modal-surface"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="modal-copy">
          <strong>{title}</strong>
          <p>{target.pathRel}</p>
        </div>
        <label className="modal-field">
          <span>{fieldLabel}</span>
          <input value={value} autoFocus onChange={(event) => onChange(event.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            {tr("取消")}
          </button>
          <button type="submit" className="primary-button">
            {tr("保存")}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { tr } = useRendererI18n();
  if (!open) {
    return null;
  }
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} aria-label={tr("取消")} onClick={onCancel} />
      <div className="modal-surface">
        <div className="modal-copy">
          <strong>{title}</strong>
          <p>{message}</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            {tr("取消")}
          </button>
          <button type="button" className="primary-button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function MoveDialog({
  dialog,
  folders,
  onChangeDestination,
  onCancel,
  onSubmit
}: {
  dialog?: MoveDialogState;
  folders: Array<{ pathRel: string; label: string }>;
  onChangeDestination: (pathRel: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { tr } = useRendererI18n();
  if (!dialog) {
    return null;
  }
  const title = dialog.target.kind === "directory" ? tr("移动文件夹") : dialog.target.kind === "resource" ? tr("移动资源") : tr("移动文件");
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} aria-label={tr("取消移动")} onClick={onCancel} />
      <form
        className="modal-surface"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="modal-copy">
          <strong>{title}</strong>
          <p>{dialog.target.pathRel}</p>
        </div>
        <label className="modal-field">
          <span>{tr("目标文件夹")}</span>
          <select value={dialog.destinationPath} autoFocus onChange={(event) => onChangeDestination(event.target.value)}>
            {folders.map((folder) => (
              <option key={folder.pathRel || "__root__"} value={folder.pathRel}>
                {folder.label}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            {tr("取消")}
          </button>
          <button type="submit" className="primary-button">
            {tr("移动")}
          </button>
        </div>
      </form>
    </div>
  );
}

function TreeContextMenu({
  menu,
  onClose,
  fileClipboard,
  isFavorite,
  onCopyFile,
  onDuplicateFile,
  onPasteFile,
  onMove,
  onToggleFavorite,
  onRename,
  onDelete
}: {
  menu?: { x: number; y: number; target: RenameTarget };
  onClose: () => void;
  fileClipboard?: FileClipboard;
  isFavorite: (pathRel: string) => boolean;
  onCopyFile: (target: RenameTarget) => void;
  onDuplicateFile: (target: RenameTarget) => void;
  onPasteFile: (target: RenameTarget) => void;
  onMove: (target: RenameTarget) => void;
  onToggleFavorite: (target: RenameTarget) => void;
  onRename: (target: RenameTarget) => void;
  onDelete: (target: DeleteTarget) => void;
}) {
  const { tr } = useRendererI18n();
  const [menuRef, menuStyle] = useFloatingMenuPosition(menu, { width: 210, height: 236 });
  useEffect(() => {
    if (!menu) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }
  const run = (action: () => void) => {
    action();
    onClose();
  };
  const canFavorite = menu.target.kind === "file";
  const favorite = canFavorite && isFavorite(menu.target.pathRel);
  const canPaste = menu.target.kind === "directory" && Boolean(fileClipboard);
  const isDirectory = menu.target.kind === "directory";
  const isResource = menu.target.kind === "resource";
  return (
    <>
      <button type="button" className="context-backdrop" aria-label={tr("关闭右键菜单")} onClick={onClose} />
      <div ref={menuRef} className="context-menu" role="menu" style={menuStyle}>
        {canFavorite ? (
          <>
            <button type="button" role="menuitem" onClick={() => run(() => onCopyFile(menu.target))}>
              <Copy size={14} /> {tr("复制")}
            </button>
            <button type="button" role="menuitem" onClick={() => run(() => onDuplicateFile(menu.target))}>
              <Files size={14} /> {tr("创建副本")}
            </button>
            <button type="button" role="menuitem" onClick={() => run(() => onMove(menu.target))}>
              <Move size={14} /> {tr("移动到...")}
            </button>
            <span className="context-menu-separator" />
            <button type="button" role="menuitem" onClick={() => run(() => onToggleFavorite(menu.target))}>
              <Star size={14} fill={favorite ? "currentColor" : "none"} /> {favorite ? tr("取消收藏") : tr("收藏")}
            </button>
            <span className="context-menu-separator" />
          </>
        ) : isDirectory ? (
          <>
            <button type="button" role="menuitem" disabled={!canPaste} onClick={() => run(() => onPasteFile(menu.target))}>
              <ClipboardPaste size={14} /> {tr("粘贴到此处")}
            </button>
            <button type="button" role="menuitem" onClick={() => run(() => onMove(menu.target))}>
              <Move size={14} /> {tr("移动到...")}
            </button>
            <span className="context-menu-separator" />
          </>
        ) : isResource ? (
          <>
            <button type="button" role="menuitem" onClick={() => run(() => onMove(menu.target))}>
              <Move size={14} /> {tr("移动到...")}
            </button>
            <span className="context-menu-separator" />
          </>
        ) : null}
        <button type="button" role="menuitem" onClick={() => run(() => onRename(menu.target))}>
          <Pencil size={14} /> {tr("重命名")}
        </button>
        <button type="button" role="menuitem" className="is-danger" onClick={() => run(() => onDelete(menu.target))}>
          <Trash2 size={14} /> {tr("删除")}
        </button>
      </div>
    </>
  );
}

function CreateItemMenu({
  menu,
  onClose,
  onCreate
}: {
  menu?: CreateMenuState;
  onClose: () => void;
  onCreate: (kind: NewItemKind, parentPath: string) => void;
}) {
  const { tr } = useRendererI18n();
  const [menuRef, menuStyle] = useFloatingMenuPosition(menu, { width: 180, height: 84 });
  useEffect(() => {
    if (!menu) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }
  const run = (kind: NewItemKind) => {
    onCreate(kind, menu.parentPath);
    onClose();
  };
  return (
    <>
      <button type="button" className="context-backdrop" aria-label={tr("关闭新建菜单")} onClick={onClose} />
      <div ref={menuRef} className="context-menu create-menu" role="menu" style={menuStyle}>
        <button type="button" role="menuitem" onClick={() => run("file")}>
          <FilePlus size={14} /> {tr("新建笔记")}
        </button>
        <button type="button" role="menuitem" onClick={() => run("directory")}>
          <FolderPlus size={14} /> {tr("新建文件夹")}
        </button>
      </div>
    </>
  );
}

function useFloatingMenuPosition(
  menu: { x: number; y: number } | undefined,
  fallbackSize: { width: number; height: number }
): [RefObject<HTMLDivElement | null>, CSSProperties] {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(() => floatingMenuStyle(menu?.x ?? 0, menu?.y ?? 0, fallbackSize));

  useEffect(() => {
    if (!menu) {
      return;
    }
    const update = () => {
      const rect = menuRef.current?.getBoundingClientRect();
      setStyle(
        floatingMenuStyle(menu.x, menu.y, {
          width: rect?.width ?? fallbackSize.width,
          height: rect?.height ?? fallbackSize.height
        })
      );
    };
    update();
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, [fallbackSize.height, fallbackSize.width, menu?.x, menu?.y]);

  return [menuRef, style];
}

function floatingMenuStyle(x: number, y: number, size: { width: number; height: number }): CSSProperties {
  if (typeof window === "undefined") {
    return { left: x, top: y };
  }
  const maxLeft = Math.max(FLOATING_MENU_MARGIN, window.innerWidth - size.width - FLOATING_MENU_MARGIN);
  const maxTop = Math.max(FLOATING_MENU_MARGIN, window.innerHeight - size.height - FLOATING_MENU_MARGIN);
  return {
    left: Math.max(FLOATING_MENU_MARGIN, Math.min(x, maxLeft)),
    top: Math.max(FLOATING_MENU_MARGIN, Math.min(y, maxTop))
  };
}

function AppNav({
  sidebarView,
  panels,
  onChange,
  onOpenOutline,
  onOpenAi,
  onToggleSettings,
  activeRightPanel,
  settingsOpen
}: {
  sidebarView: SidebarView;
  panels: SidebarPanelContribution[];
  onChange: (view: SidebarView) => void;
  onOpenOutline: () => void;
  onOpenAi: () => void;
  onToggleSettings: () => void;
  activeRightPanel?: RightPanelView;
  settingsOpen: boolean;
}) {
  const { tr } = useRendererI18n();
  const items = panels.filter((panel) => panel.visibleInNav !== false);
  return (
    <nav className="app-nav" aria-label={tr("工作区导航")}>
      <div className="nav-avatar" role="img" aria-label="Nolia">
        <img className="nav-avatar-logo" src={noliaIconUrl} alt="" />
      </div>
      <div className="app-nav-main">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item${sidebarView === item.id ? " is-active" : ""}`}
            title={item.title}
            aria-label={item.title}
            onClick={() => onChange(item.id)}
          >
            {sidebarPanelIcon(item)}
            <span>{item.title}</span>
          </button>
        ))}
        <button type="button" className={`nav-item${activeRightPanel === "outline" ? " is-active" : ""}`} title={tr("目录")} aria-label={tr("目录")} onClick={onOpenOutline}>
          <List size={18} />
          <span>{tr("目录")}</span>
        </button>
        <button type="button" className={`nav-item${activeRightPanel === "ai" ? " is-active" : ""}`} title={tr("AI 助手")} aria-label={tr("AI 助手")} onClick={onOpenAi}>
          <Bot size={18} />
          <span>{tr("AI")}</span>
        </button>
      </div>
      <div className="app-nav-bottom">
        <button type="button" className={`nav-icon-button${settingsOpen ? " is-active" : ""}`} title={tr("设置")} aria-label={tr("设置")} onClick={onToggleSettings}>
          <Settings2 size={18} />
        </button>
      </div>
    </nav>
  );
}

function EditorTopBar({
  document,
  resource,
  workspaceName,
  mode,
  leftPanelCollapsed,
  canToggleLeft,
  isImmersive,
  isFavorite,
  onToggleLeft,
  onOpenOutline,
  onModeChange,
  onToggleFavorite
}: {
  document?: OpenDocumentTab;
  resource?: ActiveResource;
  workspaceName: string;
  mode: OpenDocumentTab["mode"];
  leftPanelCollapsed: boolean;
  canToggleLeft: boolean;
  isImmersive: boolean;
  isFavorite: boolean;
  onToggleLeft: () => void;
  onOpenOutline: () => void;
  onModeChange: (mode: OpenDocumentTab["mode"]) => void;
  onToggleFavorite: () => void;
}) {
  const { tr } = useRendererI18n();
  const activePath = document?.pathRel ?? resource?.pathRel;
  if (isImmersive && document) {
    const fileName = fileNameFor(document.pathRel);
    return (
      <div className="editor-topbar immersive-topbar">
        <div className="immersive-title" aria-label={tr("当前文件")} title={fileName}>
          <strong>{fileName}</strong>
        </div>
      </div>
    );
  }
  return (
    <div className="editor-topbar">
      <div className="editor-topbar-left">
        {canToggleLeft ? (
          <button type="button" className="icon-button compact" title={leftPanelCollapsed ? tr("展开左侧栏") : tr("收起左侧栏")} onClick={onToggleLeft}>
            {leftPanelCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        ) : null}
        <div className="breadcrumb" aria-label={tr("路径")}>
          <span>{workspaceName}</span>
          <ChevronRight size={14} />
          <span>{activePath ? parentPathFor(activePath, tr) : tr("未打开笔记")}</span>
          {activePath ? (
            <>
              <ChevronRight size={14} />
              <strong>{fileNameFor(activePath)}</strong>
            </>
          ) : null}
        </div>
      </div>
      <div className="editor-topbar-right">
        {document ? (
          <>
            {document.sourceKind !== "external" ? (
            <button
              type="button"
              className={`icon-button compact favorite-toggle${isFavorite ? " is-active" : ""}`}
              title={isFavorite ? tr("取消收藏") : tr("收藏文档")}
              aria-label={isFavorite ? tr("取消收藏") : tr("收藏文档")}
              onClick={onToggleFavorite}
            >
              <Star size={15} fill={isFavorite ? "currentColor" : "none"} />
            </button>
            ) : null}
            <div className="editor-topbar-outline-slot">
              <button type="button" className="outline-toggle-button" title={tr("目录")} aria-label={tr("目录")} onClick={onOpenOutline}>
                <List size={15} />
                <span>{tr("目录")}</span>
              </button>
            </div>
            <div className="segmented-control" aria-label={tr("编辑模式")}>
              {(["wysiwyg", "source", "split"] as const).map((item) => (
                <button key={item} type="button" className={mode === item ? "is-active" : ""} onClick={() => onModeChange(item)}>
                  {item === "wysiwyg" ? tr("编辑") : item === "source" ? tr("MD") : tr("分屏")}
                </button>
              ))}
            </div>
          </>
        ) : resource ? (
          <span className="resource-kind-pill">{resourceEditorKindLabel(resource, tr)}</span>
        ) : null}
      </div>
    </div>
  );
}

type EditorScrollSnapshot = {
  pathRel: string;
  ratio: number;
  top: number;
};

type EditorPaneHandle = {
  undoEdit: () => boolean;
  redoEdit: () => boolean;
  captureScrollForModeSwitch: () => void;
  jumpToHeading: (line: number, headingIndex: number) => boolean;
  captureAiSnapshot: (scope: AiEditorSnapshot["scope"]) => AiEditorSnapshot | undefined;
  applyAiText: (text: string, mode: AiApplyMode) => boolean;
};

const EditorPane = forwardRef<EditorPaneHandle, {
  document?: OpenDocumentTab;
  resource?: ActiveResource;
  html: string;
  platform?: NodeJS.Platform;
  workspaceId?: string;
  pluginFileViewers: Map<string, RegisteredPluginRenderer<PluginFileViewerContext>>;
  pluginFileEditors: Map<string, RegisteredPluginRenderer<PluginFileEditorContext>>;
  aiEnabled: boolean;
  aiCommands: AiCommandDefinition[];
  toolbarVisible: boolean;
  lineNumbersVisible: boolean;
  onRunAiCommand: (commandId: string) => void;
  onToggleLineNumbers: () => void;
  onSourceChange: (value: string) => void;
  onHtmlChange: (value: string) => void;
  onMarkdownPaste: (value: string) => void;
  onSelectionLengthChange: (count: number) => void;
  onOpenMarkdownTarget: (target: MarkdownOpenTarget) => void;
  onReadPluginFile: (pluginId: string, pathRel: string) => Promise<FileReadResponse>;
  onWritePluginFile: (pluginId: string, pathRel: string, content: string, baseHash?: string) => Promise<FileWriteResponse>;
  onReadPluginBinaryFile: (pluginId: string, pathRel: string) => Promise<FileBinaryReadResponse>;
  onWritePluginBinaryFile: (pluginId: string, pathRel: string, data: ArrayBuffer | ArrayBufferView, baseHash?: string) => Promise<FileWriteResponse>;
  onPluginEditorDirtyChange: (pathRel: string, dirty: boolean) => void;
  onPluginEditorSaved: (pathRel: string, result: FileWriteResponse) => void;
  onPluginEditorStatus: (message: string) => void;
  onRegisterPluginEditorSaveHandler: (pathRel: string, handler: () => Promise<void>) => () => void;
}>(function EditorPane(
  {
    document,
    resource,
    html,
    platform,
    workspaceId,
    pluginFileViewers,
    pluginFileEditors,
    aiEnabled,
    aiCommands,
    toolbarVisible,
    lineNumbersVisible,
    onRunAiCommand,
    onToggleLineNumbers,
    onSourceChange,
    onHtmlChange,
    onMarkdownPaste,
    onSelectionLengthChange,
    onOpenMarkdownTarget,
    onReadPluginFile,
    onWritePluginFile,
    onReadPluginBinaryFile,
    onWritePluginBinaryFile,
    onPluginEditorDirtyChange,
    onPluginEditorSaved,
    onPluginEditorStatus,
    onRegisterPluginEditorSaveHandler
  },
  ref
) {
  const { tr } = useRendererI18n();
  const editorPaneRootRef = useRef<HTMLDivElement>(null);
  const sourceEditorRef = useRef<ReactCodeMirrorRef>(null);
  const wysiwygEditorRef = useRef<WysiwygEditorHandle>(null);
  const textResourceEditorRef = useRef<TextResourceEditorHandle>(null);
  const splitPreviewRef = useRef<HTMLDivElement>(null);
  const splitScrollSyncLock = useRef<"source" | "preview" | undefined>(undefined);
  const pendingScrollRestoreRef = useRef<EditorScrollSnapshot | undefined>(undefined);
  const [splitLeftPercent, setSplitLeftPercent] = useState(DEFAULT_SPLIT_LEFT_PERCENT);
  const [sourceTableDialog, setSourceTableDialog] = useState<TableDialogState | undefined>();
  const sourceToolsActive = document?.mode === "source" || document?.mode === "split";
  const sourceEditorKey = document ? `${document.sourceKind ?? "workspace"}:${document.filePath ?? document.pathRel}` : "empty";
  const aiToolbarCommands = aiCommands.filter((command) => command.enabled && command.ui.editorToolbar);
  const aiContextMenuCommands = aiCommands.filter((command) => command.enabled && command.ui.contextMenu);
  const [aiContextMenu, setAiContextMenu] = useState<{ x: number; y: number } | undefined>();
  const aiToolbar = aiToolbarCommands.length ? (
    <AiToolbarMenu commands={aiToolbarCommands} enabled={aiEnabled} onRunCommand={onRunAiCommand} />
  ) : null;
  const openAiEditorContextMenu = (x: number, y: number) => {
    if (aiContextMenuCommands.length === 0) {
      return;
    }
    setAiContextMenu({ x, y });
  };
  const handleSourceEditorContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (aiContextMenuCommands.length === 0) {
      return;
    }
    event.preventDefault();
    sourceEditorRef.current?.view?.focus();
    openAiEditorContextMenu(event.clientX, event.clientY);
  };
  const insertSourceSnippet = (snippet: MarkdownSnippet) => insertSnippetIntoSourceEditor(sourceEditorRef, snippet);
  const insertOrUpdateSourceToc = () => {
    if (!document) {
      return;
    }
    if (hasMarkdownToc(document.sourceText)) {
      const nextSource = updateMarkdownToc(document.sourceText);
      if (nextSource !== document.sourceText) {
        onSourceChange(nextSource);
      }
      return;
    }
    insertSourceSnippet({
      before: `${createMarkdownTocBlock(document.sourceText, tr("目录"))}\n\n`,
      block: true
    });
  };
  const insertOrUpdateWysiwygToc = async (currentHtml: string) => {
    if (!document) {
      return;
    }
    const markdownBody = await htmlToMarkdown(currentHtml);
    const currentSource = mergeWysiwygBodyIntoSource(document.sourceText, markdownBody);
    if (!hasMarkdownToc(currentSource)) {
      return;
    }
    const nextSource = updateMarkdownToc(currentSource);
    if (nextSource !== document.sourceText || document.pendingHtml) {
      onSourceChange(nextSource);
    }
  };
  const dispatchSourceCommand = (command: (target: NonNullable<ReactCodeMirrorRef["view"]>) => boolean): boolean => {
    const view = sourceEditorRef.current?.view;
    if (!view) {
      return false;
    }
    const handled = command(view);
    view.focus();
    return handled;
  };
  const undoSourceEdit = () => {
    const view = sourceEditorRef.current?.view;
    if (!view || undoDepthCodeMirror(view.state) <= 0) {
      view?.focus();
      return Boolean(view);
    }
    return dispatchSourceCommand(undoCodeMirror);
  };
  const redoSourceEdit = () => {
    const view = sourceEditorRef.current?.view;
    if (!view || redoDepthCodeMirror(view.state) <= 0) {
      view?.focus();
      return Boolean(view);
    }
    return dispatchSourceCommand(redoCodeMirror);
  };
  const runHistoryCommand = (kind: "undo" | "redo"): boolean => {
    if (resource) {
      return kind === "undo" ? (textResourceEditorRef.current?.undoEdit() ?? false) : (textResourceEditorRef.current?.redoEdit() ?? false);
    }
    if (!document) {
      return false;
    }
    if (document.mode === "wysiwyg") {
      return kind === "undo" ? (wysiwygEditorRef.current?.undoEdit() ?? false) : (wysiwygEditorRef.current?.redoEdit() ?? false);
    }
    if (document.mode === "source" || document.mode === "split") {
      return kind === "undo" ? undoSourceEdit() : redoSourceEdit();
    }
    return false;
  };
  const captureAiSnapshot = (scope: AiEditorSnapshot["scope"]): AiEditorSnapshot | undefined => {
    if (!document) {
      return undefined;
    }
    const selectionText = sourceEditorRef.current?.view
      ? selectedSourceText(sourceEditorRef.current.view)
      : document.mode === "wysiwyg"
        ? wysiwygEditorRef.current?.captureAiSelection()
        : undefined;
    return {
      workspaceId,
      pathRel: document.pathRel,
      title: document.title,
      sourceText: document.sourceText,
      selectionText,
      scope: selectionText?.trim() && scope === "selection" ? "selection" : scope,
      dirty: document.dirty
    };
  };
  const applyAiTextToEditor = (text: string, mode: AiApplyMode): boolean => {
    if (mode !== "insert" && mode !== "replace" && mode !== "append") {
      return false;
    }
    if (!document) {
      return false;
    }
    if (document.mode === "wysiwyg") {
      return wysiwygEditorRef.current?.applyAiText(text, mode) ?? false;
    }
    const view = sourceEditorRef.current?.view;
    if (!view || (document.mode !== "source" && document.mode !== "split")) {
      return false;
    }
    const range = view.state.selection.main;
    const insertAt = mode === "append" ? view.state.doc.length : range.from;
    const replaceTo = mode === "replace" && !range.empty ? range.to : insertAt;
    const prefix = mode === "append" && view.state.doc.length > 0 ? "\n\n" : "";
    const inserted = `${prefix}${text}`;
    view.dispatch({
      changes: { from: insertAt, to: replaceTo, insert: inserted },
      selection: { anchor: insertAt + inserted.length },
      scrollIntoView: true
    });
    view.focus();
    return true;
  };
  useImperativeHandle(ref, () => ({
    undoEdit: () => runHistoryCommand("undo"),
    redoEdit: () => runHistoryCommand("redo"),
    captureScrollForModeSwitch: () => {
      if (!document) {
        return;
      }
      pendingScrollRestoreRef.current = captureEditorScrollSnapshot(
        document.pathRel,
        editorScrollElementForMode(document.mode, editorPaneRootRef.current, sourceEditorRef.current?.view?.scrollDOM, splitPreviewRef.current)
      );
    },
    jumpToHeading: (line: number, headingIndex: number) => {
      if (!document) {
        return false;
      }
      if (document.mode === "wysiwyg") {
        return wysiwygEditorRef.current?.scrollToHeading(headingIndex) ?? false;
      }
      if (document.mode === "split" || document.mode === "source") {
        return focusSourceEditorLine(sourceEditorRef, line);
      }
      return false;
    },
    captureAiSnapshot,
    applyAiText: applyAiTextToEditor
  }), [document?.mode, document?.pathRel, document?.sourceText, resource?.pathRel, workspaceId]);

  useLayoutEffect(() => {
    if (!document) {
      pendingScrollRestoreRef.current = undefined;
      return;
    }
    const snapshot = pendingScrollRestoreRef.current;
    if (!snapshot || snapshot.pathRel !== document.pathRel) {
      return;
    }

    let frame = 0;
    let attempts = 0;
    let cancelled = false;
    const restore = () => {
      if (cancelled) {
        return;
      }
      const scrollers = editorScrollElementsForMode(document.mode, editorPaneRootRef.current, sourceEditorRef.current?.view?.scrollDOM, splitPreviewRef.current);
      if (!scrollers.length) {
        attempts += 1;
        if (attempts < 10) {
          frame = window.requestAnimationFrame(restore);
        }
        return;
      }
      for (const scroller of scrollers) {
        restoreEditorScroll(scroller, snapshot);
      }
      attempts += 1;
      if (attempts < 5) {
        frame = window.requestAnimationFrame(restore);
        return;
      }
      pendingScrollRestoreRef.current = undefined;
    };
    frame = window.requestAnimationFrame(restore);
    return () => {
      cancelled = true;
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [document?.mode, document?.pathRel, html]);
  const insertSourceImage = async () => {
    if (!workspaceId || !document) {
      return;
    }
    const selected = await window.nolia.attachment.pickImage({ workspaceId });
    if (!selected.path) {
      return;
    }
    const attachment = await window.nolia.attachment.import({
      workspaceId,
      documentPathRel: document.pathRel,
      source: { path: selected.path }
    });
    insertSourceSnippet({ before: attachment.markdown, block: true });
  };
  const [sourceLinkDraft, setSourceLinkDraft] = useState<LinkDraft | undefined>();
  const openSourceLinkDialog = () => {
    const view = sourceEditorRef.current?.view;
    if (!view) {
      setSourceLinkDraft({ text: "", href: "https://" });
      return;
    }
    const range = view.state.selection.main;
    const selected = view.state.sliceDoc(range.from, range.to);
    setSourceLinkDraft({ text: selected, href: "https://" });
  };
  const insertSourceLink = (draft: LinkDraft) => {
    const view = sourceEditorRef.current?.view;
    const text = draft.text.trim();
    const href = draft.href.trim();
    if (!href) {
      setSourceLinkDraft(undefined);
      return;
    }
    if (!view) {
      setSourceLinkDraft(undefined);
      return;
    }
    const range = view.state.selection.main;
    const selected = view.state.sliceDoc(range.from, range.to);
    const label = text || selected || href;
    const markdown = `[${label}](${href})`;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: markdown },
      selection: { anchor: range.from + markdown.length },
      scrollIntoView: true
    });
    view.focus();
    setSourceLinkDraft(undefined);
  };

  useEffect(() => {
    setSourceTableDialog(undefined);
    setSourceLinkDraft(undefined);
    setAiContextMenu(undefined);
  }, [document?.mode, document?.pathRel]);

  useEffect(() => {
    if (document?.mode !== "split") {
      return;
    }
    let frame = 0;
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    const attach = () => {
      if (cancelled) {
        return;
      }
      const sourceScroller = sourceEditorRef.current?.view?.scrollDOM;
      const previewScroller = splitPreviewRef.current;
      if (!sourceScroller || !previewScroller) {
        frame = window.requestAnimationFrame(attach);
        return;
      }

      const syncScroll = (from: HTMLElement, to: HTMLElement, origin: "source" | "preview") => {
        if (splitScrollSyncLock.current && splitScrollSyncLock.current !== origin) {
          return;
        }
        const fromMax = from.scrollHeight - from.clientHeight;
        const toMax = to.scrollHeight - to.clientHeight;
        if (fromMax <= 0 || toMax <= 0) {
          return;
        }
        splitScrollSyncLock.current = origin;
        to.scrollTop = (from.scrollTop / fromMax) * toMax;
        window.requestAnimationFrame(() => {
          splitScrollSyncLock.current = undefined;
        });
      };

      const onSourceScroll = () => syncScroll(sourceScroller, previewScroller, "source");
      const onPreviewScroll = () => syncScroll(previewScroller, sourceScroller, "preview");
      sourceScroller.addEventListener("scroll", onSourceScroll, { passive: true });
      previewScroller.addEventListener("scroll", onPreviewScroll, { passive: true });
      cleanup = () => {
        sourceScroller.removeEventListener("scroll", onSourceScroll);
        previewScroller.removeEventListener("scroll", onPreviewScroll);
      };
    };

    frame = window.requestAnimationFrame(attach);
    return () => {
      cancelled = true;
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      cleanup?.();
      splitScrollSyncLock.current = undefined;
    };
  }, [document?.mode, document?.pathRel]);

  const updateSplitLeftPercent = (percent: number) => {
    const next = clampSplitLeftPercent(percent);
    setSplitLeftPercent(next);
  };

  const startSplitResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const pane = event.currentTarget.closest(".split-pane");
    if (!(pane instanceof HTMLElement)) {
      return;
    }
    const rect = pane.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    const updateFromClientX = (clientX: number) => {
      updateSplitLeftPercent(((clientX - rect.left) / rect.width) * 100);
    };
    const onPointerMove = (moveEvent: PointerEvent) => updateFromClientX(moveEvent.clientX);
    const stopResize = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
    updateFromClientX(event.clientX);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  const handleSplitResizeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      updateSplitLeftPercent(splitLeftPercent + (event.key === "ArrowRight" ? 2 : -2));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      updateSplitLeftPercent(DEFAULT_SPLIT_LEFT_PERCENT);
    }
  };

  const focusSplitMermaidSource = ({ index, markdown }: { index: number; markdown?: string }) => {
    if (!document) {
      return;
    }
    const location = findMermaidSourceLocation(document.sourceText, index, markdown);
    if (!location) {
      return;
    }
    focusSourceEditorAt(sourceEditorRef, location.bodyStart);
  };

  const updateSplitCodeLanguage = ({ index, language }: { index: number; language: string }) => {
    if (!document) {
      return;
    }
    const nextSource = updateFencedCodeBlockLanguage(document.sourceText, index, language);
    if (!nextSource || nextSource === document.sourceText) {
      return;
    }
    onSourceChange(nextSource);
  };

  if (resource) {
    const pluginEditor = resource.editorId ? pluginFileEditors.get(resource.editorId) : undefined;
    if (pluginEditor) {
      return (
        <PluginResourceEditor
          resource={resource}
          workspaceId={workspaceId}
          platform={platform}
          pluginId={pluginEditor.pluginId}
          render={pluginEditor.render}
          onReadText={onReadPluginFile}
          onWriteText={onWritePluginFile}
          onReadBinary={onReadPluginBinaryFile}
          onWriteBinary={onWritePluginBinaryFile}
          onDirtyChange={onPluginEditorDirtyChange}
          onSaved={onPluginEditorSaved}
          onStatus={onPluginEditorStatus}
          onRegisterSaveHandler={onRegisterPluginEditorSaveHandler}
        />
      );
    }
    if (resource.editorId === "json.editor.fileEditor") {
      return (
        <BuiltInJsonEditor
          ref={textResourceEditorRef}
          resource={resource}
          workspaceId={workspaceId}
          onDirtyChange={onPluginEditorDirtyChange}
          onSaved={onPluginEditorSaved}
          onStatus={onPluginEditorStatus}
          onRegisterSaveHandler={onRegisterPluginEditorSaveHandler}
        />
      );
    }
    if (resource.editorId === "text.editor.fileEditor") {
      return (
        <BuiltInTextEditor
          ref={textResourceEditorRef}
          resource={resource}
          workspaceId={workspaceId}
          onDirtyChange={onPluginEditorDirtyChange}
          onSaved={onPluginEditorSaved}
          onStatus={onPluginEditorStatus}
          onRegisterSaveHandler={onRegisterPluginEditorSaveHandler}
        />
      );
    }
    if (resource.editorId) {
      return <PluginResourceUnavailable resource={resource} workspaceId={workspaceId} />;
    }
    const pluginViewer = resource.viewerId ? pluginFileViewers.get(resource.viewerId) : undefined;
    if (pluginViewer) {
      return <PluginResourceViewer resource={resource} workspaceId={workspaceId} platform={platform} pluginId={pluginViewer.pluginId} render={pluginViewer.render} onReadText={onReadPluginFile} onReadBinary={onReadPluginBinaryFile} />;
    }
    return <ResourcePreview resource={resource} workspaceId={workspaceId} platform={platform} />;
  }

  if (!document) {
    return <div className="editor-empty">{tr("打开一个 Markdown 文件。")}</div>;
  }

  return (
    <div ref={editorPaneRootRef} className={`editor-pane mode-${document.mode}`}>
      {document.mode === "source" ? (
        <div className="source-shell">
          {toolbarVisible ? (
            <MarkdownActionBar
              onInsert={insertSourceSnippet}
              onInsertImage={insertSourceImage}
              onInsertTable={(event) => setSourceTableDialog(createAnchoredTableDialog(event.currentTarget))}
              onInsertLink={openSourceLinkDialog}
              onInsertToc={insertOrUpdateSourceToc}
              lineNumbersVisible={lineNumbersVisible}
              onToggleLineNumbers={onToggleLineNumbers}
              onUndo={undoSourceEdit}
              onRedo={redoSourceEdit}
              aiToolbar={aiToolbar}
            />
          ) : null}
          <div className="source-editor-context-surface" onContextMenu={handleSourceEditorContextMenu}>
            <SourceEditor key={sourceEditorKey} ref={sourceEditorRef} value={document.sourceText} onChange={onSourceChange} onSelectionLengthChange={onSelectionLengthChange} showLineNumbers={lineNumbersVisible} />
          </div>
        </div>
      ) : null}
      {document.mode === "wysiwyg" ? (
        <WysiwygEditor
          ref={wysiwygEditorRef}
          html={html}
          sourceText={document.pendingHtml ? undefined : document.sourceText}
          workspaceId={workspaceId}
          documentPathRel={document.pathRel}
          onChange={onHtmlChange}
          onMarkdownPaste={onMarkdownPaste}
          onSelectionLengthChange={onSelectionLengthChange}
          onOpenMarkdownTarget={onOpenMarkdownTarget}
          onInsertToc={(currentHtml) => {
            void insertOrUpdateWysiwygToc(currentHtml);
          }}
          showToolbar={toolbarVisible}
          toolbarExtra={aiToolbar}
          onAiContextMenu={aiContextMenuCommands.length ? openAiEditorContextMenu : undefined}
        />
      ) : null}
      {document.mode === "split" ? (
        <div className="split-pane" style={{ gridTemplateColumns: `minmax(0, ${splitLeftPercent}fr) 10px minmax(0, ${100 - splitLeftPercent}fr)` }}>
          <div className="split-editor">
            <div className="source-shell">
              {toolbarVisible ? (
                <MarkdownActionBar
                  onInsert={insertSourceSnippet}
                  onInsertImage={insertSourceImage}
                  onInsertTable={(event) => setSourceTableDialog(createAnchoredTableDialog(event.currentTarget))}
                  onInsertLink={openSourceLinkDialog}
                  onInsertToc={insertOrUpdateSourceToc}
                  lineNumbersVisible={lineNumbersVisible}
                  onToggleLineNumbers={onToggleLineNumbers}
                  onUndo={undoSourceEdit}
                  onRedo={redoSourceEdit}
                  aiToolbar={aiToolbar}
                />
              ) : null}
              <div className="source-editor-context-surface" onContextMenu={handleSourceEditorContextMenu}>
                <SourceEditor key={sourceEditorKey} ref={sourceEditorRef} value={document.sourceText} onChange={onSourceChange} onSelectionLengthChange={onSelectionLengthChange} showLineNumbers={lineNumbersVisible} />
              </div>
            </div>
          </div>
          <button
            type="button"
            className="split-resizer"
            aria-label={tr("拖拽调整分屏比例")}
            title={tr("拖拽调整分屏比例")}
            onPointerDown={startSplitResize}
            onKeyDown={handleSplitResizeKeyDown}
            onDoubleClick={() => updateSplitLeftPercent(DEFAULT_SPLIT_LEFT_PERCENT)}
          />
          <div ref={splitPreviewRef} className="split-preview">
            <MarkdownPreview html={html} onMermaidClick={focusSplitMermaidSource} onCodeLanguageChange={updateSplitCodeLanguage} />
          </div>
        </div>
      ) : null}
      {sourceToolsActive ? (
        <>
          <SourceLinkDialog
            draft={sourceLinkDraft}
            onChange={setSourceLinkDraft}
            onCancel={() => setSourceLinkDraft(undefined)}
            onSubmit={insertSourceLink}
          />
          <TableInsertDialog
            dialog={sourceTableDialog}
            onChange={setSourceTableDialog}
            onCancel={() => setSourceTableDialog(undefined)}
            onSubmit={(rows, columns) => {
              insertSourceSnippet({ before: createMarkdownTable(rows, columns, tr), block: true });
              setSourceTableDialog(undefined);
            }}
          />
        </>
      ) : null}
      <AiEditorContextMenu
        menu={aiContextMenu}
        commands={aiContextMenuCommands}
        enabled={aiEnabled}
        onRunCommand={onRunAiCommand}
        onClose={() => setAiContextMenu(undefined)}
      />
    </div>
  );
});

type BuiltInResourceEditorProps = {
  resource: ActiveResource;
  workspaceId?: string;
  onDirtyChange: (pathRel: string, dirty: boolean) => void;
  onSaved: (pathRel: string, result: FileWriteResponse) => void;
  onStatus: (message: string) => void;
  onRegisterSaveHandler: (pathRel: string, handler: () => Promise<void>) => () => void;
};

const BuiltInJsonEditor = forwardRef<TextResourceEditorHandle, BuiltInResourceEditorProps>(function BuiltInJsonEditor(
  { resource, workspaceId, onDirtyChange, onSaved, onStatus, onRegisterSaveHandler },
  ref
) {
  return (
    <TextResourceEditor ref={ref} resource={resource} workspaceId={workspaceId} editorKind="json" onDirtyChange={onDirtyChange} onSaved={onSaved} onStatus={onStatus} onRegisterSaveHandler={onRegisterSaveHandler} />
  );
});

const BuiltInTextEditor = forwardRef<TextResourceEditorHandle, BuiltInResourceEditorProps>(function BuiltInTextEditor(
  { resource, workspaceId, onDirtyChange, onSaved, onStatus, onRegisterSaveHandler },
  ref
) {
  return (
    <TextResourceEditor ref={ref} resource={resource} workspaceId={workspaceId} editorKind="text" onDirtyChange={onDirtyChange} onSaved={onSaved} onStatus={onStatus} onRegisterSaveHandler={onRegisterSaveHandler} />
  );
});

function ResourcePreview({ resource, workspaceId, platform }: { resource: ActiveResource; workspaceId?: string; platform?: NodeJS.Platform }) {
  const { tr, locale } = useRendererI18n();
  const category = resource.category ?? resourceCategoryFor(resource.pathRel);
  const url = workspaceId ? assetUrl(workspaceId, resource.pathRel) : "";
  const revealLabel = revealInFileManagerLabel(platform, tr);
  const archiveDescription = archiveResourceDescription(platform, tr);
  const [textPreview, setTextPreview] = useState<{ loading: boolean; content: string; error?: string }>({ loading: false, content: "" });
  const [imageState, setImageState] = useState<{ loading: boolean; error?: string; naturalSize?: string }>({ loading: category === "image" && Boolean(url) });
  const canLoadAsText = category === "text" || category === "diagram";

  useEffect(() => {
    setImageState({ loading: category === "image" && Boolean(url) });
  }, [category, resource.pathRel, url]);

  useEffect(() => {
    if (!workspaceId || !canLoadAsText) {
      setTextPreview({ loading: false, content: "" });
      return;
    }
    let cancelled = false;
    setTextPreview({ loading: true, content: "" });
    void window.nolia.file
      .read({ workspaceId, pathRel: resource.pathRel })
      .then((file) => file.content)
      .then((content) => {
        if (!cancelled) {
          setTextPreview({ loading: false, content: content.slice(0, 200_000) });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTextPreview({ loading: false, content: "", error: error instanceof Error ? error.message : tr("读取失败") });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canLoadAsText, resource.pathRel, workspaceId]);

  const openExternal = async () => {
    if (!workspaceId) {
      return;
    }
    await window.nolia.file.openExternal?.({ workspaceId, pathRel: resource.pathRel });
  };
  const revealInFinder = async () => {
    if (!workspaceId) {
      return;
    }
    await window.nolia.file.revealInFinder?.({ workspaceId, pathRel: resource.pathRel });
  };

  return (
    <div className="resource-preview">
      <header className="resource-preview-header">
        <div className="resource-preview-title">
          {resourcePreviewIcon(category)}
          <div>
            <strong>{resource.name}</strong>
            <span>{resourceKindLabel(category, tr)} · {formatFileSize(resource.size, locale)}</span>
          </div>
        </div>
        <div className="resource-preview-actions">
          <button type="button" className="secondary-button" onClick={() => void openExternal()}>
            <ExternalLink size={14} /> {tr("用系统应用打开")}
          </button>
          <button type="button" className="secondary-button" onClick={() => void revealInFinder()}>
            <FolderSearch size={14} /> {revealLabel}
          </button>
        </div>
      </header>
      <div className={`resource-preview-body is-${category}`}>
        {category === "image" && url ? (
          <figure className={`image-preview-frame${imageState.error ? " is-error" : ""}${imageState.loading ? " is-loading" : ""}`}>
            <div className={`image-preview-stage${imageState.error ? " is-error" : ""}${imageState.loading ? " is-loading" : ""}`}>
              <img
                src={url}
                alt={resource.name}
                className="image-preview-image"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  setImageState({ loading: false, naturalSize: `${image.naturalWidth} × ${image.naturalHeight}` });
                }}
                onError={() => setImageState((current) => (current.error ? current : { loading: false, error: tr("文件可能已损坏，或当前格式无法被内嵌预览解码。") }))}
              />
              {imageState.loading ? <div className="image-preview-overlay resource-loading">{tr("图片加载中。")}</div> : null}
              {imageState.error ? (
                <div className="image-preview-overlay resource-placeholder">
                  <FileImage size={46} />
                  <strong>{tr("图片无法预览")}</strong>
                  <span>{imageState.error}</span>
                </div>
              ) : null}
            </div>
            {imageState.naturalSize ? <figcaption>{imageState.naturalSize}</figcaption> : null}
          </figure>
        ) : null}
        {category === "pdf" && url ? <iframe title={resource.name} src={url} /> : null}
        {category === "audio" && url ? <audio controls src={url} /> : null}
        {category === "video" && url ? <video controls src={url} /> : null}
        {canLoadAsText ? (
          textPreview.loading ? (
            <div className="empty-state">{tr("资源加载中。")}</div>
          ) : textPreview.error ? (
            <div className="empty-state">{tr("无法预览：{message}", { message: textPreview.error })}</div>
          ) : (
            <pre>{textPreview.content || tr("空文件")}</pre>
          )
        ) : null}
        {category === "archive" ? (
          <div className="resource-placeholder">
            <FileArchive size={46} />
            <strong>{tr("压缩包资源")}</strong>
            <span>{archiveDescription}</span>
          </div>
        ) : null}
        {category === "other" ? (
          <div className="resource-placeholder">
            <FileQuestion size={46} />
            <strong>{tr("暂不支持内嵌预览")}</strong>
            <span>{tr("当前资源可作为 Markdown 附件管理，可以用系统应用打开。")}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PluginSidebarPanel({
  panelId,
  title,
  render,
  workspace,
  activeDocument
}: {
  panelId: string;
  title: string;
  render?: PluginRenderProvider<PluginSidebarPanelContext>;
  workspace?: WorkspaceInfo;
  activeDocument?: OpenDocumentTab;
}) {
  const { tr } = useRendererI18n();
  const [output, setOutput] = useState<PluginRenderResult>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!render) {
      setError(tr("插件未提供面板渲染器"));
      setOutput(undefined);
      return;
    }
    let cancelled = false;
    setError(undefined);
    void Promise.resolve(
      render({
        workspace: workspace ? { workspaceId: workspace.workspaceId, name: workspace.name, rootPath: workspace.rootPath } : undefined,
        activeDocument: activeDocument ? { pathRel: activeDocument.pathRel, title: activeDocument.title, dirty: activeDocument.dirty } : undefined
      })
    )
      .then((result) => {
        if (!cancelled) {
          setOutput(result);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : tr("插件面板渲染失败"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [panelId, render, workspace?.workspaceId, activeDocument?.pathRel, activeDocument?.dirty, tr]);

  return (
    <div className="sidebar-scroll plugin-sidebar-panel">
      <SidebarBox title={title}>
        {error ? <div className="empty-state">{tr("插件面板错误：{message}", { message: error })}</div> : <PluginRenderMount output={output} />}
      </SidebarBox>
    </div>
  );
}

function PluginResourceUnavailable({ resource, workspaceId }: { resource: ActiveResource; workspaceId?: string }) {
  const { tr, locale } = useRendererI18n();
  const category = resource.category ?? resourceCategoryFor(resource.pathRel);
  const openExternal = async () => {
    if (!workspaceId) {
      return;
    }
    await window.nolia.file.openExternal?.({ workspaceId, pathRel: resource.pathRel });
  };
  return (
    <div className="resource-preview">
      <header className="resource-preview-header">
        <div className="resource-preview-title">
          {resourcePreviewIcon(category)}
          <div>
            <strong>{resource.name}</strong>
            <span>{resourceKindLabel(category, tr)} · {formatFileSize(resource.size, locale)}</span>
          </div>
        </div>
        <div className="resource-preview-actions">
          <button type="button" className="secondary-button" onClick={() => void openExternal()}>
            <ExternalLink size={14} /> {tr("用系统应用打开")}
          </button>
        </div>
      </header>
      <div className={`resource-preview-body is-${category}`}>
        <div className="empty-state">{tr("插件编辑器未加载，无法编辑该文件。")}</div>
      </div>
    </div>
  );
}

function PluginResourceEditor({
  resource,
  workspaceId,
  platform,
  pluginId,
  render,
  onReadText,
  onWriteText,
  onReadBinary,
  onWriteBinary,
  onDirtyChange,
  onSaved,
  onStatus,
  onRegisterSaveHandler
}: {
  resource: ActiveResource;
  workspaceId?: string;
  platform?: NodeJS.Platform;
  pluginId: string;
  render: PluginRenderProvider<PluginFileEditorContext>;
  onReadText: (pluginId: string, pathRel: string) => Promise<FileReadResponse>;
  onWriteText: (pluginId: string, pathRel: string, content: string, baseHash?: string) => Promise<FileWriteResponse>;
  onReadBinary: (pluginId: string, pathRel: string) => Promise<FileBinaryReadResponse>;
  onWriteBinary: (pluginId: string, pathRel: string, data: ArrayBuffer | ArrayBufferView, baseHash?: string) => Promise<FileWriteResponse>;
  onDirtyChange: (pathRel: string, dirty: boolean) => void;
  onSaved: (pathRel: string, result: FileWriteResponse) => void;
  onStatus: (message: string) => void;
  onRegisterSaveHandler: (pathRel: string, handler: () => Promise<void>) => () => void;
}) {
  const { tr, locale } = useRendererI18n();
  const category = resource.category ?? resourceCategoryFor(resource.pathRel);
  const url = workspaceId ? assetUrl(workspaceId, resource.pathRel) : "";
  const revealLabel = revealInFileManagerLabel(platform, tr);
  const contentRef = useRef(resource.initialText ?? "");
  const binaryRef = useRef<ArrayBuffer | undefined>(resource.initialBytes);
  const baseHashRef = useRef(resource.baseHash);
  const dirtyRef = useRef(Boolean(resource.dirty));
  const [output, setOutput] = useState<PluginRenderResult>();
  const [error, setError] = useState<string>();
  const openExternal = async () => {
    if (!workspaceId) {
      return;
    }
    await window.nolia.file.openExternal?.({ workspaceId, pathRel: resource.pathRel });
  };
  const revealInFinder = async () => {
    if (!workspaceId) {
      return;
    }
    await window.nolia.file.revealInFinder?.({ workspaceId, pathRel: resource.pathRel });
  };
  const setDirtyState = (dirty: boolean) => {
    dirtyRef.current = dirty;
    onDirtyChange(resource.pathRel, dirty);
  };
  const updateText = (content: string, options?: { dirty?: boolean }) => {
    contentRef.current = content;
    setDirtyState(options?.dirty ?? true);
  };
  const updateBinary = (data: ArrayBuffer | ArrayBufferView, options?: { dirty?: boolean }) => {
    binaryRef.current = binaryDataToArrayBuffer(data);
    setDirtyState(options?.dirty ?? true);
  };
  const readText = async () => {
    const file = await onReadText(pluginId, resource.pathRel);
    contentRef.current = file.content;
    baseHashRef.current = file.sha256;
    return file.content;
  };
  const readBinary = async () => {
    const file = await onReadBinary(pluginId, resource.pathRel);
    binaryRef.current = file.data;
    baseHashRef.current = file.sha256;
    return file;
  };
  const saveText = async (content = contentRef.current) => {
    contentRef.current = content;
    const result = await onWriteText(pluginId, resource.pathRel, content, baseHashRef.current);
    if (result.status !== "saved") {
      throw new Error(result.status === "conflict" ? tr("保存冲突") : tr("保存失败"));
    }
    baseHashRef.current = result.sha256 ?? baseHashRef.current;
    dirtyRef.current = false;
    onDirtyChange(resource.pathRel, false);
    onSaved(resource.pathRel, result);
    onStatus(tr("已保存 {path}", { path: resource.pathRel }));
  };
  const saveBinary = async (data?: ArrayBuffer | ArrayBufferView) => {
    data ??= binaryRef.current;
    if (!data) {
      throw new Error("Missing binary content");
    }
    const result = await onWriteBinary(pluginId, resource.pathRel, data, baseHashRef.current);
    if (result.status !== "saved") {
      throw new Error(result.status === "conflict" ? tr("保存冲突") : tr("保存失败"));
    }
    binaryRef.current = binaryDataToArrayBuffer(data);
    baseHashRef.current = result.sha256 ?? baseHashRef.current;
    dirtyRef.current = false;
    onDirtyChange(resource.pathRel, false);
    onSaved(resource.pathRel, result);
    onStatus(tr("已保存 {path}", { path: resource.pathRel }));
  };

  useEffect(() => {
    contentRef.current = resource.initialText ?? "";
    binaryRef.current = resource.initialBytes;
    baseHashRef.current = resource.baseHash;
    dirtyRef.current = Boolean(resource.dirty);
  }, [resource.pathRel]);

  useEffect(
    () => onRegisterSaveHandler(resource.pathRel, () => (binaryRef.current ? saveBinary(binaryRef.current) : saveText(contentRef.current))),
    [resource.pathRel, onRegisterSaveHandler]
  );

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void Promise.resolve(
      render({
        workspaceId,
        pathRel: resource.pathRel,
        name: resource.name,
        size: resource.size,
        category,
        url,
        initialText: contentRef.current,
        initialBytes: binaryRef.current,
        baseHash: baseHashRef.current,
        dirty: dirtyRef.current,
        readText,
        readBinary,
        updateText,
        updateBinary,
        setDirty: setDirtyState,
        save: saveText,
        writeText: saveText,
        saveBinary,
        writeBinary: saveBinary,
        openExternal,
        revealInFinder
      })
    )
      .then((result) => {
        if (!cancelled) {
          setOutput(result);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : tr("插件文件编辑器渲染失败"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [category, pluginId, render, resource.pathRel, resource.size, url, workspaceId, tr]);

  return (
    <div className="resource-preview plugin-resource-preview plugin-resource-editor">
      <header className="resource-preview-header">
        <div className="resource-preview-title">
          {resourcePreviewIcon(category)}
          <div>
            <strong>{resource.name}</strong>
            <span>{resourceKindLabel(category, tr)} · {formatFileSize(resource.size, locale)}</span>
          </div>
        </div>
        <div className="resource-preview-actions">
          <button type="button" className="secondary-button" onClick={() => void openExternal()}>
            <ExternalLink size={14} /> {tr("用系统应用打开")}
          </button>
          <button type="button" className="secondary-button" onClick={() => void revealInFinder()}>
            <FolderSearch size={14} /> {revealLabel}
          </button>
        </div>
      </header>
      <div className={`resource-preview-body is-${category}`}>
        {error ? <div className="empty-state">{tr("插件编辑器错误：{message}", { message: error })}</div> : <PluginRenderMount output={output} />}
      </div>
    </div>
  );
}

function PluginResourceViewer({
  resource,
  workspaceId,
  platform,
  pluginId,
  render,
  onReadText,
  onReadBinary
}: {
  resource: ActiveResource;
  workspaceId?: string;
  platform?: NodeJS.Platform;
  pluginId: string;
  render: PluginRenderProvider<PluginFileViewerContext>;
  onReadText: (pluginId: string, pathRel: string) => Promise<FileReadResponse>;
  onReadBinary: (pluginId: string, pathRel: string) => Promise<FileBinaryReadResponse>;
}) {
  const { tr, locale } = useRendererI18n();
  const category = resource.category ?? resourceCategoryFor(resource.pathRel);
  const url = workspaceId ? assetUrl(workspaceId, resource.pathRel) : "";
  const revealLabel = revealInFileManagerLabel(platform, tr);
  const [output, setOutput] = useState<PluginRenderResult>();
  const [error, setError] = useState<string>();
  const openExternal = async () => {
    if (!workspaceId) {
      return;
    }
    await window.nolia.file.openExternal?.({ workspaceId, pathRel: resource.pathRel });
  };
  const revealInFinder = async () => {
    if (!workspaceId) {
      return;
    }
    await window.nolia.file.revealInFinder?.({ workspaceId, pathRel: resource.pathRel });
  };

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    void Promise.resolve(
      render({
        workspaceId,
        pathRel: resource.pathRel,
        name: resource.name,
        size: resource.size,
        category,
        url,
        readText: async () => {
          const file = await onReadText(pluginId, resource.pathRel);
          return file.content;
        },
        readBinary: () => onReadBinary(pluginId, resource.pathRel),
        openExternal,
        revealInFinder
      })
    )
      .then((result) => {
        if (!cancelled) {
          setOutput(result);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : tr("插件文件预览失败"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [category, onReadText, pluginId, render, resource.pathRel, resource.size, url, workspaceId, tr]);

  return (
    <div className="resource-preview plugin-resource-preview">
      <header className="resource-preview-header">
        <div className="resource-preview-title">
          {resourcePreviewIcon(category)}
          <div>
            <strong>{resource.name}</strong>
            <span>{resourceKindLabel(category, tr)} · {formatFileSize(resource.size, locale)}</span>
          </div>
        </div>
        <div className="resource-preview-actions">
          <button type="button" className="secondary-button" onClick={() => void openExternal()}>
            <ExternalLink size={14} /> {tr("用系统应用打开")}
          </button>
          <button type="button" className="secondary-button" onClick={() => void revealInFinder()}>
            <FolderSearch size={14} /> {revealLabel}
          </button>
        </div>
      </header>
      <div className={`resource-preview-body is-${category}`}>
        {error ? <div className="empty-state">{tr("插件预览错误：{message}", { message: error })}</div> : <PluginRenderMount output={output} />}
      </div>
    </div>
  );
}

function PluginRenderMount({ output }: { output: PluginRenderResult }) {
  const { tr } = useRendererI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!(output instanceof HTMLElement)) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.replaceChildren(output);
    return () => {
      if (container.contains(output)) {
        output.remove();
      }
    };
  }, [output]);

  if (output instanceof HTMLElement) {
    return <div ref={containerRef} className="plugin-render-host" />;
  }
  if (typeof output === "string") {
    return <div className="plugin-render-text">{output}</div>;
  }
  if (output === undefined || output === null || output === false) {
    return <div className="empty-state">{tr("插件暂无内容。")}</div>;
  }
  return <>{output}</>;
}

function SidebarBox({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="sidebar-box">
      <header className="sidebar-box-header">
        <strong>{title}</strong>
        {actions ? <div className="sidebar-box-actions">{actions}</div> : null}
      </header>
      <div className="sidebar-box-body">{children}</div>
    </section>
  );
}

type TableDialogState = {
  rows: number;
  columns: number;
  x: number;
  y: number;
};

function MarkdownActionBar({
  onInsert,
  onInsertImage,
  onInsertTable,
  onInsertLink,
  onInsertToc,
  lineNumbersVisible,
  onToggleLineNumbers,
  onUndo,
  onRedo,
  aiToolbar
}: {
  onInsert: (snippet: MarkdownSnippet) => void;
  onInsertImage: () => void;
  onInsertTable: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onInsertLink: () => void;
  onInsertToc: () => void;
  lineNumbersVisible: boolean;
  onToggleLineNumbers: () => void;
  onUndo: () => void;
  onRedo: () => void;
  aiToolbar?: ReactNode;
}) {
  const { tr } = useRendererI18n();
  return (
    <div className="markdown-actionbar" role="toolbar" aria-label={tr("Markdown 工具")}>
      {aiToolbar ? (
        <>
          {aiToolbar}
          <ToolbarDivider />
        </>
      ) : null}
      <ToolbarIconButton title={tr("插入目录")} icon={<TableOfContents size={16} />} onClick={onInsertToc} />
      <ToolbarIconButton title={tr("行号")} icon={<Rows3 size={16} />} onClick={onToggleLineNumbers} pressed={lineNumbersVisible} />
      <ToolbarDivider />
      <ToolbarIconButton title={tr("撤销")} icon={<Undo2 size={16} />} onClick={onUndo} />
      <ToolbarIconButton title={tr("重做")} icon={<Redo2 size={16} />} onClick={onRedo} />
      <ToolbarDivider />
      <ToolbarIconButton title={tr("段落")} icon={<Pilcrow size={16} />} onClick={() => onInsert({ before: "" })} />
      <ToolbarIconButton title={tr("一级标题")} icon={<Heading1 size={16} />} onClick={() => onInsert({ before: "# ", placeholder: tr("一级标题") })} />
      <ToolbarIconButton title={tr("二级标题")} icon={<Heading2 size={16} />} onClick={() => onInsert({ before: "## ", placeholder: tr("二级标题") })} />
      <ToolbarIconButton title={tr("三级标题")} icon={<Heading3 size={16} />} onClick={() => onInsert({ before: "### ", placeholder: tr("三级标题") })} />
      <ToolbarDivider />
      <ToolbarIconButton title={tr("加粗")} icon={<Bold size={16} />} onClick={() => onInsert({ before: "**", after: "**", placeholder: tr("加粗文本") })} />
      <ToolbarIconButton title={tr("斜体")} icon={<Italic size={16} />} onClick={() => onInsert({ before: "*", after: "*", placeholder: tr("斜体文本") })} />
      <ToolbarIconButton title={tr("删除线")} icon={<Strikethrough size={16} />} onClick={() => onInsert({ before: "~~", after: "~~", placeholder: tr("删除线文本") })} />
      <ToolbarIconButton title={tr("行内代码")} icon={<Code size={16} />} onClick={() => onInsert({ before: "`", after: "`", placeholder: tr("代码") })} />
      <ToolbarDivider />
      <ToolbarIconButton title={tr("无序列表")} icon={<List size={16} />} onClick={() => onInsert({ before: "- ", placeholder: tr("列表项"), block: true })} />
      <ToolbarIconButton title={tr("有序列表")} icon={<ListOrdered size={16} />} onClick={() => onInsert({ before: "1. ", placeholder: tr("列表项"), block: true })} />
      <ToolbarIconButton title={tr("任务列表")} icon={<ListChecks size={16} />} onClick={() => onInsert({ before: "- [ ] ", placeholder: tr("任务"), block: true })} />
      <ToolbarIconButton title={tr("复选框")} icon={<SquareCheckBig size={16} />} onClick={() => onInsert({ before: "- [ ] ", placeholder: tr("任务"), block: true })} />
      <ToolbarDivider />
      <ToolbarIconButton title={tr("链接")} icon={<Link2 size={16} />} onClick={onInsertLink} />
      <ToolbarIconButton title={tr("图片")} icon={<ImageIcon size={16} />} onClick={onInsertImage} />
      <ToolbarIconButton title={tr("代码块")} icon={<FileCode2 size={16} />} onClick={() => onInsert({ before: "```\n", after: "\n```", placeholder: tr("代码"), block: true, select: "body" })} />
      <ToolbarIconButton title={tr("表格")} icon={<Table2 size={16} />} onClick={onInsertTable} />
      <ToolbarIconButton title={tr("公式")} icon={<Sigma size={16} />} onClick={() => onInsert({ before: "$$\n", after: "\n$$", placeholder: "E = mc^2", block: true })} />
      <ToolbarIconButton title={tr("引用")} icon={<Quote size={16} />} onClick={() => onInsert({ before: "> ", placeholder: tr("引用"), block: true })} />
      <ToolbarIconButton title={tr("分割线")} icon={<Minus size={16} />} onClick={() => onInsert({ before: "\n---\n", block: true })} />
    </div>
  );
}

function AiToolbarMenu({
  commands,
  enabled,
  onRunCommand
}: {
  commands: AiCommandDefinition[];
  enabled: boolean;
  onRunCommand: (commandId: string) => void;
}) {
  const { tr } = useRendererI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const runCommand = (commandId: string) => {
    setOpen(false);
    onRunCommand(commandId);
  };

  return (
    <div ref={menuRef} className="ai-toolbar-menu">
      <button
        type="button"
        className={`toolbar-icon-button${open ? " is-active" : ""}`}
        title={tr("AI 命令")}
        aria-label={tr("AI 命令")}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkles size={16} />
      </button>
      {open ? (
        <div className="ai-toolbar-popover" role="menu">
          {commands.map((command) => (
            <button key={command.id} type="button" role="menuitem" disabled={!enabled} onClick={() => runCommand(command.id)}>
              <Sparkles size={14} />
              <span>{command.name}</span>
            </button>
          ))}
          {!enabled ? <div className="ai-toolbar-hint">{tr("AI 未启用")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function AiEditorContextMenu({
  menu,
  commands,
  enabled,
  onRunCommand,
  onClose
}: {
  menu?: { x: number; y: number };
  commands: AiCommandDefinition[];
  enabled: boolean;
  onRunCommand: (commandId: string) => void;
  onClose: () => void;
}) {
  const { tr } = useRendererI18n();
  const [menuRef, menuStyle] = useFloatingMenuPosition(menu, { width: 220, height: Math.min(360, 40 + commands.length * 36) });

  useEffect(() => {
    if (!menu) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menu, onClose]);

  if (!menu || commands.length === 0) {
    return null;
  }

  const runCommand = (commandId: string) => {
    onClose();
    onRunCommand(commandId);
  };

  return (
    <>
      <button type="button" className="context-backdrop" aria-label={tr("关闭右键菜单")} onClick={onClose} />
      <div ref={menuRef} className="context-menu ai-editor-context-menu" role="menu" style={menuStyle}>
        {commands.map((command) => (
          <button key={command.id} type="button" role="menuitem" disabled={!enabled} onClick={() => runCommand(command.id)}>
            <Sparkles size={14} />
            <span>{command.name}</span>
          </button>
        ))}
        {!enabled ? <div className="ai-toolbar-hint">{tr("AI 未启用")}</div> : null}
      </div>
    </>
  );
}

type MarkdownSnippet = {
  before: string;
  after?: string;
  placeholder?: string;
  block?: boolean;
  select?: "body" | "end";
};

function ToolbarIconButton({ title, icon, onClick, pressed }: { title: string; icon: ReactNode; onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void; pressed?: boolean }) {
  return (
    <button type="button" className={`toolbar-icon-button${pressed ? " is-active" : ""}`} title={title} aria-label={title} aria-pressed={pressed} onClick={onClick}>
      {icon}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="toolbar-divider" aria-hidden="true" />;
}

function SourceLinkDialog({
  draft,
  onChange,
  onCancel,
  onSubmit
}: {
  draft?: LinkDraft;
  onChange: (draft: LinkDraft) => void;
  onCancel: () => void;
  onSubmit: (draft: LinkDraft) => void;
}) {
  const { tr } = useRendererI18n();
  if (!draft) {
    return null;
  }
  return (
    <form
      className="link-popover source-link-popover"
      role="dialog"
      aria-label={tr("插入链接")}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      <label>
        <span>{tr("文本")}</span>
        <input value={draft.text} autoFocus onChange={(event) => onChange({ ...draft, text: event.target.value })} placeholder={tr("文本描述")} aria-label={tr("链接文本")} />
      </label>
      <label>
        <span>{tr("链接")}</span>
        <input value={draft.href} onChange={(event) => onChange({ ...draft, href: event.target.value })} placeholder={tr("添加链接地址")} aria-label={tr("链接地址")} />
      </label>
      <div className="link-popover-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          {tr("取消")}
        </button>
        <button type="submit" className="primary-button">
          {tr("确定")}
        </button>
      </div>
    </form>
  );
}

function TableInsertDialog({
  dialog,
  onChange,
  onCancel,
  onSubmit
}: {
  dialog?: TableDialogState;
  onChange: (dialog: TableDialogState) => void;
  onCancel: () => void;
  onSubmit: (rows: number, columns: number) => void;
}) {
  const { tr } = useRendererI18n();
  if (!dialog) {
    return null;
  }
  const rows = clampInteger(dialog.rows, 1, 20);
  const columns = clampInteger(dialog.columns, 1, 10);
  return (
    <div
      className="table-popover"
      role="dialog"
      aria-label={tr("插入表格")}
      style={{ left: dialog.x, top: dialog.y }}
      tabIndex={-1}
      onBlur={(event) => {
        if (!containsRelatedTarget(event)) {
          onCancel();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      ref={(node) => node?.focus()}
    >
      <div className="table-picker-grid" style={{ gridTemplateColumns: "repeat(10, 1fr)" }}>
        {Array.from({ length: 80 }).map((_, index) => {
          const row = Math.floor(index / 10) + 1;
          const column = (index % 10) + 1;
          const selected = row <= rows && column <= columns;
          return (
            <button
              key={index}
              type="button"
              className={selected ? "is-selected" : ""}
              aria-label={`${row} x ${column}`}
              onMouseEnter={() => onChange({ ...dialog, rows: row, columns: column })}
              onFocus={() => onChange({ ...dialog, rows: row, columns: column })}
              onClick={() => onSubmit(row, column)}
            />
          );
        })}
      </div>
      <strong className="table-picker-size">{rows} x {columns}</strong>
    </div>
  );
}

function createAnchoredTableDialog(button: HTMLElement): TableDialogState {
  const buttonRect = button.getBoundingClientRect();
  const width = Math.min(260, Math.max(0, window.innerWidth - 96));
  const x = Math.max(12, Math.min(buttonRect.left + buttonRect.width / 2 - width / 2, window.innerWidth - width - 12));
  const y = Math.min(buttonRect.bottom + 8, window.innerHeight - 24);
  return { rows: 3, columns: 3, x, y };
}

function editorScrollElementForMode(
  mode: OpenDocumentTab["mode"],
  root: HTMLElement | null,
  sourceScroller?: HTMLElement,
  splitPreview?: HTMLElement | null
): HTMLElement | undefined {
  if (mode === "wysiwyg") {
    return root?.querySelector<HTMLElement>(".wysiwyg-editor") ?? undefined;
  }
  if (mode === "split") {
    return splitPreview ?? sourceScroller;
  }
  return sourceScroller;
}

function editorScrollElementsForMode(
  mode: OpenDocumentTab["mode"],
  root: HTMLElement | null,
  sourceScroller?: HTMLElement,
  splitPreview?: HTMLElement | null
): HTMLElement[] {
  if (mode === "split") {
    return [sourceScroller, splitPreview].filter((element): element is HTMLElement => Boolean(element));
  }
  const scroller = editorScrollElementForMode(mode, root, sourceScroller, splitPreview);
  return scroller ? [scroller] : [];
}

function captureEditorScrollSnapshot(pathRel: string, scroller?: HTMLElement): EditorScrollSnapshot | undefined {
  if (!scroller) {
    return undefined;
  }
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  return {
    pathRel,
    ratio: maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0,
    top: scroller.scrollTop
  };
}

function restoreEditorScroll(scroller: HTMLElement, snapshot: EditorScrollSnapshot) {
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const top = maxScrollTop > 0 ? Math.min(maxScrollTop, Math.max(0, snapshot.ratio * maxScrollTop)) : 0;
  scroller.scrollTop = top || Math.min(maxScrollTop, snapshot.top);
}

function insertSnippetIntoSourceEditor(ref: RefObject<ReactCodeMirrorRef | null>, snippet: MarkdownSnippet) {
  const view = ref.current?.view;
  if (!view) {
    return;
  }
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const placeholder = snippet.placeholder ?? "";
  const body = selected || placeholder;
  const line = view.state.doc.lineAt(range.from);
  const needsLeadingBreak = snippet.block && line.text.trim() && range.from !== line.from;
  const prefix = needsLeadingBreak ? `\n${snippet.before}` : snippet.before;
  const inserted = `${prefix}${body}${snippet.after ?? ""}`;
  const selectionStart = snippet.select === "end" ? range.from + inserted.length : range.from + prefix.length;
  const selectionEnd = snippet.select === "end" ? selectionStart : selectionStart + body.length;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: inserted },
    selection: { anchor: selectionStart, head: selectionEnd },
    scrollIntoView: true
  });
  view.focus();
}

function selectedSourceText(view: NonNullable<ReactCodeMirrorRef["view"]>): string | undefined {
  const parts: string[] = [];
  view.state.selection.ranges.forEach((range) => {
    if (!range.empty) {
      parts.push(view.state.sliceDoc(range.from, range.to));
    }
  });
  const selection = parts.join("\n");
  return selection.trim() ? selection : undefined;
}

interface MermaidSourceLocation {
  bodyStart: number;
  markdown: string;
}

function focusSourceEditorAt(ref: RefObject<ReactCodeMirrorRef | null>, position: number) {
  const view = ref.current?.view;
  if (!view) {
    return;
  }
  const anchor = clampInteger(position, 0, view.state.doc.length);
  view.dispatch({
    selection: { anchor },
    scrollIntoView: true
  });
  view.focus();
}

function focusSourceEditorLine(ref: RefObject<ReactCodeMirrorRef | null>, line: number): boolean {
  const view = ref.current?.view;
  if (!view) {
    return false;
  }
  const lineNumber = clampInteger(line, 1, view.state.doc.lines);
  const targetLine = view.state.doc.line(lineNumber);
  focusSourceEditorAt(ref, targetLine.from);
  return true;
}

function findMermaidSourceLocation(source: string, index: number, markdown?: string): MermaidSourceLocation | undefined {
  const locations = findMermaidSourceLocations(source);
  const byOrder = locations[index];
  if (byOrder) {
    return byOrder;
  }
  const normalizedMarkdown = markdown ? normalizeDiagramMarkdown(markdown) : "";
  if (!normalizedMarkdown) {
    return undefined;
  }
  return locations.find((location) => normalizeDiagramMarkdown(location.markdown) === normalizedMarkdown);
}

function findMermaidSourceLocations(source: string): MermaidSourceLocation[] {
  const locations: MermaidSourceLocation[] = [];
  const openingFencePattern = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})([^\r\n]*)\r?\n/g;
  let openingMatch: RegExpExecArray | null;
  while ((openingMatch = openingFencePattern.exec(source))) {
    const fenceStart = openingMatch.index + openingMatch[1].length;
    const fenceMarker = openingMatch[3];
    const fenceChar = fenceMarker[0];
    const language = openingMatch[4].trim().split(/\s+/)[0] || undefined;
    const bodyStart = openingFencePattern.lastIndex;
    let lineStart = bodyStart;
    let closeEnd: number | undefined;
    while (lineStart <= source.length) {
      const lineEnd = source.indexOf("\n", lineStart);
      const lineEndIndex = lineEnd === -1 ? source.length : lineEnd;
      const line = source.slice(lineStart, lineEndIndex);
      if (isClosingFenceLine(line, fenceChar, fenceMarker.length)) {
        closeEnd = lineEnd === -1 ? source.length : lineEnd + 1;
        if (isMermaidFenceLanguage(language)) {
          locations.push({
            bodyStart,
            markdown: source.slice(fenceStart, closeEnd)
          });
        }
        break;
      }
      if (lineEnd === -1) {
        break;
      }
      lineStart = lineEnd + 1;
    }
    if (!closeEnd) {
      break;
    }
    openingFencePattern.lastIndex = closeEnd;
  }
  return locations;
}

function isClosingFenceLine(line: string, fenceChar: string, minLength: number): boolean {
  const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
  const marker = normalizedLine.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/)?.[1];
  return Boolean(marker && marker[0] === fenceChar && marker.length >= minLength);
}

function normalizeDiagramMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, "\n").trim();
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function createMarkdownTable(rows: number, columns: number, tr = createTranslator("zh-CN")): string {
  const safeRows = Math.max(1, Math.min(20, rows));
  const safeColumns = Math.max(1, Math.min(10, columns));
  const header = Array.from({ length: safeColumns }, (_, index) => tr("列 {index}", { index: index + 1 }));
  const separator = Array.from({ length: safeColumns }, () => "---");
  const bodyRows = Array.from({ length: safeRows }, () => Array.from({ length: safeColumns }, () => ""));
  return [
    `| ${header.join(" | ")} |`,
    `| ${separator.join(" | ")} |`,
    ...bodyRows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function NotesWorkspaceView({
  nodes,
  selection,
  searchQuery,
  onSearchChange,
  onRefresh,
  onSelectFolder,
  onOpen,
  onOpenCreateMenu,
  onRename,
  onDelete,
  onMoveToFolder,
  onContextMenu
}: {
  nodes: FileTreeNode[];
  selection?: TreeSelection;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  onSelectFolder: (pathRel: string) => void;
  onOpen: (node: FileTreeNode) => void;
  onOpenCreateMenu: (menu: CreateMenuState) => void;
  onRename: (target: RenameTarget) => void;
  onDelete: (target: DeleteTarget) => void;
  onMoveToFolder: (target: RenameTarget, destinationPath: string) => void;
  onContextMenu: (menu: { x: number; y: number; target: RenameTarget }) => void;
}) {
  const { tr } = useRendererI18n();
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [draggingTarget, setDraggingTarget] = useState<RenameTarget | undefined>();
  const [dropTargetPath, setDropTargetPath] = useState<string | undefined>();
  const markdownNotes = useMemo(() => collectMarkdownNotes(nodes), [nodes]);
  const openableItemsCount = useMemo(() => countOpenableTreeItems(nodes), [nodes]);
  const visibleNodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return nodes;
    }
    return filterTreeNodes(nodes, query);
  }, [nodes, searchQuery]);
  const toggle = (pathRel: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(pathRel)) {
        next.delete(pathRel);
      } else {
        next.add(pathRel);
      }
      return next;
    });
  };
  const openCreateMenu = (parentPath: string, button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    onOpenCreateMenu({
      x: Math.max(12, Math.min(rect.left, window.innerWidth - 190)),
      y: rect.bottom + 8,
      parentPath
    });
  };
  const clearDragState = () => {
    setDraggingTarget(undefined);
    setDropTargetPath(undefined);
  };
  return (
    <div className="notes-workspace">
      <section className="tree-pane">
        <div className="notes-sidebar-head">
          <div className="notes-sidebar-title">
            <strong>{tr("文件与资源")}</strong>
          </div>
          <div className="note-search-row">
            <label className="note-search">
              <Search size={15} />
              <input value={searchQuery} onChange={(event) => onSearchChange(event.target.value)} placeholder={tr("搜索文件或资源")} />
            </label>
          </div>
        </div>
        <div className="tree-section">
          <header className="tree-section-header">
            <div className="tree-section-title">
              <strong>{tr("全部文件")}</strong>
              <span className="tree-section-count">{tr("{items} 个项目 · {notes} 篇笔记", { items: openableItemsCount, notes: markdownNotes.length })}</span>
            </div>
            <span className="tree-section-actions">
              <button
                type="button"
                className="icon-button compact"
                title={tr("刷新文件树")}
                aria-label={tr("刷新文件树")}
                onClick={onRefresh}
              >
                <RefreshCw size={14} />
              </button>
              <button
                type="button"
                className="icon-button compact"
                title={tr("新建")}
                aria-label={tr("新建")}
                onClick={(event) => openCreateMenu("", event.currentTarget)}
              >
                <PlusIcon />
              </button>
            </span>
          </header>
          <div className="tree-scroll">
            {visibleNodes.length === 0 ? <div className="empty-state">{tr("没有匹配的文件或资源。")}</div> : null}
            <TreeNodes
              nodes={visibleNodes}
              selection={selection}
              expanded={expanded}
              forceExpanded={Boolean(searchQuery.trim())}
              onToggle={toggle}
              onOpen={onOpen}
              onOpenCreateMenu={openCreateMenu}
              onSelectFolder={onSelectFolder}
              onRename={onRename}
              onDelete={onDelete}
              onMoveToFolder={onMoveToFolder}
              onContextMenu={onContextMenu}
              draggingTarget={draggingTarget}
              dropTargetPath={dropTargetPath}
              onDragStart={setDraggingTarget}
              onDragEnd={clearDragState}
              onDropTargetChange={setDropTargetPath}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function TreeNodes({
  nodes,
  selection,
  expanded,
  onToggle,
  onOpen,
  onOpenCreateMenu,
  onSelectFolder,
  onRename,
  onDelete,
  onMoveToFolder,
  onContextMenu,
  draggingTarget,
  dropTargetPath,
  onDragStart,
  onDragEnd,
  onDropTargetChange,
  forceExpanded = false,
  depth = 0
}: {
  nodes: FileTreeNode[];
  selection?: TreeSelection;
  expanded: Set<string>;
  forceExpanded?: boolean;
  onToggle: (pathRel: string) => void;
  onOpen: (node: FileTreeNode) => void;
  onOpenCreateMenu: (parentPath: string, button: HTMLElement) => void;
  onSelectFolder: (pathRel: string) => void;
  onRename: (target: RenameTarget) => void;
  onDelete: (target: DeleteTarget) => void;
  onMoveToFolder: (target: RenameTarget, destinationPath: string) => void;
  onContextMenu: (menu: { x: number; y: number; target: RenameTarget }) => void;
  draggingTarget?: RenameTarget;
  dropTargetPath?: string;
  onDragStart: (target: RenameTarget) => void;
  onDragEnd: () => void;
  onDropTargetChange: (pathRel?: string) => void;
  depth?: number;
}) {
  const { tr } = useRendererI18n();
  return (
    <div className="tree-list">
      {nodes.map((node) => {
        const targetKind: ItemKind = node.kind === "directory" ? "directory" : node.kind === "markdown" ? "file" : "resource";
        const isActive = selection?.pathRel === node.pathRel && selection.kind === targetKind;
        const isExpanded = forceExpanded || expanded.has(node.pathRel);
        const target: RenameTarget = { pathRel: node.pathRel, kind: targetKind, name: node.name };
        const canDrop = node.kind === "directory" && canDropTreeTarget(draggingTarget, node.pathRel);
        const rowClasses = [
          "tree-row",
          isActive ? "is-active" : "",
          draggingTarget?.pathRel === node.pathRel ? "is-dragging" : "",
          dropTargetPath === node.pathRel && canDrop ? "is-drop-target" : ""
        ].filter(Boolean).join(" ");
        return (
          <div key={node.pathRel} className="tree-node" style={{ paddingLeft: depth * 12 }}>
            <div
              className={rowClasses}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-nolia-tree-item", JSON.stringify(target));
                event.dataTransfer.setData("text/plain", target.pathRel);
                onDragStart(target);
              }}
              onDragEnd={onDragEnd}
              onDragOver={(event) => {
                if (!canDrop) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                onDropTargetChange(node.pathRel);
              }}
              onDragLeave={(event) => {
                if (dropTargetPath !== node.pathRel || containsRelatedTarget(event)) {
                  return;
                }
                onDropTargetChange(undefined);
              }}
              onDrop={(event) => {
                if (!canDrop || !draggingTarget) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const targetToMove = draggingTarget;
                onDragEnd();
                onMoveToFolder(targetToMove, node.pathRel);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu({ x: event.clientX, y: event.clientY, target });
              }}
            >
              <button
                type="button"
                className="tree-main"
                onClick={() => {
                if (node.kind === "directory") {
                  onSelectFolder(node.pathRel);
                  onToggle(node.pathRel);
                } else {
                  onOpen(node);
                }
              }}
            >
                {node.kind === "directory" ? (
                  isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                ) : (
                  <span className="tree-spacer" />
                )}
                {node.kind === "directory" ? <Folder size={15} /> : resourceTreeIcon(node.kind, node.pathRel)}
                <span className="tree-label">{node.name}</span>
              </button>
              {node.kind === "directory" ? (
                <button
                  type="button"
                  className="tree-add-button"
                  title={tr("在 {name} 中新建", { name: node.name })}
                  aria-label={tr("在 {name} 中新建", { name: node.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenCreateMenu(node.pathRel, event.currentTarget);
                  }}
                >
                  <PlusIcon />
                </button>
              ) : null}
            </div>
            {node.kind === "directory" && isExpanded && node.children?.length ? (
              <TreeNodes
                nodes={node.children}
                selection={selection}
                expanded={expanded}
                forceExpanded={forceExpanded}
                onToggle={onToggle}
                onOpen={onOpen}
                onOpenCreateMenu={onOpenCreateMenu}
                onSelectFolder={onSelectFolder}
                onRename={onRename}
                onDelete={onDelete}
                onMoveToFolder={onMoveToFolder}
                onContextMenu={onContextMenu}
                draggingTarget={draggingTarget}
                dropTargetPath={dropTargetPath}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDropTargetChange={onDropTargetChange}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PlusIcon() {
  return <span aria-hidden="true">+</span>;
}

function resourceTreeIcon(kind: FileTreeNode["kind"], pathRel: string) {
  if (kind === "markdown") {
    return <FileText size={15} />;
  }
  const category = resourceCategoryFor(pathRel);
  if (category === "image") {
    return <FileImage size={15} />;
  }
  if (category === "audio") {
    return <FileAudio size={15} />;
  }
  if (category === "video") {
    return <FileVideo size={15} />;
  }
  if (category === "archive") {
    return <FileArchive size={15} />;
  }
  return <FileQuestion size={15} />;
}

function PanelHeader({ title, onToggle }: { title: string; onToggle: () => void }) {
  const { tr } = useRendererI18n();
  return (
    <header className="right-panel-header">
      <strong>{title}</strong>
      <button type="button" className="icon-button compact" title={tr("收起右侧面板")} aria-label={tr("收起右侧面板")} onClick={onToggle}>
        <PanelRightClose size={15} />
      </button>
    </header>
  );
}

function SearchView({
  query,
  results,
  onQueryChange,
  onOpen
}: {
  query: string;
  results: SearchResultItem[];
  onQueryChange: (query: string) => void;
  onOpen: (pathRel: string) => void;
}) {
  const { tr } = useRendererI18n();
  return (
    <div className="sidebar-scroll">
      <SidebarBox title={tr("搜索")}>
        <label className="search-input">
          <Search size={14} />
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={tr("搜索工作区")} />
        </label>
        <div className="result-list">
          {query.trim() && results.length === 0 ? <div className="empty-state">{tr("没有匹配的搜索结果。")}</div> : null}
          {results.map((item) => {
            const snippet = item.snippets[0] ?? item.pathRel;
            return (
              <button key={item.pathRel} type="button" className="result-item" onClick={() => onOpen(item.pathRel)}>
                <strong>{item.title}</strong>
                <small className="result-path">{item.pathRel}</small>
                <span className="result-snippet">
                  <HighlightedText text={snippet} query={query} />
                </span>
              </button>
            );
          })}
        </div>
      </SidebarBox>
    </div>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) {
    return <>{text}</>;
  }
  const lowerText = text.toLocaleLowerCase();
  const lowerNeedle = needle.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerNeedle, cursor);
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const end = matchIndex + needle.length;
    parts.push(
      <mark key={`${matchIndex}:${end}`} className="search-hit">
        {text.slice(matchIndex, end)}
      </mark>
    );
    cursor = end;
    matchIndex = lowerText.indexOf(lowerNeedle, cursor);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return <>{parts}</>;
}

function FavoritesView({
  items,
  onOpen,
  onContextMenu
}: {
  items: FavoriteDocument[];
  onOpen: (pathRel: string) => void;
  onContextMenu: (menu: { x: number; y: number; target: RenameTarget }) => void;
}) {
  const { tr } = useRendererI18n();
  return (
    <div className="sidebar-scroll">
      <SidebarBox title={tr("收藏")}>
        {items.length === 0 ? <div className="empty-state">{tr("暂无收藏文档。")}</div> : null}
        <DocumentSimpleList items={items.map((item) => ({ pathRel: item.pathRel, title: item.title, kind: "file" }))} onOpen={onOpen} onContextMenu={onContextMenu} />
      </SidebarBox>
    </div>
  );
}

function BacklinksView({
  backlinks,
  onOpen
}: {
  backlinks: { linked: Array<{ pathRel: string; title: string; line: number; context: string }>; unlinked: Array<{ pathRel: string; title: string; line: number; context: string }> };
  onOpen: (pathRel: string) => void;
}) {
  const { tr } = useRendererI18n();
  return (
    <div className="sidebar-scroll">
      <SidebarBox title={tr("反向链接")}>
        {backlinks.linked.length === 0 ? <div className="empty-state">{tr("暂无反向链接。")}</div> : null}
        {backlinks.linked.map((item) => (
          <button key={`${item.pathRel}:${item.line}`} type="button" className="result-item" onClick={() => onOpen(item.pathRel)}>
            <strong>{item.title}</strong>
            <span>{item.context}</span>
          </button>
        ))}
      </SidebarBox>
    </div>
  );
}

function RecentView({
  viewed,
  edited,
  onOpen,
  onContextMenu
}: {
  viewed: DocumentListItem[];
  edited: DocumentListItem[];
  onOpen: (pathRel: string) => void;
  onContextMenu: (menu: { x: number; y: number; target: RenameTarget }) => void;
}) {
  const { tr } = useRendererI18n();
  const [activeTab, setActiveTab] = useState<"viewed" | "edited">("viewed");
  const [viewedSnapshot] = useState(viewed);
  const [editedSnapshot] = useState(edited);
  const displayItems = activeTab === "viewed" ? viewedSnapshot : editedSnapshot;
  return (
    <div className="sidebar-scroll">
      <SidebarBox
        title={tr("最近")}
        actions={
          <div className="sidebar-tabs" role="tablist" aria-label={tr("最近记录")}>
            <button type="button" role="tab" aria-selected={activeTab === "viewed"} className={activeTab === "viewed" ? "is-active" : ""} onClick={() => setActiveTab("viewed")}>
              {tr("最近浏览")}
            </button>
            <button type="button" role="tab" aria-selected={activeTab === "edited"} className={activeTab === "edited" ? "is-active" : ""} onClick={() => setActiveTab("edited")}>
              {tr("最近编辑")}
            </button>
          </div>
        }
      >
        {displayItems.length === 0 ? <div className="empty-state">{activeTab === "viewed" ? tr("暂无浏览记录。") : tr("暂无编辑记录。")}</div> : null}
        <DocumentSimpleList items={displayItems} onOpen={onOpen} onContextMenu={onContextMenu} />
      </SidebarBox>
    </div>
  );
}

function DocumentSimpleList({
  items,
  onOpen,
  onContextMenu
}: {
  items: Array<{ pathRel: string; title: string; kind?: "file" | "resource" }>;
  onOpen: (pathRel: string) => void;
  onContextMenu: (menu: { x: number; y: number; target: RenameTarget }) => void;
}) {
  const { tr } = useRendererI18n();
  return (
    <div className="document-simple-list">
      {items.map((item) => {
        const name = item.pathRel.split("/").pop() ?? item.title;
        const kind = item.kind ?? (isMarkdownPath(item.pathRel) ? "file" : "resource");
        return (
          <button
            key={item.pathRel}
            type="button"
            className="document-simple-item"
            onClick={() => onOpen(item.pathRel)}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenu({ x: event.clientX, y: event.clientY, target: { pathRel: item.pathRel, kind, name } });
            }}
          >
            {kind === "resource" ? resourceTreeIcon("other", item.pathRel) : <FileText size={15} />}
            <span className="document-simple-name">{name}</span>
            <span className="document-kind-badge" aria-hidden="true">
              {documentListKindLabel(item.pathRel, kind, tr)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type SettingsTabId = "preferences" | "plugins" | "ai";

function settingsTabs(tr: Translator): Array<{
  id: SettingsTabId;
  label: string;
  title: string;
  description: string;
  help: string;
  icon: typeof Settings2;
}> {
  return [
    {
      id: "preferences",
      label: tr("基础设置"),
      title: tr("基础设置"),
      description: tr("编辑体验"),
      help: tr("调整主题、语言、编辑模式、编辑区宽度和专注模式。"),
      icon: Settings2
    },
    {
      id: "plugins",
      label: tr("插件管理"),
      title: tr("插件管理"),
      description: tr("插件与扩展"),
      help: tr("管理外部插件和内置扩展，外部插件需要手动启用并接受权限。"),
      icon: Plug
    },
    {
      id: "ai",
      label: tr("AI"),
      title: tr("AI 助手"),
      description: tr("模型、隐私与命令"),
      help: tr("配置 AI provider、本地模型、上下文权限和自定义命令。"),
      icon: Bot
    }
  ];
}

function SettingsDialog({
  open,
  settings,
  workspace,
  aiIndexStatus,
  aiIndexRebuildRunning,
  extensionManifests,
  pluginDescriptors,
  settingContributions,
  onUpdate,
  onSetPluginEnabled,
  onAcceptPluginPermissions,
  onRebuildAiIndex,
  onCancelAiIndex,
  onClearAiIndex,
  onClose,
  onReload,
  languageRestartRequired,
  pluginDirectory
}: {
  open: boolean;
  settings?: AppSettings;
  workspace?: WorkspaceInfo;
  aiIndexStatus?: AiIndexStatus;
  aiIndexRebuildRunning: boolean;
  extensionManifests: ExtensionManifest[];
  pluginDescriptors: PluginDescriptor[];
  settingContributions: SettingContribution[];
  onUpdate: (key: string, value: unknown) => Promise<void>;
  onSetPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  onAcceptPluginPermissions: (pluginId: string) => Promise<void>;
  onRebuildAiIndex: () => void;
  onCancelAiIndex: () => void;
  onClearAiIndex: () => void;
  onClose: () => void;
  onReload: () => void;
  languageRestartRequired: boolean;
  pluginDirectory?: string;
}) {
  const { tr } = useRendererI18n();
  const [activeTab, setActiveTab] = useState<SettingsTabId>("preferences");
  const [permissionReviewManifest, setPermissionReviewManifest] = useState<ExtensionManifest | undefined>();
  const activeTabItem = settingsTabs(tr).find((tab) => tab.id === activeTab) ?? settingsTabs(tr)[0];

  useEffect(() => {
    if (!open) {
      setPermissionReviewManifest(undefined);
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  if (!settings) {
    return (
      <div className="modal-layer" role="dialog" aria-modal="true" aria-label={tr("设置")}>
        <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} aria-label={tr("关闭设置")} onClick={onClose} />
        <section className="modal-surface settings-dialog">
          <header className="settings-dialog-header">
            <div>
              <strong>{tr("系统设置")}</strong>
              <span>{tr("加载设置")}</span>
            </div>
            <button type="button" className="icon-button settings-close-button" aria-label={tr("关闭设置")} onClick={onClose}>
              <X size={20} />
            </button>
          </header>
          <div className="settings-dialog-body">
            <nav className="settings-sidebar-tabs" role="tablist" aria-label={tr("设置分类")}>
              {settingsTabs(tr).map((tab) => (
                <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeTab} className={tab.id === activeTab ? "is-active" : ""} disabled>
                  <tab.icon size={18} />
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>
            <div className="settings-content">
              <div className="empty-state">{tr("加载中。")}</div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const preferenceSettingContributions = settingContributions.filter((setting) => setting.category !== "plugins");
  const pluginSettingContributions = settingContributions.filter((setting) => setting.category === "plugins");

  return (
    <>
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={tr("设置")}>
      <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} aria-label={tr("关闭设置")} onClick={onClose} />
      <section className="modal-surface settings-dialog">
        <header className="settings-dialog-header">
          <div>
            <strong>{tr("系统设置")}</strong>
            <span>{activeTabItem.description}</span>
          </div>
          <button type="button" className="icon-button settings-close-button" aria-label={tr("关闭设置")} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="settings-dialog-body">
          <nav className="settings-sidebar-tabs" role="tablist" aria-label={tr("设置分类")}>
            {settingsTabs(tr).map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeTab} className={tab.id === activeTab ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>
                <tab.icon size={18} />
                <span>{tab.label}</span>
              </button>
            ))}
            <div className="settings-sidebar-spacer" />
            <button type="button" className="secondary-button settings-reload-button" onClick={onReload}>
              <Wrench size={14} /> {tr("重新加载")}
            </button>
          </nav>
          <section className="settings-content" role="tabpanel" aria-label={activeTabItem.label}>
            <div className="settings-panel-heading">
              <h2>{activeTabItem.title}</h2>
              <p>{activeTabItem.help}</p>
            </div>
            {activeTab === "preferences" ? (
              <div className="settings-tab-content">
                {languageRestartRequired ? (
                  <div className="plugin-empty-state is-warning">
                    <strong>{tr("重启后生效")}</strong>
                    <span>{tr("语言更改将在重启 Nolia 后生效。")}</span>
                  </div>
                ) : null}
                <div className="settings-form">
                  {preferenceSettingContributions.map((setting) => (
                    <SettingContributionControl key={setting.id} setting={setting} settings={settings} onUpdate={onUpdate} />
                  ))}
                </div>
              </div>
            ) : null}
            {activeTab === "plugins" ? (
              <div className="settings-tab-content settings-tab-content-plugins">
                {pluginSettingContributions.length ? (
                  <div className="settings-form plugin-control-form">
                    {pluginSettingContributions.map((setting) => (
                      <SettingContributionControl key={setting.id} setting={setting} settings={settings} onUpdate={onUpdate} />
                    ))}
                  </div>
                ) : null}
                <PluginSettingsList
                  settings={settings}
                  manifests={dedupeExtensionManifests(extensionManifests)}
                  pluginDescriptors={pluginDescriptors}
                  pluginDirectory={pluginDirectory}
                  onSetPluginEnabled={onSetPluginEnabled}
                  onRequestAcceptPluginPermissions={setPermissionReviewManifest}
                />
              </div>
            ) : null}
            {activeTab === "ai" ? (
              <AiSettingsPanel
                settings={settings}
                workspace={workspace}
                indexStatus={aiIndexStatus}
                indexRebuildRunning={aiIndexRebuildRunning}
                onUpdateAi={(ai) => onUpdate("ai", ai)}
                onRebuildIndex={onRebuildAiIndex}
                onCancelIndex={onCancelAiIndex}
                onClearIndex={onClearAiIndex}
              />
            ) : null}
          </section>
        </div>
      </section>
    </div>
    <ConfirmDialog
      open={Boolean(permissionReviewManifest)}
      title={tr("确认插件权限")}
      message={
        permissionReviewManifest
          ? tr("启用「{name}」前需要确认权限：{permissions}。确认后该插件才可启用。", {
              name: permissionReviewManifest.name,
              permissions: formatPermissionList(permissionReviewManifest.permissions, tr)
            })
          : ""
      }
      confirmLabel={tr("确认权限")}
      onCancel={() => setPermissionReviewManifest(undefined)}
      onConfirm={() => {
        if (permissionReviewManifest) {
          void onAcceptPluginPermissions(permissionReviewManifest.id);
        }
        setPermissionReviewManifest(undefined);
      }}
    />
    </>
  );
}

function AiSettingsPanel({
  settings,
  workspace,
  indexStatus,
  indexRebuildRunning,
  onUpdateAi,
  onRebuildIndex,
  onCancelIndex,
  onClearIndex
}: {
  settings: AppSettings;
  workspace?: WorkspaceInfo;
  indexStatus?: AiIndexStatus;
  indexRebuildRunning: boolean;
  onUpdateAi: (ai: AppSettings["ai"]) => Promise<void> | void;
  onRebuildIndex: () => void;
  onCancelIndex: () => void;
  onClearIndex: () => void;
}) {
  const { tr } = useRendererI18n();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [testMessages, setTestMessages] = useState<Record<string, string>>({});
  const [providerModels, setProviderModels] = useState<Record<string, AiModel[]>>({});
  const [modelMessages, setModelMessages] = useState<Record<string, string>>({});
  const [commandName, setCommandName] = useState("");
  const [commandDescription, setCommandDescription] = useState("");
  const [commandPrompt, setCommandPrompt] = useState("");
  const ai = settings.ai;
  const providers = Object.values(ai.providers).sort((left, right) => left.label.localeCompare(right.label));
  const builtinCommands = [...BUILTIN_AI_COMMANDS].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  const customCommands = Object.values(ai.commands).sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));

  const updateAi = (nextAi: AppSettings["ai"]) => {
    void onUpdateAi(nextAi);
  };
  const updateProvider = (providerId: string, patch: Partial<AiProviderConfig>) => {
    const provider = ai.providers[providerId];
    if (!provider) {
      return;
    }
    updateAi({
      ...ai,
      providers: {
        ...ai.providers,
        [providerId]: { ...provider, ...patch }
      }
    });
  };
  const addOpenAiCompatibleProvider = () => {
    const id = uniqueProviderId(ai.providers, "custom-openai");
    updateAi({
      ...ai,
      providers: {
        ...ai.providers,
        [id]: {
          id,
          type: "openai-compatible",
          label: tr("自定义 OpenAI-compatible"),
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4.1-mini",
          enabled: true
        }
      },
      defaultProviderId: ai.defaultProviderId ?? id
    });
  };
  const saveApiKey = async (provider: AiProviderConfig) => {
    if (!window.nolia.ai) {
      return;
    }
    const value = apiKeys[provider.id]?.trim();
    if (!value) {
      return;
    }
    const credential = await window.nolia.ai.setCredential({ providerId: provider.id, label: provider.label, value });
    setApiKeys((current) => ({ ...current, [provider.id]: "" }));
    updateProvider(provider.id, { apiKeyRef: credential.keyRef });
  };
  const testProvider = async (provider: AiProviderConfig) => {
    if (!window.nolia.ai) {
      return;
    }
    setTestMessages((current) => ({ ...current, [provider.id]: tr("正在测试...") }));
    const result = await window.nolia.ai.testProvider({ providerId: provider.id });
    setTestMessages((current) => ({ ...current, [provider.id]: result.ok ? tr("连接正常") : result.message ?? tr("连接失败") }));
  };
  const loadProviderModels = async (provider: AiProviderConfig) => {
    if (!window.nolia.ai) {
      return;
    }
    setModelMessages((current) => ({ ...current, [provider.id]: tr("加载模型中...") }));
    try {
      const result = await window.nolia.ai.listModels({ providerId: provider.id });
      setProviderModels((current) => ({ ...current, [provider.id]: result.models }));
      setModelMessages((current) => ({
        ...current,
        [provider.id]: result.models.length ? tr("已加载 {count} 个模型", { count: result.models.length }) : tr("未找到模型")
      }));
    } catch (error) {
      setModelMessages((current) => ({ ...current, [provider.id]: errorMessageFor(error, tr("加载模型失败")) }));
    }
  };
  const addCommand = () => {
    const name = commandName.trim();
    const prompt = commandPrompt.trim();
    if (!name || !prompt) {
      return;
    }
    const id = uniqueCommandId(ai.commands, name);
    updateAi({
      ...ai,
      commands: {
        ...ai.commands,
        [id]: {
          id,
          source: "user",
          name,
          description: commandDescription.trim() || undefined,
          promptTemplate: prompt,
          enabled: true,
          order: 10_000 + Object.keys(ai.commands).length,
          scopes: ["selection", "document", "workspace"],
          defaultContext: { includeSelection: true, includeCurrentDocument: true },
          defaultApplyMode: "answer",
          ui: { commandPalette: true, editorToolbar: false, contextMenu: false, aiPanel: true }
        }
      }
    });
    setCommandName("");
    setCommandDescription("");
    setCommandPrompt("");
  };
  const duplicateBuiltinCommand = (command: AiCommandDefinition) => {
    const name = `${command.name} ${tr("副本")}`;
    const id = uniqueCommandId(ai.commands, name);
    updateAi({
      ...ai,
      commands: {
        ...ai.commands,
        [id]: {
          ...command,
          id,
          source: "user",
          pluginId: undefined,
          name,
          order: 10_000 + Object.keys(ai.commands).length
        }
      }
    });
  };
  const updateCustomCommand = (commandId: string, patch: Partial<AiCommandDefinition>) => {
    const command = ai.commands[commandId];
    if (!command) {
      return;
    }
    updateAi({
      ...ai,
      commands: {
        ...ai.commands,
        [commandId]: {
          ...command,
          ...patch,
          source: "user"
        }
      }
    });
  };
  const moveCustomCommand = (commandId: string, direction: -1 | 1) => {
    const index = customCommands.findIndex((command) => command.id === commandId);
    const swap = customCommands[index + direction];
    const command = customCommands[index];
    if (!command || !swap) {
      return;
    }
    updateAi({
      ...ai,
      commands: {
        ...ai.commands,
        [command.id]: { ...command, order: swap.order },
        [swap.id]: { ...swap, order: command.order }
      }
    });
  };
  return (
    <div className="settings-tab-content ai-settings-panel">
      <div className="settings-form">
        <SettingToggle label={tr("启用 AI")} value={ai.enabled} onChange={(enabled) => updateAi({ ...ai, enabled })} />
        <SettingSelect
          label={tr("默认 Provider")}
          value={ai.defaultProviderId ?? ""}
          options={providers.map((provider) => provider.id)}
          labels={Object.fromEntries(providers.map((provider) => [provider.id, provider.label]))}
          onChange={(defaultProviderId) => updateAi({ ...ai, defaultProviderId })}
        />
        <label className="setting-row">
          <span>{tr("默认模型")}</span>
          <input value={ai.defaultModel ?? ""} onChange={(event) => updateAi({ ...ai, defaultModel: event.target.value })} placeholder="model" />
        </label>
      </div>
      <section className="ai-settings-section">
        <header>
          <strong>{tr("Provider")}</strong>
          <button type="button" className="secondary-button" onClick={addOpenAiCompatibleProvider}>
            + {tr("添加")}
          </button>
        </header>
        <div className="ai-provider-list">
          {providers.map((provider) => (
            <div key={provider.id} className="ai-provider-item">
              <div className="ai-provider-head">
                <label>
                  <span>{tr("名称")}</span>
                  <input value={provider.label} onChange={(event) => updateProvider(provider.id, { label: event.target.value })} />
                </label>
                <label className="plugin-toggle">
                  <input type="checkbox" checked={provider.enabled} onChange={(event) => updateProvider(provider.id, { enabled: event.target.checked })} />
                  <span>{provider.enabled ? tr("已启用") : tr("已停用")}</span>
                </label>
              </div>
              <div className="ai-provider-grid">
                <label>
                  <span>{tr("类型")}</span>
                  <select value={provider.type} onChange={(event) => updateProvider(provider.id, { type: event.target.value as AiProviderConfig["type"] })}>
                    <option value="mock">Mock</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                    <option value="openai">OpenAI</option>
                    <option value="ollama">Ollama</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="gemini">Gemini</option>
                  </select>
                </label>
                <label>
                  <span>{tr("Base URL")}</span>
                  <input value={provider.baseUrl ?? ""} onChange={(event) => updateProvider(provider.id, { baseUrl: event.target.value || undefined })} placeholder="https://api.openai.com/v1" />
                </label>
                <label>
                  <span>{tr("模型")}</span>
                  <input value={provider.defaultModel ?? ""} onChange={(event) => updateProvider(provider.id, { defaultModel: event.target.value || undefined })} placeholder="model" />
                </label>
                <label>
                  <span>{tr("Temperature")}</span>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={provider.temperature ?? ""}
                    onChange={(event) => updateProvider(provider.id, { temperature: optionalNumber(event.target.value, 0, 2) })}
                    placeholder="0.7"
                  />
                </label>
                <label>
                  <span>{tr("Max Tokens")}</span>
                  <input
                    type="number"
                    min="1"
                    max="200000"
                    step="1"
                    value={provider.maxTokens ?? ""}
                    onChange={(event) => updateProvider(provider.id, { maxTokens: optionalInteger(event.target.value, 1, 200_000) })}
                    placeholder="4096"
                  />
                </label>
                <label>
                  <span>{tr("API Key")}</span>
                  <input
                    type="password"
                    value={apiKeys[provider.id] ?? ""}
                    onChange={(event) => setApiKeys((current) => ({ ...current, [provider.id]: event.target.value }))}
                    placeholder={provider.apiKeyRef ? tr("已保存") : tr("未保存")}
                  />
                </label>
              </div>
              <div className="ai-provider-actions">
                <button type="button" className="secondary-button" onClick={() => void saveApiKey(provider)} disabled={!apiKeys[provider.id]?.trim()}>
                  {tr("保存密钥")}
                </button>
                <button type="button" className="secondary-button" onClick={() => void testProvider(provider)}>
                  {tr("测试")}
                </button>
                <button type="button" className="secondary-button" onClick={() => void loadProviderModels(provider)} disabled={!provider.enabled}>
                  {tr("加载模型")}
                </button>
                {testMessages[provider.id] ? <span>{testMessages[provider.id]}</span> : null}
                {modelMessages[provider.id] ? <span>{modelMessages[provider.id]}</span> : null}
              </div>
              {providerModels[provider.id]?.length ? (
                <label className="ai-provider-model-select">
                  <span>{tr("模型列表")}</span>
                  <select value={provider.defaultModel ?? ""} onChange={(event) => updateProvider(provider.id, { defaultModel: event.target.value || undefined })}>
                    <option value="">{tr("选择模型")}</option>
                    {providerModels[provider.id].map((model) => (
                      <option key={model.id} value={model.id}>{model.label ?? model.id}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <section className="ai-settings-section">
        <header><strong>{tr("上下文与隐私")}</strong></header>
        <div className="settings-form">
          <SettingToggle label={tr("允许当前文档上下文")} value={ai.privacy.allowCurrentDocumentContext} onChange={(value) => updateAi({ ...ai, privacy: { ...ai.privacy, allowCurrentDocumentContext: value } })} />
          <SettingToggle label={tr("允许工作区上下文")} value={ai.privacy.allowWorkspaceContext} onChange={(value) => updateAi({ ...ai, privacy: { ...ai.privacy, allowWorkspaceContext: value } })} />
          <SettingToggle label={tr("允许附件上下文")} value={ai.privacy.allowAttachmentContext} onChange={(value) => updateAi({ ...ai, privacy: { ...ai.privacy, allowAttachmentContext: value } })} />
          <SettingToggle label={tr("记住同类上下文确认")} value={ai.privacy.rememberContextApproval} onChange={(value) => updateAi({ ...ai, privacy: { ...ai.privacy, rememberContextApproval: value } })} />
          <label className="setting-row">
            <span>{tr("上下文预算字符")}</span>
            <input
              type="number"
              min="1000"
              max="200000"
              step="1000"
              value={ai.privacy.maxContextChars}
              onChange={(event) => updateAi({ ...ai, privacy: { ...ai.privacy, maxContextChars: optionalInteger(event.target.value, 1_000, 200_000) ?? DEFAULT_AI_SETTINGS.privacy.maxContextChars } })}
            />
          </label>
          <SettingToggle label={tr("保存本地对话历史")} value={ai.privacy.saveLocalConversationHistory} onChange={(value) => updateAi({ ...ai, privacy: { ...ai.privacy, saveLocalConversationHistory: value } })} />
        </div>
      </section>
      <section className="ai-settings-section">
        <header>
          <strong>{tr("工作区 AI 索引")}</strong>
          <div className="ai-index-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={onRebuildIndex}
              disabled={!workspace || !ai.index.enabled || indexRebuildRunning}
            >
              <RefreshCw size={14} /> {indexRebuildRunning ? tr("重建中") : tr("重建索引")}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={onCancelIndex}
              disabled={!workspace || indexStatus?.status !== "indexing"}
            >
              {tr("暂停")}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={onClearIndex}
              disabled={!workspace || indexStatus?.status === "indexing"}
            >
              {tr("清空")}
            </button>
          </div>
        </header>
        <div className="settings-form">
          <SettingToggle label={tr("启用工作区 AI 索引")} value={ai.index.enabled} onChange={(value) => updateAi({ ...ai, index: { ...ai.index, enabled: value } })} />
          <SettingToggle label={tr("索引 Markdown 与文本资源")} value={ai.index.includeTextResources} onChange={(value) => updateAi({ ...ai, index: { ...ai.index, includeTextResources: value } })} />
          <SettingToggle label={tr("索引附件内容")} value={ai.index.includeAttachments} onChange={(value) => updateAi({ ...ai, index: { ...ai.index, includeAttachments: value } })} />
          <label className="setting-row">
            <span>{tr("Embedding Provider")}</span>
            <select value={ai.index.embeddingProviderId ?? ""} onChange={(event) => updateAi({ ...ai, index: { ...ai.index, embeddingProviderId: event.target.value || undefined } })}>
              <option value="">{tr("暂不使用 embedding")}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
          </label>
          <label className="setting-row">
            <span>{tr("Embedding 模型")}</span>
            <input value={ai.index.embeddingModel ?? ""} onChange={(event) => updateAi({ ...ai, index: { ...ai.index, embeddingModel: event.target.value || undefined } })} placeholder="text-embedding-3-small" />
          </label>
          <label className="setting-row setting-row-block">
            <span>{tr("排除路径")}</span>
            <textarea
              value={formatAiListSetting(ai.index.excludeGlobs)}
              onChange={(event) => updateAi({ ...ai, index: { ...ai.index, excludeGlobs: parseAiListSetting(event.target.value) } })}
              placeholder=".git/**&#10;node_modules/**"
              rows={4}
            />
          </label>
          <label className="setting-row setting-row-block">
            <span>{tr("排除扩展名")}</span>
            <textarea
              value={formatAiListSetting(ai.index.excludeExtensions)}
              onChange={(event) => updateAi({ ...ai, index: { ...ai.index, excludeExtensions: parseAiListSetting(event.target.value) } })}
              placeholder=".log, .tmp"
              rows={2}
            />
          </label>
          <label className="setting-row setting-row-block">
            <span>{tr("排除标签")}</span>
            <textarea
              value={formatAiListSetting(ai.index.excludeTags)}
              onChange={(event) => updateAi({ ...ai, index: { ...ai.index, excludeTags: parseAiListSetting(event.target.value) } })}
              placeholder="private, draft"
              rows={2}
            />
          </label>
        </div>
        <div className="ai-index-status-card">
          <div>
            <strong>{aiIndexStatusLabel(indexStatus, tr)}</strong>
            <span>{indexStatus?.message ?? (workspace ? tr("尚未重建 AI 索引") : tr("当前无工作区"))}</span>
          </div>
          <span>{tr("片段 {count}", { count: indexStatus?.chunkCount ?? 0 })} · {tr("Embedding {count}", { count: indexStatus?.embeddingChunkCount ?? 0 })}</span>
        </div>
        {indexStatus?.embeddingProfileHash ? (
          <div className="ai-index-meta">{tr("Embedding 配置 {hash}", { hash: indexStatus.embeddingProfileHash.slice(0, 12) })}</div>
        ) : null}
        {indexStatus?.errors?.length ? (
          <div className="ai-index-error-list">
            {indexStatus.errors.slice(0, 5).map((error, index) => (
              <span key={`${error.pathRel ?? "workspace"}:${error.at}:${index}`}>{error.pathRel ? `${error.pathRel}: ` : ""}{error.message}</span>
            ))}
          </div>
        ) : null}
      </section>
      <section className="ai-settings-section">
        <header><strong>{tr("预置命令")}</strong></header>
        <div className="ai-builtin-command-list">
          {builtinCommands.map((command) => (
            <div key={command.id} className="ai-builtin-command-item">
              <div>
                <strong>{command.name}</strong>
                <span>{command.description ?? command.promptTemplate}</span>
                <small>{formatAiCommandMeta(command, tr)}</small>
              </div>
              <button type="button" className="secondary-button" onClick={() => duplicateBuiltinCommand(command)}>
                <Copy size={14} /> {tr("复制为自定义")}
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="ai-settings-section">
        <header><strong>{tr("自定义命令")}</strong></header>
        <div className="ai-command-editor">
          <input value={commandName} onChange={(event) => setCommandName(event.target.value)} placeholder={tr("命令名称")} />
          <input value={commandDescription} onChange={(event) => setCommandDescription(event.target.value)} placeholder={tr("命令描述")} />
          <textarea value={commandPrompt} onChange={(event) => setCommandPrompt(event.target.value)} placeholder={tr("Prompt 模板")} rows={3} />
          <button type="button" className="secondary-button" onClick={addCommand}>{tr("添加命令")}</button>
        </div>
        <div className="ai-custom-command-list">
          {customCommands.length === 0 ? <div className="plugin-empty-state">{tr("暂无自定义命令。预置命令始终可用。")}</div> : null}
          {customCommands.map((command, index) => (
            <div key={command.id} className="ai-custom-command-item">
              <div className="ai-custom-command-fields">
                <div className="ai-command-badges">
                  <span>{aiCommandSourceLabel(command, tr)}</span>
                  <span>{formatAiCommandMeta(command, tr)}</span>
                </div>
                <label>
                  <span>{tr("命令名称")}</span>
                  <input value={command.name} onChange={(event) => updateCustomCommand(command.id, { name: event.target.value })} />
                </label>
                <label>
                  <span>{tr("命令描述")}</span>
                  <input value={command.description ?? ""} onChange={(event) => updateCustomCommand(command.id, { description: event.target.value || undefined })} />
                </label>
                <label>
                  <span>{tr("Prompt 模板")}</span>
                  <textarea value={command.promptTemplate} onChange={(event) => updateCustomCommand(command.id, { promptTemplate: event.target.value })} rows={3} />
                </label>
                <label>
                  <span>{tr("结果应用方式")}</span>
                  <select value={command.defaultApplyMode} onChange={(event) => updateCustomCommand(command.id, { defaultApplyMode: event.target.value as AiApplyMode })}>
                    <option value="answer">{tr("仅回答")}</option>
                    <option value="replace">{tr("替换选区")}</option>
                    <option value="insert">{tr("插入")}</option>
                    <option value="append">{tr("追加")}</option>
                    <option value="new-document">{tr("新建笔记")}</option>
                    <option value="diff">{tr("变更计划")}</option>
                  </select>
                </label>
                <fieldset className="ai-command-checkbox-group">
                  <legend>{tr("适用范围")}</legend>
                  {(["selection", "document", "folder", "workspace"] as const).map((scope) => (
                    <label key={scope} className="plugin-toggle">
                      <input
                        type="checkbox"
                        checked={command.scopes.includes(scope)}
                        onChange={() => updateCustomCommand(command.id, { scopes: toggleAiCommandScope(command.scopes, scope) })}
                      />
                      <span>{aiScopeLabel(scope, tr)}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="ai-command-checkbox-group">
                  <legend>{tr("默认上下文")}</legend>
                  <label className="plugin-toggle">
                    <input type="checkbox" checked={Boolean(command.defaultContext.includeSelection)} onChange={(event) => updateCustomCommand(command.id, { defaultContext: { ...command.defaultContext, includeSelection: event.target.checked } })} />
                    <span>{tr("选区")}</span>
                  </label>
                  <label className="plugin-toggle">
                    <input type="checkbox" checked={Boolean(command.defaultContext.includeCurrentDocument)} onChange={(event) => updateCustomCommand(command.id, { defaultContext: { ...command.defaultContext, includeCurrentDocument: event.target.checked } })} />
                    <span>{tr("当前文档")}</span>
                  </label>
                  <label className="plugin-toggle">
                    <input type="checkbox" checked={Boolean(command.defaultContext.includeWorkspaceResults)} onChange={(event) => updateCustomCommand(command.id, { defaultContext: { ...command.defaultContext, includeWorkspaceResults: event.target.checked } })} />
                    <span>{tr("工作区结果")}</span>
                  </label>
                  <label className="plugin-toggle">
                    <input type="checkbox" checked={Boolean(command.defaultContext.includeBacklinks)} onChange={(event) => updateCustomCommand(command.id, { defaultContext: { ...command.defaultContext, includeBacklinks: event.target.checked } })} />
                    <span>{tr("反向链接")}</span>
                  </label>
                  <label className="plugin-toggle">
                    <input type="checkbox" checked={Boolean(command.defaultContext.includeAttachments)} onChange={(event) => updateCustomCommand(command.id, { defaultContext: { ...command.defaultContext, includeAttachments: event.target.checked } })} />
                    <span>{tr("附件")}</span>
                  </label>
                </fieldset>
                <fieldset className="ai-command-checkbox-group">
                  <legend>{tr("显示入口")}</legend>
                  <label className="plugin-toggle">
                    <input type="checkbox" checked={command.ui.commandPalette} onChange={(event) => updateCustomCommand(command.id, { ui: { ...command.ui, commandPalette: event.target.checked } })} />
                    <span>{tr("命令面板")}</span>
                  </label>
                  <label className="plugin-toggle">
                    <input type="checkbox" checked={command.ui.editorToolbar} onChange={(event) => updateCustomCommand(command.id, { ui: { ...command.ui, editorToolbar: event.target.checked } })} />
                    <span>{tr("编辑器工具栏")}</span>
                  </label>
                  <label className="plugin-toggle">
                    <input type="checkbox" checked={command.ui.contextMenu} onChange={(event) => updateCustomCommand(command.id, { ui: { ...command.ui, contextMenu: event.target.checked } })} />
                    <span>{tr("右键菜单")}</span>
                  </label>
                  <label className="plugin-toggle">
                    <input type="checkbox" checked={command.ui.aiPanel} onChange={(event) => updateCustomCommand(command.id, { ui: { ...command.ui, aiPanel: event.target.checked } })} />
                    <span>{tr("AI 面板")}</span>
                  </label>
                </fieldset>
              </div>
              <div className="ai-custom-command-actions">
                <label className="plugin-toggle">
                  <input type="checkbox" checked={command.enabled} onChange={(event) => updateCustomCommand(command.id, { enabled: event.target.checked })} />
                  <span>{command.enabled ? tr("已启用") : tr("已停用")}</span>
                </label>
                <button type="button" className="secondary-button" onClick={() => moveCustomCommand(command.id, -1)} disabled={index === 0}>{tr("上移")}</button>
                <button type="button" className="secondary-button" onClick={() => moveCustomCommand(command.id, 1)} disabled={index === customCommands.length - 1}>{tr("下移")}</button>
                <button
                  type="button"
                  className="icon-button compact"
                  title={tr("删除")}
                  aria-label={tr("删除")}
                  onClick={() => {
                    const nextCommands = { ...ai.commands };
                    delete nextCommands[command.id];
                    updateAi({ ...ai, commands: nextCommands });
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingContributionControl({
  setting,
  settings,
  onUpdate
}: {
  setting: SettingContribution;
  settings: AppSettings;
  onUpdate: (key: string, value: unknown) => Promise<void>;
}) {
  const value = settings[setting.key as keyof AppSettings];
  if (setting.type === "toggle") {
    return <SettingToggle label={setting.label} value={Boolean(value)} onChange={(nextValue) => void onUpdate(setting.key, nextValue)} />;
  }
  if (setting.type === "select") {
    const options = setting.options?.map((option) => option.value) ?? [];
    const labels = Object.fromEntries(setting.options?.map((option) => [option.value, option.label]) ?? []);
    return <SettingSelect label={setting.label} value={String(value ?? "")} options={options} labels={labels} onChange={(nextValue) => void onUpdate(setting.key, nextValue)} />;
  }
  return (
    <label className="setting-row">
      <span>{setting.label}</span>
      <input
        type={setting.type === "number" ? "number" : "text"}
        value={String(value ?? "")}
        onChange={(event) => void onUpdate(setting.key, setting.type === "number" ? Number(event.target.value) : event.target.value)}
      />
    </label>
  );
}

function PluginSettingsList({
  settings,
  manifests,
  pluginDescriptors,
  pluginDirectory,
  onSetPluginEnabled,
  onRequestAcceptPluginPermissions
}: {
  settings: AppSettings;
  manifests: ExtensionManifest[];
  pluginDescriptors: PluginDescriptor[];
  pluginDirectory?: string;
  onSetPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  onRequestAcceptPluginPermissions: (manifest: ExtensionManifest) => void;
}) {
  const { tr } = useRendererI18n();
  const descriptorById = new Map(pluginDescriptors.map((descriptor) => [descriptor.pluginId, descriptor]));
  const externalManifests = manifests.filter((manifest) => !manifest.builtIn);
  const builtInManifests = manifests.filter((manifest) => manifest.builtIn);
  const invalidPlugins = pluginDescriptors.filter((descriptor) => !descriptor.manifest);
  return (
    <section className="plugin-settings">
      {settings.pluginSafeMode ? (
        <div className="plugin-empty-state is-warning">
          {tr("插件安全模式已开启，所有外部插件都会被阻止运行。关闭安全模式后，已启用且权限有效的插件会恢复加载。")}
        </div>
      ) : null}
      <header>
        <strong>{tr("外部插件")}</strong>
        <span>{pluginDirectory ? tr("插件目录：{path}", { path: pluginDirectory }) : tr("插件目录：等待应用启动信息")}</span>
      </header>
      <div className="plugin-settings-list">
        {externalManifests.length === 0 && invalidPlugins.length === 0 ? (
          <div className="plugin-empty-state">
            {tr("当前没有发现外部插件。将插件放入全局插件目录后，重启或点击“重新加载”。")}
          </div>
        ) : null}
        {externalManifests.map((manifest) => (
          <PluginSettingsItem
            key={manifest.id}
            manifest={manifest}
            settings={settings}
            descriptor={descriptorById.get(manifest.id)}
            onSetPluginEnabled={onSetPluginEnabled}
            onRequestAcceptPluginPermissions={onRequestAcceptPluginPermissions}
          />
        ))}
        {invalidPlugins.map((descriptor) => (
          <div key={descriptor.pluginId} className="plugin-settings-item is-invalid">
            <div>
              <strong>{descriptor.pluginId}</strong>
              <span>{tr("插件清单无效")}</span>
              {descriptor.diagnostics.map((diagnostic) => (
                <small key={diagnostic.message} className={`plugin-diagnostic is-${diagnostic.level}`}>{diagnostic.message}</small>
              ))}
            </div>
          </div>
        ))}
      </div>
      <header>
        <strong>{tr("内置扩展")}</strong>
        <span>{tr("默认功能也由扩展注册机制提供，必需扩展不可停用。")}</span>
      </header>
      <div className="plugin-settings-list">
        {builtInManifests.map((manifest) => (
          <PluginSettingsItem
            key={manifest.id}
            manifest={manifest}
            settings={settings}
            descriptor={descriptorById.get(manifest.id)}
            onSetPluginEnabled={onSetPluginEnabled}
            onRequestAcceptPluginPermissions={onRequestAcceptPluginPermissions}
          />
        ))}
      </div>
    </section>
  );
}

function PluginSettingsItem({
  manifest,
  settings,
  descriptor,
  onSetPluginEnabled,
  onRequestAcceptPluginPermissions
}: {
  manifest: ExtensionManifest;
  settings: AppSettings;
  descriptor?: PluginDescriptor;
  onSetPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>;
  onRequestAcceptPluginPermissions: (manifest: ExtensionManifest) => void;
}) {
  const { tr } = useRendererI18n();
  const enabled = isExtensionEnabled(manifest, settings);
  const permissionsAccepted = isExtensionPermissionAccepted(manifest, settings);
  const canToggle = !manifest.required && (manifest.builtIn || Boolean(descriptor?.manifest));
  const disabledReason = descriptor?.disabledReason ?? settings.plugins[manifest.id]?.disabledReason;
  return (
    <div className="plugin-settings-item">
      <div>
        <strong>{manifest.name}</strong>
        <span>{tr("{id} · 版本 {version} · API v{apiVersion}", { id: manifest.id, version: manifest.version, apiVersion: manifest.apiVersion ?? 1 })}</span>
        {manifest.permissions?.length ? <small>{formatPermissionList(manifest.permissions, tr)}</small> : null}
        {descriptor?.needsPermissionReview ? <small className="plugin-diagnostic is-warning">{tr("权限已变更，需要重新确认。")}</small> : null}
        {disabledReason ? <small className="plugin-diagnostic is-warning">{disabledReason}</small> : null}
        {descriptor?.diagnostics.map((diagnostic) => (
          <small key={diagnostic.message} className={`plugin-diagnostic is-${diagnostic.level}`}>{diagnostic.message}</small>
        ))}
      </div>
      <div className="plugin-settings-actions">
        {!manifest.builtIn && !permissionsAccepted ? (
          <button type="button" className="secondary-button" onClick={() => onRequestAcceptPluginPermissions(manifest)}>
            {tr("接受权限")}
          </button>
        ) : null}
        <label className="plugin-toggle">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canToggle || (!manifest.builtIn && !permissionsAccepted)}
            onChange={(event) => void onSetPluginEnabled(manifest.id, event.target.checked)}
          />
          <span>{manifest.required ? tr("必需") : enabled ? tr("已启用") : tr("已停用")}</span>
        </label>
      </div>
    </div>
  );
}

function formatExtensionPermission(permission: ExtensionPermission, tr = createTranslator("zh-CN")): string {
  if (permission.startsWith("network:request:")) {
    return tr("网络请求：{host}", { host: permission.replace("network:request:", "") });
  }
  switch (permission) {
    case "workspace:read":
      return tr("读取工作区");
    case "workspace:write":
      return tr("写入工作区");
    case "workspace:file:read":
      return tr("读取工作区文件");
    case "workspace:file:write":
      return tr("写入工作区文件");
    case "workspace:file:create":
      return tr("创建工作区文件");
    case "workspace:file:delete":
      return tr("删除工作区文件");
    case "clipboard:read":
      return tr("读取剪贴板");
    case "clipboard:write":
      return tr("写入剪贴板");
    case "network:request":
      return tr("网络请求");
    case "ui:contribute":
      return tr("贡献界面");
    default:
      return permission;
  }
}

function formatPermissionList(permissions: ExtensionPermission[] | undefined, tr = createTranslator("zh-CN")): string {
  if (!permissions?.length) {
    return tr("无额外权限");
  }
  return permissions.map((permission) => formatExtensionPermission(permission, tr)).join(tr("权限分隔符"));
}

function documentListKindLabel(pathRel: string, kind: "file" | "resource", tr = createTranslator("zh-CN")): string {
  if (kind === "file") {
    return tr("笔记");
  }
  const category = resourceCategoryFor(pathRel);
  switch (category) {
    case "image":
      return tr("图片");
    case "pdf":
      return "PDF";
    case "audio":
      return tr("音频");
    case "video":
      return tr("视频");
    case "archive":
      return tr("压缩包");
    case "text":
      return tr("文本");
    case "diagram":
      return tr("图表");
    case "other":
    default:
      return tr("资源");
  }
}

function AiAssistantPanel({
  enabled,
  workspace,
  document,
  commands,
  messages,
  preview,
  indexStatus,
  indexRebuildRunning,
  insights,
  insightsWarnings,
  insightsLoading,
  runningRequestId,
  onAsk,
  onRunCommand,
  onCancel,
  onApply,
  onRebuildIndex,
  onRefreshInsights,
  onOpenInsight,
  onApplyInsight,
  onOpenSettings,
  onOpenCitation,
  onClearMessages
}: {
  enabled: boolean;
  workspace?: WorkspaceInfo;
  document?: OpenDocumentTab;
  commands: AiCommandDefinition[];
  messages: AiPanelMessage[];
  preview?: AiContextPreviewResponse;
  indexStatus?: AiIndexStatus;
  indexRebuildRunning: boolean;
  insights: AiInsightItem[];
  insightsWarnings: string[];
  insightsLoading: boolean;
  runningRequestId?: string;
  onAsk: (prompt: string, scope: AiEditorSnapshot["scope"]) => void;
  onRunCommand: (commandId: string) => void;
  onCancel: () => void;
  onApply: (text: string, mode: AiApplyMode) => void;
  onRebuildIndex: () => void;
  onRefreshInsights: () => void;
  onOpenInsight: (insight: AiInsightItem) => void;
  onApplyInsight: (insight: AiInsightItem) => void;
  onOpenSettings: () => void;
  onOpenCitation: (citation: AiCitation) => void;
  onClearMessages: () => void;
}) {
  const { tr } = useRendererI18n();
  const [prompt, setPrompt] = useState("");
  const [scope, setScope] = useState<AiEditorSnapshot["scope"]>("document");
  const latestAnswer = [...messages].reverse().find((message) => message.role === "assistant" && message.text.trim());
  const visibleCommands = commands.filter((command) => command.ui.aiPanel);
  const canAsk = enabled && Boolean(prompt.trim() || document);
  return (
    <div className="ai-assistant-panel">
      {!enabled ? (
        <div className="ai-notice is-warning">
          <strong>{tr("AI 未启用")}</strong>
          <span>{tr("开启 AI 后可以使用当前文档、选区和工作区搜索结果。")}</span>
          <button type="button" className="secondary-button" onClick={onOpenSettings}>
            <Settings2 size={14} /> {tr("打开 AI 设置")}
          </button>
        </div>
      ) : null}
      <div className="ai-scope-tabs" role="tablist" aria-label={tr("AI 范围")}>
        {(["selection", "document", "folder", "workspace"] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={scope === item} className={scope === item ? "is-active" : ""} onClick={() => setScope(item)}>
            {aiScopeLabel(item, tr)}
          </button>
        ))}
      </div>
      <section className="ai-index-mini" aria-label={tr("工作区 AI 索引")}>
        <div>
          <strong>{aiIndexStatusLabel(indexStatus, tr)}</strong>
          <span>{indexStatus?.chunkCount ? tr("片段 {count}", { count: indexStatus.chunkCount }) : indexStatus?.message ?? tr("尚未重建 AI 索引")}</span>
        </div>
        <button
          type="button"
          className="icon-button compact"
          title={tr("重建索引")}
          aria-label={tr("重建索引")}
          onClick={onRebuildIndex}
          disabled={!workspace || !enabled || indexRebuildRunning}
        >
          <RefreshCw size={14} />
        </button>
      </section>
      <section className="ai-command-strip" aria-label={tr("AI 命令")}>
        {visibleCommands.map((command) => (
          <button key={command.id} type="button" className="ai-command-chip" disabled={!enabled} onClick={() => onRunCommand(command.id)}>
            <Sparkles size={13} />
            <span>{command.name}</span>
          </button>
        ))}
        {visibleCommands.length === 0 ? <div className="empty-state">{tr("暂无 AI 命令。")}</div> : null}
      </section>
      <section className="ai-context-preview" aria-label={tr("AI 上下文")}>
        <div className="ai-section-title">
          <strong>{tr("上下文")}</strong>
          <span>{preview ? tr("约 {count} 字符", { count: preview.estimatedInputChars }) : workspace ? tr("发送前生成预览") : tr("当前无工作区")}</span>
        </div>
        {preview?.warnings.map((warning) => <div key={warning} className="ai-warning">{warning}</div>)}
        {preview?.items.map((item) => (
          <div key={item.id} className="ai-context-item">
            <strong>{item.label}</strong>
            <span>{item.pathRel ?? item.title ?? aiContextKindLabel(item.kind, tr)}</span>
          </div>
        ))}
        {!preview ? <div className="empty-state">{document ? tr("提问或运行命令后显示将发送的上下文。") : tr("打开文档后可使用 AI。")}</div> : null}
      </section>
      <section className="ai-insight-panel" aria-label={tr("整理建议")}>
        <div className="ai-section-title">
          <strong>{tr("整理建议")}</strong>
          <button
            type="button"
            className="icon-button compact"
            title={tr("刷新建议")}
            aria-label={tr("刷新建议")}
            onClick={onRefreshInsights}
            disabled={!workspace || !document || !enabled || insightsLoading}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {insightsWarnings.map((warning) => <div key={warning} className="ai-warning">{warning}</div>)}
        {insights.map((insight) => (
          <article key={insight.id} className="ai-insight-item">
            <div>
              <strong>{insight.label}</strong>
              <span>{insight.pathRel ?? insight.target ?? aiInsightKindLabel(insight.kind, tr)}</span>
            </div>
            <p>{insight.excerpt}</p>
            <div className="ai-insight-actions">
              {insight.pathRel ? (
                <button type="button" className="secondary-button" onClick={() => onOpenInsight(insight)}>
                  {tr("打开来源")}
                </button>
              ) : null}
              {isAiInsightApplicable(insight) ? (
                <button type="button" className="secondary-button" onClick={() => onApplyInsight(insight)}>
                  {tr("应用建议")}
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {insightsLoading ? <div className="empty-state">{tr("正在刷新建议...")}</div> : null}
        {!insightsLoading && insights.length === 0 && insightsWarnings.length === 0 ? <div className="empty-state">{tr("暂无整理建议。")}</div> : null}
      </section>
      <section className="ai-message-list" aria-label={tr("AI 对话")}>
        <div className="ai-message-list-header">
          <strong>{tr("AI 对话")}</strong>
          <button
            type="button"
            className="icon-button compact"
            title={tr("清空对话")}
            aria-label={tr("清空对话")}
            onClick={onClearMessages}
            disabled={messages.length === 0 || Boolean(runningRequestId)}
          >
            <Trash2 size={14} />
          </button>
        </div>
        {messages.length === 0 ? <div className="empty-state">{tr("选择命令或直接提问。")}</div> : null}
        {messages.map((message) => (
          <article key={message.id} className={`ai-message is-${message.role}${message.status === "error" ? " is-error" : ""}`}>
            <header>
              <strong>{message.role === "assistant" ? tr("AI") : message.role === "system" ? tr("系统") : tr("你")}</strong>
              {message.commandName ? <span>{message.commandName}</span> : null}
            </header>
            <p>{message.text || (message.status === "pending" ? tr("正在生成...") : "")}</p>
            {message.citations?.length ? (
              <div className="ai-citations">
                {message.citations.slice(0, 6).map((citation) => (
                  <button
                    key={`${citation.contextItemId}:${citation.pathRel ?? ""}:${citation.line ?? ""}`}
                    type="button"
                    title={citation.line !== undefined ? tr("{path} 第 {line} 行", { path: citation.pathRel ?? citation.title ?? citation.contextItemId, line: citation.line }) : citation.pathRel ?? citation.title ?? citation.contextItemId}
                    onClick={() => onOpenCitation(citation)}
                    disabled={!citation.pathRel}
                  >
                    {citation.pathRel ?? citation.title ?? citation.contextItemId}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </section>
      {latestAnswer?.text ? (
        <div className="ai-result-actions" role="toolbar" aria-label={tr("AI 结果操作")}>
          <button type="button" className="secondary-button" onClick={() => onApply(latestAnswer.text, "copy")}>{tr("复制")}</button>
          <button type="button" className="secondary-button" onClick={() => onApply(latestAnswer.text, "insert")}>{tr("插入")}</button>
          <button type="button" className="secondary-button" onClick={() => onApply(latestAnswer.text, "replace")}>{tr("替换选区")}</button>
          <button type="button" className="secondary-button" onClick={() => onApply(latestAnswer.text, "append")}>{tr("追加")}</button>
          <button type="button" className="secondary-button" onClick={() => onApply(latestAnswer.text, "new-document")}>{tr("新建笔记")}</button>
          <button type="button" className="secondary-button" onClick={() => onApply(latestAnswer.text, "diff")}>{tr("变更计划")}</button>
        </div>
      ) : null}
      <form
        className="ai-composer"
        onSubmit={(event) => {
          event.preventDefault();
          const nextPrompt = prompt.trim();
          if (!canAsk) {
            return;
          }
          setPrompt("");
          onAsk(nextPrompt, scope);
        }}
      >
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={tr("向当前上下文提问")} rows={3} />
        <div className="ai-composer-actions">
          {runningRequestId ? (
            <button type="button" className="secondary-button" onClick={onCancel}>{tr("停止")}</button>
          ) : null}
          <button type="submit" className="primary-button" disabled={!canAsk || Boolean(runningRequestId)}>
            <Send size={14} /> {tr("发送")}
          </button>
        </div>
      </form>
    </div>
  );
}

function AiChangePlanDialog({
  plan,
  onClose,
  onApplyChange,
  onApplyAll,
  onSetChangeStatus
}: {
  plan?: AiChangePlanState;
  onClose: () => void;
  onApplyChange: (changeId: string) => void;
  onApplyAll: () => void;
  onSetChangeStatus: (changeId: string, status: AiChangePlanOperation["status"]) => void;
}) {
  const { tr } = useRendererI18n();
  if (!plan) {
    return null;
  }
  const pendingCount = plan.operations.filter(isAiChangeApplicable).length;
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={tr("AI 变更计划")}>
      <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} aria-label={tr("关闭")} onClick={onClose} />
      <section className="modal-surface ai-change-plan-dialog">
        <header className="settings-dialog-header">
          <div>
            <strong>{tr("AI 变更计划")}</strong>
            <span>{plan.error ?? tr("审核后再写入工作区")}</span>
          </div>
          <button type="button" className="icon-button settings-close-button" aria-label={tr("关闭")} onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="ai-change-plan-body">
          {plan.error ? (
            <div className="plugin-empty-state is-warning">
              <strong>{plan.error}</strong>
              <span>{tr("请让 AI 按变更计划 JSON 格式重新生成。")}</span>
            </div>
          ) : null}
          {plan.operations.map((change) => (
            <article key={change.id} className={`ai-change-item is-${change.status ?? "pending"}`}>
              <header>
                <div>
                  <strong>{change.title || change.pathRel}</strong>
                  <span>{aiChangeActionLabel(change.action, tr)} · {aiChangeResultPath(change)}</span>
                </div>
                <div className="ai-change-actions">
                  {change.status === "rejected" ? (
                    <button type="button" className="secondary-button" onClick={() => onSetChangeStatus(change.id, "pending")}>
                      {tr("重新接受")}
                    </button>
                  ) : null}
                  {change.status !== "rejected" && change.status !== "applied" && change.status !== "applying" ? (
                    <button type="button" className="secondary-button" onClick={() => onSetChangeStatus(change.id, "rejected")}>
                      {tr("拒绝")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => onApplyChange(change.id)}
                    disabled={!isAiChangeApplicable(change)}
                  >
                    {change.status === "applied" ? tr("已应用") : change.status === "applying" ? tr("应用中") : tr("应用")}
                  </button>
                </div>
              </header>
              <pre>{aiChangePreview(change, tr).slice(0, 2000)}</pre>
              {change.message ? <span className="ai-change-message">{change.message}</span> : null}
            </article>
          ))}
          {plan.warnings.map((warning) => <div key={warning} className="ai-warning">{warning}</div>)}
          {!plan.error && plan.operations.length === 0 ? <div className="empty-state">{tr("没有可应用的变更。")}</div> : null}
        </div>
        <footer className="ai-change-plan-actions">
          <button type="button" className="secondary-button" onClick={onClose}>{tr("关闭")}</button>
          <button type="button" className="primary-button" disabled={Boolean(plan.error) || pendingCount === 0} onClick={onApplyAll}>
            <SquareCheckBig size={14} /> {tr("应用全部")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function AiContextApprovalDialog({
  pending,
  rememberEnabled,
  onToggleContextItem,
  onCancel,
  onConfirm
}: {
  pending?: AiPendingContextApproval;
  rememberEnabled: boolean;
  onToggleContextItem: (itemId: string) => void;
  onCancel: () => void;
  onConfirm: (remember: boolean) => void;
}) {
  const { tr } = useRendererI18n();
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (pending) {
      setRemember(false);
    }
  }, [pending?.preview.previewId]);

  if (!pending) {
    return null;
  }

  const excluded = new Set(pending.excludedContextItemIds);
  const includedItems = pending.preview.items.filter((item) => !excluded.has(item.id));

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={tr("确认 AI 上下文")}>
      <button type="button" className="modal-backdrop" aria-hidden="true" tabIndex={-1} aria-label={tr("取消")} onClick={onCancel} />
      <section className="modal-surface ai-context-approval-dialog">
        <header className="settings-dialog-header">
          <div>
            <strong>{tr("确认 AI 上下文")}</strong>
            <span>{tr("发送前检查将提供给模型的内容。")}</span>
          </div>
          <button type="button" className="icon-button settings-close-button" aria-label={tr("关闭")} onClick={onCancel}>
            <X size={20} />
          </button>
        </header>
        <div className="ai-context-approval-body">
          <div className="ai-context-approval-summary">
            <strong>{pending.commandName ?? aiScopeLabel(pending.scope, tr)}</strong>
            <span>
              {pending.preview.items.length
                ? tr("将发送 {count} 个上下文来源", { count: includedItems.length })
                : tr("暂无上下文，将仅发送用户请求。")}
            </span>
          </div>
          {pending.preview.warnings.map((warning) => (
            <div key={warning} className="ai-warning">{warning}</div>
          ))}
          <div className="ai-context-approval-list">
            {pending.preview.items.map((item) => {
              const isExcluded = excluded.has(item.id);
              return (
                <article key={item.id} className={`ai-context-approval-item${isExcluded ? " is-excluded" : ""}`}>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.pathRel ?? item.title ?? aiContextKindLabel(item.kind, tr)}</span>
                    <p>{item.excerpt}</p>
                  </div>
                  <button type="button" className="secondary-button" onClick={() => onToggleContextItem(item.id)}>
                    {isExcluded ? tr("包含") : tr("排除")}
                  </button>
                </article>
              );
            })}
            {pending.preview.items.length === 0 ? (
              <div className="empty-state">{tr("暂无上下文，将仅发送用户请求。")}</div>
            ) : null}
          </div>
        </div>
        <footer className="ai-context-approval-actions">
          <label className="plugin-toggle">
            <input type="checkbox" checked={remember} disabled={!rememberEnabled} onChange={(event) => setRemember(event.target.checked)} />
            <span>{tr("跳过本工作区同类确认")}</span>
          </label>
          <div>
            <button type="button" className="secondary-button" onClick={onCancel}>{tr("取消")}</button>
            <button type="button" className="primary-button" onClick={() => onConfirm(remember)}>
              <Send size={14} /> {tr("确认发送")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function aiScopeLabel(scope: AiEditorSnapshot["scope"], tr = createTranslator("zh-CN")): string {
  switch (scope) {
    case "selection":
      return tr("选区");
    case "folder":
      return tr("文件夹");
    case "workspace":
      return tr("工作区");
    case "document":
    default:
      return tr("文档");
  }
}

function aiIndexStatusLabel(status: AiIndexStatus | undefined, tr = createTranslator("zh-CN")): string {
  switch (status?.status) {
    case "disabled":
      return tr("AI 索引未启用");
    case "indexing":
      return tr("AI 索引构建中");
    case "paused":
      return tr("AI 索引已暂停");
    case "ready":
      return tr("AI 索引可用");
    case "error":
      return tr("AI 索引异常");
    case "idle":
    default:
      return tr("AI 索引待构建");
  }
}

function aiContextKindLabel(kind: AiContextPreviewResponse["items"][number]["kind"], tr = createTranslator("zh-CN")): string {
  switch (kind) {
    case "selection":
      return tr("选区");
    case "current-document":
      return tr("当前文档");
    case "workspace-search-result":
      return tr("工作区搜索");
    case "backlink":
      return tr("反向链接");
    case "attachment":
      return tr("附件");
    case "web":
      return tr("网页");
    default:
      return kind;
  }
}

function aiInsightKindLabel(kind: AiInsightItem["kind"], tr = createTranslator("zh-CN")): string {
  switch (kind) {
    case "similar":
      return tr("相关笔记");
    case "duplicate":
      return tr("疑似重复");
    case "tag":
      return tr("标签建议");
    case "backlink":
      return tr("双链建议");
    case "topic":
      return tr("主题线索");
    default:
      return kind;
  }
}

function DocumentDetails({
  doc,
  backlinks
}: {
  doc?: OpenDocumentTab;
  backlinks: { linked: Array<{ pathRel: string; title: string; line: number; context: string }>; unlinked: Array<{ pathRel: string; title: string; line: number; context: string }> };
}) {
  const { tr } = useRendererI18n();
  if (!doc) {
    return <div className="sidebar-scroll"><SidebarBox title={tr("文档")}><div className="empty-state">{tr("未打开文档")}</div></SidebarBox></div>;
  }
  return (
    <div className="sidebar-scroll">
      <SidebarBox title={tr("目录")}>
        {doc.parsed.headings.length === 0 ? <div className="empty-state">{tr("暂无标题。")}</div> : null}
        {doc.parsed.headings.map((heading) => (
          <button key={heading.id} type="button" className="result-item outline-item" style={outlineItemStyle(heading.depth)}>
            <strong>{heading.text}</strong>
            <span>{tr("第 {line} 行", { line: heading.line })}</span>
          </button>
        ))}
      </SidebarBox>
      <SidebarBox title={tr("反向链接")}>
        {backlinks.linked.slice(0, 6).map((item) => (
          <div key={`${item.pathRel}:${item.line}`} className="small-row">
            <strong>{item.title}</strong>
            <span>{item.context}</span>
          </div>
        ))}
      </SidebarBox>
    </div>
  );
}

function OutlinePanel({
  doc,
  onJump
}: {
  doc?: OpenDocumentTab;
  onJump: (line: number, headingIndex: number) => void;
}) {
  const { tr } = useRendererI18n();
  if (!doc) {
    return <div className="panel-empty">{tr("暂无目录。")}</div>;
  }
  return (
    <div className="panel-list">
      {doc.parsed.headings.length === 0 ? <div className="panel-empty">{tr("暂无标题。")}</div> : null}
      {doc.parsed.headings.map((heading, index) => (
        <button key={`${heading.id}:${index}`} type="button" className="panel-item outline-item" style={outlineItemStyle(heading.depth)} onClick={() => onJump(heading.line, index)}>
          <span>{heading.text}</span>
        </button>
      ))}
    </div>
  );
}

function outlineItemStyle(depth: number): CSSProperties {
  return { "--outline-depth": Math.max(0, Math.min(5, depth - 1)) } as CSSProperties;
}

function ErrorPanel({ statusMessage }: { statusMessage: string }) {
  return <div className="panel-empty">{statusMessage}</div>;
}

function StatusPill({ label, tone = "normal" }: { label: string; tone?: "normal" | "warn" | "ok" | "muted" }) {
  return <span className={`status-pill tone-${tone}`}>{label}</span>;
}

function SettingToggle({
  label,
  value,
  onChange
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function SettingSelect({
  label,
  value,
  options,
  labels,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {labels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}
