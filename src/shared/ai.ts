import { z } from "zod";

export type AiProviderType =
  | "mock"
  | "openai-compatible"
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "plugin";

export type AiContextScope = "selection" | "document" | "folder" | "workspace";
export type AiContextItemKind =
  | "selection"
  | "current-document"
  | "workspace-search-result"
  | "backlink"
  | "attachment"
  | "web"
  | "insight";
export type AiApplyMode = "answer" | "copy" | "insert" | "replace" | "append" | "new-document" | "diff";
export type AiChangeAction = "create" | "modify" | "rename" | "delete";
export type AiChangeStatus = "pending" | "accepted" | "rejected" | "applying" | "applied" | "conflict" | "error";
export type AiInsightKind = "similar" | "duplicate" | "tag" | "backlink" | "topic";
export type AiExtractorKind = "text" | "pdf" | "image" | "audio";

export interface AiProviderConfig {
  id: string;
  type: AiProviderType;
  label: string;
  baseUrl?: string;
  apiKeyRef?: string;
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;
  enabled: boolean;
  pluginId?: string;
}

export interface AiSettings {
  enabled: boolean;
  defaultProviderId?: string;
  defaultModel?: string;
  providers: Record<string, AiProviderConfig>;
  commands: Record<string, AiCommandDefinition>;
  privacy: {
    allowCurrentDocumentContext: boolean;
    allowWorkspaceContext: boolean;
    allowAttachmentContext: boolean;
    allowNetworkSearch: boolean;
    allowCloudAttachmentProcessing: boolean;
    maxContextChars: number;
    saveLocalConversationHistory: boolean;
    rememberContextApproval: boolean;
  };
  index: {
    enabled: boolean;
    embeddingProviderId?: string;
    embeddingModel?: string;
    includeTextResources: boolean;
    includeAttachments: boolean;
    excludeGlobs: string[];
    excludeExtensions: string[];
    excludeTags: string[];
  };
  extractors: {
    imageProviderId?: string;
    audioProviderId?: string;
    enablePluginExtractors: boolean;
  };
}

export interface AiModel {
  id: string;
  label?: string;
  providerId: string;
}

export interface AiCredentialSummary {
  keyRef: string;
  providerId: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiEditorSnapshot {
  workspaceId?: string;
  pathRel?: string;
  title?: string;
  sourceText?: string;
  selectionText?: string;
  scope: AiContextScope;
  dirty?: boolean;
}

export interface AiContextItemPreview {
  id: string;
  kind: AiContextItemKind;
  label: string;
  pathRel?: string;
  title?: string;
  startLine?: number;
  endLine?: number;
  excerpt: string;
  charCount: number;
}

export interface AiContextPreviewResponse {
  previewId: string;
  providerId?: string;
  model?: string;
  estimatedInputChars: number;
  items: AiContextItemPreview[];
  warnings: string[];
  expiresAt: number;
}

export interface AiIndexError {
  pathRel?: string;
  message: string;
  at: number;
}

export interface AiCitation {
  contextItemId: string;
  pathRel?: string;
  title?: string;
  line?: number;
  excerpt?: string;
}

export interface AiGeneratedResult {
  requestId: string;
  text: string;
  citations: AiCitation[];
  streamed?: boolean;
}

export interface AiUserFacingError {
  code:
    | "not_configured"
    | "invalid_api_key"
    | "model_not_found"
    | "rate_limited"
    | "quota_exceeded"
    | "network_error"
    | "timeout"
    | "cancelled"
    | "provider_error"
    | "context_too_large"
    | "unsafe_payload";
  message: string;
  retryable: boolean;
  providerId?: string;
  statusCode?: number;
}

export type AiChatStreamEvent =
  | { requestId: string; type: "started"; providerId: string; model?: string }
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "citation"; citation: AiCitation }
  | { requestId: string; type: "result"; result: AiGeneratedResult }
  | { requestId: string; type: "error"; error: AiUserFacingError }
  | { requestId: string; type: "cancelled" }
  | { requestId: string; type: "done" };

