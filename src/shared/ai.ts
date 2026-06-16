import type { EditorMode, OutlineItem, SearchResultItem } from "./types";

export type AiProviderId = "openai-compatible" | "ollama";
export type AiApiMode = "chat-completions" | "responses" | "ollama-native";
export type AiEmbeddingApiMode = "openai-embeddings" | "ollama-native";
export type AiEntryPoint = "chat" | "selection-action" | "command-palette";
export type AiSelectionActionId = "polish" | "summarize" | "translate" | "todo" | "explain";
export type AiRunStatus = "queued" | "running" | "cancelling" | "completed" | "cancelled" | "failed";
export type AiProviderProfileId = string;

export const MAX_CONVERSATION_HISTORY_TURNS = 50;
export const MAX_CONVERSATION_HISTORY_MESSAGES = MAX_CONVERSATION_HISTORY_TURNS * 2;
export const AI_EMBEDDING_SECRET_ID = "embedding:openai-compatible";

export type AiErrorCode =
  | "ai_disabled"
  | "missing_provider"
  | "missing_model"
  | "missing_api_key"
  | "provider_unreachable"
  | "provider_auth_failed"
  | "provider_rate_limited"
  | "provider_bad_request"
  | "provider_empty_response"
  | "tool_permission_denied"
  | "tool_failed"
  | "context_too_large"
  | "run_cancelled"
  | "run_timeout"
  | "patch_conflict"
  | "secret_storage_unavailable"
  | "unknown";

export interface AiSettings {
  enabled: boolean;
  defaultProviderId: AiProviderProfileId;
  providers: AiProviderProfile[];
  embedding: AiEmbeddingSettings;
  conversationHistoryTurns: number;
  agentMaxSteps: number;
  allowCurrentNoteContent: boolean;
  allowWorkspaceSearch: boolean;
  allowReadSearchResults: boolean;
  allowWorkspaceRead: boolean;
  allowWorkspaceOperations: boolean;
}

export interface AiProviderProfile {
  id: AiProviderProfileId;
  name: string;
  providerId: AiProviderId;
  model: string;
  baseUrl: string;
  apiMode: AiApiMode;
  disabled?: boolean;
}

export interface AiProviderProfilePublic extends AiProviderProfile {
  hasApiKey: boolean;
}

export interface AiEmbeddingSettings {
  enabled: boolean;
  providerId: AiProviderId;
  model: string;
  baseUrl: string;
  apiMode: AiEmbeddingApiMode;
}

export interface AiSettingsPublic extends AiSettings {
  providers: AiProviderProfilePublic[];
  activeProvider: AiProviderProfilePublic;
  providerId: AiProviderId;
  model: string;
  baseUrl: string;
  apiMode: AiApiMode;
  hasApiKey: boolean;
  secretStorageAvailable: boolean;
  secretStorageBackend?: string;
  embeddingHasApiKey: boolean;
  requireApprovalForWrites: true;
}

export interface AiSettingsSetRequest {
  settings: Partial<Omit<AiSettings, "embedding">> & {
    embedding?: Partial<AiEmbeddingSettings>;
  };
}

export interface AiSecretSetRequest {
  providerProfileId: AiProviderProfileId;
  apiKey: string;
}

export interface AiSecretClearRequest {
  providerProfileId: AiProviderProfileId;
}

export interface AiSecretGetRequest {
  providerProfileId: AiProviderProfileId;
}

export interface AiSecretGetResponse {
  apiKey?: string;
}

export interface AiProviderTestRequest {
  providerProfileId?: AiProviderProfileId;
  provider?: Partial<AiProviderProfile>;
  apiKey?: string;
}

export interface AiProviderTestResult {
  ok: boolean;
  providerId: AiProviderId;
  model?: string;
  message: string;
  localOnly: boolean;
  errorCode?: AiErrorCode;
}

export interface AiModelsListRequest {
  providerProfileId?: AiProviderProfileId;
  provider?: Partial<AiProviderProfile>;
  apiKey?: string;
}

