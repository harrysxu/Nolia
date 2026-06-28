import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { parseMarkdown } from "../src/shared/markdown";
import { AiProviderError } from "../src/main/ai/types";
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

  it("skips a failed file and keeps indexing the remaining documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-semantic-"));
    const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
    const embedMany = vi.fn(async (_settings: unknown, values: string[]) => {
      if (values.some((value) => value.includes("Second document"))) {
        throw new AiProviderError("provider reset connection", "provider_unreachable");
      }
      return values.map((value) => [value.length, 1]);
    });
    const service = new SemanticIndexService({ embedMany } as never);
    const settings = {
      enabled: true,
      providerId: "openai-compatible" as const,
      model: "mock-embed",
      baseUrl: "https://api.example.test/v1",
      apiMode: "openai-embeddings" as const
    };
    try {
      db.upsertDocument(
        {
          pathRel: "alpha.md",
          name: "alpha.md",
          ext: ".md",
          kind: "markdown",
          size: 32,
          mtimeMs: Date.now(),
          sha256: "alpha-v1"
        },
        parseMarkdown("# Alpha\n\nFirst document succeeds.", "alpha.md")
      );
      db.upsertDocument(
        {
          pathRel: "beta.md",
          name: "beta.md",
          ext: ".md",
          kind: "markdown",
          size: 35,
          mtimeMs: Date.now(),
          sha256: "beta-v1"
        },
        parseMarkdown("# Beta\n\nSecond document fails.", "beta.md")
      );
      db.upsertDocument(
        {
          pathRel: "gamma.md",
          name: "gamma.md",
          ext: ".md",
          kind: "markdown",
          size: 35,
          mtimeMs: Date.now(),
          sha256: "gamma-v1"
        },
        parseMarkdown("# Gamma\n\nThird document still succeeds.", "gamma.md")
      );

      const status = await service.update(db, settings);
      expect(status).toMatchObject({
        state: "ready",
        totalFiles: 3,
        indexedFiles: 2,
        staleFiles: 1,
        error: expect.stringContaining("已跳过 1 个失败文件")
      });
      expect(status.error).toContain("beta.md");
      expect(status.error).toContain("provider reset connection");
      expect(db.semanticSearch([1, 1], settings, 5).map((item) => item.pathRel)).toEqual(expect.arrayContaining(["alpha.md", "gamma.md"]));
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports stale, reset, provider changes, failed state, and semantic search boundaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-semantic-"));
    const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
    const embedMany = vi.fn(async (_settings: unknown, values: string[]) =>
      values.map((value, index) => [value.includes("design") ? 1 : 0.2, value.length / 1000, index + 1])
    );
    const service = new SemanticIndexService({ embedMany } as never);
    const settings = {
      enabled: true,
      providerId: "openai-compatible" as const,
      model: "mock-embed",
      baseUrl: "https://api.example.test/v1",
      apiMode: "openai-embeddings" as const
    };
    try {
      db.upsertDocument(
        {
          pathRel: "alpha.md",
          name: "alpha.md",
          ext: ".md",
          kind: "markdown",
          size: 55,
          mtimeMs: Date.now(),
          sha256: "alpha-v1"
        },
        parseMarkdown("# Alpha\n\nNolia design notes and semantic retrieval.", "alpha.md")
      );
      db.upsertDocument(
        {
          pathRel: "beta.md",
          name: "beta.md",
          ext: ".md",
          kind: "markdown",
          size: 56,
          mtimeMs: Date.now(),
          sha256: "beta-v1"
        },
        parseMarkdown("# Beta\n\nWorkspace operations, proposals, and history.", "beta.md")
      );

      expect(service.status(db, settings).state).toBe("not_created");

      const progress: string[] = [];
      const ready = await service.update(db, settings, {
        onProgress: (status) => progress.push(status.progress?.phase ?? status.state)
      });
      expect(ready).toMatchObject({ state: "ready", totalFiles: 2, indexedFiles: 2 });
      expect(ready.chunkCount).toBeGreaterThanOrEqual(2);
      expect(progress).toContain("scanning");
      expect(progress).toContain("embedding");
      expect(progress).toContain("saving");
      expect(progress.at(-1)).toBe("ready");
      expect(db.semanticSearch([1, 0.04, 1], settings, 5)[0]).toMatchObject({ pathRel: "alpha.md", mode: "semantic" });

      const callCountAfterReady = embedMany.mock.calls.length;
      await service.update(db, settings);
      expect(embedMany).toHaveBeenCalledTimes(callCountAfterReady);

      db.upsertDocument(
        {
          pathRel: "beta.md",
          name: "beta.md",
          ext: ".md",
          kind: "markdown",
          size: 61,
          mtimeMs: Date.now(),
          sha256: "beta-v2"
        },
        parseMarkdown("# Beta\n\nWorkspace operations changed after index creation.", "beta.md")
      );
      expect(service.status(db, settings)).toMatchObject({ state: "stale", staleFiles: 1 });

      const afterIncremental = await service.update(db, settings);
      expect(afterIncremental.state).toBe("ready");
      expect(embedMany.mock.calls.length).toBeGreaterThan(callCountAfterReady);

      expect(service.status(db, { ...settings, model: "other-embedding-model" }).state).toBe("stale");

      const afterReset = await service.update(db, settings, { reset: true });
      expect(afterReset.state).toBe("ready");
      expect(afterReset.indexedFiles).toBe(2);

      const failingService = new SemanticIndexService({
        embedMany: vi.fn(async () => {
          throw new AiProviderError("bad embedding credentials", "provider_auth_failed");
        })
      } as never);
      await failingService.update(db, { ...settings, model: "broken-model" });
      expect(service.status(db, { ...settings, model: "broken-model" })).toMatchObject({
        state: "failed",
        error: expect.stringContaining("bad embedding credentials")
      });
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
