import type { BrowserWindow } from "electron";

import { IpcChannels } from "../../shared/channels";
import type {
  AiEmbeddingSettings,
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

const DEFAULT_AI_IDLE_TIMEOUT_MS = 120_000;
const MIN_AI_IDLE_TIMEOUT_MS = 30_000;
const MAX_AI_IDLE_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_AI_MAX_RUN_MS = 10 * 60_000;
const MIN_AI_MAX_RUN_MS = 30_000;
const MAX_AI_MAX_RUN_MS = 60 * 60_000;

function resolveTimeoutMs(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function resolveAiIdleTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.NOLIA_AI_IDLE_TIMEOUT_MS?.trim() || env.NOLIA_AI_RUN_TIMEOUT_MS?.trim();
  return resolveTimeoutMs(raw, DEFAULT_AI_IDLE_TIMEOUT_MS, MIN_AI_IDLE_TIMEOUT_MS, MAX_AI_IDLE_TIMEOUT_MS);
}

export function resolveAiRunTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return resolveAiIdleTimeoutMs(env);
}

export function resolveAiMaxRunMs(env: NodeJS.ProcessEnv = process.env): number {
  return resolveTimeoutMs(env.NOLIA_AI_MAX_RUN_MS?.trim(), DEFAULT_AI_MAX_RUN_MS, MIN_AI_MAX_RUN_MS, MAX_AI_MAX_RUN_MS);
}

function aiIdleTimeoutMessage(timeoutMs: number): string {
  const timeoutSeconds = Math.round(timeoutMs / 1000);
  return `AI 请求超过 ${timeoutSeconds} 秒没有新的输出或工具进展，已自动停止。请检查模型服务、网络或减少上下文后重试。`;
}

function aiMaxRunTimeoutMessage(timeoutMs: number): string {
  const timeoutSeconds = Math.round(timeoutMs / 1000);
  return `AI 请求运行超过 ${timeoutSeconds} 秒，已自动停止。请缩小任务范围或稍后重试。`;
}

function isAiRunActivityEvent(event: AiRunEvent): boolean {
  return event.type !== "done" && event.type !== "cancelled" && event.type !== "error";
}

export class AiService {
  private readonly sessions = new AiSessionService();
  private readonly providers = new AiProviderRegistry();
  private readonly embeddings = new AiEmbeddingService();
  private readonly semanticIndexRuns = new Map<string, Promise<AiSemanticIndexStatus | undefined>>();
  private readonly semanticIndexProgress = new Map<string, AiSemanticIndexStatus>();

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
    const settings = this.settings.resolvedEmbeddingSettings({
      ...(request.settings ?? {}),
      apiKey: request.apiKey
    });
    const runKey = semanticIndexRunKey(request.workspaceId, settings);
    const progress = this.semanticIndexProgress.get(runKey);
    if (progress) {
      return progress;
    }
    if (!this.services.semanticIndex) {
      return runtime.db.semanticIndexStatus(settings, undefined, "语义索引服务不可用。");
    }
    return this.services.semanticIndex.status(runtime.db, settings);
  }

  async updateSemanticIndex(request: AiSemanticIndexRequest, reset = false): Promise<AiSemanticIndexResult> {
    const runtime = this.services.workspaces.requireWorkspace(request.workspaceId);
    const settings = this.settings.resolvedEmbeddingSettings({
      ...(request.settings ?? {}),
      apiKey: request.apiKey
    });
    if (!this.services.semanticIndex) {
      return { status: runtime.db.semanticIndexStatus(settings, undefined, "语义索引服务不可用。") };
    }
    const runKey = semanticIndexRunKey(request.workspaceId, settings);
    if (!this.semanticIndexRuns.has(runKey)) {
      const total = runtime.db.countSemanticIndexableDocuments();
      const initialStatus = runtime.db.semanticIndexStatus(settings, {
        phase: "scanning",
        current: 0,
        total
      }, undefined, { fast: true });
      this.semanticIndexProgress.set(runKey, initialStatus);
      const run = this.startSemanticIndexRun(runKey, runtime.db, settings, reset);
      this.semanticIndexRuns.set(runKey, run);
    }
    const status = this.semanticIndexProgress.get(runKey) ?? runtime.db.semanticIndexStatus(settings, undefined, undefined, { fast: true });
    this.semanticIndexProgress.set(runKey, status);
    return { status };
  }

  private startSemanticIndexRun(runKey: string, db: ReturnType<AiRuntimeServices["workspaces"]["requireWorkspace"]>["db"], settings: ReturnType<AiSettingsService["resolvedEmbeddingSettings"]>, reset: boolean): Promise<AiSemanticIndexStatus | undefined> {
    const run = new Promise<AiSemanticIndexStatus | undefined>((resolve) => {
      setImmediate(() => {
        void this.services.semanticIndex?.update(db, settings, {
          reset,
          onProgress: (status) => this.semanticIndexProgress.set(runKey, status)
        }).then(
          (status) => {
            this.semanticIndexProgress.set(runKey, status);
            resolve(status);
          },
          (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            const failedStatus = db.semanticIndexStatus(settings, undefined, message, { fast: true });
            this.semanticIndexProgress.set(runKey, failedStatus);
            this.services.diagnostics.warn("Semantic index update failed", {
              providerId: settings.providerId,
              model: settings.model,
              error: message
            });
            resolve(failedStatus);
          }
        );
      });
    });
    return run.finally(() => {
      this.semanticIndexRuns.delete(runKey);
      this.semanticIndexProgress.delete(runKey);
    });
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
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let maxRunTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutMessage: string | undefined;
    let timedOut = false;
    const abortByTimeout = (message: string) => {
      if (signal.aborted) {
        return;
      }
      timedOut = true;
      timeoutMessage = message;
      controller.abort(new AiProviderError(message, "run_timeout"));
    };
    const idleTimeoutMs = resolveAiIdleTimeoutMs();
    const idleTimeoutMessage = aiIdleTimeoutMessage(idleTimeoutMs);
    const resetIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        abortByTimeout(idleTimeoutMessage);
      }, idleTimeoutMs);
    };
    const maxRunMs = resolveAiMaxRunMs();
    const maxRunTimeoutMessage = aiMaxRunTimeoutMessage(maxRunMs);
    maxRunTimer = setTimeout(() => {
      abortByTimeout(maxRunTimeoutMessage);
    }, maxRunMs);
    resetIdleTimer();
    const emit = (event: AiRunEvent) => {
      if (isAiRunActivityEvent(event)) {
        resetIdleTimer();
      }
      if (this.emitRunEvent) {
        this.emitRunEvent(event);
        return;
      }
      this.getWindow()?.webContents.send(IpcChannels.aiRunEvent, event);
    };
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
        message: abortedByTimeout ? timeoutMessage ?? idleTimeoutMessage : error instanceof Error ? error.message : "AI run failed",
        retryable: true
      });
    } finally {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      if (maxRunTimer) {
        clearTimeout(maxRunTimer);
      }
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
    allowDocumentPatch: Boolean(request.options?.allowDocumentPatch),
    allowWorkspaceOperations: Boolean(allowWorkspaceRead && request.options?.allowWorkspaceOperations && settings.allowWorkspaceOperations)
  };
}

function semanticIndexRunKey(workspaceId: string, settings: AiEmbeddingSettings): string {
  return [workspaceId, settings.providerId, settings.model, settings.baseUrl, settings.apiMode].join("\u0000");
}
