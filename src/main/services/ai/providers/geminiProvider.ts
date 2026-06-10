import type { AiGeneratedResult, AiModel } from "../../../../shared/ai";
import { providerBaseUrl, requireOk, type AiProviderAdapter, type AiProviderGenerateRequest } from "./types";

interface GeminiModelsResponse {
  models?: Array<{
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

export class GeminiProvider implements AiProviderAdapter {
  readonly type = "gemini" as const;

  async test(request: AiProviderGenerateRequest): Promise<{ ok: boolean; message?: string }> {
    const models = await this.listModels(request);
    return { ok: true, message: models.length ? `Found ${models.length} Gemini model(s).` : "Gemini is reachable." };
  }

  async listModels(request: AiProviderGenerateRequest): Promise<AiModel[]> {
    const baseUrl = providerBaseUrl(request.provider, "https://generativelanguage.googleapis.com/v1beta");
    const response = await fetch(withApiKey(`${baseUrl}/models`, request.apiKey), {
      method: "GET",
      headers: geminiHeaders(request.apiKey),
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    const body = await response.json() as GeminiModelsResponse;
    return (body.models ?? []).reduce<AiModel[]>((models, model) => {
      if (!(model.supportedGenerationMethods ?? []).includes("generateContent")) {
        return models;
      }
      const id = model.name?.replace(/^models\//, "");
      if (id) {
        models.push({ id, label: model.displayName, providerId: request.provider.id });
      }
      return models;
    }, []);
  }

  async generate(request: AiProviderGenerateRequest): Promise<AiGeneratedResult> {
    const baseUrl = providerBaseUrl(request.provider, "https://generativelanguage.googleapis.com/v1beta");
    const model = request.model ?? request.provider.defaultModel;
    if (!model) {
      throw new Error("Missing model");
    }
    const response = await fetch(withApiKey(`${baseUrl}/${geminiModelPath(model)}:generateContent`, request.apiKey), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...geminiHeaders(request.apiKey)
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: request.systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildUserMessage(request) }]
          }
        ],
        generationConfig: {
          maxOutputTokens: request.provider.maxTokens ?? 4096,
          ...(request.provider.temperature !== undefined ? { temperature: request.provider.temperature } : {})
        }
      }),
      signal: request.signal
    });
    requireOk(response, request.provider.id);
    const body = await response.json() as GeminiGenerateResponse;
    return {
      requestId: request.requestId,
      text: body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "",
      citations: request.citations
    };
  }
}

function geminiHeaders(apiKey?: string): Record<string, string> {
  if (!apiKey) {
    throw new Error("Missing Gemini API key");
  }
  return { "x-goog-api-key": apiKey };
}

function withApiKey(url: string, apiKey?: string): string {
  if (!apiKey) {
    throw new Error("Missing Gemini API key");
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}key=${encodeURIComponent(apiKey)}`;
}

function geminiModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function buildUserMessage(request: AiProviderGenerateRequest): string {
  return [
    request.contextText.trim() ? `上下文：\n${request.contextText.trim()}` : "",
    request.userPrompt.trim() ? `用户请求：\n${request.userPrompt.trim()}` : "用户请求：请基于上下文给出帮助。"
  ].filter(Boolean).join("\n\n");
}
