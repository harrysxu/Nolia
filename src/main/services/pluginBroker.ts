import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { net } from "electron";

import { hasExtensionPermission, type ExtensionManifest, type ExtensionPermission } from "../../shared/extensions";
import {
  PLUGIN_RPC_VERSION,
  PluginNetworkPayloadSchema,
  PluginReadTextPayloadSchema,
  PluginWriteTextPayloadSchema,
  type PluginRpcRequest,
  type PluginRpcResponse,
  type PluginSessionDescriptor
} from "../../shared/plugins";
import { resolveWorkspaceUserPath } from "../utils/filePaths";
import { DiagnosticsService } from "./diagnosticsService";
import { FileSystemService } from "./fileSystemService";
import { PluginService } from "./pluginService";
import { WorkspaceService } from "./workspaceService";

const SESSION_TTL_MS = 30 * 60_000;
const NETWORK_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_SESSION_REQUEST_IDS = 10_000;

interface PluginSession extends PluginSessionDescriptor {
  manifest: ExtensionManifest;
  requestIds: Set<string>;
}

export class PluginBroker {
  private readonly sessions = new Map<string, PluginSession>();

  constructor(
    private readonly plugins: PluginService,
    private readonly workspaces: WorkspaceService,
    private readonly files: FileSystemService,
    private readonly diagnostics: DiagnosticsService
  ) {}

  open(pluginId: string): PluginSessionDescriptor {
    const descriptor = this.plugins.listPlugins().find((item) => item.pluginId === pluginId);
    if (!descriptor?.enabled || descriptor.manifest?.apiVersion !== PLUGIN_RPC_VERSION || !descriptor.frameUrl) {
      throw new Error("Plugin is disabled or incompatible with API v3");
    }
    const session: PluginSession = {
      sessionId: randomUUID(),
      pluginId,
      frameUrl: descriptor.frameUrl,
      grantedCapabilities: descriptor.manifest.permissions ?? [],
      expiresAt: Date.now() + SESSION_TTL_MS,
      workspaceId: this.workspaces.getActiveWorkspace()?.info.workspaceId,
      manifest: descriptor.manifest,
      requestIds: new Set()
    };
    this.sessions.set(session.sessionId, session);
    return publicSession(session);
  }

  close(sessionId: string): { ok: boolean } {
    return { ok: this.sessions.delete(sessionId) };
  }

  closeAll(): void {
    this.sessions.clear();
  }

  async request(request: PluginRpcRequest): Promise<PluginRpcResponse> {
    let session: PluginSession | undefined;
    try {
      session = this.requireSession(request.sessionId);
      if (session.requestIds.has(request.requestId)) {
        throw new Error("Plugin RPC request replayed");
      }
      if (session.requestIds.size >= MAX_SESSION_REQUEST_IDS) {
        throw new Error("Plugin RPC request limit exceeded");
      }
      session.requestIds.add(request.requestId);
      const result = await this.execute(session, request);
      session.expiresAt = Date.now() + SESSION_TTL_MS;
      return { version: PLUGIN_RPC_VERSION, requestId: request.requestId, ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.diagnostics.warn("Plugin RPC denied or failed", { pluginId: session?.pluginId ?? "unknown", method: request.method, message });
      return { version: PLUGIN_RPC_VERSION, requestId: request.requestId, ok: false, error: { code: pluginErrorCode(message), message } };
    }
  }

  private requireSession(sessionId: string): PluginSession {
    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      throw new Error("Plugin session expired");
    }
    return session;
  }

  private async execute(session: PluginSession, request: PluginRpcRequest): Promise<unknown> {
    if (request.method === "workspace.readText") {
      this.assertPermission(session, "workspace:file:read");
      const payload = PluginReadTextPayloadSchema.parse(request.payload);
      await this.assertRealWorkspacePath(payload.workspaceId, payload.pathRel);
      return this.files.readFile(payload);
    }
    if (request.method === "workspace.writeText") {
      this.assertPermission(session, "workspace:file:write");
      const payload = PluginWriteTextPayloadSchema.parse(request.payload);
      await this.assertRealWorkspacePath(payload.workspaceId, payload.pathRel);
      return this.files.writeAtomic({ ...payload, createSnapshot: true });
    }
    this.assertNetworkPermission(session, PluginNetworkPayloadSchema.parse(request.payload).url);
    return this.networkRequest(session, request.payload);
  }

