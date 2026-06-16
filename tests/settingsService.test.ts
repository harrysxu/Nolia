import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DiagnosticsService } from "../src/main/services/diagnosticsService";
import { PluginService } from "../src/main/services/pluginService";
import { SettingsService } from "../src/main/services/settingsService";
import type { LocalePreference } from "../src/shared/types";

describe("settings and plugin services", () => {
  it("migrates old global settings without plugin state", async () => {
    const root = await makeTempDir();
    try {
      await writeFile(
        path.join(root, "global-state.json"),
        JSON.stringify({
          settings: {
            theme: "dark",
            editorMode: "split"
          },
          recentWorkspaces: []
        }),
        "utf8"
      );

      const service = new SettingsService(root);
      await service.init();

      expect(service.getSettings()).toMatchObject({
        language: "system",
        theme: "dark",
        editorMode: "split",
        plugins: {}
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists the language setting", async () => {
    const root = await makeTempDir();
    try {
      const service = new SettingsService(root);
      await service.init();

      await service.setSetting("language", "en-US");

      const reloaded = new SettingsService(root);
      await reloaded.init();

      expect(reloaded.getSettings().language).toBe("en-US");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists every supported language preference", async () => {
    const root = await makeTempDir();
    const languages: LocalePreference[] = ["system", "zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];
    try {
      const service = new SettingsService(root);
      await service.init();

      for (const language of languages) {
        await service.setSetting("language", language);
        const reloaded = new SettingsService(root);
        await reloaded.init();
        expect(reloaded.getSettings().language).toBe(language);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("normalizes AI settings when persisting them", async () => {
    const root = await makeTempDir();
    try {
      const service = new SettingsService(root);
      await service.init();

      await service.setSetting("ai", {
        enabled: true,
        providerId: "openai-compatible",
        apiMode: "chat-completions",
        model: "gpt-4.1",
        baseUrl: "https://api.example.com",
        allowCurrentNoteContent: true,
        allowWorkspaceSearch: true
      });

      const reloaded = new SettingsService(root);
      await reloaded.init();

      expect(reloaded.getSettings().ai).toEqual({
        enabled: true,
        defaultProviderId: "openai-compatible",
        providers: [
          {
            id: "openai-compatible",
            name: "OpenAI-compatible",
            providerId: "openai-compatible",
            model: "gpt-4.1",
            baseUrl: "https://api.example.com",
            apiMode: "chat-completions",
            disabled: false
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
        allowCurrentNoteContent: true,
        allowWorkspaceSearch: true,
        allowReadSearchResults: false,
        allowWorkspaceRead: false,
        allowWorkspaceOperations: false
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("disables reading search result notes when note search is disabled", async () => {
    const root = await makeTempDir();
    try {
      const service = new SettingsService(root);
      await service.init();

      await service.setSetting("ai", {
        allowWorkspaceSearch: false,
        allowReadSearchResults: true
      });

      expect(service.getSettings().ai.allowWorkspaceSearch).toBe(false);
      expect(service.getSettings().ai.allowReadSearchResults).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("disables workspace operation proposals when whole-workspace read is disabled", async () => {
    const root = await makeTempDir();
    try {
      const service = new SettingsService(root);
      await service.init();

      await service.setSetting("ai", {
        allowWorkspaceRead: false,
        allowWorkspaceOperations: true
      });

      expect(service.getSettings().ai.allowWorkspaceRead).toBe(false);
      expect(service.getSettings().ai.allowWorkspaceOperations).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists plugin enablement and permission acceptance", async () => {
    const root = await makeTempDir();
    try {
      const service = new SettingsService(root);
      await service.init();

      await service.setPluginEnabled("local.demo", true);
      await service.acceptPluginPermissions("local.demo", 123);

      const reloaded = new SettingsService(root);
      await reloaded.init();

      expect(reloaded.getSettings().plugins["local.demo"]).toEqual({
        enabled: true,
        permissionsAcceptedAt: 123
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("discovers valid plugins and records invalid manifest diagnostics", async () => {
    const root = await makeTempDir();
    const home = await makeTempDir();
    try {
      await mkdir(path.join(root, "plugins", "local.demo"), { recursive: true });
      await writeFile(
        path.join(root, "plugins", "local.demo", "plugin.json"),
        JSON.stringify({
          id: "local.demo",
          name: "Local Demo",
          version: "1.0.0",
          renderer: "index.js",
          activationEvents: ["onStartup"],
          permissions: ["ui:contribute"],
          contributes: {
            commands: [{ id: "local.demo.hello", title: "Hello" }]
          }
        }),
        "utf8"
      );
      await writeFile(path.join(root, "plugins", "local.demo", "index.js"), "export function activate() {}", "utf8");

      await mkdir(path.join(root, "plugins", "bad.plugin"), { recursive: true });
      await writeFile(path.join(root, "plugins", "bad.plugin", "plugin.json"), "{ bad json", "utf8");

      const settings = new SettingsService(root);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      const plugins = new PluginService(root, settings, diagnostics);
      await plugins.init();

      const descriptors = plugins.listPlugins();
      expect(descriptors.find((descriptor) => descriptor.pluginId === "local.demo")?.manifest?.contributes.commands?.[0]?.id).toBe("local.demo.hello");
      expect(descriptors.find((descriptor) => descriptor.pluginId === "bad.plugin")?.diagnostics[0]?.level).toBe("error");

      await plugins.acceptPermissions("local.demo");
      await plugins.setEnabled("local.demo", true);

      const enabled = plugins.listPlugins().find((descriptor) => descriptor.pluginId === "local.demo");
      expect(enabled?.enabled).toBe(true);
      expect(enabled?.permissionsAcceptedAt).toBeTypeOf("number");
      expect(enabled?.acceptedPermissionHash).toBe("ui:contribute");

      const log = await readFile(diagnostics.logFilePath, "utf8");
      expect(log).toContain("Failed to load plugin manifest");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rejects incompatible plugin manifests and unscoped contributions", async () => {
    const root = await makeTempDir();
    const home = await makeTempDir();
    try {
      await mkdir(path.join(root, "plugins", "future.plugin"), { recursive: true });
      await writeFile(
        path.join(root, "plugins", "future.plugin", "plugin.json"),
        JSON.stringify({
          id: "future.plugin",
          name: "Future Plugin",
          version: "1.0.0",
          apiVersion: 999,
          activationEvents: ["onStartup"],
          contributes: {}
        }),
        "utf8"
      );

      await mkdir(path.join(root, "plugins", "scope.bad"), { recursive: true });
      await writeFile(
        path.join(root, "plugins", "scope.bad", "plugin.json"),
        JSON.stringify({
          id: "scope.bad",
          name: "Scope Bad",
          version: "1.0.0",
          apiVersion: 2,
          activationEvents: ["onStartup"],
          contributes: {
            commands: [{ id: "other.command", title: "Other" }]
          }
        }),
        "utf8"
      );

      const settings = new SettingsService(root);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      const plugins = new PluginService(root, settings, diagnostics);
      await plugins.init();

      const descriptors = plugins.listPlugins();
      const future = descriptors.find((descriptor) => descriptor.pluginId === "future.plugin");
      const scoped = descriptors.find((descriptor) => descriptor.pluginId === "scope.bad");
      expect(future?.manifest).toBeUndefined();
      expect(future?.diagnostics.some((diagnostic) => diagnostic.message.includes("API 版本"))).toBe(true);
      expect(scoped?.manifest).toBeUndefined();
      expect(scoped?.diagnostics.some((diagnostic) => diagnostic.message.includes("必须使用插件 ID 前缀"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("records runtime plugin failures and disables the plugin", async () => {
    const root = await makeTempDir();
    const home = await makeTempDir();
    try {
      await mkdir(path.join(root, "plugins", "local.demo"), { recursive: true });
      await writeFile(
        path.join(root, "plugins", "local.demo", "plugin.json"),
        JSON.stringify({
          id: "local.demo",
          name: "Local Demo",
          version: "1.0.0",
          apiVersion: 2,
          renderer: "index.js",
          activationEvents: ["onStartup"],
          permissions: ["ui:contribute"],
          contributes: {
            commands: [{ id: "local.demo.hello", title: "Hello" }]
          }
        }),
        "utf8"
      );
      await writeFile(path.join(root, "plugins", "local.demo", "index.js"), "export function activate() {}", "utf8");

      const settings = new SettingsService(root);
      await settings.init();
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      const plugins = new PluginService(root, settings, diagnostics);
      await plugins.init();
      await plugins.acceptPermissions("local.demo");
      await plugins.setEnabled("local.demo", true);
      await plugins.recordFailure("local.demo", "activate failed");

      const descriptor = plugins.listPlugins().find((item) => item.pluginId === "local.demo");
      expect(descriptor?.enabled).toBe(false);
      expect(descriptor?.disabledReason).toBe("activate failed");
      expect(settings.getSettings().plugins["local.demo"]?.enabled).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "nolia-settings-"));
}
