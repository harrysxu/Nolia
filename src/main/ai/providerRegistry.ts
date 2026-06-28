import type { AiProvider, AiResolvedSettings } from "./types";
import { OllamaProvider } from "./providers/ollamaProvider";
import { OpenAiCompatibleProvider } from "./providers/openAiCompatibleProvider";

export class AiProviderRegistry {
  private readonly providers = new Map<string, AiProvider>();
  private readonly openAiCompatibleProvider = new OpenAiCompatibleProvider();

  constructor() {
    [this.openAiCompatibleProvider, new OllamaProvider()].forEach((provider) => {
      this.providers.set(provider.id, provider);
    });
  }

  get(settings: AiResolvedSettings): AiProvider {
    if (settings.providerId === "ollama" && settings.apiMode !== "ollama-native") {
      return this.openAiCompatibleProvider;
    }
    const provider = this.providers.get(settings.providerId);
    if (!provider) {
      throw new Error(`Unsupported AI provider: ${settings.providerId}`);
    }
    return provider;
  }
}
