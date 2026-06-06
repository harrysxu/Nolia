import { describe, expect, it } from "vitest";

import { BUILT_IN_EXTENSION_MANIFESTS } from "../src/shared/builtinExtensions";
import type { AppSettings } from "../src/shared/types";
import type { ExtensionManifest } from "../src/shared/extensions";
import { createExtensionRegistry, filterMenuContributions, selectFileEditor, selectFileViewer } from "../src/renderer/extensions/registry";

const settings: AppSettings = {
  language: "zh-CN",
  theme: "light",
  editorMode: "source",
  editorWidth: "wide",
  fontSize: "medium",
  focusMode: false,
  autoSaveDelayMs: 80,
  attachmentStrategy: "workspace_assets",
  pluginSafeMode: false,
  plugins: {}
};

describe("extension registry", () => {
  it("registers built-in commands, sidebars, settings, and file handlers", () => {
    const registry = createExtensionRegistry(BUILT_IN_EXTENSION_MANIFESTS, settings);

    expect(registry.commands.map((command) => command.id)).toContain("commandPalette.open");
    expect(registry.sidebarPanels.map((panel) => panel.id)).toEqual(["recent", "files", "favorites", "search", "backlinks"]);
    expect(registry.settings.map((setting) => setting.key)).toContain("theme");
    expect(selectFileEditor(registry.fileEditors, "notes/today.md")?.id).toBe("markdown.editor.fileEditor");
    expect(selectFileEditor(registry.fileEditors, "assets/config.json")?.id).toBe("json.editor.fileEditor");
    expect(selectFileEditor(registry.fileEditors, "assets/readme.txt")?.id).toBe("text.editor.fileEditor");
    expect(selectFileViewer(registry.fileViewers, "assets/photo.png")?.category).toBe("image");
    expect(selectFileViewer(registry.fileViewers, "assets/file.unknown")?.category).toBe("other");
  });

  it("removes disabled non-required extension contributions", () => {
    const registry = createExtensionRegistry(BUILT_IN_EXTENSION_MANIFESTS, {
      ...settings,
      plugins: {
        "search.panel": { enabled: false }
      }
    });

    expect(registry.commands.map((command) => command.id)).not.toContain("view.search");
    expect(registry.sidebarPanels.map((panel) => panel.id)).not.toContain("search");
    expect(registry.menus.map((menu) => menu.command)).not.toContain("view.search");
  });

  it("keeps required extensions enabled even if settings try to disable them", () => {
    const registry = createExtensionRegistry(BUILT_IN_EXTENSION_MANIFESTS, {
      ...settings,
      plugins: {
        "markdown.editor": { enabled: false }
      }
    });

    expect(registry.commands.map((command) => command.id)).toContain("mode.source");
    expect(selectFileEditor(registry.fileEditors, "readme.markdown")?.id).toBe("markdown.editor.fileEditor");
  });

  it("loads external plugins only after enablement and permission acceptance", () => {
    const external: ExtensionManifest = {
      id: "local.demo",
      name: "Local Demo",
      version: "1.0.0",
      activationEvents: ["onStartup"],
      permissions: ["ui:contribute"],
      contributes: {
        commands: [{ id: "demo.hello", title: "Hello" }],
        sidebarPanels: [{ id: "demo", title: "Demo", order: 5 }]
      }
    };

    expect(createExtensionRegistry([external], settings).commands).toHaveLength(0);
    expect(createExtensionRegistry([external], { ...settings, plugins: { "local.demo": { enabled: true } } }).commands).toHaveLength(0);
    expect(createExtensionRegistry([external], { ...settings, plugins: { "local.demo": { enabled: true, permissionsAcceptedAt: 1, acceptedPermissionHash: "ui:contribute" } } }).commands[0]?.id).toBe("demo.hello");
  });

  it("blocks external plugins in safe mode and after permission changes", () => {
    const external: ExtensionManifest = {
      id: "local.demo",
      name: "Local Demo",
      version: "1.0.0",
      activationEvents: ["onStartup"],
      permissions: ["ui:contribute", "workspace:file:read"],
      contributes: {
        commands: [{ id: "local.demo.hello", title: "Hello" }]
      }
    };

    const accepted = { "local.demo": { enabled: true, permissionsAcceptedAt: 1, acceptedPermissionHash: "ui:contribute" } };
    expect(createExtensionRegistry([external], { ...settings, plugins: accepted }).commands).toHaveLength(0);
    expect(createExtensionRegistry([external], { ...settings, pluginSafeMode: true, plugins: { "local.demo": { enabled: true, permissionsAcceptedAt: 1, acceptedPermissionHash: "ui:contribute|workspace:file:read" } } }).commands).toHaveLength(0);
  });

  it("filters menu contributions by simple when conditions", () => {
    const registry = createExtensionRegistry(BUILT_IN_EXTENSION_MANIFESTS, settings);

    expect(filterMenuContributions(registry.menus, { workspace: true, document: false, resource: false }).map((menu) => menu.id)).toContain("menu.file.new");
    expect(filterMenuContributions([{ id: "doc", label: "Doc", command: "doc", location: "context", when: "document" }], { document: false })).toHaveLength(0);
  });
});