export interface AiModelDescriptor {
  id: string;
  label?: string;
  details?: string;
}

export interface AiEmbeddingTestRequest {
  settings?: Partial<AiEmbeddingSettings>;
  apiKey?: string;
}

export interface AiSemanticIndexRequest {
  workspaceId: string;
}

export type AiSemanticIndexState = "not_configured" | "not_created" | "ready" | "updating" | "stale" | "failed";

export interface AiSemanticIndexStatus {
  state: AiSemanticIndexState;
  enabled: boolean;
  providerId?: AiProviderId;
  model?: string;
  updatedAt?: number;
  totalFiles: number;
  indexedFiles: number;
  staleFiles: number;
  chunkCount: number;
  progress?: {
    phase: "scanning" | "embedding" | "saving";
    current: number;
    total: number;
    pathRel?: string;
  };
  message?: string;
  error?: string;
}

export interface AiSemanticIndexResult {
  status: AiSemanticIndexStatus;
}

export interface AiTextRange {
  from: number;
  to: number;
}

export interface AiClientContext {
  workspaceId?: string;
  activeDocument?: {
    pathRel: string;
    title: string;
    mode: EditorMode;
    sourceText: string;
    baseHash: string;
    dirty: boolean;
    parsedTitle?: string;
    headings?: Pick<OutlineItem, "text" | "depth" | "line">[];
  };
  selection?: {
    text: string;
    range?: AiTextRange;
    source: "source" | "wysiwyg" | "preview";
  };
  cursor?: {
    offset?: number;
    line?: number;
    column?: number;
  };
}

export interface AiRunStartRequest {
  entryPoint: AiEntryPoint;
  instruction: string;
  actionId?: AiSelectionActionId;
  conversation?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  clientContext: AiClientContext;
  options?: {
    allowTools?: boolean;
    includeCurrentNote?: boolean;
    requireCurrentNote?: boolean;
    includeSelection?: boolean;
    allowWorkspaceSearch?: boolean;
    allowWorkspaceRead?: boolean;
    allowWorkspaceOperations?: boolean;
    patchFallback?: boolean;
    maxToolRounds?: number;
  };
}

export interface AiRunStartResponse {
  runId: string;
  taskId?: string;
}

export interface AiRunCancelRequest {
  runId: string;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  durationMs?: number;
}

export interface AiSourceRef {
  kind: "current-note" | "selection" | "search-result" | "note" | "workspace-file" | "tags";
  pathRel?: string;
  title?: string;
  snippet?: string;
}

export interface AiPatchProposal {
  id: string;
  runId: string;
  taskId?: string;
  approvalId?: string;
  createdAt?: number;
  status?: "pending" | "approved" | "rejected" | "applied";
  workspaceId: string;
  pathRel: string;
  title: string;
  summary: string;
  sourceSnapshotHash: string;
  baseHash: string;
  operations: AiPatchOperation[];
}

export type AiPatchOperation =
  | {
      type: "replaceRange";
      pathRel?: string;
      range: AiTextRange;
      beforeText: string;
      afterText: string;
    }
  | {
      type: "insertAt";
      pathRel?: string;
      offset: number;
      afterText: string;
    }
  | {
      type: "append";
      pathRel?: string;
      afterText: string;
    }
  | {
      type: "replaceDocument";
      pathRel?: string;
      beforeText: string;
      afterText: string;
    }
  | {
      type: "createFile";
      pathRel: string;
      afterText: string;
    };

export type AiRunEvent =
  | { type: "run-started"; runId: string }
  | { type: "task-updated"; runId: string; task: AiTaskSummary }
  | { type: "approval-required"; runId: string; approval: AiToolApproval; proposal: AiPatchProposal }
  | { type: "task-restored"; runId: string; task: AiTaskSummary }
  | { type: "text-delta"; runId: string; text: string }
  | { type: "tool-call"; runId: string; callId: string; toolName: string; inputSummary: string }
  | { type: "tool-result"; runId: string; callId: string; toolName: string; resultSummary: string; sourceRefs?: AiSourceRef[] }
  | { type: "source-used"; runId: string; source: AiSourceRef }
  | { type: "patch-proposal"; runId: string; proposal: AiPatchProposal }
  | { type: "usage"; runId: string; usage: AiUsage }
  | { type: "done"; runId: string }
  | { type: "cancelled"; runId: string }
  | { type: "error"; runId: string; code: AiErrorCode; message: string; retryable: boolean };

