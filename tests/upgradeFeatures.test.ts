import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyFrontmatterMutation, parseMarkdown, renameMarkdownTagReferences } from "../src/shared/markdown";
import { PluginManifestV3Schema, PluginRpcRequestSchema } from "../src/shared/plugins";
import { updateMarkdownReferences } from "../src/main/services/fileSystemService";
import { WorkspaceDb } from "../src/main/services/workspaceDb";
import { applyWorkspaceTreeEvent } from "../src/renderer/features/explorer/treePatch";
import { beginDocumentSave, completeDocumentSave, createDocumentRevision, editDocumentRevision, failDocumentSave } from "../src/renderer/features/documents/documentStateMachine";
import { renderWorkspaceTemplate } from "../src/renderer/features/workspace/template";

describe("upgrade foundations", () => {
  it("updates frontmatter through YAML CST without dropping comments or unknown fields", () => {
    const source = "---\ntitle: Existing\n# keep this comment\nunknown:\n  nested: true\ntags: [one, two]\n---\n# Body\n";
    const updated = applyFrontmatterMutation(source, { type: "set", key: "status", value: "active" });
    const renamed = applyFrontmatterMutation(updated, { type: "rename", key: "status", nextKey: "state" });
    const deleted = applyFrontmatterMutation(renamed, { type: "delete", key: "title" });

    expect(deleted).toContain("# keep this comment");
    expect(deleted).toContain("unknown:");
    expect(deleted).toContain("state: active");
    expect(deleted).not.toContain("title: Existing");
    expect(parseMarkdown(deleted).frontmatter).toMatchObject({ state: "active", unknown: { nested: true } });
  });

  it("keeps newer edits dirty when an older save completes", () => {
    const initial = createDocumentRevision("doc", "doc.md", "hash-1");
    const edited = editDocumentRevision(initial, "draft-1");
    const saving = beginDocumentSave(edited);
    const editedAgain = editDocumentRevision(saving, "draft-2");
    const completed = completeDocumentSave(editedAgain, edited.revision, "hash-2");
    expect(completed.saveState).toBe("dirty");
    expect(completed.revision).toBe(2);
    expect(failDocumentSave(completed, "conflict").saveState).toBe("conflict");
  });

  it("applies continuous tree patches without rebuilding the snapshot", () => {
    const initial = [{ pathRel: "Notes", name: "Notes", kind: "directory" as const, size: 0, mtimeMs: 1, children: [] }];
    const created = applyWorkspaceTreeEvent(initial, { workspaceId: "ws", pathRel: "Notes/a.md", indexVersion: 1, sequence: 1, operation: "create", node: { pathRel: "Notes/a.md", name: "a.md", kind: "markdown", size: 3, mtimeMs: 2 } });
    expect(created[0].children?.map((item) => item.pathRel)).toEqual(["Notes/a.md"]);
    const removed = applyWorkspaceTreeEvent(created, { workspaceId: "ws", pathRel: "Notes/a.md", indexVersion: 2, sequence: 2, operation: "delete" });
    expect(removed[0].children).toEqual([]);
  });

  it("renders only the supported safe template variables", () => {
    const result = renderWorkspaceTemplate("# {{ title }}\n{{date}} {{ time }} {{workspace}} {{unknown}}", { title: "Plan", date: "2026-07-11", time: "10:30", workspace: "Alpha" });
    expect(result).toBe("# Plan\n2026-07-11 10:30 Alpha {{unknown}}");
  });

  it("updates Markdown and wikilink references relative to the referring document", () => {
    const source = "See [[Old Note#Part|old]] and [details](../Old%20Note.md#part).";
    const result = updateMarkdownReferences(source, "docs/index.md", "Old Note.md", "Archive/New Note.md");
    expect(result.replacements).toBe(2);
    expect(result.content).toContain("[[New Note#Part|old]]");
    expect(result.content).toContain("(../Archive/New%20Note.md#part)");
  });

  it("renames frontmatter and inline tags without changing code examples", () => {
    const source = [
      "---",
      "# keep tag notes",
      "tags: [dev, stable]",
      "---",
      "# Note",
      "",
      "Use #dev here, but keep `#dev` unchanged.",
      "",
      "```md",
      "#dev",
      "```"
    ].join("\n");
    const result = renameMarkdownTagReferences(source, "dev", "engineering");
    expect(result.replacements).toBe(2);
    expect(result.content).toContain("# keep tag notes");
    expect(result.content).toContain("tags: [engineering, stable]");
    expect(result.content).toContain("Use #engineering here, but keep `#dev` unchanged.");
    expect(result.content).toContain("```md\n#dev\n```");
  });

  it("rejects unversioned or unknown plugin RPC methods", () => {
    expect(() => PluginRpcRequestSchema.parse({ version: 2, sessionId: crypto.randomUUID(), requestId: "1", method: "workspace.readText", payload: {} })).toThrow();
    expect(() => PluginRpcRequestSchema.parse({ version: 3, sessionId: crypto.randomUUID(), requestId: "1", method: "shell.exec", payload: {} })).toThrow();
  });

  it("validates isolated Plugin API v3 manifests through the shared contract", () => {
    expect(PluginManifestV3Schema.parse({
      id: "local.example",
      name: "Example",
      version: "1.0.0",
      apiVersion: 3,
      entrypoints: { ui: "index.html" },
      permissions: ["ui:contribute", "network:request:api.example.com"],
      contributes: {}
    }).entrypoints.ui).toBe("index.html");
    expect(() => PluginManifestV3Schema.parse({
      id: "local.legacy",
      name: "Legacy",
      version: "1.0.0",
      apiVersion: 2,
      renderer: "index.js",
      contributes: {}
    })).toThrow();
    expect(() => PluginManifestV3Schema.parse({
      id: "local.unsafe",
      name: "Unsafe",
      version: "1.0.0",
      apiVersion: 3,
      entrypoints: { ui: "index.html" },
      permissions: ["shell:exec"],
      contributes: {}
    })).toThrow();
  });

  it("migrates and persists sessions, drafts, saved searches, AI tasks, and local graph data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-upgrade-db-"));
    try {
      const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
      expect(db.getSchemaVersion()).toBeGreaterThanOrEqual(4);
      db.writeSession({ workspaceId: "ws", activePathRel: "a.md", documents: [{ pathRel: "a.md", mode: "source", lastActiveAt: 1 }], recentlyClosed: [], sidebarView: "files", inspectorView: "outline", updatedAt: 1 });
      expect(db.readSession()?.activePathRel).toBe("a.md");
      db.writeDraft({ pathRel: "a.md", content: "draft", baseHash: "hash", revision: 2, updatedAt: 3 });
      expect(db.readDraft("a.md")?.revision).toBe(2);
      const saved = { id: "saved-1", name: "Open", query: { text: "open", mode: "exact" as const }, createdAt: 1, updatedAt: 1 };
      db.saveSavedSearch(saved);
      expect(db.listSavedSearches()).toEqual([saved]);
      db.upsertDocument({ pathRel: "a.md", name: "a.md", ext: ".md", kind: "markdown", size: 8, mtimeMs: 1, sha256: "a" }, parseMarkdown("# A\n\n[[B]]", "a.md"));
      db.upsertDocument({ pathRel: "b.md", name: "b.md", ext: ".md", kind: "markdown", size: 4, mtimeMs: 1, sha256: "b" }, parseMarkdown("# B", "b.md"));
      db.upsertDocument({ pathRel: "a.md", name: "a.md", ext: ".md", kind: "markdown", size: 8, mtimeMs: 2, sha256: "a2" }, parseMarkdown("# A\n\n[[B]]", "a.md"));
      expect(db.getLocalGraph("a.md", 1).nodes.map((node) => node.pathRel).sort()).toEqual(["a.md", "b.md"]);
      await db.save();
      db.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
