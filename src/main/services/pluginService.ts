import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { EXTENSION_API_VERSION, extensionPermissionHash, type ExtensionManifest, type ExtensionPermission, type PluginDescriptor } from "../../shared/extensions";
import { createTranslator, type Translator } from "../../shared/i18n";
import type { ResolvedLocale } from "../../shared/types";
import { DiagnosticsService } from "./diagnosticsService";
import { SettingsService } from "./settingsService";

const PLUGIN_PROTOCOL = "nolia-plugin";

const PermissionSchema = z.string().refine(isKnownPermission, "unsupported permission");

const ContributionSchema = z
  .object({
    commands: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    menus: z.array(z.object({ id: z.string(), label: z.string(), location: z.string() }).passthrough()).optional(),
    sidebarPanels: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    fileEditors: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    fileViewers: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    settings: z.array(z.object({ id: z.string(), key: z.string(), label: z.string(), type: z.string() }).passthrough()).optional(),
    markdownRenderers: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    markdownBlocks: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    editorExtensions: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    toolbarItems: z.array(z.object({ id: z.string(), title: z.string(), command: z.string() }).passthrough()).optional(),
    importers: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    exporters: z.array(z.object({ id: z.string(), title: z.string(), formats: z.array(z.string()) }).passthrough()).optional(),
    searchProviders: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    aiProviders: z.array(z.object({ id: z.string(), title: z.string() }).passthrough()).optional(),
    automations: z.array(z.object({ id: z.string(), title: z.string(), trigger: z.string() }).passthrough()).optional(),
    contextMenus: z.array(z.object({ id: z.string(), label: z.string(), location: z.string() }).passthrough()).optional()
  })
  .passthrough();

const ManifestSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
    name: z.string().min(1),
    version: z.string().min(1),
    apiVersion: z.number().int().positive().optional(),
    minAppVersion: z.string().min(1).optional(),
    capabilities: z.array(z.string().min(1)).optional(),
    builtIn: z.boolean().optional(),
    required: z.boolean().optional(),
    enabledByDefault: z.boolean().optional(),
    activationEvents: z.array(z.string().min(1)).default(["onStartup"]),
    permissions: z.array(PermissionSchema).optional(),
    renderer: z.string().min(1).optional(),
    contributes: ContributionSchema.default({})
  })
  .passthrough();

export class PluginService {
  readonly pluginsRoot: string;
  private descriptors: PluginDescriptor[] = [];

  constructor(
    userDataPath: string,
    private readonly settings: SettingsService,
    private readonly diagnostics: DiagnosticsService,
    locale: ResolvedLocale = "zh-CN"
  ) {
    this.pluginsRoot = path.join(userDataPath, "plugins");
    this.tr = createTranslator(locale);
  }

  private readonly tr: Translator;

  async init(): Promise<void> {
    await this.discover();
  }

  async discover(): Promise<PluginDescriptor[]> {
    const pluginDirs = await listPluginDirs(this.pluginsRoot);
    const descriptors = await Promise.all(pluginDirs.map((pluginPath) => this.readPlugin(pluginPath)));
    this.descriptors = descriptors.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
    return this.listPlugins();
  }