export interface AiSearchResultContext {
  query: string;
  items: SearchResultItem[];
}

export type AiTaskStatus = "queued" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled" | "interrupted";

export interface AiTaskSummary {
  id: string;
  runId: string;
  workspaceId?: string;
  title: string;
  status: AiTaskStatus;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
  pendingApprovalId?: string;
}

export interface AiTaskStep {
  id: string;
  index: number;
  kind: "model" | "tool" | "approval" | "write" | "error";
  title: string;
  summary?: string;
  createdAt: number;
}

export interface AiToolApproval {
  id: string;
  taskId: string;
  runId: string;
  toolName: string;
  input: unknown;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  proposalId?: string;
}

export interface AiWriteTransaction {
  id: string;
  taskId: string;
  proposalId: string;
  workspaceId: string;
  createdAt: number;
  operations: Array<{
    pathRel: string;
    beforeSnapshotId?: number;
    beforeHash?: string;
    afterHash?: string;
    createdFile?: boolean;
  }>;
  undoneAt?: number;
}

export interface AiTaskSnapshot extends AiTaskSummary {
  instruction: string;
  steps: AiTaskStep[];
  sources: AiSourceRef[];
  approvals: AiToolApproval[];
  proposals: AiPatchProposal[];
  writes: AiWriteTransaction[];
}

export interface AiTaskStartRequest extends AiRunStartRequest {
  title?: string;
}

export interface AiTaskStartResponse {
  taskId: string;
  runId: string;
}

export interface AiTaskReadRequest {
  taskId: string;
}

export interface AiTaskResumeRequest {
  taskId: string;
}

export interface AiTaskCancelRequest {
  taskId: string;
}

export interface AiTaskApprovalRequest {
  taskId: string;
  approvalId: string;
}

export interface AiTaskRejectRequest extends AiTaskApprovalRequest {
  reason?: string;
}

export interface AiTaskUndoWriteRequest {
  taskId: string;
  transactionId: string;
}

export const DEFAULT_OLLAMA_PROVIDER_PROFILE: AiProviderProfile = {
  id: "ollama-local",
  name: "Local Ollama",
  providerId: "ollama",
  model: "",
  baseUrl: "http://localhost:11434/v1",
  apiMode: "chat-completions",
  disabled: false
};

export const DEFAULT_AI_EMBEDDING_SETTINGS: AiEmbeddingSettings = {
  enabled: false,
  providerId: "ollama",
  model: "",
  baseUrl: "http://localhost:11434",
  apiMode: "ollama-native"
};

export const DEFAULT_OPENAI_COMPATIBLE_PROVIDER_PROFILE: AiProviderProfile = {
  id: "openai-compatible",
  name: "OpenAI-compatible",
  providerId: "openai-compatible",
  model: "",
  baseUrl: "",
  apiMode: "chat-completions",
  disabled: false
};

export function createAiProviderProfile(providerId: AiProviderId, usedIds: Iterable<string> = []): AiProviderProfile {
  const used = new Set(usedIds);
  const base = providerId === "ollama" ? DEFAULT_OLLAMA_PROVIDER_PROFILE : DEFAULT_OPENAI_COMPATIBLE_PROVIDER_PROFILE;
  const prefix = providerId === "ollama" ? "ollama" : "openai";
  let index = 1;
  let id = base.id;
  while (used.has(id)) {
    index += 1;
    id = `${prefix}-${index}`;
  }
  return {
    ...base,
    id,
    name: index === 1 ? base.name : `${base.name} ${index}`
  };
}

