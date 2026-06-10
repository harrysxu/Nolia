import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
      expect((await readdir(root)).filter((fileName) => fileName.startsWith("global-state.json.") && fileName.endsWith(".tmp"))).toEqual([]);
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
