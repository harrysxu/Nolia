import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { AgentEngine } from "../src/main/ai/agentEngine";
import { AiService } from "../src/main/ai/aiService";
import { AiTaskService } from "../src/main/ai/aiTaskService";
import { AiProviderError, type AiProvider, type AiResolvedSettings, type AiRuntimeServices } from "../src/main/ai/types";
import { normalizedOpenAiCompatibleBaseUrl } from "../src/main/ai/aiSdkProvider";
import { AiToolRegistry } from "../src/main/ai/tools/toolRegistry";
import { normalizeAiSettings } from "../src/main/ai/aiSettingsService";
import { joinUrl } from "../src/main/ai/providerUtils";
import { OpenAiCompatibleProvider } from "../src/main/ai/providers/openAiCompatibleProvider";
import { OllamaProvider } from "../src/main/ai/providers/ollamaProvider";
import { providerErrorCode as ollamaProviderErrorCode } from "../src/main/ai/providers/ollamaProvider";
import { providerErrorCode as openAiProviderErrorCode } from "../src/main/ai/providers/openAiCompatibleProvider";
import { AI_WORKSPACE_PATCH_OPERATION_LIMIT, DEFAULT_AI_EMBEDDING_SETTINGS, type AiPatchProposal, type AiTaskSnapshot } from "../src/shared/ai";

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

  it("exposes current-document proposal tools only with explicit document patch permission", () => {
    const registry = new AiToolRegistry();

    const withoutPatchPermission = registry.providerTools(
      {
        includeCurrentNote: false,
        includeSelection: true,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: false,
        allowDocumentPatch: false,
        allowWorkspaceOperations: false
      },
      true,
      true
    );
    const exposed = registry.providerTools(
      {
        includeCurrentNote: false,
        includeSelection: true,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: false,
        allowDocumentPatch: true,
        allowWorkspaceOperations: false
      },
      true,
      true
    );

    expect(withoutPatchPermission.map((tool) => tool.name)).not.toContain("proposePatch");
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
        allowDocumentPatch: false,
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
        allowDocumentPatch: false,
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
        allowDocumentPatch: false,
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
        allowDocumentPatch: false,
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
        allowDocumentPatch: false,
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

  it("normalizes AI SDK OpenAI-compatible chat base URLs to the v1 API root", () => {
    expect(
      normalizedOpenAiCompatibleBaseUrl({
        providerId: "openai-compatible",
        apiMode: "chat-completions",
        baseUrl: "https://example.test"
      })
    ).toBe("https://example.test/v1");
    expect(
      normalizedOpenAiCompatibleBaseUrl({
        providerId: "openai-compatible",
        apiMode: "chat-completions",
        baseUrl: "https://example.test/v1/"
      })
    ).toBe("https://example.test/v1");
    expect(
      normalizedOpenAiCompatibleBaseUrl({
        providerId: "ollama",
        apiMode: "chat-completions",
        baseUrl: "http://localhost:11434"
      })
    ).toBe("http://localhost:11434/v1");
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
            allowDocumentPatch: false,
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
        allowDocumentPatch: true,
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
          allowDocumentPatch: false,
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
            allowDocumentPatch: true,
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
          allowDocumentPatch: false,
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

  it("accepts twenty workspace patch operations and rejects larger batches", async () => {
    const registry = new AiToolRegistry();
    const existingContent: Record<string, string> = {
      "existing.md": "# Existing\n\nOld body.",
      "append.md": "# Append\n\nCurrent body."
    };
    const readFile = vi.fn(async ({ pathRel }: { pathRel: string }) => {
      const content = existingContent[pathRel] ?? "";
      return {
        content,
        sha256: `${pathRel}:hash`,
        stat: { size: content.length, mtimeMs: 1, ctimeMs: 1, birthtimeMs: 1, isDirectory: false },
        encoding: "utf-8" as const
      };
    });
    const writeAtomic = vi.fn();
    const context = {
      runId: "run_workspace_patch_twenty",
      workspaceId: "ws_patch",
      clientContext: { workspaceId: "ws_patch" },
      allowedScopes: {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: true,
        allowDocumentPatch: false,
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
    };
    const operations = [
      { type: "replaceDocument" as const, pathRel: "existing.md", beforeText: existingContent["existing.md"], afterText: "# Existing\n\nUpdated body." },
      { type: "append" as const, pathRel: "append.md", afterText: "\n\n## Added by AI\n\nBatch note." },
      ...Array.from({ length: AI_WORKSPACE_PATCH_OPERATION_LIMIT - 2 }, (_, index) => ({
        type: "createFile" as const,
        pathRel: `batch/note-${String(index + 1).padStart(2, "0")}.md`,
        afterText: `# Batch Note ${index + 1}\n\nCreated in a twenty-operation AI batch.`
      }))
    ];

    const result = await registry.execute("proposeWorkspacePatch", { summary: "Twenty operation batch", operations }, context);

    expect(result.proposal).toBeDefined();
    const proposal = result.proposal!;
    expect(proposal.operations).toHaveLength(AI_WORKSPACE_PATCH_OPERATION_LIMIT);
    expect(proposal.operations[0]).toMatchObject({ type: "replaceDocument", pathRel: "existing.md", afterText: "# Existing\n\nUpdated body." });
    expect(proposal.operations[1]).toMatchObject({ type: "append", pathRel: "append.md", afterText: "\n\n## Added by AI\n\nBatch note." });
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readFile.mock.calls.map(([request]) => request.pathRel)).toEqual(["existing.md", "append.md"]);
    expect(writeAtomic).not.toHaveBeenCalled();

    await expect(
      registry.execute(
        "proposeWorkspacePatch",
        {
          summary: "Too many operations",
          operations: [
            ...operations,
            { type: "createFile" as const, pathRel: "batch/overflow.md", afterText: "# Overflow\n" }
          ]
        },
        context
      )
    ).rejects.toThrow();
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
            allowDocumentPatch: false,
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

  it("does not let readNote read ignored paths even when a bad search result includes them", async () => {
    const registry = new AiToolRegistry();
    const readFile = vi.fn();

    await expect(
      registry.execute(
        "readNote",
        { pathRel: ".git/secret.md" },
        {
          runId: "run_ignored_search_result",
          workspaceId: "ws_read",
          clientContext: { workspaceId: "ws_read" },
          allowedScopes: {
            includeCurrentNote: false,
            includeSelection: false,
            allowWorkspaceSearch: true,
            allowReadSearchResults: true,
            allowWorkspaceRead: false,
            allowDocumentPatch: false,
            allowWorkspaceOperations: false
          },
          services: {
            files: { readFile } as never,
            workspaces: { requireWorkspace: vi.fn() } as never,
            settings: {} as never,
            diagnostics: {} as never
          },
          signal: new AbortController().signal,
          searchResultPaths: new Set<string>([".git/secret.md"])
        }
      )
    ).rejects.toThrow("readNote cannot read ignored workspace paths");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("limits whole-workspace reads to in-workspace readable text files", async () => {
    const registry = new AiToolRegistry();
    const readFile = vi.fn();
    const context = {
      runId: "run_workspace_read_boundaries",
      workspaceId: "ws_read",
      clientContext: { workspaceId: "ws_read" },
      allowedScopes: {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: true,
        allowDocumentPatch: false,
        allowWorkspaceOperations: false
      },
      services: {
        files: { readFile } as never,
        workspaces: {} as never,
        settings: {} as never,
        diagnostics: {} as never
      },
      signal: new AbortController().signal,
      searchResultPaths: new Set<string>()
    };

    await expect(registry.execute("readWorkspaceFile", { pathRel: "../outside.md" }, context)).rejects.toThrow("Path escapes the workspace");
    await expect(registry.execute("readWorkspaceFile", { pathRel: ".nolia/private.json" }, context)).rejects.toThrow("Workspace file is ignored and cannot be read by AI");
    await expect(registry.execute("readWorkspaceFile", { pathRel: "assets/logo.png" }, context)).rejects.toThrow("AI whole-workspace reads only support text and Markdown files");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("lists workspace top-level entries before optional recursive entries", async () => {
    const registry = new AiToolRegistry();
    const listTree = vi.fn(async ({ root = "" }: { root?: string }) => {
      if (root === "cc") {
        return {
          nodes: [
            { pathRel: "cc/claude-code-docs", name: "claude-code-docs", kind: "directory", size: 0, mtimeMs: 1, children: [{ pathRel: "cc/claude-code-docs/README.md", name: "README.md", kind: "markdown", size: 10, mtimeMs: 1 }] },
            { pathRel: "cc/.DS_Store", name: ".DS_Store", kind: "other", size: 10, mtimeMs: 1 }
          ]
        };
      }
      return {
        nodes: [
          {
            pathRel: "_nolia_ai_test",
            name: "_nolia_ai_test",
            kind: "directory",
            size: 0,
            mtimeMs: 1,
            children: Array.from({ length: 90 }, (_, index) => ({
              pathRel: `_nolia_ai_test/deep-${index}.md`,
              name: `deep-${index}.md`,
              kind: "markdown",
              size: 10,
              mtimeMs: 1
            }))
          },
          { pathRel: "A2UI", name: "A2UI", kind: "directory", size: 0, mtimeMs: 1, children: [{ pathRel: "A2UI/intro.md", name: "intro.md", kind: "markdown", size: 10, mtimeMs: 1 }] },
          { pathRel: "cc", name: "cc", kind: "directory", size: 0, mtimeMs: 1, children: [{ pathRel: "cc/claude-code-docs", name: "claude-code-docs", kind: "directory", size: 0, mtimeMs: 1 }] },
          { pathRel: ".git", name: ".git", kind: "directory", size: 0, mtimeMs: 1, children: [{ pathRel: ".git/config", name: "config", kind: "other", size: 10, mtimeMs: 1 }] },
          { pathRel: "node_modules", name: "node_modules", kind: "directory", size: 0, mtimeMs: 1, children: [{ pathRel: "node_modules/pkg/index.js", name: "index.js", kind: "other", size: 10, mtimeMs: 1 }] },
          { pathRel: "assets/logo.png", name: "logo.png", kind: "asset", size: 10, mtimeMs: 1 },
          { pathRel: "data/report.json", name: "report.json", kind: "asset", size: 10, mtimeMs: 1 }
        ]
      };
    });
    const context = {
      runId: "run_workspace_list_boundaries",
      workspaceId: "ws_list",
      clientContext: { workspaceId: "ws_list" },
      allowedScopes: {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: true,
        allowDocumentPatch: false,
        allowWorkspaceOperations: false
      },
      services: {
        files: { listTree } as never,
        workspaces: {} as never,
        settings: {} as never,
        diagnostics: {} as never
      },
      signal: new AbortController().signal,
      searchResultPaths: new Set<string>()
    };
    const result = await registry.execute(
      "listWorkspaceFiles",
      { limit: 5 },
      context
    );

    expect(result.result).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ pathRel: "_nolia_ai_test" }),
        expect.objectContaining({ pathRel: "A2UI" }),
        expect.objectContaining({ pathRel: "cc" }),
        expect.objectContaining({ pathRel: "data/report.json" })
      ])
    });
    expect(JSON.stringify(result.result)).not.toContain("_nolia_ai_test/deep-0.md");
    expect(JSON.stringify(result.result)).not.toContain(".git");
    expect(JSON.stringify(result.result)).not.toContain("node_modules");
    expect(JSON.stringify(result.result)).not.toContain("logo.png");

    const ccResult = await registry.execute("listWorkspaceFiles", { root: "cc", limit: 10 }, context);

    expect(listTree).toHaveBeenLastCalledWith({ workspaceId: "ws_list", root: "cc", sortBy: "name", showHidden: false });
    expect(ccResult.result).toMatchObject({
      items: [expect.objectContaining({ pathRel: "cc/claude-code-docs", kind: "directory" })]
    });
    expect(JSON.stringify(ccResult.result)).not.toContain(".DS_Store");
  });

  it("inspects and finds workspace paths without searching note bodies", async () => {
    const registry = new AiToolRegistry();
    const listTree = vi.fn(async ({ root = "" }: { root?: string }) => {
      if (root === "cc") {
        return {
          nodes: [
            { pathRel: "cc/claude-code-docs", name: "claude-code-docs", kind: "directory", size: 0, mtimeMs: 2, children: [{ pathRel: "cc/claude-code-docs/README.md", name: "README.md", kind: "markdown", size: 50, mtimeMs: 3 }] }
          ]
        };
      }
      return {
        nodes: [
          { pathRel: "cc", name: "cc", kind: "directory", size: 0, mtimeMs: 1, children: [{ pathRel: "cc/claude-code-docs", name: "claude-code-docs", kind: "directory", size: 0, mtimeMs: 2 }] },
          { pathRel: "notes/readme.md", name: "readme.md", kind: "markdown", size: 10, mtimeMs: 1 }
        ]
      };
    });
    const context = {
      runId: "run_path_tools",
      workspaceId: "ws_paths",
      clientContext: { workspaceId: "ws_paths" },
      allowedScopes: {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: true,
        allowDocumentPatch: false,
        allowWorkspaceOperations: false
      },
      services: {
        files: { listTree } as never,
        workspaces: {} as never,
        settings: {} as never,
        diagnostics: {} as never
      },
      signal: new AbortController().signal,
      searchResultPaths: new Set<string>()
    };

    await expect(registry.execute("inspectWorkspacePath", { pathRel: "cc" }, context)).resolves.toMatchObject({
      result: { pathRel: "cc", exists: true, kind: "directory", childCount: 1 }
    });
    await expect(registry.execute("inspectWorkspacePath", { pathRel: "missing" }, context)).resolves.toMatchObject({
      result: { pathRel: "missing", exists: false, ignored: false }
    });
    await expect(registry.execute("findWorkspacePaths", { query: "claude", root: "cc", includeFiles: false }, context)).resolves.toMatchObject({
      result: { items: [expect.objectContaining({ pathRel: "cc/claude-code-docs", kind: "directory" })] }
    });
  });

  it("creates reviewable folder and move workspace proposals without writing files", async () => {
    const registry = new AiToolRegistry();
    const listTree = vi.fn(async ({ root = "" }: { root?: string }) => {
      if (root === "docs") {
        return {
          nodes: [{ pathRel: "docs/guide.md", name: "guide.md", kind: "markdown", size: 10, mtimeMs: 1 }]
        };
      }
      if (root === "archive") {
        return { nodes: [] };
      }
      return {
        nodes: [
          { pathRel: "docs", name: "docs", kind: "directory", size: 0, mtimeMs: 1, children: [{ pathRel: "docs/guide.md", name: "guide.md", kind: "markdown", size: 10, mtimeMs: 1 }] }
        ]
      };
    });
    const create = vi.fn();
    const rename = vi.fn();
    const context = {
      runId: "run_folder_move_proposal",
      workspaceId: "ws_patch",
      clientContext: { workspaceId: "ws_patch" },
      allowedScopes: {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: true,
        allowDocumentPatch: false,
        allowWorkspaceOperations: true
      },
      services: {
        files: { listTree, create, rename } as never,
        workspaces: {} as never,
        settings: {} as never,
        diagnostics: {} as never
      },
      signal: new AbortController().signal,
      searchResultPaths: new Set<string>()
    };

    const result = await registry.execute(
      "proposeWorkspacePatch",
      {
        summary: "Create archive and move guide",
        operations: [
          { type: "createDirectory", pathRel: "archive" },
          { type: "movePath", sourcePathRel: "docs/guide.md", targetPathRel: "archive/guide.md" }
        ]
      },
      context
    );

    expect(result.proposal).toMatchObject({
      summary: "Create archive and move guide",
      pathRel: "archive",
      operations: [
        { type: "createDirectory", pathRel: "archive" },
        { type: "movePath", sourcePathRel: "docs/guide.md", targetPathRel: "archive/guide.md" }
      ]
    });
    expect(create).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it("keeps workspace proposals review-only and rejects unsupported targets", async () => {
    const registry = new AiToolRegistry();
    const readFile = vi.fn();
    const writeAtomic = vi.fn();
    const context = {
      runId: "run_workspace_patch_boundaries",
      workspaceId: "ws_patch",
      clientContext: { workspaceId: "ws_patch" },
      allowedScopes: {
        includeCurrentNote: false,
        includeSelection: false,
        allowWorkspaceSearch: false,
        allowReadSearchResults: false,
        allowWorkspaceRead: true,
        allowDocumentPatch: false,
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
    };

    await expect(
      registry.execute("proposeWorkspacePatch", { summary: "Create binary", operations: [{ type: "createFile", pathRel: "assets/result.png", afterText: "not a png" }] }, context)
    ).rejects.toThrow("Workspace patch file operations only support Markdown files");
    await expect(
      registry.execute("proposeWorkspacePatch", { summary: "Touch private data", operations: [{ type: "createFile", pathRel: ".nolia/private.md", afterText: "# Private" }] }, context)
    ).rejects.toThrow("Workspace operation cannot target ignored paths");
    await expect(
      registry.execute("proposeWorkspacePatch", { summary: "Escape workspace", operations: [{ type: "createFile", pathRel: "../outside.md", afterText: "# Outside" }] }, context)
    ).rejects.toThrow("Path escapes the workspace");
    expect(readFile).not.toHaveBeenCalled();
    expect(writeAtomic).not.toHaveBeenCalled();
  });

  it("rejects ignored paths again when applying an approved task proposal", async () => {
    const taskId = "task_injected";
    const approvalId = "approval_injected";
    const workspaceId = "ws_patch";
    const proposal: AiPatchProposal = {
      id: "proposal_injected",
      runId: "run_injected",
      taskId,
      approvalId,
      workspaceId,
      pathRel: ".nolia/private.md",
      title: "private.md",
      summary: "Injected internal write",
      sourceSnapshotHash: "new",
      baseHash: "new",
      operations: [{ type: "createFile" as const, pathRel: ".nolia/private.md", afterText: "# Private" }]
    };
    const task: AiTaskSnapshot = {
      id: taskId,
      runId: "run_injected",
      workspaceId,
      title: "Injected task",
      status: "waiting_approval" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      instruction: "write internal file",
      steps: [],
      sources: [],
      approvals: [
        {
          id: approvalId,
          taskId,
          runId: "run_injected",
          toolName: "proposal",
          input: proposal.operations,
          status: "pending" as const,
          createdAt: Date.now(),
          proposalId: proposal.id
        }
      ],
      proposals: [proposal],
      writes: []
    };
    const saveTask = vi.fn();
    const create = vi.fn();
    const service = new AiTaskService(
      { startRun: () => ({ runId: `run_${randomUUID()}` }), cancelRun: vi.fn() } as unknown as AiService,
      {
        files: { create } as never,
        workspaces: { getActiveWorkspace: () => undefined, requireWorkspace: vi.fn() } as never,
        settings: {} as never,
        diagnostics: {} as never
      },
      vi.fn()
    );
    vi.spyOn(service as unknown as { readTask: (taskId: string) => Promise<AiTaskSnapshot | undefined> }, "readTask").mockResolvedValue(task);
    vi.spyOn(service as unknown as { saveTask: (task: AiTaskSnapshot) => Promise<void> }, "saveTask").mockImplementation(saveTask);

    await expect(service.approveProposal({ taskId, approvalId })).rejects.toThrow("Workspace path is ignored");
    expect(create).not.toHaveBeenCalled();
    expect(saveTask).not.toHaveBeenCalled();
    expect(task.approvals[0].status).toBe("pending");
    expect(task.proposals[0].status).toBeUndefined();
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
