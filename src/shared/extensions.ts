import type { AppSettings } from "./types";

export const EXTENSION_API_VERSION = 2;

export type ExtensionPermission =
  | "workspace:read"
  | "workspace:write"
  | "workspace:file:read"
  | "workspace:file:write"
  | "workspace:file:create"
  | "workspace:file:delete"
  | "clipboard:read"
  | "clipboard:write"
  | "network:request"
  | `network:request:${string}`
  | "ui:contribute";

export type ExtensionActivationEvent =
  | "onStartup"
  | "onMarkdown"
  | "onWorkspaceOpen"
  | "onDocumentOpen"
  | "onDocumentSave"
  | "onDocumentChange"
  | "onSearch"
  | "onExport"
  | "onPaste"
  | "onAIRequest"
  | `onCommand:${string}`
  | `onFileOpen:${string}`
  | `onView:${string}`;

export type ExtensionCapability =
  | "manifest"
  | "renderer"
  | "ui"
  | "workspace"
  | "markdown"
  | "editor"
  | "viewer"
  | "import"
  | "export"
  | "search"
  | "automation"
  | "ai";

export type ExtensionContributionWhen =
  | "always"
  | "workspace"
  | "!workspace"
  | "document"
  | "!document"
  | "resource"
  | "!resource";

export interface CommandContribution {
  id: string;
  title: string;
  category?: string;
  keywords?: string[];
  when?: ExtensionContributionWhen;
  order?: number;
}

export interface MenuContribution {
  id: string;
  label: string;
  command?: string;
  location: "app" | "file" | "edit" | "view" | "window" | "help" | "context";
  group?: string;
  order?: number;
  when?: ExtensionContributionWhen;
  separatorBefore?: boolean;
  separatorAfter?: boolean;
}

export interface SidebarPanelContribution {
  id: string;
  title: string;
  icon?: string;
  order?: number;
  command?: string;
  when?: ExtensionContributionWhen;
  visibleInNav?: boolean;
}

export interface FileEditorContribution {
  id: string;
  title: string;
  extensions?: string[];
  mimeTypes?: string[];
  priority?: number;
}

export interface FileViewerContribution {
  id: string;
  title: string;
  extensions?: string[];
  mimeTypes?: string[];
  priority?: number;
  category?: "image" | "pdf" | "audio" | "video" | "diagram" | "archive" | "text" | "other";
  fallback?: boolean;
}

export interface SettingOptionContribution {
  value: string;
  label: string;
}

export interface SettingContribution {
  id: string;
  key: keyof AppSettings | string;
  label: string;
  category?: "appearance" | "editor" | "plugins" | "advanced";
  type: "select" | "toggle" | "number" | "text";
  options?: SettingOptionContribution[];
  order?: number;
}

export interface MarkdownRendererContribution {
  id: string;
  title: string;
  languages?: string[];
  priority?: number;
}

export interface EditorExtensionContribution {
  id: string;
  title: string;
  modes?: string[];
  order?: number;
}

export interface ToolbarItemContribution {
  id: string;
  title: string;
  command: string;
  icon?: string;
  group?: string;
  order?: number;
  when?: ExtensionContributionWhen;
}

export interface ExtensionContributions {
  commands?: CommandContribution[];
  menus?: MenuContribution[];
  sidebarPanels?: SidebarPanelContribution[];
  fileEditors?: FileEditorContribution[];
  fileViewers?: FileViewerContribution[];
  settings?: SettingContribution[];
  markdownRenderers?: MarkdownRendererContribution[];
  markdownBlocks?: MarkdownRendererContribution[];
  editorExtensions?: EditorExtensionContribution[];
  toolbarItems?: ToolbarItemContribution[];
  importers?: ImporterContribution[];
  exporters?: ExporterContribution[];
  searchProviders?: SearchProviderContribution[];
  aiProviders?: AiProviderContribution[];
  automations?: AutomationContribution[];
  contextMenus?: MenuContribution[];
}

export interface ImporterContribution {
  id: string;
  title: string;
  extensions?: string[];
  mimeTypes?: string[];
  order?: number;
}

export interface ExporterContribution {
  id: string;
  title: string;
  formats: string[];
  order?: number;
}

export interface SearchProviderContribution {
  id: string;
  title: string;
  modes?: Array<"fullText" | "semantic" | "tags" | "tasks">;
  order?: number;
}

export interface AiProviderContribution {
  id: string;
  title: string;
  models?: string[];
  order?: number;
}

export interface AutomationContribution {
  id: string;
  title: string;
  trigger: "manual" | "onDocumentSave" | "onWorkspaceOpen" | "onPaste";
  command?: string;
  order?: number;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  apiVersion?: number;
  minAppVersion?: string;
  capabilities?: ExtensionCapability[];
  builtIn?: boolean;
  required?: boolean;
  enabledByDefault?: boolean;
  activationEvents: ExtensionActivationEvent[];
  permissions?: ExtensionPermission[];
  renderer?: string;
  contributes: ExtensionContributions;
}

export interface PluginState {
  enabled: boolean;
  permissionsAcceptedAt?: number;
  acceptedPermissionHash?: string;
  disabledReason?: string;
  settings?: Record<string, unknown>;
}

export interface PluginDescriptor {
  pluginId: string;
  manifest?: ExtensionManifest;
  pluginPath: string;
  rendererUrl?: string;
  enabled: boolean;
  permissionsAcceptedAt?: number;
  acceptedPermissionHash?: string;
  permissionHash?: string;
  needsPermissionReview?: boolean;
  disabledReason?: string;
  diagnostics: Array<{
    level: "warning" | "error";
    message: string;
  }>;
}

export interface ExtensionHostSnapshot {
  manifests: ExtensionManifest[];
  plugins: PluginDescriptor[];
}

export function extensionPermissionHash(manifest: Pick<ExtensionManifest, "permissions">): string {
  const permissions = [...new Set(manifest.permissions ?? [])].sort();
  return permissions.join("|");
}

export function hasExtensionPermission(manifest: Pick<ExtensionManifest, "permissions"> | undefined, permission: ExtensionPermission): boolean {
  const permissions = new Set(manifest?.permissions ?? []);
  if (permissions.has(permission)) {
    return true;
  }
  if (permission === "workspace:file:read" && permissions.has("workspace:read")) {
    return true;
  }
  if (["workspace:file:write", "workspace:file:create", "workspace:file:delete"].includes(permission) && permissions.has("workspace:write")) {
    return true;
  }
  if (permission.startsWith("network:request:") && permissions.has("network:request")) {
    return true;
  }
  return false;
}