export interface AiCommandDefinition {
  id: string;
  source: "builtin" | "user" | "workspace" | "plugin";
  pluginId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  order: number;
  scopes: AiContextScope[];
  promptTemplate: string;
  defaultContext: {
    includeSelection?: boolean;
    includeCurrentDocument?: boolean;
    includeWorkspaceResults?: boolean;
    includeBacklinks?: boolean;
    includeAttachments?: boolean;
  };
  defaultApplyMode: AiApplyMode;
  ui: {
    commandPalette: boolean;
    editorToolbar: boolean;
    contextMenu: boolean;
    aiPanel: boolean;
  };
}

export interface AiIndexStatus {
  status: "disabled" | "idle" | "indexing" | "paused" | "ready" | "error";
  progress: number;
  message?: string;
  chunkCount?: number;
  embeddingChunkCount?: number;
  embeddingProfileHash?: string;
  updatedAt?: number;
  paused?: boolean;
  errors?: AiIndexError[];
}

export interface AiChatStartResponse {
  requestId: string;
}

export interface AiProviderTestResponse {
  ok: boolean;
  message?: string;
}

export interface AiModelsListResponse {
  models: AiModel[];
}

export interface AiWebSearchResult {
  id: string;
  title: string;
  url: string;
  excerpt: string;
}

export interface AiWebSearchResponse {
  results: AiWebSearchResult[];
  providerId: string;
}

export interface AiAttachmentExtractResponse {
  pathRel: string;
  kind: "text" | "pdf" | "image" | "audio" | "unsupported";
  title: string;
  text: string;
  warnings: string[];
  providerId?: string;
  pluginId?: string;
  cloudProcessed?: boolean;
}

export interface AiChangePlanOperation {
  id: string;
  action: AiChangeAction;
  pathRel: string;
  targetPathRel?: string;
  title?: string;
  content?: string;
  before?: string;
  after?: string;
  diff?: string;
  baseHash?: string;
  status: AiChangeStatus;
  message?: string;
}

export interface AiChangePlanPrepareResponse {
  planId: string;
  sourceText: string;
  summary?: string;
  operations: AiChangePlanOperation[];
  warnings: string[];
  error?: string;
}

export interface AiChangePlanApplyRequest {
  workspaceId: string;
  plan: AiChangePlanPrepareResponse;
  acceptedOperationIds?: string[];
}

export interface AiChangePlanApplyResponse {
  planId: string;
  operations: AiChangePlanOperation[];
  appliedCount: number;
  conflictCount: number;
  errorCount: number;
}

export interface AiInsightItem {
  id: string;
  kind: AiInsightKind;
  label: string;
  pathRel?: string;
  target?: string;
  score: number;
  excerpt: string;
}

export interface AiInsightsRequest {
  workspaceId: string;
  pathRel?: string;
  sourceText?: string;
  kinds?: AiInsightKind[];
  limit?: number;
}

export interface AiInsightsResponse {
  items: AiInsightItem[];
  warnings: string[];
}

export interface AiPluginProviderRequest {
  providerId: string;
  pluginId: string;
  model?: string;
  prompt: string;
  contextText: string;
}

export interface AiPluginProviderResponse {
  text: string;
}

export interface AiPluginExtractorRequest {
  providerId: string;
  pluginId: string;
  workspaceId: string;
  pathRel: string;
  kind: AiExtractorKind;
}

export interface AiPluginExtractorResponse {
  text: string;
  warnings?: string[];
}

export interface AiPluginProviderBridgeRequest {
  requestId: string;
  providerId: string;
  pluginId: string;
  model?: string;
  prompt: string;
  contextText: string;
}

export interface AiPluginProviderBridgeResponse {
  requestId: string;
  text?: string;
  error?: string;
}

export interface AiPluginExtractorBridgeRequest {
  requestId: string;
  providerId: string;
  pluginId: string;
  workspaceId: string;
  pathRel: string;
  kind: AiExtractorKind;
}

export interface AiPluginExtractorBridgeResponse {
  requestId: string;
  text?: string;
  warnings?: string[];
  error?: string;
}

const DEFAULT_AI_EXTRACTORS_SETTINGS: AiSettings["extractors"] = {
  enablePluginExtractors: true
};