  listPlugins(): PluginDescriptor[] {
    const settings = this.settings.getSettings();
    return this.descriptors.map((descriptor) => {
      const state = settings.plugins[descriptor.pluginId];
      const permissionHash = descriptor.manifest ? extensionPermissionHash(descriptor.manifest) : undefined;
      const needsPermissionReview = Boolean(
        descriptor.manifest?.permissions?.length &&
          state?.permissionsAcceptedAt &&
          state.acceptedPermissionHash !== permissionHash
      );
      const disabledReason =
        settings.pluginSafeMode && descriptor.manifest
          ? this.tr("插件安全模式已开启")
          : state?.disabledReason ?? (needsPermissionReview ? this.tr("插件权限已变更，需要重新确认") : undefined);
      return {
        ...descriptor,
        enabled: Boolean(state?.enabled && descriptor.manifest && !settings.pluginSafeMode && !needsPermissionReview && !state?.disabledReason),
        permissionsAcceptedAt: state?.permissionsAcceptedAt,
        acceptedPermissionHash: state?.acceptedPermissionHash,
        permissionHash,
        needsPermissionReview,
        disabledReason
      };
    });
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<PluginDescriptor[]> {
    const descriptor = this.descriptors.find((item) => item.pluginId === pluginId);
    if (!descriptor || !descriptor.manifest) {
      this.diagnostics.warn("Attempted to enable unknown or invalid plugin", { pluginId, enabled });
      return this.listPlugins();
    }
    const state = this.settings.getSettings().plugins[pluginId];
    const permissionHash = extensionPermissionHash(descriptor.manifest);
    if (enabled && descriptor.manifest.permissions?.length && state?.acceptedPermissionHash !== permissionHash) {
      this.diagnostics.warn("Attempted to enable plugin before accepting current permissions", { pluginId, permissionHash });
      return this.listPlugins();
    }
    await this.settings.setPluginEnabled(pluginId, enabled);
    return this.listPlugins();
  }

  async acceptPermissions(pluginId: string): Promise<PluginDescriptor[]> {
    const descriptor = this.descriptors.find((item) => item.pluginId === pluginId);
    if (!descriptor || !descriptor.manifest) {
      this.diagnostics.warn("Attempted to accept permissions for unknown or invalid plugin", { pluginId });
      return this.listPlugins();
    }
    await this.settings.acceptPluginPermissions(pluginId, Date.now(), extensionPermissionHash(descriptor.manifest));
    return this.listPlugins();
  }

  async recordFailure(pluginId: string, message: string): Promise<PluginDescriptor[]> {
    const descriptor = this.descriptors.find((item) => item.pluginId === pluginId);
    if (!descriptor?.manifest) {
      this.diagnostics.warn("Attempted to record failure for unknown or invalid plugin", { pluginId, message });
      return this.listPlugins();
    }
    this.diagnostics.error("Plugin disabled after runtime failure", { pluginId, message });
    await this.settings.markPluginDisabled(pluginId, message);
    return this.listPlugins();
  }

  resolvePluginFile(pluginId: string, requestPath: string): string | undefined {
    const descriptor = this.descriptors.find((item) => item.pluginId === pluginId);
    if (!descriptor?.manifest) {
      return undefined;
    }
    const normalizedPath = path.normalize(requestPath).replace(/^[/\\]+/, "");
    if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
      return undefined;
    }
    const filePath = path.join(descriptor.pluginPath, normalizedPath);
    if (!isPathInside(descriptor.pluginPath, filePath)) {
      return undefined;
    }
    return filePath;
  }

  private async readPlugin(pluginPath: string): Promise<PluginDescriptor> {
    const manifestPath = path.join(pluginPath, "plugin.json");
    const pluginId = path.basename(pluginPath);
    try {
      const raw = await readFile(manifestPath, "utf8");
      const parsed = ManifestSchema.parse(JSON.parse(raw)) as ExtensionManifest;
      const manifest: ExtensionManifest = {
        ...parsed,
        apiVersion: parsed.apiVersion ?? 1,
        builtIn: false,
        required: false,
        enabledByDefault: false
      };
      const diagnostics = [
        ...validateManifestCompatibility(manifest, this.tr),
        ...validateManifestContributions(manifest, this.tr),
        ...(await validateManifestPaths(pluginPath, manifest, this.tr))
      ];
      if (diagnostics.length) {
        for (const diagnostic of diagnostics) {
          const log = diagnostic.level === "error" ? this.diagnostics.error.bind(this.diagnostics) : this.diagnostics.warn.bind(this.diagnostics);
          log("Plugin manifest diagnostic", { pluginId: manifest.id, level: diagnostic.level, message: diagnostic.message });
        }
      }
      return {
        pluginId: manifest.id,
        pluginPath,
        manifest: diagnostics.some((item) => item.level === "error") ? undefined : manifest,
        rendererUrl: manifest.renderer && !diagnostics.some((item) => item.level === "error") ? rendererUrlFor(manifest.id, manifest.renderer) : undefined,
        enabled: false,
        diagnostics
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : this.tr("Invalid plugin manifest");
      this.diagnostics.error("Failed to load plugin manifest", { pluginId, manifestPath, message });
      return {
        pluginId,
        pluginPath,
        enabled: false,
        diagnostics: [{ level: "error", message }]
      };
    }
  }
}

export { PLUGIN_PROTOCOL };

async function listPluginDirs(pluginsRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(pluginsRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(pluginsRoot, entry.name));
  } catch {
    return [];
  }
}

