import type { BrowserWindow } from "electron";

import { IpcChannels } from "../../shared/channels";
import type {
  AiModelsListRequest,
  AiEmbeddingTestRequest,
  AiProviderTestRequest,
  AiRunCancelRequest,
  AiRunEvent,
  AiRunStartRequest,
  AiRunStartResponse,
  AiSecretClearRequest,
  AiSecretGetRequest,
  AiSecretGetResponse,
  AiSecretSetRequest,
  AiSemanticIndexRequest,
  AiSemanticIndexResult,
  AiSemanticIndexStatus,
  AiSettingsPublic,
  AiSettingsSetRequest
} from "../../shared/ai";
import { AiSettingsService } from "./aiSettingsService";
import { AiSessionService } from "./aiSessionService";
import { AiSdkAgentEngine } from "./aiSdkAgentEngine";
import { AiEmbeddingService } from "./embeddingService";
import { AiProviderRegistry } from "./providerRegistry";
import { AiProviderError, type AiAllowedScopes, type AiRuntimeServices } from "./types";

const AI_RUN_TIMEOUT_MS = 90_000;

export class AiService {
  private readonly sessions = new AiSessionService();
  private readonly providers = new AiProviderRegistry();
  private readonly embeddings = new AiEmbeddingService();

  constructor(
    private readonly settings: AiSettingsService,
    private readonly services: AiRuntimeServices,
    private readonly getWindow: () => BrowserWindow | undefined,
    private readonly emitRunEvent?: (event: AiRunEvent) => void
  ) {}

  getSettings(): AiSettingsPublic {
    return this.settings.publicSettings();
  }

  setSettings(request: AiSettingsSetRequest): Promise<AiSettingsPublic> {
    return this.settings.setSettings(request);
  }

  setSecret(request: AiSecretSetRequest): Promise<AiSettingsPublic> {
    return this.settings.setSecret(request);
  }

  clearSecret(request: AiSecretClearRequest): Promise<AiSettingsPublic> {
    return this.settings.clearSecret(request);
  }

  getSecret(request: AiSecretGetRequest): AiSecretGetResponse {
    return this.settings.getSecret(request);
  }

  async testProvider(request: AiProviderTestRequest): Promise<import("../../shared/ai").AiProviderTestResult> {
    const settings = this.settings.resolvedSettings({
      providerProfileId: request.providerProfileId,
      apiKey: request.apiKey,
      ...(request.provider ?? {})
    });
    const provider = this.providers.get(settings);
    return provider.testConnection(settings);
  }

  async listModels(request: AiModelsListRequest): Promise<import("../../shared/ai").AiModelDescriptor[]> {
    const settings = this.settings.resolvedSettings({
      providerProfileId: request.providerProfileId,
      apiKey: request.apiKey,
      ...(request.provider ?? {})
    });
    const provider = this.providers.get(settings);
    return provider.listModels ? provider.listModels(settings) : [];
  }

  async testEmbedding(request: AiEmbeddingTestRequest): Promise<import("../../shared/ai").AiProviderTestResult> {
    const settings = this.settings.resolvedEmbeddingSettings({
      ...(request.settings ?? {}),
      apiKey: request.apiKey
    });
    return this.embeddings.test(settings);
  }

  semanticIndexStatus(request: AiSemanticIndexRequest): AiSemanticIndexStatus {
    const runtime = this.services.workspaces.requireWorkspace(request.workspaceId);
    const settings = this.settings.resolvedEmbeddingSettings();
    if (!this.services.semanticIndex) {
      return runtime.db.semanticIndexStatus(settings, undefined, "语义索引服务不可用。");
    }
    return this.services.semanticIndex.status(runtime.db, settings);
  }

  async updateSemanticIndex(request: AiSemanticIndexRequest, reset = false): Promise<AiSemanticIndexResult> {
    const runtime = this.services.workspaces.requireWorkspace(request.workspaceId);
    const settings = this.settings.resolvedEmbeddingSettings();
    if (!this.services.semanticIndex) {
      return { status: runtime.db.semanticIndexStatus(settings, undefined, "语义索引服务不可用。") };
    }
    const status = await this.services.semanticIndex.update(runtime.db, settings, { reset });
    return { status };
  }

  startRun(request: AiRunStartRequest): AiRunStartResponse {
    const settings = this.settings.resolvedSettings();
    const session = this.sessions.create();
    queueMicrotask(() => void this.run(session.runId, request, settings, session.controller));
    return { runId: session.runId };
  }