export const AiProviderConfigSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["mock", "openai-compatible", "ollama", "openai", "anthropic", "gemini", "plugin"]),
    label: z.string().min(1),
    baseUrl: z.string().optional(),
    apiKeyRef: z.string().optional(),
    defaultModel: z.string().optional(),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().max(200_000).optional(),
    enabled: z.boolean(),
    pluginId: z.string().optional()
  })
  .strict();

export const AiCommandDefinitionSchema = z
  .object({
    id: z.string().min(1),
    source: z.enum(["builtin", "user", "workspace", "plugin"]),
    pluginId: z.string().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    enabled: z.boolean(),
    order: z.number(),
    scopes: z.array(z.enum(["selection", "document", "folder", "workspace"])),
    promptTemplate: z.string(),
    defaultContext: z
      .object({
        includeSelection: z.boolean().optional(),
        includeCurrentDocument: z.boolean().optional(),
        includeWorkspaceResults: z.boolean().optional(),
        includeBacklinks: z.boolean().optional(),
        includeAttachments: z.boolean().optional()
      })
      .strict(),
    defaultApplyMode: z.enum(["answer", "copy", "insert", "replace", "append", "new-document", "diff"]),
    ui: z
      .object({
        commandPalette: z.boolean(),
        editorToolbar: z.boolean(),
        contextMenu: z.boolean(),
        aiPanel: z.boolean()
      })
      .strict()
  })
  .strict();

export const AiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    defaultProviderId: z.string().optional(),
    defaultModel: z.string().optional(),
    providers: z.record(z.string(), AiProviderConfigSchema),
    commands: z.record(z.string(), AiCommandDefinitionSchema),
    privacy: z
      .object({
        allowCurrentDocumentContext: z.boolean(),
        allowWorkspaceContext: z.boolean(),
        allowAttachmentContext: z.boolean(),
        allowNetworkSearch: z.boolean(),
        allowCloudAttachmentProcessing: z.boolean().default(false),
        maxContextChars: z.number().int().min(1_000).max(200_000),
        saveLocalConversationHistory: z.boolean(),
        rememberContextApproval: z.boolean()
      })
      .strict(),
    index: z
      .object({
        enabled: z.boolean(),
        embeddingProviderId: z.string().optional(),
        embeddingModel: z.string().optional(),
        includeTextResources: z.boolean(),
        includeAttachments: z.boolean(),
        excludeGlobs: z.array(z.string()),
        excludeExtensions: z.array(z.string()),
        excludeTags: z.array(z.string())
      })
      .strict(),
    extractors: z
      .object({
        imageProviderId: z.string().optional(),
        audioProviderId: z.string().optional(),
        enablePluginExtractors: z.boolean()
      })
      .strict()
      .default(DEFAULT_AI_EXTRACTORS_SETTINGS)
  })
  .strict();

export const AiSettingsSetRequestSchema = z.object({ settings: AiSettingsSchema }).strict();

export const AiCredentialListRequestSchema = z.object({}).strict();
export const AiCredentialSetRequestSchema = z
  .object({
    providerId: z.string().min(1),
    label: z.string().optional(),
    value: z.string().min(1)
  })
  .strict();

export const AiCredentialDeleteRequestSchema = z.object({ keyRef: z.string().min(1) }).strict();

export const AiProviderTestRequestSchema = z
  .object({
    providerId: z.string().optional(),
    provider: AiProviderConfigSchema.optional(),
    apiKey: z.string().optional()
  })
  .strict();

export const AiModelsListRequestSchema = z
  .object({
    providerId: z.string().optional(),
    provider: AiProviderConfigSchema.optional(),
    apiKey: z.string().optional()
  })
  .strict();

export const AiEditorSnapshotSchema = z
  .object({
    workspaceId: z.string().optional(),
    pathRel: z.string().optional(),
    title: z.string().optional(),
    sourceText: z.string().optional(),
    selectionText: z.string().optional(),
    scope: z.enum(["selection", "document", "folder", "workspace"]),
    dirty: z.boolean().optional()
  })
  .strict();

export const AiContextPreviewRequestSchema = z
  .object({
    workspaceId: z.string().optional(),
    prompt: z.string().default(""),
    scope: z.enum(["selection", "document", "folder", "workspace"]).default("document"),
    providerId: z.string().optional(),
    model: z.string().optional(),
    editor: AiEditorSnapshotSchema.optional(),
    includeSelection: z.boolean().optional(),
    includeCurrentDocument: z.boolean().optional(),
    includeBacklinks: z.boolean().optional(),
    includeAttachments: z.boolean().optional(),
    includeWebSearch: z.boolean().optional()
  })
  .strict();

