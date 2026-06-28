import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Check, Edit3, Eye, EyeOff, Info, Plus, RefreshCw, RotateCcw, Search, TestTube2, Trash2, X } from "lucide-react";

import {
  AI_EMBEDDING_SECRET_ID,
  DEFAULT_AI_EMBEDDING_SETTINGS,
  MAX_CONVERSATION_HISTORY_TURNS,
  createAiProviderProfile,
  normalizeAiEmbeddingSettings,
  type AiEmbeddingSettings,
  type AiApiMode,
  type AiModelDescriptor,
  type AiProviderId,
  type AiProviderProfile,
  type AiProviderProfilePublic,
  type AiProviderTestResult,
  type AiSemanticIndexStatus,
  type AiSettings,
  type AiSettingsPublic
} from "../../shared/ai";
import { useRendererI18n } from "../app/i18n";

interface AiSettingsPanelProps {
  settings: AiSettingsPublic;
  onUpdate: (settings: Partial<AiSettings>) => Promise<void>;
  onSetApiKey: (providerProfileId: string, apiKey: string) => Promise<void>;
  onClearApiKey: (providerProfileId: string) => Promise<void>;
  onGetApiKey: (providerProfileId: string) => Promise<string | undefined>;
  onTestProvider: (provider: AiProviderProfile, apiKey?: string) => Promise<AiProviderTestResult>;
  onListModels: (provider: AiProviderProfile, apiKey?: string) => Promise<AiModelDescriptor[]>;
  workspaceId?: string;
  semanticStatus?: AiSemanticIndexStatus;
  onRefreshSemanticStatus?: (settings?: AiEmbeddingSettings, apiKey?: string) => Promise<void>;
  onTestEmbedding?: (settings: AiEmbeddingSettings, apiKey?: string) => Promise<AiProviderTestResult>;
  onUpdateSemanticIndex?: (settings: AiEmbeddingSettings, apiKey?: string) => Promise<AiSemanticIndexStatus | undefined>;
  onResetSemanticIndex?: (settings: AiEmbeddingSettings, apiKey?: string) => Promise<AiSemanticIndexStatus | undefined>;
}

type ModelDialogMode = "create" | "edit";
type ModelDraft = AiProviderProfile & {
  apiKeyDraft: string;
  apiKeyTouched: boolean;
};

