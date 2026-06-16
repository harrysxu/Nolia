import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseMarkdown } from "../src/shared/markdown";
import { WorkspaceDb } from "../src/main/services/workspaceDb";
import { SemanticIndexService } from "../src/main/services/semanticIndexService";

describe("semantic index service", () => {
  it("manually creates semantic chunks and reuses unchanged files on update", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-semantic-"));
    const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
    const embedMany = vi.fn(async (_settings: unknown, values: string[]) => values.map((value) => [value.length, 1]));
    const service = new SemanticIndexService({ embedMany } as never);
    const settings = {
      enabled: true,
      providerId: "ollama" as const,
      model: "mock-embed",
      baseUrl: "http://localhost:11434",
      apiMode: "ollama-native" as const
    };
    try {
      const source = "# Alpha\n\nSemantic indexing reads markdown text.";
      db.upsertDocument(
        {
          pathRel: "alpha.md",
          name: "alpha.md",
          ext: ".md",
          kind: "markdown",
          size: source.length,
          mtimeMs: Date.now(),
          sha256: "alpha-v1"
        },
        parseMarkdown(source, "alpha.md")
      );

      const first = await service.update(db, settings);
      expect(first.state).toBe("ready");
      expect(first.chunkCount).toBeGreaterThan(0);
      expect(embedMany).toHaveBeenCalledTimes(1);

      const second = await service.update(db, settings);
      expect(second.state).toBe("ready");
      expect(embedMany).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not create an index when embedding is not configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-semantic-"));
    const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
    const service = new SemanticIndexService({ embedMany: vi.fn() } as never);
    try {
      const status = await service.update(db, {
        enabled: false,
        providerId: "ollama",
        model: "",
        baseUrl: "http://localhost:11434",
        apiMode: "ollama-native"
      });
      expect(status.state).toBe("not_configured");
      expect(status.chunkCount).toBe(0);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
