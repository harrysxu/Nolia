import { describe, expect, it, vi } from "vitest";

import { AgentEngine } from "../src/main/ai/agentEngine";
import { AiProviderError, type AiProvider, type AiResolvedSettings, type AiRuntimeServices } from "../src/main/ai/types";
import { AiToolRegistry } from "../src/main/ai/tools/toolRegistry";
import { normalizeAiSettings } from "../src/main/ai/aiSettingsService";
import { joinUrl } from "../src/main/ai/providerUtils";
import { OpenAiCompatibleProvider } from "../src/main/ai/providers/openAiCompatibleProvider";
import { OllamaProvider } from "../src/main/ai/providers/ollamaProvider";
import { providerErrorCode as ollamaProviderErrorCode } from "../src/main/ai/providers/ollamaProvider";
import { providerErrorCode as openAiProviderErrorCode } from "../src/main/ai/providers/openAiCompatibleProvider";
import { DEFAULT_AI_EMBEDDING_SETTINGS } from "../src/shared/ai";

describe("AI runtime", () => {
  it("normalizes provider defaults", () => {
    expect(normalizeAiSettings({ providerId: "ollama" })).toMatchObject({
      defaultProviderId: "ollama-local",
      providers: [
        expect.objectContaining({
          id: "ollama-local",
          providerId: "ollama",
          baseUrl: "http://localhost:11434/v1",
          apiMode: "chat-completions"
        })
      ],
      enabled: false
    });
    expect(normalizeAiSettings({ providerId: "openai-compatible" })).toMatchObject({
      defaultProviderId: "openai-compatible",
      providers: [
        expect.objectContaining({
          id: "openai-compatible",
          providerId: "openai-compatible",
          baseUrl: "",
          apiMode: "chat-completions"
        })
      ]
    });
  });

  it("exposes proposal tools without requiring workspace search", () => {
    const registry = new AiToolRegistry();

    const exposed = registry.providerTools(
      {
        includeCurrentNote: false,
        includeSelection: true,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: false,
        allowWorkspaceOperations: false
      },
      true,
      true
    );

    expect(exposed.map((tool) => tool.name)).toContain("proposePatch");
    expect(exposed.map((tool) => tool.name)).not.toContain("searchNotes");
    expect(exposed.map((tool) => tool.name)).not.toContain("readNote");
  });

  it("only exposes readNote when workspace search and matched-note reading are both enabled", () => {
    const registry = new AiToolRegistry();

    const withoutSearch = registry.providerTools(
      {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: true,
        allowWorkspaceRead: false,
        allowWorkspaceOperations: false
      },
      true,
      true
    );
    const withSearchAndRead = registry.providerTools(
      {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: true,
        allowReadSearchResults: true,
        allowWorkspaceRead: false,
        allowWorkspaceOperations: false
      },
      true,
      true
    );

    expect(withoutSearch.map((tool) => tool.name)).not.toContain("readNote");
    expect(withSearchAndRead.map((tool) => tool.name)).toContain("searchNotes");
    expect(withSearchAndRead.map((tool) => tool.name)).toContain("readNote");
    expect(withSearchAndRead.find((tool) => tool.name === "readNote")?.description).toContain("Cannot read arbitrary files");
  });

  it("exposes whole-workspace read tools only after workspace read is allowed", () => {
    const registry = new AiToolRegistry();
    const locked = registry.providerTools(
      {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: false,
        allowWorkspaceOperations: false
      },
      true,
      true
    );
    const allowed = registry.providerTools(
      {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: true,
        allowWorkspaceOperations: false
      },
      true,
      true
    );

    expect(locked.map((tool) => tool.name)).not.toContain("readWorkspaceFile");
    expect(allowed.map((tool) => tool.name)).toContain("listWorkspaceFiles");
    expect(allowed.map((tool) => tool.name)).toContain("readWorkspaceFile");
    expect(allowed.map((tool) => tool.name)).not.toContain("proposeWorkspacePatch");
  });

  it("exposes workspace operation proposals only after read and operation permissions are allowed", () => {
    const registry = new AiToolRegistry();
    const exposed = registry.providerTools(
      {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: true,
        allowWorkspaceOperations: true
      },
      true,
      true
    );

    expect(exposed.map((tool) => tool.name)).toContain("proposeWorkspacePatch");
  });

  it("maps provider errors to AI error codes", () => {
    const rateLimitError = new AiProviderError("rate limited", "provider_rate_limited");

    expect(openAiProviderErrorCode(rateLimitError)).toBe("provider_rate_limited");
    expect(ollamaProviderErrorCode(rateLimitError)).toBe("provider_rate_limited");
    expect(openAiProviderErrorCode(new Error("network"))).toBe("provider_unreachable");
  });

  it("joins OpenAI-compatible v1 base URLs without duplicating the version segment", () => {
    expect(joinUrl("https://example.test/v1", "/v1/chat/completions")).toBe("https://example.test/v1/chat/completions");
    expect(joinUrl("https://example.test/v1/", "v1/models")).toBe("https://example.test/v1/models");
    expect(joinUrl("https://example.test/proxy", "/v1/chat/completions")).toBe("https://example.test/proxy/v1/chat/completions");
    expect(joinUrl("http://localhost:11434", "/api/chat")).toBe("http://localhost:11434/api/chat");
  });

  it("lists OpenAI-compatible models through the v1 models endpoint", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://example.test/v1/models");
      expect(init?.headers).toMatchObject({ authorization: "Bearer secret" });
      return new Response(JSON.stringify({ data: [{ id: "gpt-5.4-mini", owned_by: "codexx" }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const provider = new OpenAiCompatibleProvider();
      await expect(
        provider.listModels({
          enabled: true,
          id: "openai-compatible",
          name: "OpenAI-compatible",
          defaultProviderId: "openai-compatible",
          providers: [
            {
              id: "openai-compatible",
              name: "OpenAI-compatible",
              providerId: "openai-compatible",
              model: "gpt-5.4-mini",
              baseUrl: "https://example.test/v1",
              apiMode: "chat-completions"
            }
          ],
          embedding: DEFAULT_AI_EMBEDDING_SETTINGS,
          providerId: "openai-compatible",
          model: "gpt-5.4-mini",
          baseUrl: "https://example.test/v1",
          apiMode: "chat-completions",
          conversationHistoryTurns: 3,
          agentMaxSteps: 12,
          allowCurrentNoteContent: false,
          allowWorkspaceSearch: false,
          allowReadSearchResults: false,
          allowWorkspaceRead: false,
          allowWorkspaceOperations: false,
          apiKey: "secret"
        })
      ).resolves.toEqual([{ id: "gpt-5.4-mini", label: "gpt-5.4-mini", details: "codexx" }]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses OpenAI-compatible endpoints for Ollama chat-completions without requiring an API key", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "http://localhost:11434/v1/chat/completions") {
        expect(init?.headers).not.toMatchObject({ authorization: expect.any(String) });
        return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (String(url) === "http://localhost:11434/v1/models") {
        expect(init?.headers).not.toMatchObject({ authorization: expect.any(String) });
        return new Response(JSON.stringify({ data: [{ id: "qwen3.5:latest", owned_by: "ollama" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected URL: ${String(url)}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const provider = new OpenAiCompatibleProvider();
      const settings = {
        ...ollamaTestSettings(),
        baseUrl: "http://localhost:11434/v1",
        apiMode: "chat-completions" as const
      };
      await expect(provider.testConnection(settings)).resolves.toMatchObject({
        ok: true,
        providerId: "ollama",
        localOnly: true,
        model: "qwen3.5:latest"
      });
      await expect(provider.listModels(settings)).resolves.toEqual([{ id: "qwen3.5:latest", label: "qwen3.5:latest", details: "ollama" }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports OpenAI-compatible empty streams with a specific error code", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;

    try {
      const provider = new OpenAiCompatibleProvider();
      await expect(collectProviderEvents(provider.streamChat({ settings: openAiTestSettings(), messages: [{ role: "user", content: "hello" }], tools: [] }, new AbortController().signal))).rejects.toMatchObject({
        code: "provider_empty_response"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses OpenAI-compatible CRLF SSE streams", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\r\n\r\ndata: [DONE]\r\n\r\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as typeof fetch;

    try {
      const provider = new OpenAiCompatibleProvider();
      await expect(collectProviderEvents(provider.streamChat({ settings: openAiTestSettings(), messages: [{ role: "user", content: "hello" }], tools: [] }, new AbortController().signal))).resolves.toContainEqual({
        type: "text-delta",
        text: "ok"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports non-JSON OpenAI-compatible streams as bad request", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response("data: provider proxy returned html\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      })
    ) as typeof fetch;

    try {
      const provider = new OpenAiCompatibleProvider();
      await expect(collectProviderEvents(provider.streamChat({ settings: openAiTestSettings(), messages: [{ role: "user", content: "hello" }], tools: [] }, new AbortController().signal))).rejects.toMatchObject({
        code: "provider_bad_request"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports Ollama empty streams with a specific error code", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("", { status: 200, headers: { "content-type": "application/x-ndjson" } })) as typeof fetch;

    try {
      const provider = new OllamaProvider();
      await expect(collectProviderEvents(provider.streamChat({ settings: ollamaTestSettings(), messages: [{ role: "user", content: "hello" }], tools: [] }, new AbortController().signal))).rejects.toMatchObject({
        code: "provider_empty_response"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports tool-call loops that exhaust the configured rounds", async () => {
    const provider: AiProvider = {
      id: "openai-compatible",
      label: "Mock provider",
      capabilities: {
        streaming: true,
        nativeToolCalling: true,
        structuredOutput: true,
        localOnly: false,
        modelListing: false,
        usage: "none"
      },
      async testConnection() {
        return { ok: true, providerId: "openai-compatible", message: "ok", localOnly: false };
      },
      async *streamChat() {
        yield { type: "tool-call", callId: "call_1", toolName: "listTags", input: {} };
        yield { type: "done" };
      }
    };
    const services: AiRuntimeServices = {
      files: {} as never,
      workspaces: { requireWorkspace: () => ({ db: { listTags: () => [] } }) } as never,
      settings: {} as never,
      diagnostics: {} as never
    };
    const engine = new AgentEngine(provider, services);

    await expect(
      collectRunEvents(
        engine.run({
          runId: "run_loop",
          instruction: "list tags",
          entryPoint: "chat",
          conversation: [],
          settings: openAiTestSettings(),
          clientContext: { workspaceId: "ws_1" },
          allowedScopes: {
            includeCurrentNote: false,
            includeSelection: false,
            allowWorkspaceSearch: false,
            allowReadSearchResults: false,
            allowWorkspaceRead: false,
            allowWorkspaceOperations: false
          },
          allowTools: true,
          patchFallback: false,
          maxToolRounds: 1,
          signal: new AbortController().signal
        })
      )
    ).rejects.toMatchObject({
      code: "tool_failed"
    });
  });

  it("creates reviewable patch proposals without writing files", async () => {
    const registry = new AiToolRegistry();
    const sourceText = "# Patch Target\n\nOriginal paragraph.";
    const writeAtomic = vi.fn();
    const context = {
      runId: "run_patch",
      workspaceId: "ws_patch",
      clientContext: {
        workspaceId: "ws_patch",
        activeDocument: {
          pathRel: "patch.md",
          title: "patch.md",
          mode: "source" as const,
          sourceText,
          baseHash: "base-hash",
          dirty: false,
          parsedTitle: "Patch Target",
          headings: [{ text: "Patch Target", depth: 1, line: 1 }]
        }
      },
      allowedScopes: {
        includeCurrentNote: true,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: false,
        allowWorkspaceOperations: false
      },
      services: {
        files: { writeAtomic } as never,
        workspaces: {} as never,
        settings: {} as never,
        diagnostics: {} as never
      },
      signal: new AbortController().signal,
      searchResultPaths: new Set<string>()
    };

    const result = await registry.execute(
      "proposePatch",
      {
        pathRel: "patch.md",
        summary: "Replace patch target",
        operations: [{ type: "replaceDocument", beforeText: sourceText, afterText: "# Patch Target\n\nAI Patch Proposed." }]
      },
      context
    );

    expect(result.summary).toBe("Replace patch target");
    expect(result.proposal).toMatchObject({
      runId: "run_patch",
      workspaceId: "ws_patch",
      pathRel: "patch.md",
      title: "Patch Target",
      summary: "Replace patch target",
      baseHash: "base-hash",
      operations: [{ type: "replaceDocument", beforeText: sourceText, afterText: "# Patch Target\n\nAI Patch Proposed." }]
    });
    expect(writeAtomic).not.toHaveBeenCalled();
  });

  it("searchNotes falls back to full-text when semantic index is not configured", async () => {
    const registry = new AiToolRegistry();
    const search = vi.fn(() => ({
      items: [{ pathRel: "alpha.md", title: "Alpha", score: 1, snippets: ["alpha snippet"] }],
      indexVersion: 1,
      isPartial: false
    }));
    const result = await registry.execute(
      "searchNotes",
      { query: "alpha" },
      {
        runId: "run_search",
        workspaceId: "ws_search",
        clientContext: { workspaceId: "ws_search" },
        allowedScopes: {
          includeCurrentNote: false,
          includeSelection: false,
          allowWorkspaceSearch: true,
          allowReadSearchResults: true,
          allowWorkspaceRead: false,
          allowWorkspaceOperations: false
        },
        services: {
          files: {} as never,
          workspaces: {
            requireWorkspace: () => ({
              db: {
                search,
                semanticIndexStatus: () => ({ state: "not_configured" })
              }
            })
          } as never,
          aiSettings: {
            resolvedEmbeddingSettings: () => DEFAULT_AI_EMBEDDING_SETTINGS
          } as never,
          settings: {} as never,
          diagnostics: {} as never
        },
        signal: new AbortController().signal,
        searchResultPaths: new Set<string>()
      }
    );

    expect(result.result).toMatchObject({
      mode: "full-text",
      fallbackReason: expect.stringContaining("not configured"),
      items: [{ pathRel: "alpha.md" }]
    });
    expect(result.summary).toContain("full-text");
    expect(search).toHaveBeenCalledWith({ workspaceId: "ws_search", query: "alpha", limit: 8 });
  });

  it("rejects patch proposals for files other than the active document", async () => {
    const registry = new AiToolRegistry();
    await expect(
      registry.execute(
        "proposePatch",
        {
          pathRel: "other.md",
          summary: "Invalid target",
          operations: [{ type: "append", afterText: "Nope" }]
        },
        {
          runId: "run_patch",
          workspaceId: "ws_patch",
          clientContext: {
            workspaceId: "ws_patch",
            activeDocument: {
              pathRel: "patch.md",
              title: "patch.md",
              mode: "source" as const,
              sourceText: "# Patch",
              baseHash: "base-hash",
              dirty: false
            }
          },
          allowedScopes: {
            includeCurrentNote: true,
            includeSelection: false,
            allowWorkspaceSearch: false,
            allowReadSearchResults: false,
            allowWorkspaceRead: false,
            allowWorkspaceOperations: false
          },
          services: {
            files: {} as never,
            workspaces: {} as never,
            settings: {} as never,
            diagnostics: {} as never
          },
          signal: new AbortController().signal,
          searchResultPaths: new Set<string>()
        }
      )
    ).rejects.toThrow("Patch proposals can only target the active document");
  });

  it("creates reviewable workspace patch proposals without writing files", async () => {
    const registry = new AiToolRegistry();
    const readFile = vi.fn(async () => ({
      content: "# Existing\n\nOld body.",
      sha256: "existing-hash",
      stat: { size: 20, mtimeMs: 1, ctimeMs: 1, birthtimeMs: 1, isDirectory: false },
      encoding: "utf-8" as const
    }));
    const writeAtomic = vi.fn();

    const result = await registry.execute(
      "proposeWorkspacePatch",
      {
        summary: "Update workspace docs",
        operations: [
          { type: "replaceDocument", pathRel: "existing.md", beforeText: "# Existing\n\nOld body.", afterText: "# Existing\n\nNew body." },
          { type: "createFile", pathRel: "new-note.md", afterText: "# New note\n" }
        ]
      },
      {
        runId: "run_workspace_patch",
        workspaceId: "ws_patch",
        clientContext: { workspaceId: "ws_patch" },
        allowedScopes: {
          includeCurrentNote: false,
          includeSelection: false,
          allowWorkspaceSearch: false,
          allowReadSearchResults: false,
          allowWorkspaceRead: true,
          allowWorkspaceOperations: true
        },
        services: {
          files: { readFile, writeAtomic } as never,
          workspaces: {} as never,
          settings: {} as never,
          diagnostics: {} as never
        },
        signal: new AbortController().signal,
        searchResultPaths: new Set<string>()
      }
    );

    expect(result.summary).toBe("Update workspace docs");
    expect(result.proposal).toMatchObject({
      workspaceId: "ws_patch",
      pathRel: "existing.md",
      operations: [
        { type: "replaceDocument", pathRel: "existing.md", beforeText: "# Existing\n\nOld body.", afterText: "# Existing\n\nNew body." },
        { type: "createFile", pathRel: "new-note.md", afterText: "# New note\n" }
      ]
    });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(writeAtomic).not.toHaveBeenCalled();
  });

  it("does not let readNote bypass search-result scope by reading the current note", async () => {
    const registry = new AiToolRegistry();
    await expect(
      registry.execute(
        "readNote",
        { pathRel: "current.md" },
        {
          runId: "run_read",
          workspaceId: "ws_read",
          clientContext: {
            workspaceId: "ws_read",
            activeDocument: {
              pathRel: "current.md",
              title: "current.md",
              mode: "source" as const,
              sourceText: "# Current\n\nSecret current note body.",
              baseHash: "base-hash",
              dirty: false
            }
          },
          allowedScopes: {
            includeCurrentNote: false,
            includeSelection: false,
            allowWorkspaceSearch: true,
            allowReadSearchResults: true,
            allowWorkspaceRead: false,
            allowWorkspaceOperations: false
          },
          services: {
            files: { readFile: vi.fn() } as never,
            workspaces: { requireWorkspace: vi.fn() } as never,
            settings: {} as never,
            diagnostics: {} as never
          },
          signal: new AbortController().signal,
          searchResultPaths: new Set<string>()
        }
      )
    ).rejects.toThrow("readNote can only read notes found by search in this run");
  });
});

async function collectProviderEvents<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function collectRunEvents<T>(events: AsyncIterable<T>): Promise<T[]> {
  return collectProviderEvents(events);
}

function openAiTestSettings(): AiResolvedSettings {
  return {
    enabled: true,
    id: "openai-compatible",
    name: "OpenAI-compatible",
    defaultProviderId: "openai-compatible",
    providers: [
      {
        id: "openai-compatible",
        name: "OpenAI-compatible",
        providerId: "openai-compatible",
        model: "gpt-5.4-mini",
        baseUrl: "https://example.test/v1",
        apiMode: "chat-completions"
      }
    ],
    embedding: DEFAULT_AI_EMBEDDING_SETTINGS,
    providerId: "openai-compatible",
    model: "gpt-5.4-mini",
    baseUrl: "https://example.test/v1",
    apiMode: "chat-completions",
    conversationHistoryTurns: 3,
    agentMaxSteps: 12,
    allowCurrentNoteContent: false,
    allowWorkspaceSearch: false,
    allowReadSearchResults: false,
    allowWorkspaceRead: false,
    allowWorkspaceOperations: false,
    apiKey: "secret"
  };
}

function ollamaTestSettings(): AiResolvedSettings {
  return {
    ...openAiTestSettings(),
    id: "ollama-local",
    name: "Local Ollama",
    defaultProviderId: "ollama-local",
    providers: [
      {
        id: "ollama-local",
        name: "Local Ollama",
        providerId: "ollama",
        model: "qwen3.5:latest",
        baseUrl: "http://localhost:11434",
        apiMode: "ollama-native"
      }
    ],
    providerId: "ollama",
    model: "qwen3.5:latest",
    baseUrl: "http://localhost:11434",
    apiMode: "ollama-native",
    apiKey: undefined
  };
}
