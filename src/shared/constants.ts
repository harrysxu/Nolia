import { DEFAULT_AI_SETTINGS } from "./ai";

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
  ai: DEFAULT_AI_SETTINGS,
  pluginSafeMode: false,
  plugins: {}
} as const;

export const WORKSPACE_DIRECTORIES = {
  snapshots: "snapshots",
  cache: "cache",
  logs: "logs"
} as const;
