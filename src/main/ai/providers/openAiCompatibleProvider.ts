import type { AiErrorCode } from "../../../shared/ai";
import { AiProviderError, type AiChatMessage, type AiProvider, type AiProviderChatRequest, type AiProviderEvent, type AiProviderTool, type AiResolvedSettings } from "../types";
import { errorCodeForStatus, joinUrl, parseJsonSafely, parseSse, readErrorMessage } from "../providerUtils";

type ChatCompletionChunk = {
  error?: {
    message?: string;
  } | string;
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        id?: string;
        index?: number;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type ResponsesChunk = {
  error?: {
    message?: string;
  } | string;
  type?: string;
  delta?: string;
  response?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
  };
  item?: {
    type?: string;
    id?: string;
    name?: string;
    arguments?: string;
  };
};

type ModelsResponse = {
  data?: Array<{
    id?: string;
    owned_by?: string;
  }>;
};

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = "openai-compatible" as const;
  readonly label = "OpenAI-compatible";
  readonly capabilities = {
    streaming: true,
    nativeToolCalling: true,
    structuredOutput: true,
    localOnly: false,
    modelListing: true,
    usage: "tokens" as const
  };

  async testConnection(settings: AiResolvedSettings, signal?: AbortSignal) {
    const localOnly = isLocalProvider(settings);
    const providerId = settings.providerId;
    if (!settings.apiKey && !localOnly) {
      return { ok: false, providerId, model: settings.model, localOnly, message: "Missing API key", errorCode: "missing_api_key" as AiErrorCode };
    }
    if (!settings.model) {
      return { ok: false, providerId, localOnly, message: "Missing model", errorCode: "missing_model" as AiErrorCode };
    }
    try {
      const response = await fetch(joinUrl(settings.baseUrl, settings.apiMode === "responses" ? "/v1/responses" : "/v1/chat/completions"), {
        method: "POST",
        headers: headers(settings),
        body: JSON.stringify(settings.apiMode === "responses" ? responsesBody(settings, [{ role: "user", content: "Reply with ok." }], []) : chatBody(settings, [{ role: "user", content: "Reply with ok." }], [])),
        signal
      });
      if (!response.ok) {
        return { ok: false, providerId, model: settings.model, localOnly, message: await readErrorMessage(response), errorCode: errorCodeForStatus(response.status) };
      }
      return { ok: true, providerId, model: settings.model, localOnly, message: "Connected" };
    } catch (error) {
      return { ok: false, providerId, model: settings.model, localOnly, message: error instanceof Error ? error.message : "Provider unreachable", errorCode: "provider_unreachable" as AiErrorCode };
    }
  }

  async listModels(settings: AiResolvedSettings, signal?: AbortSignal) {
    if (!settings.apiKey && !isLocalProvider(settings)) {
      throw new Error("Missing API key");
    }
    const response = await fetch(joinUrl(settings.baseUrl, "/v1/models"), {
      headers: headers(settings),
      signal
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const payload = (await response.json()) as ModelsResponse;
    return (payload.data ?? [])
      .map((model) => ({
        id: model.id ?? "",
        label: model.id,
        details: model.owned_by
      }))
      .filter((model) => model.id);
  }

  async *streamChat(request: AiProviderChatRequest, signal: AbortSignal): AsyncIterable<AiProviderEvent> {
    const endpoint = request.settings.apiMode === "responses" ? "/v1/responses" : "/v1/chat/completions";
    const response = await fetch(joinUrl(request.settings.baseUrl, endpoint), {
      method: "POST",
      headers: headers(request.settings),
      body: JSON.stringify(
        request.settings.apiMode === "responses"
          ? responsesBody(request.settings, request.messages, request.tools, true)
          : chatBody(request.settings, request.messages, request.tools, true)
      ),
      signal
    });
    if (!response.ok) {
      throw new AiProviderError(await readErrorMessage(response), errorCodeForStatus(response.status));
    }
    if (request.settings.apiMode === "responses") {
      yield* parseResponsesStream(response);
      return;
    }
    yield* parseChatCompletionStream(response);
  }
}

function headers(settings: AiResolvedSettings): Record<string, string> {
  const result: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiKey) {
    result.authorization = `Bearer ${settings.apiKey}`;
  } else if (settings.providerId !== "ollama") {
    result.authorization = "";
  }
  return result;
}

function isLocalProvider(settings: AiResolvedSettings): boolean {
  if (settings.providerId === "ollama") {
    return true;
  }
  try {
    const url = new URL(settings.baseUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function chatBody(settings: AiResolvedSettings, messages: AiChatMessage[], tools: AiProviderTool[], stream = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: settings.model,
    messages: messages.map((message) => {
      if (message.role === "assistant" && message.toolCalls?.length) {
        return {
          role: "assistant",
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({
            id: call.callId,
            type: "function",
            function: {
              name: call.toolName,
              arguments: stringifyToolInput(call.input)
            }
          }))
        };
      }
      if (message.role === "tool") {
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content
        };
      }
      return { role: message.role, content: message.content };
    }),
    stream
  };
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
  return body;
}

function stringifyToolInput(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "{}";
  }
}

