import { afterEach, describe, expect, it, vi } from "vitest";

import { AiEmbeddingService } from "../src/main/ai/embeddingService";
import { AiService, resolveAiIdleTimeoutMs, resolveAiMaxRunMs, resolveAiRunTimeoutMs } from "../src/main/ai/aiService";
import type { AiEmbeddingSettings } from "../src/shared/ai";

describe("AI service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a bounded configurable run timeout", () => {
    expect(resolveAiRunTimeoutMs({})).toBe(120_000);
    expect(resolveAiRunTimeoutMs({ NOLIA_AI_RUN_TIMEOUT_MS: "180000" })).toBe(180_000);
    expect(resolveAiRunTimeoutMs({ NOLIA_AI_RUN_TIMEOUT_MS: "bad" })).toBe(120_000);
    expect(resolveAiRunTimeoutMs({ NOLIA_AI_RUN_TIMEOUT_MS: "5000" })).toBe(30_000);
    expect(resolveAiRunTimeoutMs({ NOLIA_AI_RUN_TIMEOUT_MS: "1200000" })).toBe(600_000);
    expect(resolveAiIdleTimeoutMs({ NOLIA_AI_RUN_TIMEOUT_MS: "180000", NOLIA_AI_IDLE_TIMEOUT_MS: "240000" })).toBe(240_000);
    expect(resolveAiMaxRunMs({})).toBe(600_000);
    expect(resolveAiMaxRunMs({ NOLIA_AI_MAX_RUN_MS: "1200000" })).toBe(1_200_000);
    expect(resolveAiMaxRunMs({ NOLIA_AI_MAX_RUN_MS: "5000" })).toBe(30_000);
    expect(resolveAiMaxRunMs({ NOLIA_AI_MAX_RUN_MS: "7200000" })).toBe(3_600_000);
  });

  it("tests embedding connectivity even when semantic retrieval is disabled", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    const service = new AiEmbeddingService();

    const result = await service.test({
      enabled: false,
      providerId: "ollama",
      model: "nomic-embed-text",
      baseUrl: "http://localhost:11434",
      apiMode: "ollama-native"
    });

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:11434/api/embed", expect.objectContaining({ method: "POST" }));
    expect(result).toMatchObject({
      ok: true,
      providerId: "ollama",
      model: "nomic-embed-text",
      message: "Embedding connected (3 dimensions)"
    });
  });

  it("uses OpenAI-compatible embeddings endpoint and surfaces provider messages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "model does not support embeddings" } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      })
    );
    const service = new AiEmbeddingService();

    const result = await service.test({
      enabled: true,
      providerId: "openai-compatible",
      model: "mock-embed",
      baseUrl: "https://api.example.test/v1",
      apiMode: "openai-embeddings",
      apiKey: "test-key"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "mock-embed", input: ["Nolia embedding connectivity test."] })
      })
    );
    expect(result).toMatchObject({
      ok: false,
      providerId: "openai-compatible",
      model: "mock-embed",
      errorCode: "provider_bad_request",
      message: "model does not support embeddings"
    });
  });

  it("starts semantic indexing in the background and returns progress immediately", async () => {
    let resolveIndex!: (value: unknown) => void;
    const indexStarted = vi.fn();
    const status = {
      state: "not_created",
      enabled: true,
      providerId: "ollama",
      model: "mock-embed",
      totalFiles: 3,
      indexedFiles: 0,
      staleFiles: 3,
      chunkCount: 0
    };
    const db = {
      countSemanticIndexableDocuments: vi.fn(() => 3),
      semanticIndexStatus: vi.fn((settings: AiEmbeddingSettings, progress?: unknown) => ({
        ...status,
        ...settings,
        state: progress ? "updating" : status.state,
        progress
      }))
    };
    const service = new AiService(
      {
        resolvedEmbeddingSettings: (overrides?: Partial<AiEmbeddingSettings>) => ({
          enabled: true,
          providerId: "ollama" as const,
          model: "mock-embed",
          baseUrl: "http://localhost:11434",
          apiMode: "ollama-native" as const,
          ...(overrides ?? {})
        })
      } as never,
      {
        workspaces: {
          requireWorkspace: () => ({ db })
        },
        semanticIndex: {
          update: vi.fn(() => {
            indexStarted();
            return new Promise((resolve) => {
              resolveIndex = resolve;
            });
          })
        },
        diagnostics: { warn: vi.fn() }
      } as never,
      () => undefined
    );

    const result = await service.updateSemanticIndex({ workspaceId: "ws_test" });

    expect(result.status).toMatchObject({
      state: "updating",
      progress: { phase: "scanning", current: 0, total: 3 }
    });
    expect(indexStarted).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(indexStarted).toHaveBeenCalledTimes(1);
    resolveIndex(status);
  });
});