export const AiChatStartRequestSchema = z
  .object({
    previewId: z.string().optional(),
    workspaceId: z.string().optional(),
    prompt: z.string().default(""),
    scope: z.enum(["selection", "document", "folder", "workspace"]).default("document"),
    providerId: z.string().optional(),
    model: z.string().optional(),
    editor: AiEditorSnapshotSchema.optional(),
    includeSelection: z.boolean().optional(),
    includeCurrentDocument: z.boolean().optional(),
    includeBacklinks: z.boolean().optional(),
    includeAttachments: z.boolean().optional(),
    includeWebSearch: z.boolean().optional(),
    excludedContextItemIds: z.array(z.string()).optional()
  })
  .strict();

export const AiChatCancelRequestSchema = z.object({ requestId: z.string().min(1) }).strict();

export const AiCommandsListRequestSchema = z.object({ workspaceId: z.string().optional() }).strict();
export const AiCommandRunRequestSchema = AiChatStartRequestSchema.extend({ commandId: z.string().min(1) }).strict();
export const AiIndexStatusRequestSchema = z.object({ workspaceId: z.string().optional() }).strict();
export const AiIndexRebuildRequestSchema = z.object({ workspaceId: z.string().min(1) }).strict();
export const AiIndexClearRequestSchema = z.object({ workspaceId: z.string().min(1) }).strict();
export const AiIndexCancelRequestSchema = z.object({ workspaceId: z.string().min(1) }).strict();
export const AiWebSearchRequestSchema = z
  .object({
    workspaceId: z.string().optional(),
    query: z.string().min(1),
    limit: z.number().int().positive().max(10).optional()
  })
  .strict();
export const AiAttachmentExtractRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    pathRel: z.string().min(1)
  })
  .strict();
export const AiChangePlanOperationSchema = z
  .object({
    id: z.string().min(1),
    action: z.enum(["create", "modify", "rename", "delete"]),
    pathRel: z.string().min(1),
    targetPathRel: z.string().optional(),
    title: z.string().optional(),
    content: z.string().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
    diff: z.string().optional(),
    baseHash: z.string().optional(),
    status: z.enum(["pending", "accepted", "rejected", "applying", "applied", "conflict", "error"]),
    message: z.string().optional()
  })
  .strict();
export const AiChangePlanPrepareRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    sourceText: z.string()
  })
  .strict();
export const AiChangePlanPrepareResponseSchema = z
  .object({
    planId: z.string().min(1),
    sourceText: z.string(),
    summary: z.string().optional(),
    operations: z.array(AiChangePlanOperationSchema),
    warnings: z.array(z.string()),
    error: z.string().optional()
  })
  .strict();
export const AiChangePlanApplyRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    plan: AiChangePlanPrepareResponseSchema,
    acceptedOperationIds: z.array(z.string()).optional()
  })
  .strict();
export const AiInsightsRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    pathRel: z.string().optional(),
    sourceText: z.string().optional(),
    kinds: z.array(z.enum(["similar", "duplicate", "tag", "backlink", "topic"])).optional(),
    limit: z.number().int().positive().max(20).optional()
  })
  .strict();
export const AiPluginExtractorBridgeResponseSchema = z
  .object({
    requestId: z.string().min(1),
    text: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional()
  })
  .strict();

