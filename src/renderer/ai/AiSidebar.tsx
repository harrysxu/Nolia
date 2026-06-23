import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Copy, RefreshCw, Send, Settings, Sparkles, Square, Wrench, X } from "lucide-react";

import type { AiErrorCode, AiPatchOperation, AiPatchProposal, AiProviderProfile, AiSettingsPublic, AiSourceRef } from "../../shared/ai";
import { renderMarkdownToHtml } from "../../shared/markdown";
import { useRendererI18n } from "../app/i18n";
import { MarkdownPreview } from "../components/MarkdownPreview";

export interface AiMessageView {
  id: string;
  role: "user" | "assistant" | "event" | "error";
  text: string;
  errorCode?: AiErrorCode;
  retryable?: boolean;
}

type AiMessageRenderItem =
  | { kind: "message"; message: AiMessageView }
  | { kind: "events"; id: string; messages: AiMessageView[] };

interface AiSidebarProps {
  open: boolean;
  settings?: AiSettingsPublic;
  activeRunId?: string;
  running: boolean;
  messages: AiMessageView[];
  sources: AiSourceRef[];
  patchProposal?: AiPatchProposal;
  patchApplyMode?: "current-document" | "new-document";
  contextSummary: string[];
  onClose: () => void;
  onOpenSettings: () => void;
  onUpdateDefaultProvider: (patch: Partial<AiProviderProfile> & { defaultProviderId?: string }) => void;
  onSend: (message: string, intent?: "summarize-current-note") => void;
  onCancel: () => void;
  onRetry: () => void;
  canRetry?: boolean;
  onCopy: (text: string) => void;
  onApplyPatch: (proposal: AiPatchProposal, mode: "replace" | "insert" | "append" | "new-document") => void | Promise<void>;
  onDiscardPatch: () => void;
}

