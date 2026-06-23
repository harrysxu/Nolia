import { stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type TextStreamPart, type ToolSet } from "ai";

import type { AiPatchProposal, AiRunEvent, AiUsage } from "../../shared/ai";
import { abortError, createFallbackProposal, summarizeToolInput } from "./agentRuntimeUtils";
import { buildInitialMessages } from "./context/aiContextBuilder";
import { AiProviderError, type AiProvider, type AiRunInput, type AiRuntimeServices } from "./types";
import { createAiSdkLanguageModel } from "./aiSdkProvider";
import { AiToolRegistry, allAiTools, toolAllowedForScopes } from "./tools/toolRegistry";

export class AiSdkAgentEngine {
  constructor(
    private readonly fallbackProvider: AiProvider,
    private readonly services: AiRuntimeServices
  ) {}

  async *run(input: AiRunInput): AsyncIterable<AiRunEvent> {
    const model = createAiSdkLanguageModel(input.settings);
    if (!model) {
      yield* new LegacyProviderAgentEngine(this.fallbackProvider, this.services).run(input);
      return;
    }

    const registry = new AiToolRegistry();
    const searchResultPaths = new Set<string>();
    const emittedProposalIds = new Set<string>();
    let generatedText = "";
    let sawUsefulOutput = false;
    let sawReasoningOnlyOutput = false;
    let generatedTextAfterLastToolCall = false;
    let lastStepHadToolResults = false;
    let lastStepToolNames: string[] = [];
    yield { type: "run-started", runId: input.runId };

    const sdkTools = input.allowTools
      ? createSdkTools({
          registry,
          model,
          input,
          services: this.services,
          searchResultPaths,
          onEvent: (event) => {
            sawUsefulOutput = true;
            bufferedEvents.push(event);
          },
          onProposal: (proposal) => {
            emittedProposalIds.add(proposal.id);
          }
        })
      : undefined;
    const bufferedEvents: AiRunEvent[] = [];

    try {
      const result = streamText({
        model,
        messages: toModelMessages(buildInitialMessages(input)),
        tools: sdkTools,
        stopWhen: stepCountIs(Math.max(1, Math.min(30, input.maxToolRounds))),
        abortSignal: input.signal,
        onStepFinish: (step) => {
          lastStepHadToolResults = step.toolResults.length > 0;
          lastStepToolNames = step.toolCalls.map((call) => call.toolName);
          const usage = usageFromSdk(step.usage);
          if (usage.totalTokens || usage.inputTokens || usage.outputTokens) {
            bufferedEvents.push({ type: "usage", runId: input.runId, usage });
          }
        }
      });

      for await (const part of result.fullStream) {
        for (const event of bufferedEvents.splice(0)) {
          if (event.type === "tool-call") {
            generatedTextAfterLastToolCall = false;
          }
          yield event;
        }
        if (input.signal.aborted) {
          throw abortError(input.signal);
        }
        const event = eventFromStreamPart(input.runId, part);
        if (part.type === "reasoning-delta") {
          sawReasoningOnlyOutput = true;
        }
        if (part.type === "tool-call") {
          generatedTextAfterLastToolCall = false;
          lastStepHadToolResults = true;
          lastStepToolNames = [String(part.toolName)];
        }
        if (event?.type === "text-delta") {
          sawUsefulOutput = true;
          generatedTextAfterLastToolCall = true;
          generatedText = `${generatedText}${event.text}`;
          yield event;
        } else if (event) {
          sawUsefulOutput = true;
          yield event;
        }
      }
      for (const event of bufferedEvents.splice(0)) {
        if (event.type === "tool-call") {
          generatedTextAfterLastToolCall = false;
        }
        yield event;
      }
      await result.finishReason;
      if (!sawUsefulOutput) {
        throw new AiProviderError(
          sawReasoningOnlyOutput
            ? "模型服务只返回了思考过程，没有返回最终回答或工具调用。请关闭模型的 thinking/reasoning 模式，或换用支持普通 Chat Completions 工具调用的模型后重试。"
            : "模型服务结束了本轮请求，但没有返回文本或工具调用。请检查模型服务是否正常，或确认当前模型支持所选接口模式。",
          "provider_empty_response"
        );
      }
      if (lastStepHadToolResults && !generatedTextAfterLastToolCall && !emittedProposalIds.size) {
        throw new AiProviderError(`模型连续调用工具 ${Math.max(1, Math.min(30, input.maxToolRounds))} 步后仍没有生成最终回答。\n最后调用的工具：${[...new Set(lastStepToolNames)].join(", ")}\n请减少问题范围，或在 AI 设置中提高多轮工具调用次数后重试。`, "tool_failed");
      }
      if (input.patchFallback && input.allowedScopes.allowDocumentPatch && !emittedProposalIds.size) {
        const proposal = createFallbackProposal(input, generatedText);
        if (proposal) {
          yield { type: "patch-proposal", runId: input.runId, proposal };
        }
      }
      yield { type: "done", runId: input.runId };
    } catch (error) {
      if (input.signal.aborted) {
        throw error;
      }
      throw normalizeAiSdkError(error);
    }
  }
}

