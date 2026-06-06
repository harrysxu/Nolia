import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseMarkdown } from "../src/shared/markdown";
import { WorkspaceDb } from "../src/main/services/workspaceDb";

describe("workspace db", () => {
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
});
