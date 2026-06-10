import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WebContents } from "electron";

import type {
  AiAttachmentExtractRequest,
  AiAttachmentExtractResponse,
  AiChangePlanApplyRequest,
  AiChangePlanApplyResponse,
  AiChangePlanPrepareRequest,
  AiChangePlanPrepareResponse,
  AiChatCancelRequest,
  AiChatStartRequest,
  AiChatStartResponse,
  AiChatStreamEvent,
  AiCommandDefinition,
  AiCommandRunRequest,
  AiContextPreviewRequest,
  AiContextPreviewResponse,
  AiCredentialSetRequest,
  AiCredentialSummary,
  AiGeneratedResult,
  AiIndexCancelRequest,
  AiIndexClearRequest,
  AiIndexRebuildRequest,
  AiIndexStatus,
  AiIndexStatusRequest,
  AiInsightItem,
  AiInsightsRequest,
  AiInsightsResponse,
  AiModelsListRequest,
  AiModelsListResponse,
  AiProviderConfig,
  AiProviderTestRequest,
  AiProviderTestResponse,
  AiUserFacingError,
  AiWebSearchResponse
} from "../../../shared/ai";
import { IpcChannels } from "../../../shared/channels";
import { parseMarkdown } from "../../../shared/markdown";
import { normalizePathRel, resolveWorkspacePath } from "../../utils/filePaths";
import { sha256Text } from "../../utils/hash";
import { DiagnosticsService } from "../diagnosticsService";
import { FileSystemService } from "../fileSystemService";
import { SettingsService } from "../settingsService";
import { WorkspaceService } from "../workspaceService";
import type { PluginService } from "../pluginService";
import { AiChangePlanService } from "./aiChangePlanService";
import { AiCommandService } from "./aiCommandService";
import { AiContextService } from "./aiContextService";
import { AiIndexService, type AiIndexEmbeddingProfile, type AiIndexSearchOptions } from "./aiIndexService";
import { AiProviderRegistry } from "./aiProviderRegistry";
import { CredentialService } from "./credentialService";

interface StoredPreview {
  preview: AiContextPreviewResponse;
  request: AiContextPreviewRequest;
}

interface RunningRequest {
  controller: AbortController;
  webContents: WebContents;
}

const SYSTEM_PROMPT = [
  "你是 Nolia 的 AI 编辑助手。",
  "回答必须尊重给定上下文，涉及工作区内容时尽量引用来源。",
  "不要声称读取了未提供的文件。没有依据时明确说明证据不足。",
  "保留 Markdown 结构，除非用户要求换成其他格式。"
].join("\n");

export class AiService {
  private readonly aiIndex = new AiIndexService();
  private readonly context: AiContextService;
  private readonly commands: AiCommandService;
  private readonly changePlans: AiChangePlanService;
  private readonly providers = new AiProviderRegistry();
  private readonly previews = new Map<string, StoredPreview>();
  private readonly running = new Map<string, RunningRequest>();
  private readonly indexControllers = new Map<string, AbortController>();

  constructor(
    private readonly settings: SettingsService,
    private readonly credentials: CredentialService,
    private readonly workspaces: WorkspaceService,
    private readonly files: FileSystemService,
    private readonly diagnostics: DiagnosticsService,
    plugins?: PluginService
  ) {
    this.context = new AiContextService(
      workspaces,
      this.aiIndex,
      (settings) => this.searchOptionsForSettings(settings),
      (workspaceId, pathRel) => this.extractAttachment({ workspaceId, pathRel })
    );
    this.commands = new AiCommandService(settings, workspaces, plugins, diagnostics);
    this.changePlans = new AiChangePlanService(workspaces, files);
  }

  listCredentials(): AiCredentialSummary[] {
    return this.credentials.list();
  }

  async setCredential(request: AiCredentialSetRequest): Promise<AiCredentialSummary> {
    const summary = await this.credentials.set(request.providerId, request.value, request.label);
    const ai = this.settings.getSettings().ai;
    const provider = ai.providers[request.providerId];
    if (provider) {
      await this.settings.setSetting("ai", {
        ...ai,
        providers: {
          ...ai.providers,
          [request.providerId]: {
            ...provider,
            apiKeyRef: summary.keyRef
          }
        }
      });
    }
    return summary;
  }