export function normalizeAiProviderProfile(value: unknown, fallback?: AiProviderProfile): AiProviderProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const raw = value as Partial<AiProviderProfile>;
  const providerId = raw.providerId === "openai-compatible" || raw.providerId === "ollama" ? raw.providerId : fallback?.providerId ?? "ollama";
  const base = fallback ?? createAiProviderProfile(providerId);
  const apiMode: AiApiMode = providerId === "ollama" ? (raw.apiMode === "ollama-native" ? "ollama-native" : "chat-completions") : raw.apiMode === "responses" ? "responses" : "chat-completions";
  const defaultBaseUrl = providerId === "ollama" ? (apiMode === "ollama-native" ? "http://localhost:11434" : "http://localhost:11434/v1") : "";
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? safeProviderProfileId(raw.id.trim()) : base.id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : base.name,
    providerId,
    model: typeof raw.model === "string" ? raw.model : base.model,
    baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim() ? raw.baseUrl.trim() : defaultBaseUrl,
    apiMode,
    disabled: typeof raw.disabled === "boolean" ? raw.disabled : Boolean(base.disabled)
  };
}

export function normalizeAiSettings(value: unknown): AiSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<AiSettings> & Partial<LegacyAiSettings>) : {};
  const legacyProviderId = raw.providerId === "openai-compatible" || raw.providerId === "ollama" ? raw.providerId : undefined;
  const legacyProfile = legacyProviderId
    ? normalizeAiProviderProfile({
        id: legacyProviderId === "ollama" ? DEFAULT_OLLAMA_PROVIDER_PROFILE.id : DEFAULT_OPENAI_COMPATIBLE_PROVIDER_PROFILE.id,
        name: legacyProviderId === "ollama" ? DEFAULT_OLLAMA_PROVIDER_PROFILE.name : DEFAULT_OPENAI_COMPATIBLE_PROVIDER_PROFILE.name,
        providerId: legacyProviderId,
        model: raw.model,
        baseUrl: raw.baseUrl,
        apiMode: raw.apiMode
      })
    : undefined;
  const normalizedProviders = Array.isArray(raw.providers)
    ? raw.providers.flatMap((item) => {
        const profile = normalizeAiProviderProfile(item);
        return profile ? [profile] : [];
      })
    : [];
  const providers = dedupeAiProviderProfiles(normalizedProviders.length ? normalizedProviders : [legacyProfile ?? DEFAULT_OLLAMA_PROVIDER_PROFILE]);
  const defaultProviderId =
    typeof raw.defaultProviderId === "string" && providers.some((provider) => provider.id === raw.defaultProviderId)
      ? raw.defaultProviderId
      : legacyProfile?.id && providers.some((provider) => provider.id === legacyProfile.id)
        ? legacyProfile.id
        : providers[0].id;
  return {
    enabled: Boolean(raw.enabled),
    defaultProviderId,
    providers,
    embedding: normalizeAiEmbeddingSettings(raw.embedding, DEFAULT_AI_EMBEDDING_SETTINGS),
    conversationHistoryTurns: normalizeConversationHistoryTurns(raw.conversationHistoryTurns),
    agentMaxSteps: normalizeAgentMaxSteps(raw.agentMaxSteps),
    allowCurrentNoteContent: Boolean(raw.allowCurrentNoteContent),
    allowWorkspaceSearch: Boolean(raw.allowWorkspaceSearch),
    allowReadSearchResults: Boolean(raw.allowWorkspaceSearch && raw.allowReadSearchResults),
    allowWorkspaceRead: Boolean(raw.allowWorkspaceRead),
    allowWorkspaceOperations: Boolean(raw.allowWorkspaceRead && raw.allowWorkspaceOperations)
  };
}