export function AiSidebar({
  open,
  settings,
  running,
  messages,
  sources,
  patchProposal,
  patchApplyMode = "current-document",
  contextSummary,
  onClose,
  onOpenSettings,
  onUpdateDefaultProvider,
  onSend,
  onCancel,
  onRetry,
  canRetry = false,
  onCopy,
  onApplyPatch,
  onDiscardPatch
}: AiSidebarProps) {
  const { tr } = useRendererI18n();
  const [draft, setDraft] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToLatestRef = useRef(true);
  const updateStickToLatest = useCallback(() => {
    const list = messageListRef.current;
    if (!list) {
      shouldStickToLatestRef.current = true;
      return true;
    }
    const distanceFromBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
    const shouldStick = distanceFromBottom <= 48;
    shouldStickToLatestRef.current = shouldStick;
    return shouldStick;
  }, []);
  const scrollMessagesToLatest = useCallback(() => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }
    list.scrollTop = list.scrollHeight;
    shouldStickToLatestRef.current = true;
  }, []);
  const scrollMessagesToLatestIfSticky = useCallback(() => {
    if (shouldStickToLatestRef.current) {
      scrollMessagesToLatest();
    }
  }, [scrollMessagesToLatest]);
  const assistantText = useMemo(() => messages.filter((message) => message.role === "assistant").map((message) => message.text).join("\n\n"), [messages]);
  const enabled = Boolean(settings?.enabled);
  const activeProvider = settings?.activeProvider;
  const modelOptions = useMemo(() => {
    if (!settings) {
      return [];
    }
    return settings.providers.filter((provider) => !provider.disabled && provider.model.trim()).map((provider) => ({
      value: provider.id,
      label: modelDisplayName(provider)
    }));
  }, [settings]);
  const selectedModelOption = activeProvider?.model.trim() && modelOptions.some((option) => option.value === activeProvider.id) ? activeProvider.id : "";
  const hasConversation = messages.length > 0 || sources.length > 0 || Boolean(patchProposal);
  const canRunRetry = enabled && !running && canRetry;
  const lastUserMessageIndex = findLastMessageIndex(messages, "user");
  const hasAssistantAfterLastUser = messages.slice(lastUserMessageIndex + 1).some((message) => message.role === "assistant");
  const renderItems = useMemo(() => groupAiMessagesForRender(messages), [messages]);
  const composerNote = enabled
    ? contextSummary.length
      ? tr("将使用：{items}", { items: contextSummary.join(" · ") })
      : tr("当前会话暂无可发送上下文。")
    : tr("AI 已禁用，打开设置后继续。");
  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      scrollMessagesToLatestIfSticky();
    });
    const lateFrame = window.setTimeout(scrollMessagesToLatestIfSticky, 80);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(lateFrame);
    };
  }, [messages, sources, patchProposal, running, open, scrollMessagesToLatestIfSticky, updateStickToLatest]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!open || !list) {
      return;
    }
    let frame = 0;
    const scheduleScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(scrollMessagesToLatestIfSticky);
    };
    const resizeObserver = new ResizeObserver(scheduleScroll);
    const observeChildren = () => {
      resizeObserver.disconnect();
      resizeObserver.observe(list);
      Array.from(list.children).forEach((child) => resizeObserver.observe(child));
    };
    const mutationObserver = new MutationObserver(() => {
      observeChildren();
      scheduleScroll();
    });
    observeChildren();
    mutationObserver.observe(list, { childList: true, subtree: true, characterData: true });
    list.addEventListener("scroll", updateStickToLatest, { passive: true });
    updateStickToLatest();
    scheduleScroll();
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      list.removeEventListener("scroll", updateStickToLatest);
    };
  }, [open, scrollMessagesToLatestIfSticky, updateStickToLatest]);

  if (!open) {
    return null;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value || running || !enabled) {
      return;
    }
    setDraft("");
    onSend(value, isCurrentNoteSummaryRequest(value) ? "summarize-current-note" : undefined);
  };
  return (
    <section className="ai-sidebar" aria-label={tr("Nolia AI")}>
      <header className="ai-sidebar-header">
        <div>
          <strong><Sparkles size={16} /> {tr("Nolia AI")}</strong>
        </div>
        <div className="ai-header-actions">
          <button type="button" className="icon-button" title={tr("AI 设置")} aria-label={tr("AI 设置")} onClick={onOpenSettings}>
            <Settings size={16} />
          </button>
          <button type="button" className="icon-button" title={tr("关闭 AI")} aria-label={tr("关闭 AI")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>
      <div ref={messageListRef} className="ai-message-list">
        {!enabled && !hasConversation ? (
          <div className="ai-empty-state">
            <strong>{tr("启用 Nolia AI")}</strong>
            <span>{tr("选择本地 Ollama 或 OpenAI-compatible Provider 后即可开始。")}</span>
            <button type="button" className="primary-button" onClick={onOpenSettings}>{tr("打开 AI 设置")}</button>
          </div>
        ) : null}
        {!enabled && hasConversation ? (
          <section className="ai-inline-warning">
            <strong>{tr("AI 已禁用，历史内容仍可查看。")}</strong>
            <span>{tr("重新启用后可以继续发送和重试。")}</span>
            <button type="button" className="secondary-button" onClick={onOpenSettings}>{tr("打开 AI 设置")}</button>
          </section>
        ) : null}
        {renderItems.map((item) => (
          item.kind === "events" ? (
            <AiToolEventGroup key={item.id} messages={item.messages} />
          ) : item.message.role === "error" ? (
            <AiErrorMessage
              key={item.message.id}
              message={item.message}
              enabled={enabled}
              running={running}
              canRetry={canRunRetry && item.message.retryable !== false}
              hasPatchProposal={Boolean(patchProposal)}
              onOpenSettings={onOpenSettings}
              onRetry={onRetry}
              onCopy={onCopy}
            />
          ) : (
            <article key={item.message.id} className={`ai-message is-${item.message.role}`}>
              {item.message.role === "assistant" ? <AiMarkdownContent text={item.message.text} renderDiagrams={!running} /> : <pre>{item.message.text}</pre>}
            </article>
          )
        ))}
        {running && !hasAssistantAfterLastUser ? (
          <article className="ai-message is-assistant is-pending" role="status">
            <pre>{tr("正在生成回复...")}</pre>
          </article>
        ) : null}
        {sources.length ? (
          <details className="ai-sources">
            <summary>
              <strong>{tr("来源")}</strong>
              <span>{sources.length}</span>
            </summary>
            {sources.map((source, index) => (
              <span
                key={`${source.pathRel ?? source.title ?? source.kind}:${index}`}
                className="ai-source-chip"
                title={source.snippet ?? source.pathRel ?? source.title ?? source.kind}
              >
                <strong>{sourceKindLabel(source.kind, tr)}</strong>
                <span>{sourceTitle(source, tr)}</span>
              </span>
            ))}
          </details>
        ) : null}
        {patchProposal ? (
          <AiPatchPreview
            proposal={patchProposal}
            applyMode={patchApplyMode}
            canRetry={canRunRetry}
            onCopy={onCopy}
            onApply={onApplyPatch}
            onDiscard={onDiscardPatch}
            onRetry={onRetry}
          />
        ) : null}
      </div>
      <form className="ai-composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={enabled ? tr("询问 Nolia AI...") : tr("AI 已禁用")}
          disabled={!enabled}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !isComposing && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              submit(event);
            }
          }}
        />
        {settings ? (
          <div className="ai-composer-model-row">
            <label>
              {modelOptions.length ? (
                <select
                  aria-label={tr("模型")}
                  value={selectedModelOption}
                  onChange={(event) => {
                    if (event.target.value) {
                      onUpdateDefaultProvider({ defaultProviderId: event.target.value });
                    }
                  }}
                  disabled={!enabled || running}
                >
                  <option value="">{tr("选择模型")}</option>
                  {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <input
                  aria-label={tr("模型")}
                  value={activeProvider?.model ?? ""}
                  placeholder={tr("输入模型名称")}
                  disabled={!enabled || running}
                  onChange={(event) => onUpdateDefaultProvider({ model: event.target.value })}
                />
              )}
            </label>
          </div>
        ) : null}
        <p className="ai-composer-note">{composerNote}</p>
        <div className="ai-composer-actions">
          <button type="button" className="secondary-button" disabled={!assistantText} onClick={() => onCopy(assistantText)}>
            <Copy size={14} /> {tr("复制")}
          </button>
          <button type="button" className="secondary-button" disabled={!canRunRetry} onClick={onRetry}>
            <RefreshCw size={14} /> {tr("重试")}
          </button>
          {running ? (
            <button type="button" className="primary-button" onClick={onCancel}>
              <Square size={14} /> {tr("停止")}
            </button>
          ) : (
            <button type="submit" className="primary-button" disabled={!settings?.enabled || !draft.trim()}>
              <Send size={14} /> {tr("发送")}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function AiErrorMessage({
  message,
  enabled,
  running,
  canRetry,
  hasPatchProposal,
  onOpenSettings,
  onRetry,
  onCopy
}: {
  message: AiMessageView;
  enabled: boolean;
  running: boolean;
  canRetry: boolean;
  hasPatchProposal: boolean;
  onOpenSettings: () => void;
  onRetry: () => void;
  onCopy: (text: string) => void;
}) {
  const { tr } = useRendererI18n();
  return (
    <article className="ai-message ai-error-card is-error">
      <header>
        <strong><AlertTriangle size={15} /> {tr("AI 运行失败")}</strong>
        {message.errorCode ? <span>{tr("错误代码：{code}", { code: message.errorCode })}</span> : null}
      </header>
      <pre>{message.text}</pre>
      {hasPatchProposal ? <p>{tr("当前建议修改仍可查看；重新生成需要先恢复 AI 连接。")}</p> : null}
      <div className="ai-message-actions">
        <button type="button" className="secondary-button" onClick={onOpenSettings}>{tr("打开 AI 设置")}</button>
        <button type="button" className="secondary-button" disabled={!enabled || running || !canRetry} onClick={onRetry}>
          <RefreshCw size={14} /> {tr("重试")}
        </button>
        <button type="button" className="secondary-button" onClick={() => onCopy(message.text)}>
          <Copy size={14} /> {tr("复制错误")}
        </button>
      </div>
    </article>
  );
}

function AiToolEventGroup({ messages }: { messages: AiMessageView[] }) {
  const { tr } = useRendererI18n();
  return (
    <details className="ai-tool-events">
      <summary>
        <Wrench size={14} />
        <strong>{tr("工具调用")}</strong>
        <span>{messages.length}</span>
      </summary>
      <div className="ai-tool-event-list">
        {messages.map((message) => (
          <article key={message.id} className="ai-tool-event">
            <pre>{message.text}</pre>
          </article>
        ))}
      </div>
    </details>
  );
}

function AiPatchPreview({
  proposal,
  applyMode,
  canRetry,
  onCopy,
  onApply,
  onDiscard,
  onRetry
}: {
  proposal: AiPatchProposal;
  applyMode: "current-document" | "new-document";
  canRetry: boolean;
  onCopy: (text: string) => void;
  onApply: (proposal: AiPatchProposal, mode: "replace" | "insert" | "append" | "new-document") => void | Promise<void>;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const { tr } = useRendererI18n();
  const [pendingAction, setPendingAction] = useState<"apply" | "new-document" | "discard" | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const text = proposal.operations.map((operation) => ("afterText" in operation ? operation.afterText : "")).join("\n\n");
  const firstOperation = proposal.operations[0];
  const workspaceProposal = isWorkspacePatchProposal(proposal);
  const copyText = workspaceProposal ? workspaceOperationSummary(proposal.operations, proposal.pathRel, tr) : text;
  const action = workspaceProposal ? { label: tr("确认应用工作区操作"), mode: "replace" as const, enabled: proposal.operations.length > 0 } : patchPrimaryAction(firstOperation, applyMode, tr);
  const showBeforeAfter = firstOperation?.type === "replaceDocument" || firstOperation?.type === "replaceRange";
  const beforeText = showBeforeAfter ? firstOperation.beforeText : "";
  const canCreateNewDocument = !workspaceProposal && applyMode !== "new-document" && firstOperation?.type === "replaceDocument" && Boolean(text.trim());
  const busy = Boolean(pendingAction);
  const runAction = async (actionName: "apply" | "new-document" | "discard", actionRunner: () => void | Promise<void>) => {
    if (pendingAction) {
      return;
    }
    setPendingAction(actionName);
    setActionError(undefined);
    try {
      await actionRunner();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(undefined);
    }
  };
  const primaryActionName = action.mode === "new-document" ? "new-document" : "apply";
  const primaryLabel = pendingAction === primaryActionName ? primaryActionName === "new-document" ? tr("正在新建文档...") : tr("正在应用...") : action.label;
  const newDocumentLabel = pendingAction === "new-document" ? tr("正在新建文档...") : tr("新建文档");
  const discardLabel = pendingAction === "discard" ? tr("正在放弃...") : tr("放弃");
  return (
    <section className="ai-patch-preview">
      <header className="ai-patch-header">
        <strong>{workspaceProposal ? tr("工作区操作提案") : tr("建议修改")}</strong>
        <span>{proposal.summary}</span>
      </header>
      <div className="ai-patch-diff" aria-label={tr("影响范围")}>
        {workspaceProposal ? (
          <section className="ai-workspace-summary" aria-label={tr("工作区操作清单")}>
            <div className="ai-workspace-summary-header">
              <strong>{tr("待确认操作")}</strong>
              <span>{tr("共 {count} 个操作", { count: proposal.operations.length })}</span>
            </div>
            <WorkspaceOperationList operations={proposal.operations} fallbackPath={proposal.pathRel} />
          </section>
        ) : (
          <section className="ai-diff-block is-after">
            <strong>{showBeforeAfter ? tr("建议") : tr("新增内容")}</strong>
            <div className="ai-diff-content is-after">
              <AiMarkdownContent text={text || tr("无内容")} renderDiagrams />
            </div>
          </section>
        )}
        {firstOperation ? (
          <details className="ai-patch-details">
            <summary>{tr("影响范围")}</summary>
            <div className="ai-patch-meta">
              {workspaceProposal ? <span>{tr("共 {count} 个操作", { count: proposal.operations.length })}</span> : <span>{tr("目标：{path}", { path: proposal.pathRel })}</span>}
              {!workspaceProposal ? <span>{tr("操作：{operation}", { operation: operationLabel(firstOperation, tr) })}</span> : null}
            </div>
            {workspaceProposal ? (
              <WorkspaceOperationList operations={proposal.operations} fallbackPath={proposal.pathRel} variant="details" />
            ) : null}
            {showBeforeAfter ? (
              <section className="ai-diff-block is-before">
                <strong>{tr("原文")}</strong>
                <pre>{beforeText || tr("无内容")}</pre>
              </section>
            ) : null}
          </details>
        ) : null}
      </div>
      {actionError ? (
        <div className="ai-patch-action-error" role="alert">
          <AlertTriangle size={14} />
          <span>{actionError}</span>
        </div>
      ) : null}
      <div className="ai-patch-actions">
        <button type="button" className="primary-button" disabled={!action.enabled || busy} onClick={() => void runAction(primaryActionName, () => onApply(proposal, action.mode))}>{primaryLabel}</button>
        {canCreateNewDocument ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void runAction("new-document", () => onApply(proposal, "new-document"))}>{newDocumentLabel}</button> : null}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => onCopy(copyText)}>{workspaceProposal ? tr("复制操作清单") : tr("复制结果")}</button>
        <button type="button" className="secondary-button" disabled={!canRetry || busy} onClick={onRetry}>{tr("重新生成")}</button>
        <button type="button" className="secondary-button is-subtle" disabled={busy} onClick={() => void runAction("discard", onDiscard)}>{discardLabel}</button>
      </div>
    </section>
  );
}

function WorkspaceOperationList({ operations, fallbackPath, variant = "summary" }: { operations: AiPatchOperation[]; fallbackPath: string; variant?: "summary" | "details" }) {
  const { tr } = useRendererI18n();
  const compact = variant === "details";
  const itemClassName = variant === "details" ? "ai-workspace-operation-detail" : "ai-workspace-operation";
  return (
    <div className={`ai-workspace-operation-list${compact ? " is-compact" : ""}`} role="list">
      {operations.map((operation, index) => (
        <div key={`${operationLabel(operation, tr)}:${operationPath(operation, fallbackPath)}:${index}`} className={itemClassName} role="listitem">
          <div>
            <strong>{operationLabel(operation, tr)}</strong>
            <span>{operationPath(operation, fallbackPath)}</span>
          </div>
          <p>{operationPreview(operation, tr)}</p>
        </div>
      ))}
    </div>
  );
}

function AiMarkdownContent({ text, renderDiagrams = true }: { text: string; renderDiagrams?: boolean }) {
  const [html, setHtml] = useState<string | undefined>();
  const shouldRenderMarkdown = looksLikeMarkdown(text);
  const shouldDelayDiagramMarkdown = !renderDiagrams && containsDiagramFence(text);

  useEffect(() => {
    let cancelled = false;
    if (!shouldRenderMarkdown || shouldDelayDiagramMarkdown) {
      setHtml(undefined);
      return () => {
        cancelled = true;
      };
    }
    void renderMarkdownToHtml(text).then((nextHtml) => {
      if (!cancelled) {
        setHtml(nextHtml);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shouldDelayDiagramMarkdown, shouldRenderMarkdown, text]);

  if (!shouldRenderMarkdown || !html) {
    return <pre>{text}</pre>;
  }
  return (
    <div className="ai-markdown-content">
      <MarkdownPreview html={html} renderDiagrams={renderDiagrams} />
    </div>
  );
}

function patchPrimaryAction(
  operation: AiPatchOperation | undefined,
  applyMode: "current-document" | "new-document",
  tr: ReturnType<typeof useRendererI18n>["tr"]
): { label: string; mode: "replace" | "insert" | "append" | "new-document"; enabled: boolean } {
  if (applyMode === "new-document") {
    return { label: tr("新建文档"), mode: "new-document", enabled: Boolean(operation) };
  }
  if (operation?.type === "createDirectory") {
    return { label: tr("创建文件夹"), mode: "replace", enabled: true };
  }
  if (operation?.type === "movePath") {
    return { label: tr("移动或重命名"), mode: "replace", enabled: true };
  }
  switch (operation?.type) {
    case "replaceDocument":
      return { label: tr("替换全文"), mode: "replace", enabled: true };
    case "replaceRange":
      return { label: tr("替换选区"), mode: "replace", enabled: true };
    case "insertAt":
      return { label: tr("插入到位置 {offset}", { offset: operation.offset }), mode: "insert", enabled: true };
    case "append":
      return { label: tr("追加到末尾"), mode: "append", enabled: true };
    case "createFile":
      return { label: tr("创建文件"), mode: "replace", enabled: true };
    default:
      return { label: tr("应用建议"), mode: "replace", enabled: false };
  }
}

function sourceKindLabel(kind: AiSourceRef["kind"], tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  switch (kind) {
    case "current-note":
      return tr("当前笔记");
    case "selection":
      return tr("选区");
    case "search-result":
      return tr("搜索结果");
    case "note":
      return tr("笔记");
    case "workspace-file":
      return tr("工作区文件");
    case "tags":
      return tr("标签");
    default:
      return kind;
  }
}

function sourceTitle(source: AiSourceRef, tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  if (source.pathRel) {
    return source.pathRel;
  }
  if (source.title) {
    return source.title;
  }
  if (source.snippet) {
    return compactText(source.snippet, 34);
  }
  return sourceKindLabel(source.kind, tr);
}

function operationLabel(operation: AiPatchOperation, tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  if (operation.type === "createDirectory") {
    return tr("创建文件夹");
  }
  if (operation.type === "movePath") {
    return tr("移动或重命名");
  }
  switch (operation.type) {
    case "replaceDocument":
      return tr("替换全文");
    case "replaceRange":
      return tr("替换选区");
    case "insertAt":
      return tr("插入到位置 {offset}", { offset: operation.offset });
    case "append":
      return tr("追加到末尾");
    case "createFile":
      return tr("创建文件");
    default:
      return tr("建议修改");
  }
}

function isWorkspacePatchProposal(proposal: AiPatchProposal): boolean {
  return proposal.operations.some((operation) => operation.type === "createFile" || operation.type === "createDirectory" || operation.type === "movePath" || Boolean(operationPath(operation, "")));
}

function operationPath(operation: AiPatchOperation, fallbackPath: string): string {
  if (operation.type === "movePath") {
    return `${operation.sourcePathRel} -> ${operation.targetPathRel}`;
  }
  return "pathRel" in operation && operation.pathRel ? operation.pathRel : fallbackPath;
}

function operationPreview(operation: AiPatchOperation, tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  if (operation.type === "createDirectory") {
    return tr("创建文件夹：{path}", { path: operation.pathRel });
  }
  if (operation.type === "movePath") {
    return tr("从 {source} 移动到 {target}", { source: operation.sourcePathRel, target: operation.targetPathRel });
  }
  if ("afterText" in operation && operation.afterText.trim()) {
    return compactText(operation.afterText, 120);
  }
  if ("beforeText" in operation && operation.beforeText.trim()) {
    return compactText(operation.beforeText, 120);
  }
  return tr("无内容");
}

function workspaceOperationSummary(operations: AiPatchOperation[], fallbackPath: string, tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  return operations.map((operation, index) => `${index + 1}. ${operationLabel(operation, tr)} - ${operationPath(operation, fallbackPath)}\n${operationPreview(operation, tr)}`).join("\n\n");
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function groupAiMessagesForRender(messages: AiMessageView[]): AiMessageRenderItem[] {
  const items: AiMessageRenderItem[] = [];
  let pendingEvents: AiMessageView[] = [];
  const flushEvents = () => {
    if (!pendingEvents.length) {
      return;
    }
    items.push({
      kind: "events",
      id: `events:${pendingEvents[0].id}`,
      messages: pendingEvents
    });
    pendingEvents = [];
  };
  for (const message of messages) {
    if (message.role === "event") {
      pendingEvents.push(message);
      continue;
    }
    flushEvents();
    items.push({ kind: "message", message });
  }
  flushEvents();
  return items;
}

function looksLikeMarkdown(value: string): boolean {
  return (
    /(^|\n)\s{0,3}#{1,6}\s+\S/.test(value) ||
    /(^|\n)\s{0,3}[-*+]\s+\S/.test(value) ||
    /(^|\n)\s{0,3}\d+\.\s+\S/.test(value) ||
    /(^|\n)\s{0,3}>\s+\S/.test(value) ||
    /(^|\n)\s{0,3}\|.+\|/.test(value) ||
    /```/.test(value) ||
    /\*\*[^*\n]+\*\*/.test(value)
  );
}

function containsDiagramFence(value: string): boolean {
  return /(^|\n)```(?:mermaid|graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|mindmap|timeline|journey|pie|quadrantChart)\b/i.test(value);
}

function modelDisplayName(provider: Pick<AiProviderProfile, "alias" | "model">): string {
  const name = provider.alias?.trim();
  const model = provider.model.trim();
  return name || model || "Untitled model";
}

function findLastMessageIndex(messages: AiMessageView[], role: AiMessageView["role"]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === role) {
      return index;
    }
  }
  return -1;
}

function isCurrentNoteSummaryRequest(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  return /(总结|概括|summary|summarize)/i.test(value) && /(当前|这篇|本文|笔记|note)/i.test(normalized);
}