export type AiSettingsSetRequest = z.infer<typeof AiSettingsSetRequestSchema>;
export type AiCredentialListRequest = z.infer<typeof AiCredentialListRequestSchema>;
export type AiCredentialSetRequest = z.infer<typeof AiCredentialSetRequestSchema>;
export type AiCredentialDeleteRequest = z.infer<typeof AiCredentialDeleteRequestSchema>;
export type AiProviderTestRequest = z.infer<typeof AiProviderTestRequestSchema>;
export type AiModelsListRequest = z.infer<typeof AiModelsListRequestSchema>;
export type AiContextPreviewRequest = z.infer<typeof AiContextPreviewRequestSchema>;
export type AiChatStartRequest = z.infer<typeof AiChatStartRequestSchema>;
export type AiChatCancelRequest = z.infer<typeof AiChatCancelRequestSchema>;
export type AiCommandsListRequest = z.infer<typeof AiCommandsListRequestSchema>;
export type AiCommandRunRequest = z.infer<typeof AiCommandRunRequestSchema>;
export type AiIndexStatusRequest = z.infer<typeof AiIndexStatusRequestSchema>;
export type AiIndexRebuildRequest = z.infer<typeof AiIndexRebuildRequestSchema>;
export type AiIndexClearRequest = z.infer<typeof AiIndexClearRequestSchema>;
export type AiIndexCancelRequest = z.infer<typeof AiIndexCancelRequestSchema>;
export type AiWebSearchRequest = z.infer<typeof AiWebSearchRequestSchema>;
export type AiAttachmentExtractRequest = z.infer<typeof AiAttachmentExtractRequestSchema>;
export type AiChangePlanPrepareRequest = z.infer<typeof AiChangePlanPrepareRequestSchema>;
export type AiChangePlanApplyParsedRequest = z.infer<typeof AiChangePlanApplyRequestSchema>;
export type AiInsightsParsedRequest = z.infer<typeof AiInsightsRequestSchema>;
export type AiPluginExtractorBridgeValidatedResponse = z.infer<typeof AiPluginExtractorBridgeResponseSchema>;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  providers: {
    mock: {
      id: "mock",
      type: "mock",
      label: "Mock AI",
      defaultModel: "mock-fast",
      enabled: true
    },
    ollama: {
      id: "ollama",
      type: "ollama",
      label: "Ollama",
      baseUrl: "http://127.0.0.1:11434",
      defaultModel: "llama3.2",
      enabled: true
    },
    openai: {
      id: "openai",
      type: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4.1-mini",
      enabled: false
    },
    anthropic: {
      id: "anthropic",
      type: "anthropic",
      label: "Anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      defaultModel: "claude-sonnet-4-5",
      enabled: false
    },
    gemini: {
      id: "gemini",
      type: "gemini",
      label: "Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      defaultModel: "gemini-2.5-flash",
      enabled: false
    }
  },
  defaultProviderId: "mock",
  defaultModel: "mock-fast",
  commands: {},
  privacy: {
    allowCurrentDocumentContext: true,
    allowWorkspaceContext: false,
    allowAttachmentContext: false,
    allowNetworkSearch: false,
    allowCloudAttachmentProcessing: false,
    maxContextChars: 40_000,
    saveLocalConversationHistory: false,
    rememberContextApproval: false
  },
  index: {
    enabled: false,
    includeTextResources: true,
    includeAttachments: false,
    excludeGlobs: [
      ".git/**",
      "node_modules/**",
      "dist/**",
      "release/**",
      "release-arch-compare/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
      "output/**"
    ],
    excludeExtensions: [],
    excludeTags: []
  },
  extractors: DEFAULT_AI_EXTRACTORS_SETTINGS
};

