import path from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeWorkspaceUserPath, resolveWorkspaceUserPath } from "../src/main/utils/filePaths";

describe("workspace user path policy", () => {
  it("normalizes ordinary user paths and allows the workspace root when requested", () => {
    const rootPath = path.resolve("C:/workspace/example");

    expect(normalizeWorkspaceUserPath("notes\\daily.md")).toBe("notes/daily.md");
    expect(normalizeWorkspaceUserPath("", { allowEmpty: true })).toBe("");
    expect(resolveWorkspaceUserPath(rootPath, "assets/logo.png")).toBe(path.join(rootPath, "assets", "logo.png"));
  });

  it("rejects workspace escapes and always-ignored internal paths", () => {
    const rootPath = path.resolve("C:/workspace/example");

    expect(() => normalizeWorkspaceUserPath("")).toThrow("Workspace path is required");
    expect(() => normalizeWorkspaceUserPath("../outside.md")).toThrow("Path escapes the workspace");
    expect(() => resolveWorkspaceUserPath(rootPath, ".nolia/workspace.json")).toThrow("Workspace path is ignored");
    expect(() => resolveWorkspaceUserPath(rootPath, ".git/config")).toThrow("Workspace path is ignored");
    expect(() => resolveWorkspaceUserPath(rootPath, "node_modules/pkg/index.js")).toThrow("Workspace path is ignored");
  });
});
