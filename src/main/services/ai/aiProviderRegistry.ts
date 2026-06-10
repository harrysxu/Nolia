import type {
  AiGeneratedResult,
  AiModel,
  AiProviderConfig,
  AiProviderTestResponse
} from "../../../shared/ai";
import { MockAiProvider } from "./providers/mockProvider";
import { OllamaProvider } from "./providers/ollamaProvider";
import { OpenAiCompatibleProvider, OpenAiProvider } from "./providers/openAiCompatibleProvider";
import { AnthropicProvider } from "./providers/anthropicProvider";
import { GeminiProvider } from "./providers/geminiProvider";
import type { AiProviderAdapter, AiProviderEmbedRequest, AiProviderEmbedResponse, AiProviderGenerateOptions, AiProviderGenerateRequest } from "./providers/types";

export class AiProviderRegistry {
  private readonly adapters = new Map<AiProviderConfig["type"], AiProviderAdapter>();

  constructor() {
    this.register(new MockAiProvider());
    this.register(new OpenAiCompatibleProvider());
    this.register(new OpenAiProvider());
    this.register(new OllamaProvider());
    this.register(new AnthropicProvider());
    this.register(new GeminiProvider());
  }

  async test(request: AiProviderGenerateRequest): Promise<AiProviderTestResponse> {
    return this.adapterFor(request.provider).test(request);
  }

  async listModels(request: AiProviderGenerateRequest): Promise<AiModel[]> {
    return this.adapterFor(request.provider).listModels(request);
  }

  async generate(request: AiProviderGenerateRequest, options?: AiProviderGenerateOptions): Promise<AiGeneratedResult> {
    return this.adapterFor(request.provider).generate(request, options);
  }

  async embed(request: AiProviderEmbedRequest): Promise<AiProviderEmbedResponse> {
    const adapter = this.adapterFor(request.provider);
    if (!adapter.embed) {
      throw new Error(`AI provider does not support embeddings: ${request.provider.id}`);
    }
    return adapter.embed(request);
  }

  supportsEmbedding(provider: AiProviderConfig): boolean {
    return Boolean(this.adapterFor(provider).embed);
  }

  private register(adapter: AiProviderAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  private adapterFor(provider: AiProviderConfig): AiProviderAdapter {
    const adapter = this.adapters.get(provider.type);
    if (!adapter) {
      throw new Error(`Unsupported AI provider type: ${provider.type}`);
    }
    return adapter;
  }
}