function responsesBody(settings: AiResolvedSettings, messages: AiChatMessage[], tools: AiProviderTool[], stream = false): Record<string, unknown> {
  const system = messages.find((message) => message.role === "system")?.content;
  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "tool" ? "user" : message.role,
      content: message.role === "tool" ? `Tool ${message.toolName ?? message.toolCallId} result:\n${message.content}` : message.content
    }));
  const body: Record<string, unknown> = {
    model: settings.model,
    input,
    stream
  };
  if (system) {
    body.instructions = system;
  }
  if (tools.length) {
    body.tools = tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
  }
  return body;
}

async function* parseChatCompletionStream(response: Response): AsyncIterable<AiProviderEvent> {
  const toolCalls = new Map<number, { callId: string; toolName: string; args: string }>();
  let sawRecognizedChunk = false;
  let sawText = false;
  for await (const raw of parseSse(response)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AiProviderError("模型服务返回了无法解析的流式数据，不是 OpenAI Chat Completions JSON chunk。请检查接口模式是否选对。", "provider_bad_request");
    }
    const chunk = raw as ChatCompletionChunk;
    const streamError = streamErrorMessage(chunk.error);
    if (streamError) {
      throw new AiProviderError(streamError, "provider_bad_request");
    }
    sawRecognizedChunk = true;
    const delta = chunk.choices?.[0]?.delta;
    if (delta?.content) {
      sawText = true;
      yield { type: "text-delta", text: delta.content };
    }
    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0;
      const current = toolCalls.get(index) ?? { callId: call.id ?? `tool-${index}`, toolName: "", args: "" };
      toolCalls.set(index, {
        callId: call.id ?? current.callId,
        toolName: call.function?.name ?? current.toolName,
        args: `${current.args}${call.function?.arguments ?? ""}`
      });
    }
    if (chunk.usage) {
      yield {
        type: "usage",
        usage: {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens
        }
      };
    }
  }
  if (!sawRecognizedChunk) {
    throw new AiProviderError("模型服务返回了空的 OpenAI Chat Completions 流式响应。请检查模型是否存在、Base URL 是否正确，或关闭不兼容的代理流式转发。", "provider_empty_response");
  }
  const completeToolCalls = [...toolCalls.values()].filter((call) => call.toolName);
  if (!sawText && !completeToolCalls.length) {
    throw new AiProviderError("模型服务已结束响应，但没有返回文本、工具调用或用量信息。请检查模型服务日志，确认该模型支持当前请求格式。", "provider_empty_response");
  }
  for (const call of completeToolCalls) {
    yield { type: "tool-call", callId: call.callId, toolName: call.toolName, input: parseJsonSafely(call.args || "{}") };
  }
  yield { type: "done" };
}

async function* parseResponsesStream(response: Response): AsyncIterable<AiProviderEvent> {
  const toolArgs = new Map<string, { toolName: string; args: string }>();
  let sawRecognizedChunk = false;
  let sawText = false;
  for await (const raw of parseSse(response)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AiProviderError("模型服务返回了无法解析的流式数据，不是 OpenAI Responses JSON event。请检查接口模式是否选对。", "provider_bad_request");
    }
    const chunk = raw as ResponsesChunk;
    const streamError = streamErrorMessage(chunk.error);
    if (streamError) {
      throw new AiProviderError(streamError, "provider_bad_request");
    }
    sawRecognizedChunk = true;
    if (chunk.type === "response.output_text.delta" && chunk.delta) {
      sawText = true;
      yield { type: "text-delta", text: chunk.delta };
    }
    if (chunk.type === "response.output_item.added" && chunk.item?.type === "function_call" && chunk.item.id && chunk.item.name) {
      toolArgs.set(chunk.item.id, { toolName: chunk.item.name, args: "" });
    }
    if (chunk.type === "response.function_call_arguments.delta" && chunk.item?.id && typeof chunk.delta === "string") {
      const current = toolArgs.get(chunk.item.id);
      if (current) {
        toolArgs.set(chunk.item.id, { ...current, args: `${current.args}${chunk.delta}` });
      }
    }
    if (chunk.response?.usage) {
      yield {
        type: "usage",
        usage: {
          inputTokens: chunk.response.usage.input_tokens,
          outputTokens: chunk.response.usage.output_tokens,
          totalTokens: chunk.response.usage.total_tokens
        }
      };
    }
  }
  if (!sawRecognizedChunk) {
    throw new AiProviderError("模型服务返回了空的 OpenAI Responses 流式响应。请检查模型是否存在、Base URL 是否正确，或切换到 Chat Completions 模式。", "provider_empty_response");
  }
  if (!sawText && !toolArgs.size) {
    throw new AiProviderError("模型服务已结束响应，但没有返回文本、工具调用或用量信息。请检查模型服务日志，确认该模型支持 Responses 流式格式。", "provider_empty_response");
  }
  for (const [callId, call] of toolArgs) {
    yield { type: "tool-call", callId, toolName: call.toolName, input: parseJsonSafely(call.args || "{}") };
  }
  yield { type: "done" };
}

export function providerErrorCode(error: unknown): AiErrorCode {
  return error instanceof AiProviderError ? error.code : "provider_unreachable";
}

function streamErrorMessage(error: ChatCompletionChunk["error"]): string | undefined {
  if (typeof error === "string") {
    return error;
  }
  return error?.message;
}
