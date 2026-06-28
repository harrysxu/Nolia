import type { AiErrorCode } from "../../../shared/ai";
import { AiProviderError, type AiProvider, type AiProviderChatRequest, type AiProviderEvent, type AiProviderTool, type AiResolvedSettings } from "../types";
import { errorCodeForStatus, joinUrl, parseNdjson, readErrorMessage } from "../providerUtils";

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    details?: {
      family?: string;
      parameter_size?: string;
    };
  }>;
};

type OllamaChatChunk = {
  message?: {
    content?: string;
    tool_calls?: Array<{
      function?: {
        name?: string;
        arguments?: unknown;
      };
    }>;
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
};

export class OllamaProvider implements AiProvider {
  readonly id = "ollama" as const;
  readonly label = "Ollama";
  readonly capabilities = {
    streaming: true,
    nativeToolCalling: true,
    structuredOutput: false,
    localOnly: true,
    modelListing: true,
    usage: "ollama-metrics" as const
  };

  async testConnection(settings: AiResolvedSettings, signal?: AbortSignal) {
    if (!settings.model) {
      return { ok: false, providerId: this.id, localOnly: true, message: "Missing model", errorCode: "missing_model" as AiErrorCode };
    }
    try {
      const response = await fetch(joinUrl(settings.baseUrl, "/api/chat"), {
        method: "POST",
        headers: headers(settings),
        body: JSON.stringify({
          model: settings.model,
          stream: false,
          messages: [{ role: "user", content: "Reply with ok." }]
        }),
        signal
      });
      if (!response.ok) {
        return { ok: false, providerId: this.id, model: settings.model, localOnly: isLocal(settings.baseUrl), message: await readErrorMessage(response), errorCode: errorCodeForStatus(response.status) };
      }
      return { ok: true, providerId: this.id, model: settings.model, localOnly: isLocal(settings.baseUrl), message: "Connected" };
    } catch (error) {
      return { ok: false, providerId: this.id, model: settings.model, localOnly: isLocal(settings.baseUrl), message: error instanceof Error ? error.message : "Ollama unreachable", errorCode: "provider_unreachable" as AiErrorCode };
    }
  }

  async listModels(settings: AiResolvedSettings, signal?: AbortSignal) {
    const response = await fetch(joinUrl(settings.baseUrl, "/api/tags"), { headers: headers(settings), signal });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const payload = (await response.json()) as OllamaTagsResponse;
    return (payload.models ?? [])
      .map((model) => ({
        id: model.name ?? model.model ?? "",
        label: model.name ?? model.model,
        details: [model.details?.family, model.details?.parameter_size].filter(Boolean).join(" ")
      }))
      .filter((model) => model.id);
  }

  async *streamChat(request: AiProviderChatRequest, signal: AbortSignal): AsyncIterable<AiProviderEvent> {
    const response = await fetch(joinUrl(request.settings.baseUrl, "/api/chat"), {
      method: "POST",
      headers: headers(request.settings),
      body: JSON.stringify({
        model: request.settings.model,
        stream: true,
        messages: request.messages.map((message) => ({
          role: message.role === "tool" ? "user" : message.role,
          content: message.role === "tool" ? `Tool ${message.toolName ?? message.toolCallId} result:\n${message.content}` : message.content
        })),
        tools: request.tools.map(ollamaTool)
      }),
      signal
    });
    if (!response.ok) {
      throw new AiProviderError(await readErrorMessage(response), errorCodeForStatus(response.status));
    }
    let toolIndex = 0;
    let sawRecognizedChunk = false;
    let sawUsefulOutput = false;
    for await (const raw of parseNdjson(response)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new AiProviderError("Ollama 返回了无法解析的流式数据，不是 JSON 行。请检查 Ollama 服务或代理配置。", "provider_bad_request");
      }
      const chunk = raw as OllamaChatChunk;
      sawRecognizedChunk = true;
      if (chunk.message?.content) {
        sawUsefulOutput = true;
        yield { type: "text-delta", text: chunk.message.content };
      }
      for (const call of chunk.message?.tool_calls ?? []) {
        const toolName = call.function?.name;
        if (toolName) {
          sawUsefulOutput = true;
          yield { type: "tool-call", callId: `ollama-tool-${toolIndex++}`, toolName, input: call.function?.arguments ?? {} };
        }
      }
      if (chunk.done) {
        yield {
          type: "usage",
          usage: {
            inputTokens: chunk.prompt_eval_count,
            outputTokens: chunk.eval_count,
            totalTokens: typeof chunk.prompt_eval_count === "number" && typeof chunk.eval_count === "number" ? chunk.prompt_eval_count + chunk.eval_count : undefined,
            durationMs: typeof chunk.total_duration === "number" ? Math.round(chunk.total_duration / 1_000_000) : undefined
          }
        };
      }
    }
    if (!sawRecognizedChunk) {
      throw new AiProviderError("Ollama 返回了空的流式响应。请确认 Ollama 正在运行，且模型已拉取并可以生成内容。", "provider_empty_response");
    }
    if (!sawUsefulOutput) {
      throw new AiProviderError("Ollama 已结束响应，但没有返回文本或工具调用。请检查模型是否支持当前请求，或查看 Ollama 日志。", "provider_empty_response");
    }
    yield { type: "done" };
  }
}

function headers(settings: AiResolvedSettings): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiKey) {
    headers.authorization = `Bearer ${settings.apiKey}`;
  }
  return headers;
}

function ollamaTool(tool: AiProviderTool): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  };
}

function isLocal(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

export function providerErrorCode(error: unknown): AiErrorCode {
  return error instanceof AiProviderError ? error.code : "provider_unreachable";
}
