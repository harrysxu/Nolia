import type {
  AiEmbeddingSettings,
  AiProviderProfile,
  AiProviderProfilePublic,
  AiSecretClearRequest,
  AiSecretGetRequest,
  AiSecretGetResponse,
  AiSecretSetRequest,
  AiSettings,
  AiSettingsPublic,
  AiSettingsSetRequest
} from "../../shared/ai";
import { AI_EMBEDDING_SECRET_ID, activeAiProvider, normalizeAiEmbeddingSettings, normalizeAiProviderProfile, normalizeAiSettings } from "../../shared/ai";
import { SettingsService } from "../services/settingsService";
import { AiSecretService } from "./security/secretService";

export class AiSettingsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly secrets: AiSecretService
  ) {}

  publicSettings(): AiSettingsPublic {
    const ai = normalizeAiSettings(this.settings.getSettings().ai);
    const providers = ai.providers.map((provider) => this.publicProvider(provider));
    const activeProvider =
      providers.find((provider) => provider.id === activeAiProvider(ai).id) ??
      providers.find((provider) => provider.id === ai.defaultProviderId) ??
      providers[0] ??
      this.publicProvider(activeAiProvider(ai));
    return {
      ...ai,
      providers,
      activeProvider,
      providerId: activeProvider.providerId,
      model: activeProvider.model,
      baseUrl: activeProvider.baseUrl,
      apiMode: activeProvider.apiMode,
      hasApiKey: activeProvider.hasApiKey,
      secretStorageAvailable: this.secrets.isAvailable(),
      secretStorageBackend: this.secrets.backend(),
      embeddingHasApiKey: this.secrets.has(AI_EMBEDDING_SECRET_ID),
      requireApprovalForWrites: true
    };
  }

  resolvedSettings(overrides?: Partial<AiProviderProfile> & { providerProfileId?: string; apiKey?: string }): AiSettings & AiProviderProfile & { apiKey?: string } {
    const ai = normalizeAiSettings(this.settings.getSettings().ai);
    const baseProvider = overrides?.providerProfileId
      ? ai.providers.find((provider) => provider.id === overrides.providerProfileId) ?? activeAiProvider(ai)
      : activeAiProvider(ai);
    const provider = normalizeAiProviderProfile({ ...baseProvider, ...(overrides ?? {}) }, baseProvider) ?? baseProvider;
    const apiKey = overrides?.apiKey?.trim() || this.secrets.get(provider.id) || this.secrets.get(provider.providerId);
    return {
      ...ai,
      ...provider,
      apiKey
    };
  }

  resolvedEmbeddingSettings(overrides?: Partial<AiEmbeddingSettings> & { apiKey?: string }): AiEmbeddingSettings & { apiKey?: string } {
    const ai = normalizeAiSettings(this.settings.getSettings().ai);
    const embedding = normalizeAiEmbeddingSettings({ ...ai.embedding, ...(overrides ?? {}) });
    const apiKey = overrides?.apiKey?.trim() || this.secrets.get(AI_EMBEDDING_SECRET_ID);
    return {
      ...embedding,
      apiKey
    };
  }

  async setSettings(request: AiSettingsSetRequest): Promise<AiSettingsPublic> {
    const current = normalizeAiSettings(this.settings.getSettings().ai);
    const next = normalizeAiSettings({
      ...current,
      ...request.settings,
      embedding: {
        ...current.embedding,
        ...(request.settings.embedding ?? {})
      }
    });
    await this.settings.setSetting("ai", next);
    return this.publicSettings();
  }

  async setSecret(request: AiSecretSetRequest): Promise<AiSettingsPublic> {
    const settings = normalizeAiSettings(this.settings.getSettings().ai);
    if (request.providerProfileId === AI_EMBEDDING_SECRET_ID) {
      if (!this.secrets.isAvailable()) {
        throw new Error("Secret storage is not available");
      }
      if (request.apiKey.trim()) {
        await this.secrets.set(AI_EMBEDDING_SECRET_ID, request.apiKey.trim());
      }
      return this.publicSettings();
    }
    const provider = settings.providers.find((item) => item.id === request.providerProfileId);
    if (!provider) {
      throw new Error("AI provider profile not found");
    }
    if (provider.providerId !== "ollama" && !this.secrets.isAvailable()) {
      throw new Error("Secret storage is not available");
    }
    if (request.apiKey.trim()) {
      await this.secrets.set(provider.id, request.apiKey.trim());
    }
    return this.publicSettings();
  }

  async clearSecret(request: AiSecretClearRequest): Promise<AiSettingsPublic> {
    const settings = normalizeAiSettings(this.settings.getSettings().ai);
    const provider = settings.providers.find((item) => item.id === request.providerProfileId);
    await this.secrets.clear(request.providerProfileId);
    if (provider && provider.providerId !== request.providerProfileId) {
      await this.secrets.clear(provider.providerId);
    }
    return this.publicSettings();
  }

  getSecret(request: AiSecretGetRequest): AiSecretGetResponse {
    const settings = normalizeAiSettings(this.settings.getSettings().ai);
    const provider = settings.providers.find((item) => item.id === request.providerProfileId);
    return { apiKey: this.secrets.get(request.providerProfileId) || (provider ? this.secrets.get(provider.providerId) : undefined) };
  }

  private publicProvider(provider: AiProviderProfile): AiProviderProfilePublic {
    return {
      ...provider,
      hasApiKey: this.secrets.has(provider.id) || this.secrets.has(provider.providerId)
    };
  }
}

export { AI_EMBEDDING_SECRET_ID, normalizeAiEmbeddingSettings, normalizeAiSettings };