export function normalizeAiEmbeddingSettings(value: unknown, fallback: AiEmbeddingSettings = DEFAULT_AI_EMBEDDING_SETTINGS): AiEmbeddingSettings {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<AiEmbeddingSettings>) : {};
  const providerId: AiProviderId = raw.providerId === "openai-compatible" || raw.providerId === "ollama" ? raw.providerId : fallback.providerId;
  const apiMode: AiEmbeddingApiMode = providerId === "ollama" ? "ollama-native" : "openai-embeddings";
  const defaultBaseUrl = providerId === "ollama" ? "http://localhost:11434" : "";
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    providerId,
    model: typeof raw.model === "string" ? raw.model.trim() : fallback.model,
    baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim() ? raw.baseUrl.trim() : fallback.providerId === providerId && fallback.baseUrl ? fallback.baseUrl : defaultBaseUrl,
    apiMode
  };
}

function normalizeAgentMaxSteps(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 12;
  }
  return Math.max(1, Math.min(30, Math.trunc(value)));
}

function normalizeConversationHistoryTurns(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }
  return Math.max(0, Math.min(MAX_CONVERSATION_HISTORY_TURNS, Math.trunc(value)));
}

export function activeAiProvider(settings: AiSettings): AiProviderProfile {
  return (
    settings.providers.find((provider) => provider.id === settings.defaultProviderId && !provider.disabled) ??
    settings.providers.find((provider) => !provider.disabled) ??
    settings.providers.find((provider) => provider.id === settings.defaultProviderId) ??
    settings.providers[0] ??
    DEFAULT_OLLAMA_PROVIDER_PROFILE
  );
}

export function normalizeAiSettingsPublic(value: unknown): AiSettingsPublic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Partial<AiSettingsPublic>;
  const ai = normalizeAiSettings(raw);
  const rawProviders = Array.isArray(raw.providers) ? raw.providers : [];
  const hasApiKeyByProviderId = new Map<string, boolean>();
  for (const provider of rawProviders) {
    if (provider && typeof provider === "object" && typeof provider.id === "string") {
      hasApiKeyByProviderId.set(safeProviderProfileId(provider.id), Boolean((provider as Partial<AiProviderProfilePublic>).hasApiKey));
    }
  }
  const providers = ai.providers.map((provider) => ({
    ...provider,
    hasApiKey: hasApiKeyByProviderId.get(provider.id) ?? false
  }));
  const rawActiveProviderId = typeof raw.activeProvider?.id === "string" ? safeProviderProfileId(raw.activeProvider.id) : undefined;
  const activeProvider =
    (rawActiveProviderId ? providers.find((provider) => provider.id === rawActiveProviderId && !provider.disabled) : undefined) ??
    providers.find((provider) => provider.id === activeAiProvider(ai).id) ??
    providers.find((provider) => provider.id === ai.defaultProviderId) ??
    providers[0] ??
    { ...DEFAULT_OLLAMA_PROVIDER_PROFILE, hasApiKey: false };
  return {
    ...ai,
    providers,
    activeProvider,
    providerId: activeProvider.providerId,
    model: activeProvider.model,
    baseUrl: activeProvider.baseUrl,
    apiMode: activeProvider.apiMode,
    hasApiKey: activeProvider.hasApiKey,
    secretStorageAvailable: Boolean(raw.secretStorageAvailable),
    secretStorageBackend: typeof raw.secretStorageBackend === "string" && raw.secretStorageBackend.trim() ? raw.secretStorageBackend : undefined,
    embeddingHasApiKey: Boolean(raw.embeddingHasApiKey),
    requireApprovalForWrites: true
  };
}

interface LegacyAiSettings {
  providerId: AiProviderId;
  model: string;
  baseUrl: string;
  apiMode: AiApiMode;
  agentMaxSteps?: number;
}

function dedupeAiProviderProfiles(providers: AiProviderProfile[]): AiProviderProfile[] {
  const used = new Set<string>();
  return providers.map((provider) => {
    let id = safeProviderProfileId(provider.id);
    let index = 2;
    while (used.has(id)) {
      id = `${safeProviderProfileId(provider.id)}-${index}`;
      index += 1;
    }
    used.add(id);
    return { ...provider, id };
  });
}

function safeProviderProfileId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "provider";
}
