import { expect, test } from "@playwright/test";

import type { ExtensionManifest, PluginDescriptor } from "../../src/shared/extensions";
import { installMockNolia } from "./helpers/mockNolia";

function descriptor(manifest: ExtensionManifest, overrides: Partial<PluginDescriptor> = {}): PluginDescriptor {
  const permissionHash = [...(manifest.permissions ?? [])].sort().join("|");
  return {
    pluginId: manifest.id,
    pluginPath: `/tmp/plugins/${manifest.id}`,
    manifest,
    declaredApiVersion: manifest.apiVersion,
    enabled: true,
    permissionsAcceptedAt: 123,
    acceptedPermissionHash: permissionHash,
    permissionHash,
    diagnostics: [],
    ...overrides
  };
}

test("API v2 plugins remain discoverable but cannot execute", async ({ page }) => {
  const manifest: ExtensionManifest = {
    id: "legacy.demo",
    name: "Legacy Demo",
    version: "2.4.0",
    apiVersion: 2,
    renderer: "index.js",
    activationEvents: ["onStartup"],
    permissions: ["ui:contribute"],
    contributes: { sidebarPanels: [{ id: "legacy.panel", title: "Legacy Panel", visibleInNav: true }] }
  };
  await installMockNolia(page, {
    plugins: [descriptor(manifest)],
    settings: { plugins: { "legacy.demo": { enabled: true, permissionsAcceptedAt: 123, acceptedPermissionHash: "ui:contribute" } } }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "Legacy Panel" })).toHaveCount(0);
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("tab", { name: "插件管理" }).click();
  const plugin = settings.locator(".plugin-settings-item", { hasText: "Legacy Demo" });
  await expect(plugin).toContainText("API v2 插件不能在此版本运行");
  await expect(plugin.locator("input[type=checkbox]")).toBeDisabled();
});

test("API v3 plugin permission changes require explicit acceptance", async ({ page }) => {
  const manifest: ExtensionManifest = {
    id: "v3.permission",
    name: "Permission Demo",
    version: "3.0.0",
    apiVersion: 3,
    entrypoints: { ui: "index.html" },
    activationEvents: ["onStartup"],
    permissions: ["ui:contribute", "network:request:api.example.com"],
    contributes: {}
  };
  await installMockNolia(page, {
    plugins: [descriptor(manifest, { enabled: false, needsPermissionReview: true, permissionsAcceptedAt: undefined, acceptedPermissionHash: undefined })],
    settings: { plugins: { "v3.permission": { enabled: false } } }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("tab", { name: "插件管理" }).click();
  const plugin = settings.locator(".plugin-settings-item", { hasText: "Permission Demo" });
  await expect(plugin).toContainText("网络请求：api.example.com");
  await plugin.getByRole("button", { name: "接受权限" }).click();
  await page.getByRole("dialog", { name: "确认插件权限" }).getByRole("button", { name: "确认权限" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { acceptedPlugins: string[] } }).__noliaMock.acceptedPlugins)).toContain("v3.permission");
  await expect(plugin.locator("input[type=checkbox]")).toBeEnabled();
});

test("API v3 UI runs in a sandboxed opaque-origin frame", async ({ page }) => {
  const manifest: ExtensionManifest = {
    id: "v3.frame",
    name: "Frame Demo",
    version: "3.0.0",
    apiVersion: 3,
    entrypoints: { ui: "index.html" },
    activationEvents: ["onStartup"],
    permissions: ["ui:contribute"],
    contributes: {}
  };
  const frameUrl = "data:text/html,<script>document.body.textContent='Plugin frame ready'</script>";
  await installMockNolia(page, {
    plugins: [descriptor(manifest, { frameUrl })],
    settings: { plugins: { "v3.frame": { enabled: true, permissionsAcceptedAt: 123, acceptedPermissionHash: "ui:contribute" } } }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings.getByRole("tab", { name: "插件管理" }).click();
  const plugin = settings.locator(".plugin-settings-item", { hasText: "Frame Demo" });
  await plugin.getByText("打开插件界面", { exact: true }).click();
  const frame = plugin.locator("iframe[title='Frame Demo']");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).not.toHaveAttribute("sandbox", /allow-same-origin|allow-forms|allow-popups|allow-top-navigation/);
  await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
});