export function AiSettingsPanel({
  settings,
  onUpdate,
  onSetApiKey,
  onClearApiKey,
  onGetApiKey,
  onTestProvider,
  onListModels,
  workspaceId,
  semanticStatus,
  onRefreshSemanticStatus,
  onTestEmbedding,
  onUpdateSemanticIndex,
  onResetSemanticIndex
}: AiSettingsPanelProps) {
  const { tr } = useRendererI18n();
  const [dialog, setDialog] = useState<{ mode: ModelDialogMode; draft: ModelDraft; original?: AiProviderProfilePublic } | undefined>();
  const [modelOptions, setModelOptions] = useState<AiModelDescriptor[]>([]);
  const [testResult, setTestResult] = useState<AiProviderTestResult | undefined>();
  const [embeddingResult, setEmbeddingResult] = useState<AiProviderTestResult | undefined>();
  const [embeddingApiKeyDraft, setEmbeddingApiKeyDraft] = useState(settings.embeddingHasApiKey ? API_KEY_MASK : "");
  const [embeddingApiKeyTouched, setEmbeddingApiKeyTouched] = useState(false);
  const [embeddingApiKeyVisible, setEmbeddingApiKeyVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [semanticBusy, setSemanticBusy] = useState<"test" | "update" | "reset" | undefined>();
  const [localSemanticStatus, setLocalSemanticStatus] = useState<AiSemanticIndexStatus | undefined>();
  const refreshSemanticStatusRef = useRef(onRefreshSemanticStatus);

  const embedding = useMemo(() => normalizeAiEmbeddingSettings(settings.embedding, DEFAULT_AI_EMBEDDING_SETTINGS), [settings.embedding]);
  const displayedSemanticStatus = localSemanticStatus ?? semanticStatus;
  const semanticUpdating = Boolean(displayedSemanticStatus?.progress);
  const usingLocalSecretStorage = settings.secretStorageBackend === "local-file";
  const activeEnabledProvider = useMemo(() => settings.providers.find((provider) => provider.id === settings.defaultProviderId && !provider.disabled), [settings.defaultProviderId, settings.providers]);
  const defaultProviderId = activeEnabledProvider?.id ?? settings.providers.find((provider) => !provider.disabled)?.id ?? settings.defaultProviderId;

  useEffect(() => {
    if (!dialog) {
      return;
    }
    const latest = settings.providers.find((provider) => provider.id === dialog.draft.id);
    if (!latest || latest === dialog.original) {
      return;
    }
    setDialog((current) => current ? { ...current, original: latest } : current);
  }, [dialog, settings.providers]);

  useEffect(() => {
    setEmbeddingApiKeyDraft(settings.embeddingHasApiKey ? API_KEY_MASK : "");
    setEmbeddingApiKeyTouched(false);
    setEmbeddingApiKeyVisible(false);
  }, [settings.embeddingHasApiKey, embedding.providerId]);

  useEffect(() => {
    refreshSemanticStatusRef.current = onRefreshSemanticStatus;
  }, [onRefreshSemanticStatus]);

  useEffect(() => {
    void refreshSemanticStatusRef.current?.();
  }, [workspaceId, embedding.enabled, embedding.providerId, embedding.model, embedding.baseUrl, embedding.apiMode]);

  useEffect(() => {
    setLocalSemanticStatus(undefined);
  }, [semanticStatus]);

  const updateProviders = (providers: Array<AiProviderProfile | AiProviderProfilePublic>, preferredDefaultId = defaultProviderId) => {
    const cleanProviders = providers.map(toProviderSettings);
    const nextDefaultProviderId =
      cleanProviders.find((provider) => provider.id === preferredDefaultId && !provider.disabled)?.id ??
      cleanProviders.find((provider) => !provider.disabled)?.id ??
      cleanProviders[0]?.id ??
      preferredDefaultId;
    return onUpdate({
      providers: cleanProviders,
      defaultProviderId: nextDefaultProviderId
    });
  };

  const openCreateDialog = () => {
    const next = createAiProviderProfile("openai-compatible", settings.providers.map((provider) => provider.id));
    setDialog({ mode: "create", draft: toDraft(next) });
    setModelOptions([]);
    setTestResult(undefined);
  };

  const openEditDialog = (provider: AiProviderProfilePublic) => {
    setDialog({ mode: "edit", original: provider, draft: toDraft(provider, provider.hasApiKey ? API_KEY_MASK : "") });
    setModelOptions([]);
    setTestResult(undefined);
  };

  const closeDialog = () => {
    setDialog(undefined);
    setModelOptions([]);
    setTestResult(undefined);
    setBusy(false);
  };

  const updateDraft = (patch: Partial<ModelDraft>) => {
    setDialog((current) => {
      if (!current) {
        return current;
      }
      const draft = normalizeDraftPatch(current.draft, patch);
      return { ...current, draft };
    });
    setTestResult(undefined);
    if ("providerId" in patch || "baseUrl" in patch || "apiMode" in patch || "apiKeyDraft" in patch) {
      setModelOptions([]);
    }
  };

  const saveDialog = () => {
    if (!dialog || busy) {
      return;
    }
    const provider = normalizeProviderForSave(dialog.draft);
    void runBusy(setBusy, async () => {
      setTestResult(undefined);
      try {
        const providers = dialog.mode === "create"
          ? [...settings.providers, provider]
          : settings.providers.map((item) => (item.id === provider.id ? { ...provider, hasApiKey: dialog.original?.hasApiKey ?? false } : item));
        await updateProviders(providers, provider.disabled ? defaultProviderId : provider.id);
        if (provider.providerId === "openai-compatible" && dialog.draft.apiKeyTouched) {
          const value = dialog.draft.apiKeyDraft.trim();
          if (!value || value === API_KEY_MASK) {
            await onClearApiKey(provider.id);
          } else {
            await onSetApiKey(provider.id, value);
          }
        }
        if (provider.providerId === "ollama") {
          await onClearApiKey(provider.id);
        }
        closeDialog();
      } catch (error) {
        setTestResult(errorResult(provider, error));
      }
    });
  };

  const deleteProvider = (provider: AiProviderProfilePublic) => {
    if (settings.providers.length <= 1 || busy) {
      return;
    }
    const providers = settings.providers.filter((item) => item.id !== provider.id);
    void runBusy(setBusy, async () => {
      await onClearApiKey(provider.id);
      await updateProviders(providers, settings.defaultProviderId === provider.id ? undefined : settings.defaultProviderId);
    });
  };

  const setDefaultProvider = (provider: AiProviderProfilePublic) => {
    if (provider.disabled) {
      return;
    }
    void onUpdate({ defaultProviderId: provider.id });
  };

  const setProviderDisabled = (provider: AiProviderProfilePublic, disabled: boolean) => {
    const providers = settings.providers.map((item) => (item.id === provider.id ? { ...item, disabled } : item));
    void updateProviders(providers, disabled && settings.defaultProviderId === provider.id ? undefined : settings.defaultProviderId);
  };

  const refreshDialogModels = () => {
    if (!dialog) {
      return;
    }
    void runBusy(setBusy, async () => {
      setTestResult(undefined);
      try {
        setModelOptions(await onListModels(normalizeProviderForSave(dialog.draft), draftApiKeyForRequest(dialog.draft)));
      } catch (error) {
        setModelOptions([]);
        setTestResult(errorResult(dialog.draft, error));
      }
    });
  };

  const testDialogProvider = () => {
    if (!dialog) {
      return;
    }
    void runBusy(setBusy, async () => {
      try {
        setTestResult(await onTestProvider(normalizeProviderForSave(dialog.draft), draftApiKeyForRequest(dialog.draft)));
      } catch (error) {
        setTestResult(errorResult(dialog.draft, error));
      }
    });
  };

  const updateEmbeddingSettings = (patch: Partial<AiEmbeddingSettings>) => {
    const providerId = patch.providerId ?? embedding.providerId;
    const next: AiEmbeddingSettings = {
      ...embedding,
      ...patch,
      providerId,
      apiMode: providerId === "ollama" ? "ollama-native" : "openai-embeddings",
      baseUrl: patch.baseUrl ?? (patch.providerId && patch.providerId !== embedding.providerId ? (providerId === "ollama" ? "http://localhost:11434" : "") : embedding.baseUrl)
    };
    setEmbeddingResult(undefined);
    void onUpdate({ embedding: next });
  };

  const saveEmbeddingSecretIfNeeded = async () => {
    if (embedding.providerId !== "openai-compatible") {
      await onClearApiKey(AI_EMBEDDING_SECRET_ID);
      return;
    }
    if (!embeddingApiKeyTouched) {
      return;
    }
    const value = embeddingApiKeyDraft.trim();
    if (!value || value === API_KEY_MASK) {
      await onClearApiKey(AI_EMBEDDING_SECRET_ID);
    } else {
      await onSetApiKey(AI_EMBEDDING_SECRET_ID, value);
    }
    setEmbeddingApiKeyTouched(false);
  };

  const testEmbedding = () => {
    if (!onTestEmbedding) {
      return;
    }
    void runSemanticBusy(setSemanticBusy, "test", async () => {
      await saveEmbeddingSecretIfNeeded();
      const apiKey = draftSemanticApiKeyForRequest(embeddingApiKeyDraft);
      setEmbeddingResult(await onTestEmbedding(embedding, apiKey));
      await onRefreshSemanticStatus?.(embedding, apiKey);
    });
  };

  const updateSemanticIndex = () => {
    if (!onUpdateSemanticIndex) {
      return;
    }
    void runSemanticBusy(setSemanticBusy, "update", async () => {
      await saveEmbeddingSecretIfNeeded();
      setEmbeddingResult(undefined);
      const apiKey = draftSemanticApiKeyForRequest(embeddingApiKeyDraft);
      const status = await onUpdateSemanticIndex(embedding, apiKey);
      setLocalSemanticStatus(status);
    });
  };

  const resetSemanticIndex = () => {
    if (!onResetSemanticIndex || !window.confirm(tr("清空现有语义索引并重新生成？这不会修改你的文档，但会重新调用 embedding 模型。"))) {
      return;
    }
    void runSemanticBusy(setSemanticBusy, "reset", async () => {
      await saveEmbeddingSecretIfNeeded();
      setEmbeddingResult(undefined);
      const apiKey = draftSemanticApiKeyForRequest(embeddingApiKeyDraft);
      const status = await onResetSemanticIndex(embedding, apiKey);
      setLocalSemanticStatus(status);
    });
  };

  useEffect(() => {
    if (!displayedSemanticStatus?.progress || !onRefreshSemanticStatus) {
      return undefined;
    }
    const apiKey = draftSemanticApiKeyForRequest(embeddingApiKeyDraft);
    const timer = window.setInterval(() => {
      void onRefreshSemanticStatus(embedding, apiKey);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [displayedSemanticStatus?.progress, embedding, embeddingApiKeyDraft, onRefreshSemanticStatus]);

  return (
    <div className="settings-tab-content ai-settings-panel">
      <section className="ai-settings-section ai-model-manager" aria-label={tr("模型管理")}>
        <header className="ai-section-title-row">
          <div>
            <strong>{tr("模型管理")}</strong>
            <p>{tr("配置 API key 添加更多可用模型，预置模型默认使用稳定版本。")}</p>
          </div>
          <div className="ai-title-actions">
            <label className="ai-inline-enable">
              <span>{tr("启用 AI")}</span>
              <input aria-label={tr("启用 AI")} type="checkbox" checked={settings.enabled} onChange={(event) => void onUpdate({ enabled: event.target.checked })} />
            </label>
            <button type="button" className="secondary-button" onClick={openCreateDialog}>
              <Plus size={16} /> {tr("添加模型")}
            </button>
          </div>
        </header>

        <div className="ai-local-inline" role="note">
          <Info size={15} />
          <span>{tr("添加的模型仅支持在 SOLO 本地环境中使用，暂不支持在云端环境中使用。")}</span>
        </div>

        <div className="ai-model-table" role="table" aria-label={tr("模型列表")}>
          <div className="ai-model-table-row ai-model-table-head" role="row">
            <span role="columnheader">{tr("模型")}</span>
            <span role="columnheader">{tr("服务商")}</span>
            <span role="columnheader">{tr("状态")}</span>
            <span role="columnheader">{tr("操作")}</span>
          </div>
          {settings.providers.map((provider) => (
            <div key={provider.id} className={`ai-model-table-row${provider.disabled ? " is-disabled" : ""}`} role="row">
              <div className="ai-model-name-cell" role="cell">
                <Box size={18} />
                <div>
                  <strong>{modelDisplayName(provider)}</strong>
                  <span>
                    {provider.model}
                    {provider.apiMode === "responses" ? ` · ${tr("Responses 格式")}` : provider.apiMode === "chat-completions" ? ` · ${tr("Chat Completions 格式")}` : ""}
                  </span>
                </div>
              </div>
              <span role="cell">{providerLabel(provider.providerId, tr)}</span>
              <span className={`ai-model-status${provider.disabled ? " is-disabled" : provider.id === defaultProviderId ? " is-default" : ""}`} role="cell">
                {provider.id === defaultProviderId && !provider.disabled ? tr("默认") : provider.disabled ? tr("已禁用") : tr("可用")}
              </span>
              <div className="ai-model-actions" role="cell">
                <button type="button" className="icon-button" title={tr("编辑模型")} aria-label={tr("编辑模型")} onClick={() => openEditDialog(provider)}>
                  <Edit3 size={15} />
                </button>
                <button type="button" className="icon-button" title={tr("删除模型")} aria-label={tr("删除模型")} disabled={settings.providers.length <= 1 || busy} onClick={() => deleteProvider(provider)}>
                  <Trash2 size={15} />
                </button>
                <button type="button" className="ai-toggle" role="switch" aria-label={tr("启用模型 {model}", { model: modelDisplayName(provider) })} aria-checked={!provider.disabled} onClick={() => setProviderDisabled(provider, !provider.disabled)}>
                  <span />
                </button>
                <button type="button" className="icon-button" title={tr("默认")} aria-label={tr("默认")} disabled={provider.disabled || provider.id === defaultProviderId} onClick={() => setDefaultProvider(provider)}>
                  <Check size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="ai-settings-section ai-semantic-section" aria-label={tr("语义索引")}>
        <header className="ai-section-title-row">
          <div>
            <strong>{tr("语义索引")}</strong>
            <p>{tr("手动配置 embedding 模型后创建索引；AI 回答前仍会读取当前文件内容做校验。")}</p>
          </div>
          <div className="ai-title-actions">
            <button type="button" className="secondary-button" disabled={!workspaceId || semanticBusy === "update" || semanticBusy === "reset" || semanticUpdating} onClick={updateSemanticIndex}>
              <RefreshCw size={14} /> {tr("创建/更新语义索引")}
            </button>
            <button type="button" className="secondary-button" disabled={!workspaceId || semanticBusy === "update" || semanticBusy === "reset" || semanticUpdating} onClick={resetSemanticIndex}>
              <RotateCcw size={14} /> {tr("清空并重建")}
            </button>
          </div>
        </header>

        <div className="ai-semantic-grid">
          <label className="setting-row ai-semantic-toggle-row">
            <span>{tr("启用语义检索")}</span>
            <span className="ai-semantic-toggle-control">
              <input aria-label={tr("启用语义检索")} type="checkbox" checked={embedding.enabled} onChange={(event) => updateEmbeddingSettings({ enabled: event.target.checked })} />
            </span>
          </label>
          <label className="setting-row">
            <span>{tr("Embedding 服务商")}</span>
            <select value={embedding.providerId} onChange={(event) => updateEmbeddingSettings({ providerId: event.target.value as AiProviderId, model: "" })}>
              <option value="ollama">Ollama</option>
              <option value="openai-compatible">OpenAI Compatible</option>
            </select>
          </label>
          <label className="setting-row ai-model-field-span">
            <span>{tr("Embedding 地址")}</span>
            <input value={embedding.baseUrl} onChange={(event) => updateEmbeddingSettings({ baseUrl: event.target.value })} placeholder={embedding.providerId === "ollama" ? "http://localhost:11434" : "https://api.example.com/v1"} />
          </label>
          <label className="setting-row">
            <span>{tr("Embedding 模型")}</span>
            <input value={embedding.model} onChange={(event) => updateEmbeddingSettings({ model: event.target.value })} placeholder={embedding.providerId === "ollama" ? "nomic-embed-text" : "text-embedding-3-small"} />
          </label>
          <label className="setting-row">
            <span>{tr("索引状态")}</span>
            <span className={`ai-semantic-status is-${displayedSemanticStatus?.state ?? "not_created"}`}>
              <Search size={14} /> {semanticStatusLabel(displayedSemanticStatus, tr)}
            </span>
          </label>
          {embedding.providerId === "openai-compatible" ? (
            <div className="setting-row ai-model-field-span">
              <span>Embedding API key</span>
              <div className="ai-secret-field">
                <input
                  aria-label="Embedding API key"
                  type={embeddingApiKeyVisible ? "text" : "password"}
                  value={embeddingApiKeyDraft}
                  onFocus={(event) => {
                    if (embeddingApiKeyDraft === API_KEY_MASK) {
                      event.currentTarget.select();
                    }
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (embeddingApiKeyDraft === API_KEY_MASK && isApiKeyMaskEdit(value)) {
                      return;
                    }
                    setEmbeddingApiKeyDraft(value);
                    setEmbeddingApiKeyTouched(true);
                  }}
                  placeholder={settings.embeddingHasApiKey ? tr("已保存") : tr("输入 API key")}
                />
                <button
                  type="button"
                  className="icon-button ai-secret-toggle"
                  aria-label={embeddingApiKeyVisible ? tr("隐藏密钥") : tr("显示密钥")}
                  title={embeddingApiKeyVisible ? tr("隐藏密钥") : tr("显示密钥")}
                  onClick={() => {
                    if (embeddingApiKeyVisible) {
                      setEmbeddingApiKeyVisible(false);
                      return;
                    }
                    if (embeddingApiKeyDraft !== API_KEY_MASK) {
                      setEmbeddingApiKeyVisible(true);
                      return;
                    }
                    void onGetApiKey(AI_EMBEDDING_SECRET_ID).then((apiKey) => {
                      if (apiKey) {
                        setEmbeddingApiKeyDraft(apiKey);
                        setEmbeddingApiKeyTouched(false);
                        setEmbeddingApiKeyVisible(true);
                      }
                    });
                  }}
                >
                  {embeddingApiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          ) : null}
          {usingLocalSecretStorage ? <div className="plugin-empty-state is-warning ai-model-field-span">{tr("系统安全存储不可用，API key 将保存到本机配置文件。")}</div> : null}
        </div>

        <div className="ai-semantic-summary">
          <span>{tr("文件：{indexed}/{total}", { indexed: displayedSemanticStatus?.indexedFiles ?? 0, total: displayedSemanticStatus?.totalFiles ?? 0 })}</span>
          <span>{tr("分块：{count}", { count: displayedSemanticStatus?.chunkCount ?? 0 })}</span>
          <span>{tr("过期：{count}", { count: displayedSemanticStatus?.staleFiles ?? 0 })}</span>
          {displayedSemanticStatus?.progress ? <span>{tr("进度：{current}/{total}", { current: displayedSemanticStatus.progress.current, total: displayedSemanticStatus.progress.total })}</span> : null}
        </div>

        <div className="ai-model-dialog-tools">
          <button type="button" className="secondary-button" disabled={semanticBusy === "test" || !embedding.model.trim()} onClick={testEmbedding}>
            <TestTube2 size={14} /> {tr("测试 embedding")}
          </button>
          <button type="button" className="secondary-button" disabled={!onRefreshSemanticStatus || semanticBusy !== undefined} onClick={() => void onRefreshSemanticStatus?.()}>
            <RefreshCw size={14} /> {tr("检查索引状态")}
          </button>
        </div>
        {embeddingResult ? <div className={`plugin-empty-state ${embeddingResult.ok ? "is-ok" : "is-warning"}`} role="status">{embeddingResult.message}</div> : null}
        {displayedSemanticStatus?.error ? <div className="plugin-empty-state is-warning" role="status">{displayedSemanticStatus.error}</div> : null}
      </section>

      <section className="ai-settings-section ai-security-section">
        <header className="ai-section-title-row">
          <strong>{tr("上下文与安全")}</strong>
          <p>{tr("这些开关决定 AI 可以读取哪些本地上下文；所有写入仍需要你确认。")}</p>
        </header>
        <div className="ai-permission-list">
          <label className="setting-row setting-row-with-copy">
            <span>
              <strong>{tr("多轮上下文")}</strong>
              <small>{tr("每次请求会携带最近 N 轮用户与 AI 对话；轮数越多，token 消耗越高。")}</small>
            </span>
            <input
              aria-label={tr("多轮上下文")}
              type="number"
              min={0}
              max={MAX_CONVERSATION_HISTORY_TURNS}
              step={1}
              inputMode="numeric"
              value={settings.conversationHistoryTurns}
              onChange={(event) => void onUpdate({ conversationHistoryTurns: normalizeConversationHistoryInput(event.currentTarget.value) })}
            />
            <small>{tr("0 表示关闭，最多 {count} 轮。", { count: MAX_CONVERSATION_HISTORY_TURNS })}</small>
          </label>
          <label className="setting-row setting-row-with-copy">
            <span>
              <strong>{tr("允许发送当前笔记正文")}</strong>
              <small>{tr("仅在当前会话需要上下文时发送给默认 Provider。")}</small>
            </span>
            <input aria-label={tr("允许发送当前笔记正文")} type="checkbox" checked={settings.allowCurrentNoteContent} onChange={(event) => void onUpdate({ allowCurrentNoteContent: event.target.checked })} />
          </label>
          <label className="setting-row setting-row-with-copy">
            <span>
              <strong>{tr("允许搜索笔记")}</strong>
              <small>{tr("AI 只能通过本地索引搜索 Markdown 笔记；不会遍历或读取整个工作目录。搜索结果标题和片段可能发送给 Provider。")}</small>
            </span>
            <input
              aria-label={tr("允许搜索笔记")}
              type="checkbox"
              checked={settings.allowWorkspaceSearch}
              onChange={(event) => void onUpdate(event.target.checked ? { allowWorkspaceSearch: true } : { allowWorkspaceSearch: false, allowReadSearchResults: false })}
            />
          </label>
          <label className="setting-row setting-row-with-copy">
            <span>
              <strong>{tr("允许读取搜索命中笔记摘录")}</strong>
              <small>{tr("开启后，AI 只能读取本轮搜索命中的 Markdown 笔记摘录；不能读取未命中的文件或整个工作目录。")}</small>
            </span>
            <input
              aria-label={tr("允许读取搜索命中笔记摘录")}
              type="checkbox"
              checked={settings.allowWorkspaceSearch && settings.allowReadSearchResults}
              disabled={!settings.allowWorkspaceSearch}
              onChange={(event) => void onUpdate({ allowReadSearchResults: event.target.checked })}
            />
          </label>
          <label className="setting-row setting-row-with-copy">
            <span>
              <strong>{tr("允许读取整个工作区")}</strong>
              <small>{tr("AI 可以列出并读取工作区内的文本和 Markdown 文件；仍会跳过 .nolia、.git、node_modules 等内部目录。")}</small>
            </span>
            <input
              aria-label={tr("允许读取整个工作区")}
              type="checkbox"
              checked={settings.allowWorkspaceRead}
              onChange={(event) => void onUpdate(event.target.checked ? { allowWorkspaceRead: true } : { allowWorkspaceRead: false, allowWorkspaceOperations: false })}
            />
          </label>
          <label className="setting-row setting-row-with-copy">
            <span>
              <strong>{tr("允许提出工作区操作")}</strong>
              <small>{tr("AI 只能生成待确认的创建或修改方案；确认后写入前会创建历史版本，可从历史版本回滚。")}</small>
            </span>
            <input
              aria-label={tr("允许提出工作区操作")}
              type="checkbox"
              checked={settings.allowWorkspaceRead && settings.allowWorkspaceOperations}
              disabled={!settings.allowWorkspaceRead}
              onChange={(event) => void onUpdate({ allowWorkspaceOperations: event.target.checked })}
            />
          </label>
          <label className="setting-row setting-row-with-copy">
            <span>
              <strong>{tr("写入前必须确认")}</strong>
              <small>{tr("AI 只能生成建议，替换、插入、追加和创建文件都必须由你点击确认。")}</small>
            </span>
            <input type="checkbox" checked disabled />
          </label>
        </div>
        <p className="ai-context-note">
          {settings.activeProvider.providerId === "ollama" ? tr("本地 Ollama 请求发送到你的本机服务。") : tr("云端 Provider 可能会接收当前笔记、选中文本、搜索结果标题和片段、搜索命中摘录，以及授权读取的工作区文件摘录。")}
        </p>
      </section>

      {dialog ? (
        <ModelDialog
          mode={dialog.mode}
          draft={dialog.draft}
          busy={busy}
          modelOptions={modelOptions}
          testResult={testResult}
          usingLocalSecretStorage={usingLocalSecretStorage}
          onUpdate={updateDraft}
          onRefreshModels={refreshDialogModels}
          onTestProvider={testDialogProvider}
          onRevealApiKey={async () => {
            try {
              const apiKey = await onGetApiKey(dialog.draft.id);
              if (!apiKey) {
                setTestResult({ ok: false, providerId: dialog.draft.providerId, model: dialog.draft.model, localOnly: false, message: tr("未找到已保存的 API key。") });
              }
              return apiKey;
            } catch (error) {
              setTestResult(errorResult(dialog.draft, error));
              return undefined;
            }
          }}
          onCancel={closeDialog}
          onSave={saveDialog}
        />
      ) : null}
    </div>
  );
}

function ModelDialog({
  mode,
  draft,
  busy,
  modelOptions,
  testResult,
  usingLocalSecretStorage,
  onUpdate,
  onRefreshModels,
  onTestProvider,
  onRevealApiKey,
  onCancel,
  onSave
}: {
  mode: ModelDialogMode;
  draft: ModelDraft;
  busy: boolean;
  modelOptions: AiModelDescriptor[];
  testResult?: AiProviderTestResult;
  usingLocalSecretStorage: boolean;
  onUpdate: (patch: Partial<ModelDraft>) => void;
  onRefreshModels: () => void;
  onTestProvider: () => void;
  onRevealApiKey: () => Promise<string | undefined>;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { tr } = useRendererI18n();
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyRevealBusy, setApiKeyRevealBusy] = useState(false);
  const confirmDisabled = busy || !draft.model.trim() || !draft.baseUrl.trim();
  const toggleApiKeyVisible = () => {
    if (apiKeyVisible) {
      setApiKeyVisible(false);
      return;
    }
    if (draft.apiKeyDraft !== API_KEY_MASK) {
      setApiKeyVisible(true);
      return;
    }
    setApiKeyRevealBusy(true);
    void onRevealApiKey()
      .then((apiKey) => {
        if (apiKey) {
          onUpdate({ apiKeyDraft: apiKey, apiKeyTouched: false });
          setApiKeyVisible(true);
        }
      })
      .finally(() => setApiKeyRevealBusy(false));
  };

  return (
    <div className="modal-layer ai-model-modal-layer" role="dialog" aria-modal="true" aria-label={mode === "create" ? tr("添加模型") : tr("编辑模型")}>
      <button type="button" className="modal-backdrop" aria-label={tr("取消")} onClick={onCancel} />
      <section className="modal-surface ai-model-dialog">
        <header className="ai-model-dialog-header">
          <div>
            <strong>{mode === "create" ? tr("添加模型") : tr("编辑模型")}</strong>
            <span>{tr("配置 Provider、模型、上下文权限和写入确认。")}</span>
          </div>
          <button type="button" className="icon-button" aria-label={tr("取消")} onClick={onCancel}>
            <X size={20} />
          </button>
        </header>

        <div className="ai-model-dialog-body">
          <label className="setting-row ai-model-field-half">
            <span><RequiredMark /> {tr("服务商")}</span>
            <select value={draft.providerId} onChange={(event) => onUpdate({ providerId: event.target.value as AiProviderId })}>
              <option value="openai-compatible">OpenAI Compatible</option>
              <option value="ollama">Ollama</option>
            </select>
          </label>

          <label className="setting-row ai-model-field-half">
            <span><RequiredMark /> {tr("API 格式")}</span>
            <select value={draft.apiMode} disabled={draft.providerId === "ollama"} onChange={(event) => onUpdate({ apiMode: event.target.value as AiApiMode })}>
              {draft.providerId === "ollama" ? <option value="ollama-native">Ollama native</option> : null}
              {draft.providerId === "openai-compatible" ? <option value="chat-completions">{tr("OpenAI Chat Completions 格式")}</option> : null}
              {draft.providerId === "openai-compatible" ? <option value="responses">{tr("OpenAI Responses 格式")}</option> : null}
            </select>
          </label>

          <label className="setting-row ai-model-field-span">
            <span><RequiredMark /> {tr("自定义请求地址")}</span>
            <input value={draft.baseUrl} onChange={(event) => onUpdate({ baseUrl: event.target.value })} placeholder={draft.providerId === "ollama" ? "http://localhost:11434" : "https://api.example.com/v1"} />
            {draft.providerId === "openai-compatible" && draft.apiMode === "chat-completions" ? (
              <small>{tr("请填写兼容 OpenAI API 的 /v1 服务端地址，不要以斜杠结尾。/chat/completions 将会被补充到你填写的地址末尾。")}</small>
            ) : null}
          </label>

          <label className="setting-row ai-model-field-span">
            <span><RequiredMark /> {tr("模型 ID")}</span>
            {modelOptions.length ? (
              <select value={draft.model} onChange={(event) => onUpdate({ model: event.target.value })}>
                <option value="">{tr("选择模型")}</option>
                {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.label ?? model.id}</option>)}
                {draft.model && !modelOptions.some((model) => model.id === draft.model) ? <option value={draft.model}>{draft.model}</option> : null}
              </select>
            ) : (
              <input value={draft.model} onChange={(event) => onUpdate({ model: event.target.value })} placeholder={draft.providerId === "ollama" ? "llama3.2" : "gpt-4.1"} />
            )}
          </label>

          <label className="setting-row ai-model-field-span">
            <span>{tr("模型别名")}</span>
            <input value={draft.alias ?? ""} onChange={(event) => onUpdate({ alias: event.target.value })} maxLength={32} placeholder={draft.model || tr("未设置时显示模型 ID")} />
          </label>

          {draft.providerId === "openai-compatible" ? (
            <>
              <div className="setting-row ai-model-field-span">
                <span><RequiredMark /> API key</span>
                <div className="ai-secret-field">
                  <input
                    aria-label="API key"
                    type={apiKeyVisible ? "text" : "password"}
                    value={draft.apiKeyDraft}
                    onFocus={(event) => {
                      if (draft.apiKeyDraft === API_KEY_MASK) {
                        event.currentTarget.select();
                      }
                    }}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (draft.apiKeyDraft === API_KEY_MASK && isApiKeyMaskEdit(value)) {
                        return;
                      }
                      onUpdate({ apiKeyDraft: value, apiKeyTouched: true });
                    }}
                    placeholder={draft.apiKeyDraft === API_KEY_MASK ? tr("已保存") : tr("输入 API key")}
                  />
                  <button
                    type="button"
                    className="icon-button ai-secret-toggle"
                    aria-label={apiKeyVisible ? tr("隐藏密钥") : tr("显示密钥")}
                    title={apiKeyVisible ? tr("隐藏密钥") : tr("显示密钥")}
                    disabled={apiKeyRevealBusy}
                    onClick={toggleApiKeyVisible}
                  >
                    {apiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              {usingLocalSecretStorage ? <div className="plugin-empty-state is-warning ai-model-field-span">{tr("系统安全存储不可用，API key 将保存到本机配置文件。")}</div> : null}
            </>
          ) : (
            <p className="ai-context-note ai-model-field-span">{tr("本地 Ollama 不需要 API key，Nolia 只会请求你的本机服务。")}</p>
          )}

          <div className="ai-model-dialog-tools ai-model-field-span">
            <button type="button" className="secondary-button" disabled={busy} onClick={onRefreshModels}>
              <RefreshCw size={14} /> {tr("刷新模型")}
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={onTestProvider}>
              <TestTube2 size={14} /> {tr("测试连接")}
            </button>
          </div>
          {testResult ? <div className={`plugin-empty-state ${testResult.ok ? "is-ok" : "is-warning"} ai-model-field-span`} role="status">{testResult.message}</div> : null}
        </div>

        <footer className="ai-model-dialog-footer">
          <button type="button" className="secondary-button" onClick={onCancel}>
            {tr("取消")}
          </button>
          <button type="button" className="primary-button" disabled={confirmDisabled} onClick={onSave}>
            {tr("确认")}
          </button>
        </footer>
      </section>
    </div>
  );
}

const API_KEY_MASK = "********";

function RequiredMark() {
  return <span className="ai-required-mark">*</span>;
}

function toDraft(provider: AiProviderProfile | AiProviderProfilePublic, apiKeyDraft = ""): ModelDraft {
  return {
    id: provider.id,
    name: provider.name,
    alias: provider.alias,
    providerId: provider.providerId,
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiMode: provider.apiMode,
    disabled: Boolean(provider.disabled),
    apiKeyDraft,
    apiKeyTouched: false
  };
}

function normalizeDraftPatch(draft: ModelDraft, patch: Partial<ModelDraft>): ModelDraft {
  const providerId = patch.providerId ?? draft.providerId;
  const providerChanged = patch.providerId && patch.providerId !== draft.providerId;
  const model = patch.model ?? (providerChanged ? "" : draft.model);
  const baseUrl = patch.baseUrl ?? (providerChanged ? (providerId === "ollama" ? "http://localhost:11434" : "") : draft.baseUrl);
  const apiMode = providerId === "ollama" ? "ollama-native" : patch.apiMode === "responses" ? "responses" : "chat-completions";
  return {
    ...draft,
    ...patch,
    providerId,
    model,
    name: patch.name ?? (providerChanged ? createAiProviderProfile(providerId).name : draft.name),
    baseUrl,
    apiMode,
    apiKeyDraft: providerId === "ollama" ? "" : patch.apiKeyDraft ?? (providerChanged ? "" : draft.apiKeyDraft),
    apiKeyTouched: patch.apiKeyTouched ?? (providerChanged ? true : draft.apiKeyTouched)
  };
}

function normalizeProviderForSave(draft: ModelDraft): AiProviderProfile {
  const model = draft.model.trim();
  const name = draft.name.trim() || createAiProviderProfile(draft.providerId).name;
  const alias = draft.alias?.trim();
  return {
    id: draft.id,
    name,
    alias: alias || undefined,
    providerId: draft.providerId,
    model,
    baseUrl: draft.baseUrl.trim() || (draft.providerId === "ollama" ? "http://localhost:11434" : ""),
    apiMode: draft.providerId === "ollama" ? "ollama-native" : draft.apiMode === "responses" ? "responses" : "chat-completions",
    disabled: Boolean(draft.disabled)
  };
}

function draftApiKeyForRequest(draft: ModelDraft): string | undefined {
  const value = draft.apiKeyDraft.trim();
  return value && value !== API_KEY_MASK ? value : undefined;
}

function toProviderSettings(provider: AiProviderProfile | AiProviderProfilePublic): AiProviderProfile {
  return {
    id: provider.id,
    name: provider.name,
    alias: provider.alias,
    providerId: provider.providerId,
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiMode: provider.apiMode,
    disabled: Boolean(provider.disabled)
  };
}

function errorResult(provider: AiProviderProfile, error: unknown): AiProviderTestResult {
  return {
    ok: false,
    providerId: provider.providerId,
    model: provider.model,
    localOnly: provider.providerId === "ollama",
    message: error instanceof Error ? error.message : String(error)
  };
}

function isApiKeyMaskEdit(value: string): boolean {
  return value.length > 0 && value.length <= API_KEY_MASK.length && API_KEY_MASK.startsWith(value);
}

function normalizeConversationHistoryInput(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(MAX_CONVERSATION_HISTORY_TURNS, Math.trunc(parsed)));
}

function modelDisplayName(provider: AiProviderProfile): string {
  const name = provider.alias?.trim();
  const model = provider.model.trim();
  return name || model || "Untitled model";
}

function providerLabel(providerId: AiProviderId, tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  return providerId === "ollama" ? "Ollama" : tr("自定义(OpenAI Compatible)");
}

function draftSemanticApiKeyForRequest(value: string): string | undefined {
  const clean = value.trim();
  return clean && clean !== API_KEY_MASK ? clean : undefined;
}

function semanticStatusLabel(status: AiSemanticIndexStatus | undefined, tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  if (!status) {
    return tr("未读取");
  }
  if (status.state === "ready") {
    return tr("可用");
  }
  if (status.state === "updating") {
    return tr("更新中");
  }
  if (status.state === "stale") {
    return tr("需要更新");
  }
  if (status.state === "failed") {
    return tr("失败");
  }
  if (status.state === "not_configured") {
    return tr("未配置");
  }
  return tr("未创建");
}

async function runBusy(setBusy: (value: boolean) => void, task: () => Promise<void>): Promise<void> {
  setBusy(true);
  try {
    await task();
  } finally {
    setBusy(false);
  }
}

async function runSemanticBusy(setBusy: (value: "test" | "update" | "reset" | undefined) => void, value: "test" | "update" | "reset", task: () => Promise<void>): Promise<void> {
  setBusy(value);
  try {
    await task();
  } finally {
    setBusy(undefined);
  }
}
