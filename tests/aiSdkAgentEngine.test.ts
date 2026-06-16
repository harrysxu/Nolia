import { describe, expect, it, vi } from "vitest";

import { AiProviderError, type AiProvider, type AiRunInput, type AiRuntimeServices } from "../src/main/ai/types";
import { DEFAULT_AI_EMBEDDING_SETTINGS } from "../src/shared/ai";

const streamTextMock = vi.hoisted(() => vi.fn());
const sdkModel = vi.hoisted(() => ({}));

vi.mock("ai", () => ({
  stepCountIs: (count: number) => count,
  streamText: streamTextMock,
  tool: (definition: unknown) => definition
}));

vi.mock("../src/main/ai/aiSdkProvider", () => ({
  createAiSdkLanguageModel: () => sdkModel
}));

describe("AI SDK agent engine", () => {
  it("propagates aborted SDK runs so the service can report timeout instead of cancellation", async () => {
    const { AiSdkAgentEngine } = await import("../src/main/ai/aiSdkAgentEngine");
    const controller = new AbortController();
    streamTextMock.mockReturnValueOnce({
      fullStream: (async function* () {
        controller.abort(new AiProviderError("AI 请求超过 90 秒未返回，已自动停止。", "run_timeout"));
        yield { type: "start" };
      })(),
      finishReason: Promise.resolve("stop")
    });

    await expect(collectRunEvents(new AiSdkAgentEngine(provider(), services()).run(input(controller.signal)))).rejects.toMatchObject({
      code: "run_timeout"
    });
  });
});

async function collectRunEvents<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function input(signal: AbortSignal): AiRunInput {
  return {
    runId: "run-timeout",
    instruction: "hello",
    entryPoint: "chat",
    conversation: [],
    settings: {
      enabled: true,
      id: "ollama-local",
      name: "Local Ollama",
      defaultProviderId: "ollama-local",
      providers: [],
      embedding: DEFAULT_AI_EMBEDDING_SETTINGS,
      providerId: "ollama",
      model: "qwen3.5:latest",
      baseUrl: "http://localhost:11434/v1",
      apiMode: "chat-completions",
      conversationHistoryTurns: 3,
      agentMaxSteps: 12,
      allowCurrentNoteContent: false,
      allowWorkspaceSearch: false,
      allowReadSearchResults: false,
      allowWorkspaceRead: false,
      allowWorkspaceOperations: false
    },
    clientContext: {},
    allowedScopes: {
      includeCurrentNote: false,
      includeSelection: false,
      allowWorkspaceSearch: false,
      allowReadSearchResults: false,
      allowWorkspaceRead: false,
      allowWorkspaceOperations: false
    },
    allowTools: false,
    patchFallback: false,
    maxToolRounds: 12,
    signal
  };
}

function provider(): AiProvider {
  return {
    id: "ollama",
    label: "Ollama",
    capabilities: {
      streaming: true,
      nativeToolCalling: true,
      structuredOutput: true,
      localOnly: true,
      modelListing: true,
      usage: "tokens"
    },
    async testConnection() {
      return { ok: true, providerId: "ollama", message: "ok", localOnly: true };
    },
    async *streamChat() {
      yield { type: "done" };
    }
  };
}

function services(): AiRuntimeServices {
  return {
    files: {} as never,
    workspaces: {} as never,
    settings: {} as never,
    diagnostics: {} as never
  };
}
