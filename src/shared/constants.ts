import type { AppSettings } from "./types";

export const APP_NAME = "Nolia";
export const BUNDLE_IDENTIFIER = "com.nolia.app";
export const WORKSPACE_META_DIR = ".nolia";
export const WORKSPACE_CONFIG_FILE = "workspace.json";
export const WORKSPACE_DB_FILE = "workspace.sqlite";

export const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd"];

export const DEFAULT_SETTINGS = {
  language: "system",
  theme: "system",
  editorMode: "wysiwyg",
  editorWidth: "full",
  fontSize: "medium",
  focusMode: false,
  autoSaveDelayMs: 800,
  attachmentStrategy: "workspace_assets",
  pluginSafeMode: false,
  ai: {
    enabled: false,
    defaultProviderId: "ollama-local",
    providers: [
      {
        id: "ollama-local",
        name: "Local Ollama",
        providerId: "ollama",
        model: "",
        baseUrl: "http://localhost:11434/v1",
        apiMode: "chat-completions"
      }
    ],
    embedding: {
      enabled: false,
      providerId: "ollama",
      model: "",
      baseUrl: "http://localhost:11434",
      apiMode: "ollama-native"
    },
    conversationHistoryTurns: 3,
    agentMaxSteps: 12,
    allowCurrentNoteContent: false,
    allowWorkspaceSearch: false,
    allowReadSearchResults: false,
    allowWorkspaceRead: false,
    allowWorkspaceOperations: false
  },
  plugins: {}
} satisfies AppSettings;

export const WORKSPACE_DIRECTORIES = {
  snapshots: "snapshots",
  cache: "cache",
  logs: "logs",
  aiTasks: "ai/tasks"
} as const;
