import type {
  AiCitation,
  AiGeneratedResult,
  AiModel,
  AiProviderConfig,
  AiProviderTestResponse
} from "../../../../shared/ai";

export interface AiProviderGenerateRequest {
  requestId: string;
  provider: AiProviderConfig;
  model?: string;
  apiKey?: string;
  systemPrompt: string;
  userPrompt: string;
  contextText: string;
  citations: AiCitation[];
  signal?: AbortSignal;
}

export interface AiProviderGenerateOptions {
  onDelta?: (text: string) => void | Promise<void>;
}

export interface AiProviderEmbedRequest {
  requestId: string;
  provider: AiProviderConfig;
  model?: string;
  apiKey?: string;
  texts: string[];
  signal?: AbortSignal;
}

export interface AiProviderEmbedResponse {
  embeddings: number[][];
  model?: string;
}

export interface AiProviderAdapter {
  type: AiProviderConfig["type"];
  test: (request: AiProviderGenerateRequest) => Promise<AiProviderTestResponse>;
  listModels: (request: AiProviderGenerateRequest) => Promise<AiModel[]>;
  generate: (request: AiProviderGenerateRequest, options?: AiProviderGenerateOptions) => Promise<AiGeneratedResult>;
  embed?: (request: AiProviderEmbedRequest) => Promise<AiProviderEmbedResponse>;
}

export function providerBaseUrl(provider: AiProviderConfig, fallback: string): string {
  return (provider.baseUrl ?? fallback).replace(/\/+$/, "");
}

export function requestHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

export function requireOk(response: Response, providerId: string): void {
  if (response.ok) {
    return;
  }
  const error = new Error(`Provider ${providerId} responded with ${response.status}`);
  Object.assign(error, { statusCode: response.status });
  throw error;
}