  async deleteCredential(keyRef: string): Promise<{ ok: boolean }> {
    const result = await this.credentials.delete(keyRef);
    if (!result.ok) {
      return result;
    }
    const ai = this.settings.getSettings().ai;
    const providers = Object.fromEntries(
      Object.entries(ai.providers).map(([providerId, provider]) => [
        providerId,
        provider.apiKeyRef === keyRef ? { ...provider, apiKeyRef: undefined } : provider
      ])
    );
    await this.settings.setSetting("ai", { ...ai, providers });
    return result;
  }

  async testProvider(request: AiProviderTestRequest): Promise<AiProviderTestResponse> {
    const provider = this.resolveProvider(request.providerId, request.provider);
    const controller = new AbortController();
    try {
      return await this.providers.test(this.buildProviderRequest({
        requestId: randomUUID(),
        provider,
        model: provider.defaultModel,
        prompt: "Provider connectivity test.",
        contextText: "",
        citations: [],
        apiKeyOverride: request.apiKey,
        signal: controller.signal
      }));
    } catch (error) {
      return { ok: false, message: this.toUserFacingError(error, provider.id).message };
    }
  }

  async listModels(request: AiModelsListRequest): Promise<AiModelsListResponse> {
    const provider = this.resolveProvider(request.providerId, request.provider);
    const models = await this.providers.listModels(this.buildProviderRequest({
      requestId: randomUUID(),
      provider,
      model: provider.defaultModel,
      prompt: "List models.",
      contextText: "",
      citations: [],
      apiKeyOverride: request.apiKey
    }));
    return { models };
  }

  async previewContext(request: AiContextPreviewRequest): Promise<AiContextPreviewResponse> {
    const preview = await this.context.preview(request, this.settings.getSettings().ai);
    this.previews.set(preview.previewId, { preview, request });
    this.prunePreviews();
    return preview;
  }

  listCommands(request: { workspaceId?: string } = {}): Promise<AiCommandDefinition[]> {
    return this.commands.listCommands(request.workspaceId);
  }

  async runCommand(request: AiCommandRunRequest, webContents: WebContents): Promise<AiChatStartResponse> {
    const command = await this.commands.findCommand(request.commandId, request.workspaceId);
    if (!command) {
      throw new Error(`Unknown AI command: ${request.commandId}`);
    }
    const prompt = [command.promptTemplate, request.prompt].filter(Boolean).join("\n\n");
    const scope = request.scope ?? command.scopes[0] ?? "document";
    return this.startChat({ ...request, prompt, scope }, webContents, command);
  }

  async startChat(request: AiChatStartRequest, webContents: WebContents, command?: AiCommandDefinition): Promise<AiChatStartResponse> {
    const requestId = randomUUID();
    const controller = new AbortController();
    this.running.set(requestId, { controller, webContents });
    void this.executeChat(requestId, request, webContents, controller, command);
    return { requestId };
  }

  cancelChat(request: AiChatCancelRequest): { ok: boolean } {
    const running = this.running.get(request.requestId);
    if (!running) {
      return { ok: false };
    }
    running.controller.abort();
    this.send(running.webContents, { requestId: request.requestId, type: "cancelled" });
    return { ok: true };
  }

  indexStatus(request: AiIndexStatusRequest = {}): AiIndexStatus {
    const ai = this.settings.getSettings().ai;
    if (!ai.index.enabled) {
      return { status: "disabled", progress: 0, message: "AI semantic index is disabled." };
    }
    const workspace = request.workspaceId
      ? this.workspaces.requireWorkspace(request.workspaceId)
      : this.workspaces.getActiveWorkspace();
    if (!workspace) {
      return { status: "idle", progress: 0, message: "No active workspace." };
    }
    return this.aiIndex.getStatus(workspace.info.workspaceId);
  }

