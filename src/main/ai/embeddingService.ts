import { embedMany, type EmbeddingModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { AiEmbeddingSettings, AiProviderTestResult } from "../../shared/ai";
import { AiProviderError } from "./types";
import { errorCodeForStatus, joinUrl, readErrorMessage } from "./providerUtils";

export type ResolvedAiEmbeddingSettings = AiEmbeddingSettings & { apiKey?: string };

type OllamaEmbedResponse = {
  embeddings?: number[][];
  embedding?: number[];
  error?: string;
};

export class AiEmbeddingService {
  async test(settings: ResolvedAiEmbeddingSettings, signal?: AbortSignal): Promise<AiProviderTestResult> {
    if (!settings.enabled) {
      return { ok: false, providerId: settings.providerId, model: settings.model, localOnly: settings.providerId === "ollama", message: "Embedding is disabled", errorCode: "missing_model" };
    }
    if (!settings.model.trim()) {
      return { ok: false, providerId: settings.providerId, localOnly: settings.providerId === "ollama", message: "Missing embedding model", errorCode: "missing_model" };
    }
    if (settings.providerId === "openai-compatible" && !settings.apiKey && !isLocalProvider(settings.baseUrl)) {
      return { ok: false, providerId: settings.providerId, model: settings.model, localOnly: false, message: "Missing API key", errorCode: "missing_api_key" };
    }
    try {
      const vector = await this.embedOne(settings, "Nolia embedding connectivity test.", signal);
      if (!vector.length) {
        return { ok: false, providerId: settings.providerId, model: settings.model, localOnly: settings.providerId === "ollama", message: "Embedding model returned an empty vector", errorCode: "provider_empty_response" };
      }
      return { ok: true, providerId: settings.providerId, model: settings.model, localOnly: settings.providerId === "ollama", message: `Embedding connected (${vector.length} dimensions)` };
    } catch (error) {
      return {
        ok: false,
        providerId: settings.providerId,
        model: settings.model,
        localOnly: settings.providerId === "ollama",
        message: error instanceof Error ? error.message : "Embedding provider unreachable",
        errorCode: error instanceof AiProviderError ? error.code : "provider_unreachable"
      };
    }
  }

  async embedOne(settings: ResolvedAiEmbeddingSettings, value: string, signal?: AbortSignal): Promise<number[]> {
    const [embedding] = await this.embedMany(settings, [value], signal);
    return embedding ?? [];
  }

  async embedMany(settings: ResolvedAiEmbeddingSettings, values: string[], signal?: AbortSignal): Promise<number[][]> {
    const cleanValues = values.map((value) => value.trim()).filter(Boolean);
    if (!settings.model.trim()) {
      throw new AiProviderError("Embedding 模型尚未配置。请先在 AI 设置中选择 embedding 模型。", "missing_model");
    }
    if (!cleanValues.length) {
      return [];
    }
    if (settings.providerId === "ollama") {
      return this.embedWithOllama(settings, cleanValues, signal);
    }
    if (!settings.apiKey && !isLocalProvider(settings.baseUrl)) {
      throw new AiProviderError("Embedding Provider 缺少 API key。请在语义索引设置中填写并保存 API key。", "missing_api_key");
    }
    try {
      const result = await embedMany({
        model: createEmbeddingModel(settings),
        values: cleanValues,
        maxRetries: 0,
        abortSignal: signal
      });
      return result.embeddings;
    } catch (error) {
      throw normalizeEmbeddingError(error);
    }
  }

  private async embedWithOllama(settings: ResolvedAiEmbeddingSettings, values: string[], signal?: AbortSignal): Promise<number[][]> {
    try {
      const response = await fetch(joinUrl(settings.baseUrl, "/api/embed"), {
        method: "POST",
        headers: headers(settings),
        body: JSON.stringify({ model: settings.model, input: values }),
        signal
      });
      if (!response.ok) {
        throw new AiProviderError(await readErrorMessage(response), errorCodeForStatus(response.status));
      }
      const payload = (await response.json()) as OllamaEmbedResponse;
      if (payload.error) {
        throw new AiProviderError(payload.error, "provider_bad_request");
      }
      if (Array.isArray(payload.embeddings) && payload.embeddings.every(isEmbeddingVector)) {
        return payload.embeddings;
      }
      if (Array.isArray(payload.embedding) && isEmbeddingVector(payload.embedding) && values.length === 1) {
        return [payload.embedding];
      }
      throw new AiProviderError("Ollama embedding 接口没有返回有效向量。请确认模型支持 embedding，或换用专用 embedding 模型。", "provider_empty_response");
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      return this.embedWithOllamaLegacy(settings, values, signal);
    }
  }

  private async embedWithOllamaLegacy(settings: ResolvedAiEmbeddingSettings, values: string[], signal?: AbortSignal): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (const value of values) {
      const response = await fetch(joinUrl(settings.baseUrl, "/api/embeddings"), {
        method: "POST",
        headers: headers(settings),
        body: JSON.stringify({ model: settings.model, prompt: value }),
        signal
      });
      if (!response.ok) {
        throw new AiProviderError(await readErrorMessage(response), errorCodeForStatus(response.status));
      }
      const payload = (await response.json()) as OllamaEmbedResponse;
      if (payload.error) {
        throw new AiProviderError(payload.error, "provider_bad_request");
      }
      if (!isEmbeddingVector(payload.embedding)) {
        throw new AiProviderError("Ollama embedding 接口没有返回有效向量。请确认模型支持 embedding，或换用专用 embedding 模型。", "provider_empty_response");
      }
      embeddings.push(payload.embedding);
    }
    return embeddings;
  }
}

function createEmbeddingModel(settings: ResolvedAiEmbeddingSettings): EmbeddingModel {
  const normalizedBaseUrl = settings.baseUrl.replace(/\/+$/, "");
  if (!normalizedBaseUrl || normalizedBaseUrl === "https://api.openai.com" || normalizedBaseUrl === "https://api.openai.com/v1") {
    const openai = createOpenAI({
      apiKey: settings.apiKey,
      baseURL: normalizedBaseUrl || undefined
    });
    return openai.embeddingModel(settings.model);
  }
  const compatible = createOpenAICompatible({
    name: "openai-compatible-embedding",
    baseURL: normalizedBaseUrl,
    apiKey: settings.apiKey
  });
  return compatible.embeddingModel(settings.model);
}

function headers(settings: ResolvedAiEmbeddingSettings): Record<string, string> {
  const result: Record<string, string> = { "content-type": "application/json" };
  if (settings.apiKey) {
    result.authorization = `Bearer ${settings.apiKey}`;
  }
  return result;
}

function isEmbeddingVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isLocalProvider(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function normalizeEmbeddingError(error: unknown): AiProviderError {
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
  if (/fetch|network|ECONN|ENOTFOUND|Failed to fetch/i.test(message)) {
    return new AiProviderError(message, "provider_unreachable");
  }
  return new AiProviderError(message || "Embedding provider failed", "provider_bad_request");
}
