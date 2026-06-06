import type {
  CommandContribution,
  ExtensionContributionWhen,
  ExtensionManifest,
  FileEditorContribution,
  FileViewerContribution,
  MenuContribution,
  SettingContribution,
  SidebarPanelContribution
} from "../../shared/extensions";
import { extensionPermissionHash } from "../../shared/extensions";
import type { AppSettings } from "../../shared/types";

export interface ContributionContext {
  workspace?: boolean;
  document?: boolean;
  resource?: boolean;
}

export interface ExtensionRegistrySnapshot {
  manifests: ExtensionManifest[];
  commands: CommandContribution[];
  menus: MenuContribution[];
  contextMenus: MenuContribution[];
  sidebarPanels: SidebarPanelContribution[];
  settings: SettingContribution[];
  fileEditors: FileEditorContribution[];
  fileViewers: FileViewerContribution[];
  markdownRenderers: NonNullable<ExtensionManifest["contributes"]["markdownRenderers"]>;
  markdownBlocks: NonNullable<ExtensionManifest["contributes"]["markdownBlocks"]>;
  editorExtensions: NonNullable<ExtensionManifest["contributes"]["editorExtensions"]>;
  toolbarItems: NonNullable<ExtensionManifest["contributes"]["toolbarItems"]>;
  importers: NonNullable<ExtensionManifest["contributes"]["importers"]>;
  exporters: NonNullable<ExtensionManifest["contributes"]["exporters"]>;
  searchProviders: NonNullable<ExtensionManifest["contributes"]["searchProviders"]>;
  aiProviders: NonNullable<ExtensionManifest["contributes"]["aiProviders"]>;
  automations: NonNullable<ExtensionManifest["contributes"]["automations"]>;
}

export function createExtensionRegistry(manifests: ExtensionManifest[], settings?: AppSettings): ExtensionRegistrySnapshot {
  const enabledManifests = manifests.filter((manifest) => isExtensionEnabled(manifest, settings));
  return {
    manifests: enabledManifests,
    commands: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.commands ?? [])),
    menus: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.menus ?? [])),
    contextMenus: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.contextMenus ?? [])),
    sidebarPanels: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.sidebarPanels ?? [])),
    settings: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.settings ?? [])),
    fileEditors: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.fileEditors ?? [])),
    fileViewers: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.fileViewers ?? [])),
    markdownRenderers: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.markdownRenderers ?? [])),
    markdownBlocks: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.markdownBlocks ?? [])),
    editorExtensions: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.editorExtensions ?? [])),
    toolbarItems: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.toolbarItems ?? [])),
    importers: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.importers ?? [])),
    exporters: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.exporters ?? [])),
    searchProviders: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.searchProviders ?? [])),
    aiProviders: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.aiProviders ?? [])),
    automations: sortContributions(enabledManifests.flatMap((manifest) => manifest.contributes.automations ?? []))
  };
}

export function isExtensionEnabled(manifest: ExtensionManifest, settings?: AppSettings): boolean {
  if (manifest.required) {
    return true;
  }
  const state = settings?.plugins?.[manifest.id];
  if (manifest.builtIn) {
    return state?.enabled ?? manifest.enabledByDefault !== false;
  }
  if (settings?.pluginSafeMode || state?.disabledReason) {
    return false;
  }
  return Boolean(state?.enabled && isExtensionPermissionAccepted(manifest, settings));
}

export function isExtensionPermissionAccepted(manifest: ExtensionManifest, settings?: AppSettings): boolean {
  if (manifest.builtIn || manifest.required || !manifest.permissions?.length) {
    return true;
  }
  const state = settings?.plugins?.[manifest.id];
  if (!state?.permissionsAcceptedAt) {
    return false;
  }
  return state.acceptedPermissionHash === extensionPermissionHash(manifest);
}

export function isContributionVisible(when: ExtensionContributionWhen | undefined, context: ContributionContext): boolean {
  switch (when) {
    case "workspace":
      return Boolean(context.workspace);
    case "!workspace":
      return !context.workspace;
    case "document":
      return Boolean(context.document);
    case "!document":
      return !context.document;
    case "resource":
      return Boolean(context.resource);
    case "!resource":
      return !context.resource;
    case "always":
    case undefined:
    default:
      return true;
  }
}

export function filterMenuContributions(menus: MenuContribution[], context: ContributionContext): MenuContribution[] {
  return menus.filter((item) => isContributionVisible(item.when, context));
}

export function selectFileEditor(editors: FileEditorContribution[], pathRel: string, mimeType?: string): FileEditorContribution | undefined {
  return selectFileHandler(editors, pathRel, mimeType);
}

export function selectFileViewer(viewers: FileViewerContribution[], pathRel: string, mimeType?: string): FileViewerContribution | undefined {
  const matched = selectFileHandler(viewers.filter((viewer) => !viewer.fallback), pathRel, mimeType);
  if (matched) {
    return matched;
  }
  return sortContributions(viewers.filter((viewer) => viewer.fallback))[0];
}

function selectFileHandler<T extends { id: string; extensions?: string[]; mimeTypes?: string[]; priority?: number }>(handlers: T[], pathRel: string, mimeType?: string): T | undefined {
  const ext = fileExtension(pathRel);
  return sortContributions(handlers).find((handler) => {
    const extensionMatch = handler.extensions?.some((item) => normalizeExtension(item) === ext);
    const mimeMatch = Boolean(mimeType && handler.mimeTypes?.includes(mimeType));
    return extensionMatch || mimeMatch;
  });
}

function sortContributions<T extends { id: string; order?: number; priority?: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftRank = left.priority ?? left.order ?? 0;
    const rightRank = right.priority ?? right.order ?? 0;
    if (left.priority !== undefined || right.priority !== undefined) {
      return rightRank - leftRank || left.id.localeCompare(right.id);
    }
    return leftRank - rightRank || left.id.localeCompare(right.id);
  });
}

function fileExtension(pathRel: string): string {
  return pathRel.toLowerCase().split(/[?#]/)[0]?.match(/\.[^./]+$/)?.[0] ?? "";
}

function normalizeExtension(extension: string): string {
  const value = extension.trim().toLowerCase();
  return value.startsWith(".") ? value : `.${value}`;
}