  async rebuildIndex(request: AiIndexRebuildRequest): Promise<AiIndexStatus> {
    const ai = this.settings.getSettings().ai;
    if (!ai.index.enabled) {
      return { status: "disabled", progress: 0, message: "AI semantic index is disabled." };
    }
    const workspace = this.workspaces.requireWorkspace(request.workspaceId);
    this.indexControllers.get(workspace.info.workspaceId)?.abort();
    const controller = new AbortController();
    this.indexControllers.set(workspace.info.workspaceId, controller);
    const embeddingProfile = this.embeddingProfileForSettings();
    const embeddingProvider = embeddingProfile ? this.resolveProvider(embeddingProfile.providerId) : undefined;
    try {
      return await this.aiIndex.rebuildWorkspace(workspace.info.workspaceId, workspace.info.rootPath, {
        includeMarkdown: ai.index.includeTextResources,
        includeTextResources: ai.index.includeTextResources,
        excludeGlobs: ai.index.excludeGlobs,
        excludeExtensions: ai.index.excludeExtensions,
        excludeTags: ai.index.excludeTags,
        embeddingProfile,
        embed: embeddingProvider && this.providers.supportsEmbedding(embeddingProvider)
          ? (texts, signal) => this.embedTexts(embeddingProvider, embeddingProfile?.model, texts, signal)
          : undefined,
        signal: controller.signal
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = this.aiIndex.getStatus(workspace.info.workspaceId);
      this.diagnostics.warn("AI index rebuild failed", { workspaceId: workspace.info.workspaceId, error: message });
      return status;
    } finally {
      if (this.indexControllers.get(workspace.info.workspaceId) === controller) {
        this.indexControllers.delete(workspace.info.workspaceId);
      }
    }
  }

  async clearIndex(request: AiIndexClearRequest): Promise<AiIndexStatus> {
    const workspace = this.workspaces.requireWorkspace(request.workspaceId);
    this.indexControllers.get(workspace.info.workspaceId)?.abort();
    this.indexControllers.delete(workspace.info.workspaceId);
    return this.aiIndex.clearWorkspace(workspace.info.workspaceId, workspace.info.rootPath);
  }

  cancelIndex(request: AiIndexCancelRequest): AiIndexStatus {
    const workspace = this.workspaces.requireWorkspace(request.workspaceId);
    const controller = this.indexControllers.get(workspace.info.workspaceId);
    controller?.abort();
    return this.aiIndex.pauseWorkspace(workspace.info.workspaceId);
  }

  async webSearch(): Promise<AiWebSearchResponse> {
    return {
      providerId: "disabled",
      results: []
    };
  }

  prepareChangePlan(request: AiChangePlanPrepareRequest): Promise<AiChangePlanPrepareResponse> {
    return this.changePlans.prepare(request);
  }

  applyChangePlan(request: AiChangePlanApplyRequest): Promise<AiChangePlanApplyResponse> {
    return this.changePlans.apply(request);
  }

  async insights(request: AiInsightsRequest): Promise<AiInsightsResponse> {
    const workspace = this.workspaces.requireWorkspace(request.workspaceId);
    const sourceText = request.sourceText ?? (request.pathRel ? await this.files.readFile({ workspaceId: request.workspaceId, pathRel: request.pathRel }).then((file) => file.content).catch(() => "") : "");
    const parsed = parseMarkdown(sourceText, request.pathRel ?? "");
    const warnings: string[] = [];
    const kinds = new Set(request.kinds ?? ["similar", "duplicate", "tag", "backlink", "topic"]);
    const limit = request.limit ?? 8;
    const items: AiInsightItem[] = [];

    if (kinds.has("tag")) {
      items.push(...buildTagInsights(parsed.tags, workspace.db.listTags()));
    }

    if (kinds.has("backlink") && request.pathRel) {
      const backlinks = workspace.db.getBacklinks(normalizePathRel(request.pathRel), true);
      items.push(...backlinks.unlinked.slice(0, 4).map((item, index) => ({
        id: `backlink:${item.pathRel}:${item.line}:${index}`,
        kind: "backlink" as const,
        label: `建议双链：${item.title}`,
        pathRel: item.pathRel,
        target: item.title,
        score: 0.72 - index * 0.04,
        excerpt: item.context
      })));
    }

    if ((kinds.has("similar") || kinds.has("duplicate") || kinds.has("topic")) && sourceText.trim()) {
      const query = buildInsightQuery(parsed.title, parsed.plainText || sourceText);
      const searchOptions = await this.searchOptionsForSettings(this.settings.getSettings().ai);
      const indexResults = this.settings.getSettings().ai.index.enabled
        ? await this.aiIndex.search(workspace.info.workspaceId, workspace.info.rootPath, query, { limit: 8, ...searchOptions }).catch(() => [])
        : [];
      const results = indexResults.length
        ? indexResults.map((item) => ({
            pathRel: item.pathRel,
            title: item.title,
            excerpt: item.text,
            score: item.score
          }))
        : workspace.db.search({ workspaceId: workspace.info.workspaceId, query, limit: 8 }).items.map((item) => ({
            id: item.pathRel,
            pathRel: item.pathRel,
            title: item.title,
            excerpt: item.snippets[0] ?? item.title,
            score: item.score || 1
          }));
      for (const [index, result] of results.entries()) {
        if (result.pathRel === request.pathRel) {
          continue;
        }
        const similarity = textSimilarity(parsed.plainText || sourceText, result.excerpt);
        if (kinds.has("duplicate") && similarity > 0.9) {
          items.push({
            id: `duplicate:${result.pathRel}`,
            kind: "duplicate",
            label: `疑似重复：${result.title}`,
            pathRel: result.pathRel,
            score: Math.max(0.88, similarity),
            excerpt: result.excerpt
          });
          continue;
        }
        if (kinds.has("similar")) {
          items.push({
            id: `similar:${result.pathRel}`,
            kind: "similar",
            label: `相关笔记：${result.title}`,
            pathRel: result.pathRel,
            score: Math.max(0.45, Math.min(0.86, (result.score ?? 1) / 10 || 0.55)) - index * 0.02,
            excerpt: result.excerpt
          });
        }
      }
      if (kinds.has("topic")) {
        items.push(...buildTopicInsights(parsed.plainText || sourceText));
      }
    } else if (!sourceText.trim()) {
      warnings.push("当前文档内容为空，整理建议有限。");
    }

    return {
      items: dedupeInsights(items)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .slice(0, limit),
      warnings
    };
  }

  async extractAttachment(request: AiAttachmentExtractRequest): Promise<AiAttachmentExtractResponse> {
    const ai = this.settings.getSettings().ai;
    if (!ai.privacy.allowAttachmentContext) {
      throw new Error("附件上下文已在 AI 隐私设置中关闭。");
    }
    const workspace = this.workspaces.requireWorkspace(request.workspaceId);
    const pathRel = normalizePathRel(request.pathRel);
    const absolutePath = resolveWorkspacePath(workspace.info.rootPath, pathRel);
    const ext = path.extname(pathRel).toLocaleLowerCase();
    const title = path.posix.basename(pathRel);
    if (isPlainTextAttachment(ext)) {
      const text = await readFile(absolutePath, "utf8");
      return { pathRel, kind: "text", title, text: clipAttachmentText(text), warnings: [] };
    }
    if (ext === ".pdf") {
      const bytes = await readFile(absolutePath);
      const text = extractPdfText(bytes);
      return {
        pathRel,
        kind: "pdf",
        title,
        text: clipAttachmentText(text),
        warnings: text.trim() ? ["PDF 已使用轻量文本抽取，复杂排版可能不完整。"] : ["PDF 未抽取到可用文本。"]
      };
    }
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg"].includes(ext)) {
      const providerId = ai.extractors.imageProviderId;
      const warnings = providerId
        ? ai.privacy.allowCloudAttachmentProcessing
          ? [`图片 OCR provider ${providerId} 已配置，但 provider extractor bridge 尚未连接。`]
          : [`图片 OCR provider ${providerId} 已配置，但云端附件处理未开启。`]
        : ["图片 OCR provider 尚未配置，无法抽取图片文字。"];
      return { pathRel, kind: "image", title, text: "", warnings, providerId, cloudProcessed: false };
    }
    if ([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"].includes(ext)) {
      const providerId = ai.extractors.audioProviderId;
      const warnings = providerId
        ? ai.privacy.allowCloudAttachmentProcessing
          ? [`音频转写 provider ${providerId} 已配置，但 provider extractor bridge 尚未连接。`]
          : [`音频转写 provider ${providerId} 已配置，但云端附件处理未开启。`]
        : ["音频转写 provider 尚未配置，无法抽取音频内容。"];
      return { pathRel, kind: "audio", title, text: "", warnings, providerId, cloudProcessed: false };
    }
    return { pathRel, kind: "unsupported", title, text: "", warnings: [`暂不支持抽取附件：${pathRel}`] };
  }

  private async executeChat(
    requestId: string,
    request: AiChatStartRequest,
    webContents: WebContents,
    controller: AbortController,
    command: AiCommandDefinition | undefined
  ): Promise<void> {
    const provider = this.resolveProvider(request.providerId);
    try {
      this.send(webContents, { requestId, type: "started", providerId: provider.id, model: request.model ?? provider.defaultModel });
      const preview = await this.previewForRequest(request);
      const { contextText, citations } = this.context.toProviderContext(preview);
      const result = await this.providers.generate(this.buildProviderRequest({
        requestId,
        provider,
        model: request.model,
        prompt: buildPrompt(request.prompt, command),
        contextText,
        citations,
        signal: controller.signal
      }), {
        onDelta: (text) => this.send(webContents, { requestId, type: "delta", text })
      });
      if (controller.signal.aborted) {
        this.send(webContents, { requestId, type: "cancelled" });
        return;
      }
      if (!result.streamed) {
        this.sendDelta(webContents, requestId, result.text);
      }
      for (const citation of result.citations) {
        this.send(webContents, { requestId, type: "citation", citation });
      }
      this.send(webContents, { requestId, type: "result", result });
      this.send(webContents, { requestId, type: "done" });
    } catch (error) {
      if (controller.signal.aborted) {
        this.send(webContents, { requestId, type: "cancelled" });
        this.send(webContents, { requestId, type: "done" });
        return;
      }
      const userError = this.toUserFacingError(error, provider.id);
      this.diagnostics.warn("AI request failed", {
        requestId,
        providerId: provider.id,
        code: userError.code,
        statusCode: userError.statusCode
      });
      this.send(webContents, { requestId, type: "error", error: userError });
      this.send(webContents, { requestId, type: "done" });
    } finally {
      this.running.delete(requestId);
    }
  }

  private async previewForRequest(request: AiChatStartRequest): Promise<AiContextPreviewResponse> {
    const stored = request.previewId ? this.previews.get(request.previewId) : undefined;
    if (stored && stored.preview.expiresAt > Date.now()) {
      return filterPreviewItems(stored.preview, request.excludedContextItemIds);
    }
    const preview = await this.previewContext({
      workspaceId: request.workspaceId,
      prompt: request.prompt,
      scope: request.scope,
      providerId: request.providerId,
      model: request.model,
      editor: request.editor,
      includeSelection: request.includeSelection,
      includeCurrentDocument: request.includeCurrentDocument,
      includeBacklinks: request.includeBacklinks ?? (request.scope === "workspace" || request.scope === "document"),
      includeAttachments: request.includeAttachments ?? true,
      includeWebSearch: false
    });
    return filterPreviewItems(preview, request.excludedContextItemIds);
  }

  private resolveProvider(providerId?: string, override?: AiProviderConfig): AiProviderConfig {
    if (override) {
      return override;
    }
    const ai = this.settings.getSettings().ai;
    const resolvedProviderId = providerId ?? ai.defaultProviderId;
    const provider = resolvedProviderId ? ai.providers[resolvedProviderId] : undefined;
    if (!provider) {
      throw new Error("AI provider is not configured");
    }
    if (!provider.enabled) {
      throw new Error(`AI provider is disabled: ${provider.id}`);
    }
    return provider;
  }

  private buildProviderRequest(options: {
    requestId: string;
    provider: AiProviderConfig;
    model?: string;
    prompt: string;
    contextText: string;
    citations: AiGeneratedResult["citations"];
    apiKeyOverride?: string;
    signal?: AbortSignal;
  }) {
    return {
      requestId: options.requestId,
      provider: options.provider,
      model: options.model ?? this.settings.getSettings().ai.defaultModel ?? options.provider.defaultModel,
      apiKey: options.apiKeyOverride ?? this.credentials.getSecret(options.provider.apiKeyRef),
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: options.prompt,
      contextText: options.contextText,
      citations: options.citations,
      signal: options.signal
    };
  }

  private async searchOptionsForSettings(settings: ReturnType<SettingsService["getSettings"]>["ai"]): Promise<Pick<AiIndexSearchOptions, "embeddingProfile" | "embedQuery">> {
    const profile = this.embeddingProfileForSettings(settings);
    if (!profile) {
      return {};
    }
    const provider = this.resolveProvider(profile.providerId);
    if (!this.providers.supportsEmbedding(provider)) {
      return {};
    }
    return {
      embeddingProfile: profile,
      embedQuery: async (query) => {
        const [embedding] = await this.embedTexts(provider, profile.model, [query]);
        return embedding;
      }
    };
  }

  private embeddingProfileForSettings(ai = this.settings.getSettings().ai): AiIndexEmbeddingProfile | undefined {
    if (!ai.index.embeddingProviderId) {
      return undefined;
    }
    const provider = ai.providers[ai.index.embeddingProviderId];
    if (!provider?.enabled) {
      return undefined;
    }
    const model = ai.index.embeddingModel || provider.defaultModel;
    return {
      providerId: provider.id,
      model,
      profileHash: sha256Text(`${provider.id}:${provider.type}:${model ?? ""}`).slice(0, 16)
    };
  }

  private async embedTexts(provider: AiProviderConfig, model: string | undefined, texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const response = await this.providers.embed({
      requestId: randomUUID(),
      provider,
      model,
      apiKey: this.credentials.getSecret(provider.apiKeyRef),
      texts,
      signal
    });
    return response.embeddings;
  }

  private send(webContents: WebContents, event: AiChatStreamEvent): void {
    if (webContents.isDestroyed()) {
      return;
    }
    webContents.send(IpcChannels.aiChatEvent, event);
  }

  private sendDelta(webContents: WebContents, requestId: string, text: string): void {
    const chunks = text.match(/[\s\S]{1,800}/g) ?? [""];
    for (const chunk of chunks) {
      this.send(webContents, { requestId, type: "delta", text: chunk });
    }
  }

  private prunePreviews(): void {
    const now = Date.now();
    for (const [previewId, stored] of this.previews) {
      if (stored.preview.expiresAt <= now) {
        this.previews.delete(previewId);
      }
    }
  }

  private toUserFacingError(error: unknown, providerId?: string): AiUserFacingError {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { code: "cancelled", message: "AI 请求已取消。", retryable: false, providerId };
    }
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
    if (/not configured|missing model|provider is disabled/i.test(message)) {
      return { code: "not_configured", message: "AI provider 尚未配置完整。", retryable: false, providerId, statusCode };
    }
    if (statusCode === 401 || statusCode === 403) {
      return { code: "invalid_api_key", message: "AI provider 鉴权失败，请检查 API Key。", retryable: false, providerId, statusCode };
    }
    if (statusCode === 404) {
      return { code: "model_not_found", message: "未找到指定模型或 provider endpoint。", retryable: false, providerId, statusCode };
    }
    if (statusCode === 429) {
      return { code: "rate_limited", message: "AI provider 当前限流，请稍后重试。", retryable: true, providerId, statusCode };
    }
    if (/fetch failed|network|ECONNREFUSED|ENOTFOUND/i.test(message)) {
      return { code: "network_error", message: "无法连接 AI provider。", retryable: true, providerId, statusCode };
    }
    return { code: "provider_error", message: message || "AI provider 请求失败。", retryable: false, providerId, statusCode };
  }
}

function buildPrompt(prompt: string, command: AiCommandDefinition | undefined): string {
  if (!command) {
    return prompt;
  }
  return [
    `命令：${command.name}`,
    command.description ? `说明：${command.description}` : "",
    prompt
  ].filter(Boolean).join("\n");
}

function filterPreviewItems(preview: AiContextPreviewResponse, excludedIds: string[] | undefined): AiContextPreviewResponse {
  if (!excludedIds?.length) {
    return preview;
  }
  const excluded = new Set(excludedIds);
  const items = preview.items.filter((item) => !excluded.has(item.id));
  return {
    ...preview,
    items,
    estimatedInputChars: items.reduce((sum, item) => sum + item.excerpt.length, 0)
  };
}

function buildTagInsights(currentTags: string[], workspaceTags: Array<{ name: string; displayName: string; count: number }>): AiInsightItem[] {
  const current = new Set(currentTags.map((tag) => tag.toLocaleLowerCase()));
  return workspaceTags
    .filter((tag) => !current.has(tag.name.toLocaleLowerCase()))
    .slice(0, 5)
    .map((tag, index) => ({
      id: `tag:${tag.name}`,
      kind: "tag",
      label: `建议标签：#${tag.displayName || tag.name}`,
      target: tag.name,
      score: Math.max(0.3, 0.68 - index * 0.04 + Math.min(tag.count, 20) / 100),
      excerpt: `工作区中已有 ${tag.count} 篇笔记使用该标签。`
    }));
}

function buildTopicInsights(sourceText: string): AiInsightItem[] {
  return [...topTerms(sourceText, 4)].map(([term, count], index) => ({
    id: `topic:${term}`,
    kind: "topic",
    label: `主题线索：${term}`,
    target: term,
    score: Math.max(0.28, 0.5 - index * 0.04 + Math.min(count, 8) / 80),
    excerpt: `当前文档中多次出现「${term}」，可考虑拆分为主题页或补充双链。`
  }));
}

function buildInsightQuery(title: string, plainText: string): string {
  const terms = [...topTerms(`${title}\n${plainText}`, 8)].map(([term]) => term);
  return [title, ...terms].filter(Boolean).join(" ").trim() || plainText.split(/\s+/).slice(0, 12).join(" ");
}

function topTerms(sourceText: string, limit: number): Array<[string, number]> {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "have",
    "into",
    "或者",
    "以及",
    "因为",
    "所以",
    "一个",
    "我们",
    "可以",
    "需要",
    "当前",
    "文档"
  ]);
  const counts = new Map<string, number>();
  for (const raw of sourceText.toLocaleLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    const term = raw.trim().replace(/^#+/, "");
    if (term.length < 2 || stopWords.has(term) || /^\d+$/.test(term)) {
      continue;
    }
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function textSimilarity(left: string, right: string): number {
  const leftTerms = new Set([...topTerms(left, 80)].map(([term]) => term));
  const rightTerms = new Set([...topTerms(right, 80)].map(([term]) => term));
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      intersection += 1;
    }
  }
  return intersection / Math.max(leftTerms.size, rightTerms.size);
}

function dedupeInsights(items: AiInsightItem[]): AiInsightItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.pathRel ?? ""}:${item.target ?? ""}:${item.label}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isPlainTextAttachment(ext: string): boolean {
  return [".md", ".markdown", ".txt", ".csv", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".log"].includes(ext);
}

function clipAttachmentText(text: string): string {
  const maxChars = 20_000;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars).trimEnd()}\n...`;
}

function extractPdfText(bytes: Buffer): string {
  const source = bytes.toString("latin1");
  const matches = [...source.matchAll(/\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g)]
    .map((match) => decodePdfLiteral(match[1]))
    .filter(Boolean);
  if (matches.length > 0) {
    return matches.join("\n");
  }
  return source
    .replace(/[^\x20-\x7E\n\r\t]+/g, " ")
    .split(/\s+/)
    .filter((part) => part.length > 2)
    .slice(0, 4000)
    .join(" ");
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\([()\\])/g, "$1")
    .trim();
}
