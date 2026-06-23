import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseMarkdown } from "../src/shared/markdown";
import { DEFAULT_AI_EMBEDDING_SETTINGS } from "../src/shared/ai";
import { WorkspaceDb } from "../src/main/services/workspaceDb";

describe("workspace db", () => {
  it("does not rewrite an existing database on open", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-db-"));
    const dbPath = path.join(root, "workspace.sqlite");
    const created = await WorkspaceDb.open(dbPath);
    try {
      created.upsertFile({
        pathRel: "alpha.md",
        name: "alpha.md",
        ext: ".md",
        kind: "markdown",
        size: 1,
        mtimeMs: 1,
        sha256: "alpha"
      });
      await created.save();
    } finally {
      created.close();
    }

    const before = await stat(dbPath);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reopened = await WorkspaceDb.open(dbPath);
    try {
      expect((await stat(dbPath)).mtimeMs).toBe(before.mtimeMs);
    } finally {
      reopened.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("flushes delayed recent-file writes explicitly", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-db-"));
    const dbPath = path.join(root, "workspace.sqlite");
    const db = await WorkspaceDb.open(dbPath);
    try {
      db.upsertFile({
        pathRel: "alpha.md",
        name: "alpha.md",
        ext: ".md",
        kind: "markdown",
        size: 1,
        mtimeMs: 1,
        sha256: "alpha"
      });
      await db.save();
      db.touchRecentFile("alpha.md");
      db.scheduleSave(60_000);
      await db.flush();
    } finally {
      db.close();
    }

    const reopened = await WorkspaceDb.open(dbPath);
    try {
      expect(reopened.listRecentFiles(5)[0]).toMatchObject({ pathRel: "alpha.md" });
    } finally {
      reopened.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects unchanged indexed files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-db-"));
    const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
    try {
      const entry = {
        pathRel: "alpha.md",
        name: "alpha.md",
        ext: ".md",
        kind: "markdown" as const,
        size: 12,
        mtimeMs: 123,
        sha256: "alpha"
      };
      expect(db.shouldIndexFile(entry)).toBe(true);
      db.upsertFile(entry);
      expect(db.shouldIndexFile(entry)).toBe(false);
      expect(db.shouldIndexFile({ ...entry, sha256: "beta" })).toBe(true);
      expect(db.shouldIndexFile({ ...entry, mtimeMs: 124 })).toBe(true);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("backs up a corrupted database and recreates a clean index", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-db-"));
    const dbPath = path.join(root, "workspace.sqlite");
    await writeFile(dbPath, "not a sqlite database", "utf8");

    const db = await WorkspaceDb.open(dbPath);
    try {
      expect(db.listTags()).toEqual([]);
      const entries = await readdir(root);
      expect(entries.some((entry) => entry.startsWith("workspace.sqlite.corrupt-"))).toBe(true);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("indexes documents for search, tags, and backlinks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-db-"));
    const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
    try {
      const alpha = `---
title: Alpha
tags: [dev]
---
# Alpha

Local first design notes.
`;
      db.upsertDocument(
        {
          pathRel: "alpha.md",
          name: "alpha.md",
          ext: ".md",
          kind: "markdown",
          size: alpha.length,
          mtimeMs: Date.now(),
          sha256: "alpha"
        },
        parseMarkdown(alpha, "alpha.md")
      );

      const beta = "# Beta\n\nSee [[Alpha]] for local search details.\n";
      db.upsertDocument(
        {
          pathRel: "beta.md",
          name: "beta.md",
          ext: ".md",
          kind: "markdown",
          size: beta.length,
          mtimeMs: Date.now(),
          sha256: "beta"
        },
        parseMarkdown(beta, "beta.md")
      );

      const search = db.search({ workspaceId: "ws_test", query: "local", limit: 10 });
      expect(search.items.map((item) => item.pathRel)).toContain("alpha.md");
      expect(db.listTags()).toEqual([{ name: "dev", displayName: "dev", count: 1 }]);
      expect(db.getBacklinks("alpha.md").linked[0]).toMatchObject({ pathRel: "beta.md" });
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("indexes markdown attachment references without failing schema writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-db-"));
    const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
    try {
      const source = "# Image note\n\n![diagram](assets/diagram.png)\n";

      expect(() =>
        db.upsertDocument(
          {
            pathRel: "image-note.md",
            name: "image-note.md",
            ext: ".md",
            kind: "markdown",
            size: source.length,
            mtimeMs: Date.now(),
            sha256: "image-note"
          },
          parseMarkdown(source, "image-note.md")
        )
      ).not.toThrow();
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stores semantic chunks, searches current vectors, and reports stale files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-db-"));
    const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
    try {
      const source = "# Semantic\n\nApples and pears live in the fruit basket.\n";
      db.upsertDocument(
        {
          pathRel: "semantic.md",
          name: "semantic.md",
          ext: ".md",
          kind: "markdown",
          size: source.length,
          mtimeMs: Date.now(),
          sha256: "semantic-v1"
        },
        parseMarkdown(source, "semantic.md")
      );
      const settings = {
        ...DEFAULT_AI_EMBEDDING_SETTINGS,
        enabled: true,
        model: "mock-embed"
      };

      expect(db.semanticIndexStatus(settings).state).toBe("not_created");
      db.replaceSemanticChunks("semantic.md", [
        {
          pathRel: "semantic.md",
          title: "Semantic",
          fileSha256: "semantic-v1",
          chunkIndex: 0,
          chunkHash: "chunk-1",
          content: "Apples and pears",
          embedding: [1, 0],
          providerId: "ollama",
          model: "mock-embed",
          dimension: 2,
          updatedAt: Date.now()
        }
      ]);
      db.setSemanticIndexMetadata({
        enabled: true,
        providerId: "ollama",
        model: "mock-embed",
        baseUrl: "http://localhost:11434",
        apiMode: "ollama-native",
        updatedAt: Date.now()
      });

      expect(db.semanticIndexStatus(settings).state).toBe("ready");
      expect(db.semanticSearch([1, 0], settings, 3)[0]).toMatchObject({ pathRel: "semantic.md", mode: "semantic" });
      expect(db.semanticIndexStatus({ ...settings, model: "other-embed" })).toMatchObject({
        state: "stale",
        indexedFiles: 0,
        chunkCount: 0
      });

      db.upsertDocument(
        {
          pathRel: "semantic.md",
          name: "semantic.md",
          ext: ".md",
          kind: "markdown",
          size: source.length,
          mtimeMs: Date.now(),
          sha256: "semantic-v2"
        },
        parseMarkdown(`${source}\nChanged.\n`, "semantic.md")
      );
      expect(db.semanticIndexStatus(settings).state).toBe("stale");
      expect(db.semanticSearch([1, 0], settings, 3)).toEqual([]);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
