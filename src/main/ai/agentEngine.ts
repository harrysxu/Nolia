import type { AiRunEvent } from "../../shared/ai";
import { abortError, createFallbackProposal, summarizeToolInput } from "./agentRuntimeUtils";
import { buildInitialMessages } from "./context/aiContextBuilder";
import { AiProviderError, type AiChatMessage, type AiProvider, type AiRunInput, type AiRuntimeServices } from "./types";
import { AiToolRegistry } from "./tools/toolRegistry";

export class AgentEngine {
  constructor(
    private readonly provider: AiProvider,
    private readonly services: AiRuntimeServices
  ) {}

  async *run(input: AiRunInput): AsyncIterable<AiRunEvent> {
    const registry = new AiToolRegistry();
    const messages: AiChatMessage[] = buildInitialMessages(input);
    const searchResultPaths = new Set<string>();
    let generatedText = "";
    let emittedProposal = false;
    yield { type: "run-started", runId: input.runId };

    const tools = input.allowTools && this.provider.capabilities.nativeToolCalling
      ? registry.providerTools(input.allowedScopes, Boolean(input.clientContext.activeDocument), Boolean(input.clientContext.workspaceId))
      : [];
    const maxRounds = Math.max(1, Math.min(30, input.maxToolRounds));
    let exhaustedToolCalls: string[] = [];

    for (let round = 0; round < maxRounds; round += 1) {
      const pendingToolCalls: Array<{ callId: string; toolName: string; input: unknown }> = [];
      let sawProviderEvent = false;
      let sawUsefulOutput = false;
      for await (const event of this.provider.streamChat({ settings: input.settings, messages, tools }, input.signal)) {
        sawProviderEvent = true;
        if (input.signal.aborted) {
          throw abortError(input.signal);
        }
        if (event.type === "text-delta") {
          generatedText = `${generatedText}${event.text}`;
          sawUsefulOutput = true;
          yield { type: "text-delta", runId: input.runId, text: event.text };
        } else if (event.type === "tool-call") {
          pendingToolCalls.push(event);
          sawUsefulOutput = true;
          yield {
            type: "tool-call",
            runId: input.runId,
            callId: event.callId,
            toolName: event.toolName,
            inputSummary: summarizeToolInput(event.input)
          };
        } else if (event.type === "usage") {
          yield { type: "usage", runId: input.runId, usage: event.usage };
        }
      }
      if (!sawProviderEvent || !sawUsefulOutput) {
        throw new AiProviderError("模型服务结束了本轮请求，但没有返回文本或工具调用。请检查模型服务是否正常，或确认当前模型支持所选接口模式。", "provider_empty_response");
      }
      if (!pendingToolCalls.length) {
        if (input.patchFallback && input.allowedScopes.allowDocumentPatch && !emittedProposal) {
          const proposal = createFallbackProposal(input, generatedText);
          if (proposal) {
            yield { type: "patch-proposal", runId: input.runId, proposal };
          }
        }
        yield { type: "done", runId: input.runId };
        return;
      }

      if (round === maxRounds - 1) {
        exhaustedToolCalls = pendingToolCalls.map((call) => call.toolName);
      }
      messages.push({ role: "assistant", content: "", toolCalls: pendingToolCalls });
      for (const call of pendingToolCalls) {
        let result: Awaited<ReturnType<AiToolRegistry["execute"]>>;
        try {
          result = await registry.execute(call.toolName, call.input, {
            runId: input.runId,
            workspaceId: input.clientContext.workspaceId,
            clientContext: input.clientContext,
            allowedScopes: input.allowedScopes,
            services: this.services,
            signal: input.signal,
            searchResultPaths
          });
        } catch (error) {
          throw new AiProviderError(`AI 工具调用失败：${call.toolName}\n原因：${error instanceof Error ? error.message : String(error)}`, "tool_failed");
        }
        yield {
          type: "tool-result",
          runId: input.runId,
          callId: call.callId,
          toolName: call.toolName,
          resultSummary: result.summary,
          sourceRefs: result.sourceRefs
        };
        for (const source of result.sourceRefs ?? []) {
          yield { type: "source-used", runId: input.runId, source };
        }
        if (result.proposal) {
          emittedProposal = true;
          yield { type: "patch-proposal", runId: input.runId, proposal: result.proposal };
        }
        messages.push({
          role: "tool",
          toolCallId: call.callId,
          toolName: call.toolName,
          content: JSON.stringify(result.result)
        });
      }
    }
    if (exhaustedToolCalls.length && !emittedProposal) {
      throw new AiProviderError(`模型连续调用工具 ${maxRounds} 轮后仍没有生成最终回答。\n最后调用的工具：${[...new Set(exhaustedToolCalls)].join(", ")}\n请减少问题范围，或在 AI 设置中提高多轮工具调用次数后重试。`, "tool_failed");
    }
    if (!generatedText.trim() && !emittedProposal) {
      throw new AiProviderError("模型请求结束，但没有生成最终回答或修改建议。请检查模型服务日志后重试。", "provider_empty_response");
    }
    if (input.patchFallback && input.allowedScopes.allowDocumentPatch && !emittedProposal) {
      const proposal = createFallbackProposal(input, generatedText);
      if (proposal) {
        yield { type: "patch-proposal", runId: input.runId, proposal };
      }
    }
    yield { type: "done", runId: input.runId };
  }
}
