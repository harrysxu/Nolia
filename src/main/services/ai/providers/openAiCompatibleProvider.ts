import type { AiGeneratedResult, AiModel } from "../../../../shared/ai";
import { providerBaseUrl, requestHeaders, requireOk, type AiProviderAdapter, type AiProviderEmbedRequest, type AiProviderEmbedResponse, type AiProviderGenerateOptions, type AiProviderGenerateRequest } from "./types";

interface OpenAiModelListResponse {
  data?: Array<{ id?: string }>;
}

interface OpenAiChatResponse {
  choices?: Array<{
    delta?: {
      content?: OpenAiContent;
    };
    message?: {
      content?: OpenAiContent;
    };
    text?: string;
  }>;
}

type OpenAiContent = string | Array<{ type?: string; text?: string }> | undefined;

interface OpenAiEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  model?: string;
}

export class OpenAiCompatibleProvider implements AiProviderAdapter {
  readonly type = "openai-compatible" as const;

  async test(request: AiProviderGenerateRequest): Promise<{ ok: boolean; message?: string }> {
    const models = await this.listModels(request);
    return { ok: true, message: models.length ? `Found ${models.length} model(s).` : "Provider is reachable." };
  }

  async listModels(request: AiProviderGenerateRequest): Promise<AiModel[]> {
    const baseUrl = providerBaseUrl(request.provider, defaultBaseUrl(request.provider.type));
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: {
        ...requestHeaders(request.apiKey)
      },
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    const body = await response.json() as OpenAiModelListResponse;
    return (body.data ?? [])
      .map((model) => model.id)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id, providerId: request.provider.id }));
  }

  async generate(request: AiProviderGenerateRequest, options?: AiProviderGenerateOptions): Promise<AiGeneratedResult> {
    const baseUrl = providerBaseUrl(request.provider, defaultBaseUrl(request.provider.type));
    const model = request.model ?? request.provider.defaultModel;
    if (!model) {
      throw new Error("Missing model");
    }
    const stream = Boolean(options?.onDelta);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...requestHeaders(request.apiKey)
      },
      body: JSON.stringify({
        model,
        stream,
        ...(request.provider.temperature !== undefined ? { temperature: request.provider.temperature } : {}),
        ...(request.provider.maxTokens !== undefined ? { max_tokens: request.provider.maxTokens } : {}),
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: buildUserMessage(request) }
        ]
      }),
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    if (stream && options?.onDelta) {
      const text = await readOpenAiStream(response, options.onDelta, request.signal);
      return {
        requestId: request.requestId,
        text,
        citations: request.citations,
        streamed: true
      };
    }
    const body = await response.json() as OpenAiChatResponse;
    const content = body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? "";
    return {
      requestId: request.requestId,
      text: normalizeOpenAiContent(content),
      citations: request.citations
    };
  }

  async embed(request: AiProviderEmbedRequest): Promise<AiProviderEmbedResponse> {
    const baseUrl = providerBaseUrl(request.provider, defaultBaseUrl(request.provider.type));
    const model = request.model ?? request.provider.defaultModel;
    if (!model) {
      throw new Error("Missing embedding model");
    }
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...requestHeaders(request.apiKey)
      },
      body: JSON.stringify({
        model,
        input: request.texts
      }),
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    const body = await response.json() as OpenAiEmbeddingResponse;
    const embeddings = (body.data ?? [])
      .map((item) => item.embedding)
      .filter((embedding): embedding is number[] => Array.isArray(embedding));
    if (embeddings.length !== request.texts.length) {
      throw new Error(`Provider ${request.provider.id} returned ${embeddings.length} embedding(s) for ${request.texts.length} text(s)`);
    }
    return { embeddings, model: body.model ?? model };
  }
}

export class OpenAiProvider implements AiProviderAdapter {
  readonly type = "openai" as const;
  private readonly compatible = new OpenAiCompatibleProvider();

  test(request: AiProviderGenerateRequest): Promise<{ ok: boolean; message?: string }> {
    return this.compatible.test(request);
  }

  listModels(request: AiProviderGenerateRequest): Promise<AiModel[]> {
    return this.compatible.listModels(request);
  }

  generate(request: AiProviderGenerateRequest, options?: AiProviderGenerateOptions): Promise<AiGeneratedResult> {
    return this.compatible.generate(request, options);
  }

  embed(request: AiProviderEmbedRequest): Promise<AiProviderEmbedResponse> {
    return this.compatible.embed(request);
  }
}

function defaultBaseUrl(type: string): string {
  return type === "openai" ? "https://api.openai.com/v1" : "https://api.openai.com/v1";
}

function buildUserMessage(request: AiProviderGenerateRequest): string {
  const context = request.contextText.trim();
  const prompt = request.userPrompt.trim();
  return [
    context ? `上下文：\n${context}` : "",
    prompt ? `用户请求：\n${prompt}` : "用户请求：请基于上下文给出帮助。"
  ].filter(Boolean).join("\n\n");
}

function normalizeOpenAiContent(content: OpenAiContent | string): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((item) => item.text ?? "").join("");
  }
  return "";
}

async function readOpenAiStream(response: Response, onDelta: (text: string) => void | Promise<void>, signal?: AbortSignal): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  while (true) {
    if (signal?.aborted) {
      throw new DOMException("AI request cancelled", "AbortError");
    }
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const delta = parseOpenAiStreamPart(part);
      if (!delta) {
        continue;
      }
      fullText += delta;
      await onDelta(delta);
    }
  }
  const tail = decoder.decode();
  if (tail) {
    buffer += tail;
  }
  const delta = parseOpenAiStreamPart(buffer);
  if (delta) {
    fullText += delta;
    await onDelta(delta);
  }
  return fullText;
}

function parseOpenAiStreamPart(part: string): string {
  return part
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .filter((line) => line && line !== "[DONE]")
    .map((line) => {
      try {
        const body = JSON.parse(line) as OpenAiChatResponse;
        const content = body.choices?.[0]?.delta?.content ?? body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? "";
        return normalizeOpenAiContent(content);
      } catch {
        return "";
      }
    })
    .join("");
}
