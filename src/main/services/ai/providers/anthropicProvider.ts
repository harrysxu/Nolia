import type { AiGeneratedResult, AiModel } from "../../../../shared/ai";
import { providerBaseUrl, requireOk, type AiProviderAdapter, type AiProviderGenerateRequest } from "./types";

interface AnthropicModelsResponse {
  data?: Array<{ id?: string; display_name?: string }>;
}

interface AnthropicMessageResponse {
  content?: Array<{ type?: string; text?: string }>;
}

export class AnthropicProvider implements AiProviderAdapter {
  readonly type = "anthropic" as const;

  async test(request: AiProviderGenerateRequest): Promise<{ ok: boolean; message?: string }> {
    const models = await this.listModels(request);
    return { ok: true, message: models.length ? `Found ${models.length} Claude model(s).` : "Anthropic is reachable." };
  }

  async listModels(request: AiProviderGenerateRequest): Promise<AiModel[]> {
    const baseUrl = providerBaseUrl(request.provider, "https://api.anthropic.com/v1");
    const response = await fetch(`${baseUrl}/models`, {
      method: "GET",
      headers: anthropicHeaders(request.apiKey),
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    const body = await response.json() as AnthropicModelsResponse;
    return (body.data ?? []).reduce<AiModel[]>((models, model) => {
      if (model.id) {
        models.push({ id: model.id, label: model.display_name, providerId: request.provider.id });
      }
      return models;
    }, []);
  }

  async generate(request: AiProviderGenerateRequest): Promise<AiGeneratedResult> {
    const baseUrl = providerBaseUrl(request.provider, "https://api.anthropic.com/v1");
    const model = request.model ?? request.provider.defaultModel;
    if (!model) {
      throw new Error("Missing model");
    }
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...anthropicHeaders(request.apiKey)
      },
      body: JSON.stringify({
        model,
        max_tokens: request.provider.maxTokens ?? 4096,
        ...(request.provider.temperature !== undefined ? { temperature: request.provider.temperature } : {}),
        system: request.systemPrompt,
        messages: [
          { role: "user", content: buildUserMessage(request) }
        ]
      }),
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    const body = await response.json() as AnthropicMessageResponse;
    return {
      requestId: request.requestId,
      text: (body.content ?? []).filter((part) => part.type === "text" || part.text).map((part) => part.text ?? "").join(""),
      citations: request.citations
    };
  }
}

function anthropicHeaders(apiKey?: string): Record<string, string> {
  if (!apiKey) {
    throw new Error("Missing Anthropic API key");
  }
  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
}

function buildUserMessage(request: AiProviderGenerateRequest): string {
  return [
    request.contextText.trim() ? `上下文：\n${request.contextText.trim()}` : "",
    request.userPrompt.trim() ? `用户请求：\n${request.userPrompt.trim()}` : "用户请求：请基于上下文给出帮助。"
  ].filter(Boolean).join("\n\n");
}
