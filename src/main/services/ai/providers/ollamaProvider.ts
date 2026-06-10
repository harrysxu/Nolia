import type { AiGeneratedResult, AiModel } from "../../../../shared/ai";
import { providerBaseUrl, requireOk, type AiProviderAdapter, type AiProviderEmbedRequest, type AiProviderEmbedResponse, type AiProviderGenerateRequest } from "./types";

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  response?: string;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  embedding?: number[];
}

export class OllamaProvider implements AiProviderAdapter {
  readonly type = "ollama" as const;

  async test(request: AiProviderGenerateRequest): Promise<{ ok: boolean; message?: string }> {
    const models = await this.listModels(request);
    return { ok: true, message: models.length ? `Found ${models.length} local model(s).` : "Ollama is reachable." };
  }

  async listModels(request: AiProviderGenerateRequest): Promise<AiModel[]> {
    const baseUrl = providerBaseUrl(request.provider, "http://127.0.0.1:11434");
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    const body = await response.json() as OllamaTagsResponse;
    return (body.models ?? [])
      .map((model) => model.name ?? model.model)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id, providerId: request.provider.id }));
  }

  async generate(request: AiProviderGenerateRequest): Promise<AiGeneratedResult> {
    const baseUrl = providerBaseUrl(request.provider, "http://127.0.0.1:11434");
    const model = request.model ?? request.provider.defaultModel;
    if (!model) {
      throw new Error("Missing model");
    }
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        stream: false,
        options: {
          ...(request.provider.temperature !== undefined ? { temperature: request.provider.temperature } : {}),
          ...(request.provider.maxTokens !== undefined ? { num_predict: request.provider.maxTokens } : {})
        },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: buildUserMessage(request) }
        ]
      }),
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    const body = await response.json() as OllamaChatResponse;
    return {
      requestId: request.requestId,
      text: body.message?.content ?? body.response ?? "",
      citations: request.citations
    };
  }

  async embed(request: AiProviderEmbedRequest): Promise<AiProviderEmbedResponse> {
    const baseUrl = providerBaseUrl(request.provider, "http://127.0.0.1:11434");
    const model = request.model ?? request.provider.defaultModel;
    if (!model) {
      throw new Error("Missing embedding model");
    }
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: request.texts
      }),
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    const body = await response.json() as OllamaEmbedResponse;
    const embeddings = body.embeddings ?? (body.embedding ? [body.embedding] : []);
    if (embeddings.length !== request.texts.length) {
      throw new Error(`Ollama returned ${embeddings.length} embedding(s) for ${request.texts.length} text(s)`);
    }
    return { embeddings, model };
  }
}

function buildUserMessage(request: AiProviderGenerateRequest): string {
  return [
    request.contextText.trim() ? `上下文：\n${request.contextText.trim()}` : "",
    request.userPrompt.trim() ? `用户请求：\n${request.userPrompt.trim()}` : "用户请求：请基于上下文给出帮助。"
  ].filter(Boolean).join("\n\n");
}
