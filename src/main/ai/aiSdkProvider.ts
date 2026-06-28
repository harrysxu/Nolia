import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

import type { AiResolvedSettings } from "./types";

export function createAiSdkLanguageModel(settings: AiResolvedSettings): LanguageModel | undefined {
  if (settings.providerId === "ollama" && settings.apiMode === "ollama-native") {
    return undefined;
  }
  if (settings.providerId === "openai-compatible" && isDefaultOpenAiBaseUrl(settings.baseUrl)) {
    const openai = createOpenAI({
      apiKey: settings.apiKey,
      baseURL: normalizedBaseUrl(settings.baseUrl) || undefined
    });
    return settings.apiMode === "responses" ? openai.responses(settings.model) : openai.chat(settings.model);
  }
  const compatibleOptions = {
    name: settings.providerId === "ollama" ? "ollama" : settings.name || "openai-compatible",
    baseURL: normalizedOpenAiCompatibleBaseUrl(settings),
    apiKey: settings.apiKey,
    includeUsage: true,
    ...(settings.providerId === "ollama" ? { transformRequestBody: (body: Record<string, unknown>) => ({ ...body, think: false }) } : {})
  };
  const compatible = createOpenAICompatible(compatibleOptions);
  return compatible.chatModel(settings.model);
}

export function normalizedOpenAiCompatibleBaseUrl(settings: Pick<AiResolvedSettings, "providerId" | "apiMode" | "baseUrl">): string {
  const baseUrl = normalizedBaseUrl(settings.baseUrl);
  if (settings.apiMode !== "chat-completions") {
    return baseUrl;
  }
  if (settings.providerId === "ollama") {
    return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  }
  return /\/v\d+(?:\/)?$/u.test(baseUrl) ? baseUrl : `${baseUrl}/v1`;
}

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function isDefaultOpenAiBaseUrl(baseUrl: string): boolean {
  const normalized = normalizedBaseUrl(baseUrl);
  return !normalized || normalized === "https://api.openai.com" || normalized === "https://api.openai.com/v1";
}