export const BUILTIN_AI_COMMANDS: AiCommandDefinition[] = [
  {
    id: "ai.summarize.selection",
    source: "builtin",
    name: "总结选区",
    description: "把选中文本总结为简洁要点。",
    enabled: true,
    order: 10,
    scopes: ["selection", "document"],
    promptTemplate: "请总结以下内容，输出 3-5 条要点。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "answer",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.polish.selection",
    source: "builtin",
    name: "润色选区",
    description: "保持原意，提升表达清晰度。",
    enabled: true,
    order: 20,
    scopes: ["selection", "document"],
    promptTemplate: "请润色以下内容，保持 Markdown 格式和原意。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.rewrite.clear",
    source: "builtin",
    name: "改写得更清晰",
    description: "重写选区，让表达更直接、更易读。",
    enabled: true,
    order: 25,
    scopes: ["selection", "document"],
    promptTemplate: "请改写选中内容，使表达更清晰、结构更自然；不要改变事实含义，保留 Markdown 结构。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.shorten.selection",
    source: "builtin",
    name: "缩写选区",
    description: "压缩文字，保留关键信息。",
    enabled: true,
    order: 30,
    scopes: ["selection", "document"],
    promptTemplate: "请将选中内容压缩到原文的 50% 左右，保留关键事实、结论和行动项。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.expand.selection",
    source: "builtin",
    name: "扩写选区",
    description: "在不改变结论的前提下补充细节。",
    enabled: true,
    order: 35,
    scopes: ["selection", "document"],
    promptTemplate: "请扩写选中内容，补充必要背景、解释和例子；保持事实谨慎，无法确认的信息不要编造。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.translate.zh",
    source: "builtin",
    name: "翻译为中文",
    description: "把选中内容翻译成自然、准确的中文。",
    enabled: true,
    order: 40,
    scopes: ["selection", "document"],
    promptTemplate: "请将选中内容翻译为简体中文，保留 Markdown 结构、链接和代码块。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.translate.en",
    source: "builtin",
    name: "翻译为英文",
    description: "把选中内容翻译成自然、专业的英文。",
    enabled: true,
    order: 45,
    scopes: ["selection", "document"],
    promptTemplate: "请将选中内容翻译为自然、专业的英文，保留 Markdown 结构、链接和代码块。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.translate.ja",
    source: "builtin",
    name: "翻译为日文",
    description: "把选中内容翻译成自然的日文。",
    enabled: true,
    order: 50,
    scopes: ["selection", "document"],
    promptTemplate: "请将选中内容翻译为自然的日文，保留 Markdown 结构、链接和代码块。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.translate.ko",
    source: "builtin",
    name: "翻译为韩文",
    description: "把选中内容翻译成自然的韩文。",
    enabled: true,
    order: 55,
    scopes: ["selection", "document"],
    promptTemplate: "请将选中内容翻译为自然的韩文，保留 Markdown 结构、链接和代码块。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.tone.formal",
    source: "builtin",
    name: "改成正式语气",
    description: "调整为正式、克制的表达。",
    enabled: true,
    order: 60,
    scopes: ["selection", "document"],
    promptTemplate: "请将选中内容改写为正式、克制、适合文档发布的语气，保持原意和 Markdown 结构。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.tone.technical",
    source: "builtin",
    name: "改成技术文档风格",
    description: "调整为清晰、可执行的技术文档表达。",
    enabled: true,
    order: 65,
    scopes: ["selection", "document"],
    promptTemplate: "请将选中内容改写为技术文档风格：结构清晰、术语准确、可执行；保留 Markdown 结构。",
    defaultContext: { includeSelection: true },
    defaultApplyMode: "replace",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.explain.selection",
    source: "builtin",
    name: "解释选区",
    description: "解释选中概念、代码或段落。",
    enabled: true,
    order: 70,
    scopes: ["selection", "document"],
    promptTemplate: "请解释选中内容：先给一句话结论，再列出关键概念、上下文和可能的注意事项。",
    defaultContext: { includeSelection: true, includeCurrentDocument: true },
    defaultApplyMode: "answer",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.extract.todos",
    source: "builtin",
    name: "提取待办",
    description: "从内容中提取可执行待办事项。",
    enabled: true,
    order: 80,
    scopes: ["selection", "document"],
    promptTemplate: "请从上下文中提取待办事项，输出 Markdown 任务列表；每项尽量包含负责人、截止时间或依赖信息，缺失则不要编造。",
    defaultContext: { includeSelection: true, includeCurrentDocument: true },
    defaultApplyMode: "answer",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.summarize.document",
    source: "builtin",
    name: "总结当前文档",
    description: "总结当前文档并列出待办。",
    enabled: true,
    order: 90,
    scopes: ["document"],
    promptTemplate: "请总结当前文档，列出核心结论和待办事项。",
    defaultContext: { includeCurrentDocument: true },
    defaultApplyMode: "answer",
    ui: { commandPalette: true, editorToolbar: true, contextMenu: false, aiPanel: true }
  },
  {
    id: "ai.generate.outline",
    source: "builtin",
    name: "生成大纲",
    description: "根据当前文档生成结构化大纲。",
    enabled: true,
    order: 95,
    scopes: ["document"],
    promptTemplate: "请基于当前文档生成一个可直接用于改写的 Markdown 大纲，保持层级清晰，并指出缺失信息。",
    defaultContext: { includeCurrentDocument: true },
    defaultApplyMode: "answer",
    ui: { commandPalette: true, editorToolbar: false, contextMenu: false, aiPanel: true }
  },
  {
    id: "ai.generate.titles",
    source: "builtin",
    name: "生成标题",
    description: "为当前内容生成标题候选。",
    enabled: true,
    order: 100,
    scopes: ["selection", "document"],
    promptTemplate: "请根据上下文生成 8 个标题候选，按“清晰、简洁、可搜索”的标准排序。",
    defaultContext: { includeSelection: true, includeCurrentDocument: true },
    defaultApplyMode: "answer",
    ui: { commandPalette: true, editorToolbar: false, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.generate.tags",
    source: "builtin",
    name: "生成标签",
    description: "为当前内容生成标签建议。",
    enabled: true,
    order: 105,
    scopes: ["selection", "document"],
    promptTemplate: "请根据上下文生成 5-10 个标签建议，输出为 Markdown 列表；标签应短、稳定、可复用。",
    defaultContext: { includeSelection: true, includeCurrentDocument: true },
    defaultApplyMode: "answer",
    ui: { commandPalette: true, editorToolbar: false, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.create.note",
    source: "builtin",
    name: "生成新笔记",
    description: "基于当前上下文生成一篇可保存的新 Markdown 笔记。",
    enabled: true,
    order: 110,
    scopes: ["selection", "document", "workspace"],
    promptTemplate: "请基于当前上下文生成一篇完整 Markdown 笔记，包含清晰标题、摘要、正文结构和必要的待办。只输出笔记正文。",
    defaultContext: { includeSelection: true, includeCurrentDocument: true, includeWorkspaceResults: true },
    defaultApplyMode: "new-document",
    ui: { commandPalette: true, editorToolbar: false, contextMenu: true, aiPanel: true }
  },
  {
    id: "ai.propose.change-plan",
    source: "builtin",
    name: "生成变更计划",
    description: "提出可审核的文件修改计划。",
    enabled: true,
    order: 115,
    scopes: ["document", "folder", "workspace"],
    promptTemplate: [
      "请基于上下文生成一个可审核的文件变更计划。",
      "必须优先输出 JSON，格式为：",
      "{\"changes\":[{\"action\":\"create|modify|rename|delete\",\"pathRel\":\"notes/example.md\",\"targetPathRel\":\"notes/new-name.md\",\"title\":\"变更说明\",\"content\":\"完整 Markdown 内容\"}]}",
      "create 和 modify 必须提供完整 content；rename 必须提供 targetPathRel；delete 不需要 content。",
      "只在有足够依据时给出变更；删除和重命名必须非常谨慎，并在 title 中说明依据。"
    ].join("\n"),
    defaultContext: { includeCurrentDocument: true, includeWorkspaceResults: true, includeBacklinks: true },
    defaultApplyMode: "diff",
    ui: { commandPalette: true, editorToolbar: false, contextMenu: false, aiPanel: true }
  },
  {
    id: "ai.ask.workspace",
    source: "builtin",
    name: "问工作区",
    description: "基于工作区搜索结果回答问题并给出来源。",
    enabled: true,
    order: 120,
    scopes: ["workspace"],
    promptTemplate: "请基于提供的工作区来源回答问题。没有依据时说明未找到明确依据。",
    defaultContext: { includeWorkspaceResults: true, includeBacklinks: true },
    defaultApplyMode: "answer",
    ui: { commandPalette: true, editorToolbar: false, contextMenu: false, aiPanel: true }
  },
  {
    id: "ai.recommend.links",
    source: "builtin",
    name: "推荐双链",
    description: "根据当前内容和工作区上下文推荐相关双链。",
    enabled: true,
    order: 130,
    scopes: ["document", "workspace"],
    promptTemplate: "请基于当前文档和工作区来源推荐可加入的 [[双链]]，按相关度排序，并说明推荐理由。",
    defaultContext: { includeCurrentDocument: true, includeWorkspaceResults: true, includeBacklinks: true },
    defaultApplyMode: "answer",
    ui: { commandPalette: true, editorToolbar: false, contextMenu: false, aiPanel: true }
  }
];
