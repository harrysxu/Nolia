import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { EXTENSION_API_VERSION, extensionPermissionHash, type ExtensionManifest, type PluginDescriptor } from "../../shared/extensions";
import { createTranslator, type Translator } from "../../shared/i18n";
import { PluginManifestSchema } from "../../shared/plugins";
import type { ResolvedLocale } from "../../shared/types";
import { DiagnosticsService } from "./diagnosticsService";
import { SettingsService } from "./settingsService";

const PLUGIN_PROTOCOL = "nolia-plugin";

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
          : descriptor.diagnostics.some((item) => item.level === "error")
            ? descriptor.diagnostics.find((item) => item.level === "error")?.message
            : state?.disabledReason ?? (needsPermissionReview ? this.tr("插件权限已变更，需要重新确认") : undefined);
      return {
        ...descriptor,
        enabled: Boolean(state?.enabled && descriptor.manifest?.apiVersion === EXTENSION_API_VERSION && descriptor.frameUrl && !settings.pluginSafeMode && !needsPermissionReview && !state?.disabledReason && !descriptor.diagnostics.some((item) => item.level === "error")),
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
    if (enabled && (descriptor.manifest.apiVersion !== EXTENSION_API_VERSION || !descriptor.frameUrl || descriptor.diagnostics.some((item) => item.level === "error"))) {
      this.diagnostics.warn("Attempted to enable incompatible plugin", { pluginId, apiVersion: descriptor.manifest.apiVersion });
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
      const parsed = PluginManifestSchema.parse(JSON.parse(raw)) as ExtensionManifest;
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
      const hasFatalDiagnostic = diagnostics.some((item) => item.level === "error" && !(manifest.apiVersion && manifest.apiVersion < EXTENSION_API_VERSION && item.message.includes("incompatible with the isolated")));
      if (diagnostics.length) {
        for (const diagnostic of diagnostics) {
          const log = diagnostic.level === "error" ? this.diagnostics.error.bind(this.diagnostics) : this.diagnostics.warn.bind(this.diagnostics);
          log("Plugin manifest diagnostic", { pluginId: manifest.id, level: diagnostic.level, message: diagnostic.message });
        }
      }
      return {
        pluginId: manifest.id,
        pluginPath,
        manifest: hasFatalDiagnostic ? undefined : manifest,
        declaredApiVersion: manifest.apiVersion,
        rendererUrl: undefined,
        frameUrl: manifest.apiVersion === EXTENSION_API_VERSION && manifest.entrypoints?.ui && !diagnostics.some((item) => item.level === "error") ? rendererUrlFor(manifest.id, manifest.entrypoints.ui) : undefined,
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
  const entryPath = manifest.apiVersion === EXTENSION_API_VERSION ? manifest.entrypoints?.ui : manifest.renderer;
  if (!entryPath) {
    return diagnostics;
  }
  const normalizedRenderer = path.normalize(entryPath).replace(/^[/\\]+/, "");
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
      level: "error",
      message: `Plugin API v${apiVersion} is incompatible with the isolated v${EXTENSION_API_VERSION} runtime and must be migrated.`
    });
  }
  if (apiVersion === EXTENSION_API_VERSION && !manifest.entrypoints?.ui && manifest.renderer) {
    diagnostics.push({ level: "error", message: "Plugin API v3 requires entrypoints.ui; renderer is a legacy v2 field." });
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

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
