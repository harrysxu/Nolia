import { describe, expect, it } from "vitest";

import { PluginBroker, isPrivateAddress, readLimitedResponseBody, safeRequestHeaders } from "../src/main/services/pluginBroker";

describe("plugin broker security boundaries", () => {
  it("removes sensitive and authority-changing request headers", () => {
    expect(safeRequestHeaders({
      Authorization: "Bearer secret",
      cookie: "session=secret",
      HOST: "internal.example",
      Origin: "https://host.example",
      Referer: "https://host.example/private",
      "Proxy-Authorization": "Basic secret",
      Accept: "application/json",
      "X-Plugin": "allowed"
    })).toEqual({ Accept: "application/json", "X-Plugin": "allowed" });
  });

  it("blocks private, local, mapped, link-local and non-routable addresses", () => {
    for (const address of [
      "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1",
      "172.16.0.1", "172.31.255.255", "192.168.1.1", "198.18.0.1", "224.0.0.1",
      "::", "::1", "::ffff:127.0.0.1", "fc00::1", "fd00::1", "fe80::1", "febf::1", "ff02::1"
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["1.1.1.1", "8.8.8.8", "172.15.255.255", "172.32.0.1", "2001:4860:4860::8888"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("stops streaming responses as soon as they exceed the configured limit", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      }
    }));
    await expect(readLimitedResponseBody(response, 5)).rejects.toThrow("exceeds 5 MB");
  });

  it("returns an exact byte sequence within the response limit", async () => {
    const bytes = await readLimitedResponseBody(new Response(new Uint8Array([1, 2, 3, 4])), 4);
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });

  it("rejects a repeated request id even when the first request was denied", async () => {
    const broker = new PluginBroker(
      {
        listPlugins: () => [{
          pluginId: "local.security-test",
          enabled: true,
          frameUrl: "nolia-plugin://local.security-test/index.html",
          manifest: {
            id: "local.security-test",
            name: "Security Test",
            version: "1.0.0",
            apiVersion: 3,
            entrypoints: { ui: "index.html" },
            permissions: [],
            contributes: {}
          }
        }]
      } as never,
      { getActiveWorkspace: () => undefined } as never,
      {} as never,
      { warn: () => undefined } as never
    );
    const session = broker.open("local.security-test");
    const request = {
      version: 3 as const,
      sessionId: session.sessionId,
      requestId: "request-1",
      method: "network.request" as const,
      payload: { url: "https://example.com", method: "GET" as const }
    };

    const first = await broker.request(request);
    const replayed = await broker.request(request);
    if (first.ok || replayed.ok) throw new Error("Denied plugin requests must return an error response");
    expect(first.error.code).toBe("plugin_network_denied");
    expect(replayed.error.code).toBe("plugin_replay");
  });

  it("rejects credentials embedded in an otherwise allowed URL", async () => {
    const broker = new PluginBroker(
      {
        listPlugins: () => [{
          pluginId: "local.security-test",
          enabled: true,
          frameUrl: "nolia-plugin://local.security-test/index.html",
          manifest: {
            id: "local.security-test",
            name: "Security Test",
            version: "1.0.0",
            apiVersion: 3,
            entrypoints: { ui: "index.html" },
            permissions: ["network:request:example.com"],
            contributes: {}
          }
        }]
      } as never,
      { getActiveWorkspace: () => undefined } as never,
      {} as never,
      { warn: () => undefined } as never
    );
    const session = broker.open("local.security-test");
    const response = await broker.request({
      version: 3,
      sessionId: session.sessionId,
      requestId: "credential-url",
      method: "network.request",
      payload: { url: "https://user:secret@example.com/data", method: "GET" }
    });

    if (response.ok) throw new Error("Credential-bearing plugin URLs must be denied");
    expect(response.error.code).toBe("plugin_network_denied");
    expect(response.error.message).not.toContain("secret");
  });
});