function createSdkTools(options: {
  registry: AiToolRegistry;
  model: LanguageModel;
  input: AiRunInput;
  services: AiRuntimeServices;
  searchResultPaths: Set<string>;
  onEvent: (event: AiRunEvent) => void;
  onProposal: (proposal: AiPatchProposal) => void;
}): ToolSet {
  const available = allAiTools().filter((item) =>
    toolAllowedForScopes(item, options.input.allowedScopes, Boolean(options.input.clientContext.activeDocument), Boolean(options.input.clientContext.workspaceId))
  );
  const result: ToolSet = {};
  for (const aiTool of available) {
    result[aiTool.name] = tool({
      description: aiTool.description,
      inputSchema: aiTool.inputSchema,
      execute: async (toolInput, executionOptions) => {
        const callId = executionOptions.toolCallId;
        options.onEvent({
          type: "tool-call",
          runId: options.input.runId,
          callId,
          toolName: aiTool.name,
          inputSummary: summarizeToolInput(toolInput)
        });
        let envelope: Awaited<ReturnType<AiToolRegistry["execute"]>>;
        try {
          envelope = await options.registry.execute(aiTool.name, toolInput, {
            runId: options.input.runId,
            workspaceId: options.input.clientContext.workspaceId,
            clientContext: options.input.clientContext,
            allowedScopes: options.input.allowedScopes,
            services: options.services,
            signal: options.input.signal,
            searchResultPaths: options.searchResultPaths
          });
        } catch (error) {
          throw new AiProviderError(`AI 工具调用失败：${aiTool.name}\n原因：${error instanceof Error ? error.message : String(error)}`, "tool_failed");
        }
        options.onEvent({
          type: "tool-result",
          runId: options.input.runId,
          callId,
          toolName: aiTool.name,
          resultSummary: envelope.summary,
          sourceRefs: envelope.sourceRefs
        });
        for (const source of envelope.sourceRefs ?? []) {
          options.onEvent({ type: "source-used", runId: options.input.runId, source });
        }
        if (envelope.proposal) {
          options.onProposal(envelope.proposal);
          options.onEvent({ type: "patch-proposal", runId: options.input.runId, proposal: envelope.proposal });
        }
        return envelope.result;
      }
    });
  }
  return result;
}

function toModelMessages(messages: ReturnType<typeof buildInitialMessages>): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === "system") {
      return { role: "system", content: message.content };
    }
    if (message.role === "assistant") {
      return { role: "assistant", content: message.content };
    }
    return { role: "user", content: message.content };
  });
}

function eventFromStreamPart(runId: string, part: TextStreamPart<ToolSet>): AiRunEvent | undefined {
  if (part.type === "text-delta") {
    return { type: "text-delta", runId, text: part.text };
  }
  if (part.type === "error") {
    throw normalizeAiSdkError(part.error);
  }
  return undefined;
}

function usageFromSdk(value: unknown): AiUsage {
  if (!value || typeof value !== "object") {
    return {};
  }
  const usage = value as {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
  const inputTokens = usage.inputTokens ?? usage.promptTokens;
  const outputTokens = usage.outputTokens ?? usage.completionTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.totalTokens ?? (typeof inputTokens === "number" && typeof outputTokens === "number" ? inputTokens + outputTokens : undefined)
  };
}

function normalizeAiSdkError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthorized|api key|401|403/i.test(message)) {
    return new AiProviderError(message, "provider_auth_failed");
  }
  if (/rate limit|429/i.test(message)) {
    return new AiProviderError(message, "provider_rate_limited");
  }
  if (/tool|schema|invalid/i.test(message)) {
    return new AiProviderError(message, "tool_failed");
  }
  if (/fetch|network|ECONN|ENOTFOUND|Failed to fetch/i.test(message)) {
    return new AiProviderError(message, "provider_unreachable");
  }
  return new AiProviderError(message || "AI run failed", "provider_bad_request");
}

class LegacyProviderAgentEngine {
  constructor(
    private readonly provider: AiProvider,
    private readonly services: AiRuntimeServices
  ) {}

  async *run(input: AiRunInput): AsyncIterable<AiRunEvent> {
    const { AgentEngine } = await import("./agentEngine");
    yield* new AgentEngine(this.provider, this.services).run(input);
  }
}