  cancelRun(request: AiRunCancelRequest): { ok: boolean } {
    return { ok: this.sessions.cancel(request.runId) };
  }

  private async run(runId: string, request: AiRunStartRequest, settings: ReturnType<AiSettingsService["resolvedSettings"]>, controller: AbortController): Promise<void> {
    const signal = controller.signal;
    const emit = (event: AiRunEvent) => {
      if (this.emitRunEvent) {
        this.emitRunEvent(event);
        return;
      }
      this.getWindow()?.webContents.send(IpcChannels.aiRunEvent, event);
    };
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new AiProviderError("AI 请求超过 90 秒未返回，已自动停止。请检查模型服务、网络或减少上下文后重试。", "run_timeout"));
    }, AI_RUN_TIMEOUT_MS);
    try {
      if (!settings.enabled) {
        emit({ type: "error", runId, code: "ai_disabled", message: "AI is disabled", retryable: false });
        return;
      }
      if (!settings.model) {
        emit({ type: "error", runId, code: "missing_model", message: "AI model is not configured", retryable: false });
        return;
      }
      if (settings.providerId === "openai-compatible" && !settings.apiKey) {
        emit({ type: "error", runId, code: "missing_api_key", message: "API key is missing", retryable: false });
        return;
      }
      if (request.options?.requireCurrentNote && !settings.allowCurrentNoteContent) {
        emit({
          type: "error",
          runId,
          code: "tool_permission_denied",
          message: "当前请求需要读取当前笔记正文，但 AI 设置未允许发送当前笔记正文。请在 AI 设置中开启“允许发送当前笔记正文”后重试。",
          retryable: true
        });
        return;
      }
      if (request.options?.requireCurrentNote && !request.clientContext.activeDocument) {
        emit({
          type: "error",
          runId,
          code: "tool_permission_denied",
          message: "当前请求需要读取当前笔记正文，但当前没有打开可读取的 Markdown 笔记。",
          retryable: false
        });
        return;
      }
      this.sessions.mark(runId, "running");
      const provider = this.providers.get(settings);
      const engine = new AiSdkAgentEngine(provider, this.services);
      const allowedScopes = allowedScopesFor(request, settings);
      for await (const event of engine.run({
        runId,
        instruction: request.instruction,
        entryPoint: request.entryPoint,
        actionId: request.actionId,
        conversation: request.conversation,
        settings,
        clientContext: request.clientContext,
        allowedScopes,
        allowTools: request.options?.allowTools !== false,
        patchFallback: Boolean(request.options?.patchFallback),
        maxToolRounds: request.options?.maxToolRounds ?? settings.agentMaxSteps,
        signal
      })) {
        emit(event);
      }
    } catch (error) {
      const abortedByTimeout = timedOut && signal.aborted;
      if (signal.aborted && !abortedByTimeout) {
        emit({ type: "cancelled", runId });
        return;
      }
      emit({
        type: "error",
        runId,
        code: abortedByTimeout ? "run_timeout" : error instanceof AiProviderError ? error.code : "unknown",
        message: abortedByTimeout ? "AI 请求超过 90 秒未返回，已自动停止。请检查模型服务、网络或减少上下文后重试。" : error instanceof Error ? error.message : "AI run failed",
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
      this.sessions.complete(runId);
    }
  }
}

function allowedScopesFor(request: AiRunStartRequest, settings: ReturnType<AiSettingsService["resolvedSettings"]>): AiAllowedScopes {
  const hasSelection = Boolean(request.clientContext.selection?.text);
  const allowWorkspaceSearch = Boolean((request.options?.allowWorkspaceSearch || settings.allowWorkspaceSearch) && settings.allowWorkspaceSearch);
  const allowWorkspaceRead = Boolean((request.options?.allowWorkspaceRead || settings.allowWorkspaceRead) && settings.allowWorkspaceRead);
  return {
    includeCurrentNote: Boolean(request.options?.requireCurrentNote || (request.options?.includeCurrentNote && settings.allowCurrentNoteContent)),
    includeSelection: Boolean(hasSelection && request.options?.includeSelection !== false),
    allowWorkspaceSearch,
    allowReadSearchResults: Boolean(allowWorkspaceSearch && settings.allowReadSearchResults),
    allowWorkspaceRead,
    allowWorkspaceOperations: Boolean(allowWorkspaceRead && (request.options?.allowWorkspaceOperations || settings.allowWorkspaceOperations) && settings.allowWorkspaceOperations)
  };
}