async function validateManifestPaths(pluginPath: string, manifest: ExtensionManifest, tr: Translator = createTranslator("zh-CN")): Promise<PluginDescriptor["diagnostics"]> {
  const diagnostics: PluginDescriptor["diagnostics"] = [];
  if (!manifest.renderer) {
    return diagnostics;
  }
  const normalizedRenderer = path.normalize(manifest.renderer).replace(/^[/\\]+/, "");
  if (normalizedRenderer.startsWith("..") || path.isAbsolute(normalizedRenderer)) {
    diagnostics.push({ level: "error", message: tr("renderer must be a relative path inside the plugin directory") });
    return diagnostics;
  }
  const rendererPath = path.join(pluginPath, normalizedRenderer);
  if (!isPathInside(pluginPath, rendererPath)) {
    diagnostics.push({ level: "error", message: tr("renderer must stay inside the plugin directory") });
    return diagnostics;
  }
  await stat(rendererPath).catch(() => {
    diagnostics.push({ level: "error", message: tr("renderer entry does not exist") });
  });
  return diagnostics;
}

function rendererUrlFor(pluginId: string, rendererPath: string): string {
  const encodedPath = rendererPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${PLUGIN_PROTOCOL}://${encodeURIComponent(pluginId)}/${encodedPath}`;
}

function validateManifestCompatibility(manifest: ExtensionManifest, tr: Translator = createTranslator("zh-CN")): PluginDescriptor["diagnostics"] {
  const diagnostics: PluginDescriptor["diagnostics"] = [];
  const apiVersion = manifest.apiVersion ?? 1;
  if (apiVersion > EXTENSION_API_VERSION) {
    diagnostics.push({
      level: "error",
      message: tr("插件 API 版本 {apiVersion} 高于当前支持版本 {supportedVersion}", { apiVersion, supportedVersion: EXTENSION_API_VERSION })
    });
  } else if (apiVersion < EXTENSION_API_VERSION) {
    diagnostics.push({
      level: "warning",
      message: tr("插件 API 版本 {apiVersion} 低于当前平台版本 {supportedVersion}，将按兼容模式加载", { apiVersion, supportedVersion: EXTENSION_API_VERSION })
    });
  }
  return diagnostics;
}

function validateManifestContributions(manifest: ExtensionManifest, tr: Translator = createTranslator("zh-CN")): PluginDescriptor["diagnostics"] {
  const diagnostics: PluginDescriptor["diagnostics"] = [];
  const ids = [
    ...(manifest.contributes.commands?.map((item) => item.id) ?? []),
    ...(manifest.contributes.sidebarPanels?.map((item) => item.id) ?? []),
    ...(manifest.contributes.fileEditors?.map((item) => item.id) ?? []),
    ...(manifest.contributes.fileViewers?.map((item) => item.id) ?? []),
    ...(manifest.contributes.settings?.map((item) => item.id) ?? []),
    ...(manifest.contributes.markdownRenderers?.map((item) => item.id) ?? []),
    ...(manifest.contributes.markdownBlocks?.map((item) => item.id) ?? []),
    ...(manifest.contributes.editorExtensions?.map((item) => item.id) ?? []),
    ...(manifest.contributes.toolbarItems?.map((item) => item.id) ?? []),
    ...(manifest.contributes.importers?.map((item) => item.id) ?? []),
    ...(manifest.contributes.exporters?.map((item) => item.id) ?? []),
    ...(manifest.contributes.searchProviders?.map((item) => item.id) ?? []),
    ...(manifest.contributes.aiProviders?.map((item) => item.id) ?? []),
    ...(manifest.contributes.automations?.map((item) => item.id) ?? [])
  ];
  for (const id of ids) {
    if (!id.startsWith(`${manifest.id}.`) && id !== manifest.id) {
      diagnostics.push({
        level: "error",
        message: tr("贡献点 {id} 必须使用插件 ID 前缀 {pluginId}.", { id, pluginId: manifest.id })
      });
    }
  }
  return diagnostics;
}

function isKnownPermission(value: string): value is ExtensionPermission {
  return (
    [
      "workspace:read",
      "workspace:write",
      "workspace:file:read",
      "workspace:file:write",
      "workspace:file:create",
      "workspace:file:delete",
      "clipboard:read",
      "clipboard:write",
      "network:request",
      "ui:contribute"
    ].includes(value) || value.startsWith("network:request:")
  );
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