  private assertPermission(session: PluginSession, permission: ExtensionPermission): void {
    if (!hasExtensionPermission(session.manifest, permission)) {
      throw new Error(`Plugin permission denied: ${permission}`);
    }
  }

  private assertNetworkPermission(session: PluginSession, urlValue: string): void {
    const url = new URL(urlValue);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Plugin network denied: only HTTP and HTTPS are allowed");
    }
    if (url.username || url.password) {
      throw new Error("Plugin network denied: URL credentials are not allowed");
    }
    const hostPermission = `network:request:${url.hostname.toLowerCase()}` as ExtensionPermission;
    if (!hasExtensionPermission(session.manifest, hostPermission)) {
      throw new Error(`Plugin network denied for host ${url.hostname}`);
    }
  }

  private async assertRealWorkspacePath(workspaceId: string, pathRel: string): Promise<void> {
    const runtime = this.workspaces.requireWorkspace(workspaceId);
    const root = await realpath(runtime.info.rootPath);
    const candidate = await realpath(resolveWorkspaceUserPath(runtime.info.rootPath, pathRel));
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Plugin path escapes the active workspace");
    }
  }

  private async networkRequest(session: PluginSession, rawPayload: unknown): Promise<unknown> {
    const payload = PluginNetworkPayloadSchema.parse(rawPayload);
    let current = new URL(payload.url);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      this.assertNetworkPermission(session, current.toString());
      await assertPublicHost(current.hostname);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
      try {
        const response = await net.fetch(current.toString(), {
          method: payload.method,
          headers: safeRequestHeaders(payload.headers),
          body: payload.body,
          redirect: "manual",
          signal: controller.signal,
          credentials: "omit"
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location || redirect === MAX_REDIRECTS) throw new Error("Plugin network redirect limit exceeded");
          current = new URL(location, current);
          continue;
        }
        const declaredLength = Number(response.headers.get("content-length") ?? 0);
        if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("Plugin network response exceeds 5 MB");
        const bytes = await readLimitedResponseBody(response);
        return {
          status: response.status,
          headers: Object.fromEntries(["content-type", "cache-control"].flatMap((name) => response.headers.has(name) ? [[name, response.headers.get(name) ?? ""]] : [])),
          body: new TextDecoder().decode(bytes),
          url: current.toString()
        };
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("Plugin network request failed");
  }
}

function publicSession(session: PluginSession): PluginSessionDescriptor {
  return { sessionId: session.sessionId, pluginId: session.pluginId, frameUrl: session.frameUrl, grantedCapabilities: session.grantedCapabilities, expiresAt: session.expiresAt, workspaceId: session.workspaceId };
}

export function safeRequestHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const denied = new Set(["authorization", "cookie", "host", "origin", "referer", "proxy-authorization"]);
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !denied.has(name.toLowerCase())));
}

async function assertPublicHost(hostname: string): Promise<void> {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".local")) throw new Error("Plugin network denied for local host");
  const addresses = await lookup(hostname, { all: true });
  if (addresses.some((item) => isPrivateAddress(item.address))) throw new Error("Plugin network denied for private network address");
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0];
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateAddress(mappedIpv4);
  const octets = normalized.split(".").map((value) => Number(value));
  if (octets.length === 4 && octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
    const [first, second] = octets;
    return first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224;
  }
  if (normalized === "::" || normalized === "::1") return true;
  const firstHextet = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  return normalized.startsWith("fc") || normalized.startsWith("fd") ||
    (Number.isFinite(firstHextet) && (firstHextet & 0xffc0) === 0xfe80) ||
    normalized.startsWith("ff");
}

function pluginErrorCode(message: string): string {
  if (/network denied/i.test(message)) return "plugin_network_denied";
  if (/permission denied|escapes/i.test(message)) return "plugin_permission_denied";
  if (/replayed/i.test(message)) return "plugin_replay";
  if (/expired/i.test(message)) return "plugin_timeout";
  return "plugin_error";
}

export async function readLimitedResponseBody(response: Response, limit = MAX_RESPONSE_BYTES): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("Plugin network response exceeds 5 MB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
