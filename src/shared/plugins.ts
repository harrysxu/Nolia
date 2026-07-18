import { z } from "zod";

export const PLUGIN_RPC_VERSION = 3;

const PLUGIN_PERMISSION_NAMES = [
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
] as const;

export const PluginPermissionSchema = z.string().refine(
  (value) => (PLUGIN_PERMISSION_NAMES as readonly string[]).includes(value) || value.startsWith("network:request:"),
  "unsupported permission"
);

export const PluginContributionSchema = z
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

export const PluginManifestSchema = z
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
    permissions: z.array(PluginPermissionSchema).optional(),
    renderer: z.string().min(1).optional(),
    entrypoints: z.object({ ui: z.string().min(1).optional() }).strict().optional(),
    contributes: PluginContributionSchema.default({})
  })
  .passthrough();

export const PluginManifestV3Schema = PluginManifestSchema.extend({
  apiVersion: z.literal(PLUGIN_RPC_VERSION),
  entrypoints: z.object({ ui: z.string().min(1) }).strict(),
  renderer: z.never().optional()
});

export type PluginManifestV3 = z.infer<typeof PluginManifestV3Schema>;

export interface PluginSessionDescriptor {
  sessionId: string;
  pluginId: string;
  frameUrl: string;
  grantedCapabilities: string[];
  expiresAt: number;
  workspaceId?: string;
}

export const PluginSessionOpenRequestSchema = z.object({ pluginId: z.string().min(1) });
export const PluginSessionCloseRequestSchema = z.object({ sessionId: z.string().uuid() });
export const PluginRpcRequestSchema = z.object({
  version: z.literal(PLUGIN_RPC_VERSION),
  sessionId: z.string().uuid(),
  requestId: z.string().min(1).max(128),
  method: z.enum(["workspace.readText", "workspace.writeText", "network.request"]),
  payload: z.unknown()
});

export type PluginRpcRequest = z.infer<typeof PluginRpcRequestSchema>;

export type PluginRpcResponse =
  | { version: 3; requestId: string; ok: true; result: unknown }
  | { version: 3; requestId: string; ok: false; error: { code: string; message: string } };

export const PluginReadTextPayloadSchema = z.object({
  workspaceId: z.string().min(1),
  pathRel: z.string().min(1)
});

export const PluginWriteTextPayloadSchema = PluginReadTextPayloadSchema.extend({
  content: z.string(),
  baseHash: z.string().min(1)
});

export const PluginNetworkPayloadSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().max(1_000_000).optional()
});
