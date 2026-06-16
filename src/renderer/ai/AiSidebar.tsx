import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Copy, RefreshCw, Send, Settings, Sparkles, Square, X } from "lucide-react";

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
      label: `${modelDisplayName(provider)} · ${providerLabel(provider.providerId)}`
    }));
  }, [settings]);
  const selectedModelOption = activeProvider?.model.trim() && modelOptions.some((option) => option.value === activeProvider.id) ? activeProvider.id : "";
  const hasConversation = messages.length > 0 || sources.length > 0 || Boolean(patchProposal);
  const canRunRetry = enabled && !running && canRetry;
  const lastUserMessageIndex = findLastMessageIndex(messages, "user");
  const hasAssistantAfterLastUser = messages.slice(lastUserMessageIndex + 1).some((message) => message.role === "assistant");
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
          <span>{enabled && settings ? `${providerLabel(settings.providerId)} · ${settings.model || tr("未选择模型")}` : tr("AI 未启用")}</span>
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
      <div className="ai-context-bar">
        {contextSummary.length ? contextSummary.map((item) => <span key={item}>{item}</span>) : <span>{tr("无当前上下文")}</span>}
      </div>
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
        {messages.map((message) => (
          message.role === "error" ? (
            <AiErrorMessage
              key={message.id}
              message={message}
              enabled={enabled}
              running={running}
              canRetry={canRunRetry && message.retryable !== false}
              hasPatchProposal={Boolean(patchProposal)}
              onOpenSettings={onOpenSettings}
              onRetry={onRetry}
              onCopy={onCopy}
            />
          ) : (
            <article key={message.id} className={`ai-message is-${message.role}`}>
              {message.role === "assistant" ? <AiMarkdownContent text={message.text} renderDiagrams={!running} /> : <pre>{message.text}</pre>}
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
        {settings ? (
          <div className="ai-composer-model-row">
            <label>
              <span>{tr("模型")}</span>
              {modelOptions.length ? (
                <select
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
                  value={activeProvider?.model ?? ""}
                  placeholder={tr("输入模型名称")}
                  disabled={!enabled || running}
                  onChange={(event) => onUpdateDefaultProvider({ model: event.target.value })}
                />
              )}
            </label>
            <button type="button" className="secondary-button" onClick={onOpenSettings}>{tr("管理")}</button>
          </div>
        ) : null}
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
  const text = proposal.operations.map((operation) => ("afterText" in operation ? operation.afterText : "")).join("\n\n");
  const firstOperation = proposal.operations[0];
  const workspaceProposal = isWorkspacePatchProposal(proposal);
  const action = workspaceProposal ? { label: tr("确认应用工作区操作"), mode: "replace" as const, enabled: proposal.operations.length > 0 } : patchPrimaryAction(firstOperation, applyMode, tr);
  const showBeforeAfter = firstOperation?.type === "replaceDocument" || firstOperation?.type === "replaceRange";
  const beforeText = showBeforeAfter ? firstOperation.beforeText : "";
  const canCreateNewDocument = !workspaceProposal && applyMode !== "new-document" && firstOperation?.type === "replaceDocument" && Boolean(text.trim());
  return (
    <section className="ai-patch-preview">
      <header className="ai-patch-header">
        <strong>{tr("建议修改")}</strong>
        <span>{proposal.summary}</span>
      </header>
      <div className="ai-patch-diff" aria-label={tr("影响范围")}>
        <section className="ai-diff-block is-after">
          <strong>{showBeforeAfter ? tr("建议") : tr("新增内容")}</strong>
          <div className="ai-diff-content is-after">
            <AiMarkdownContent text={text || tr("无内容")} renderDiagrams />
          </div>
        </section>
        {firstOperation ? (
          <details className="ai-patch-details">
            <summary>{tr("影响范围")}</summary>
            <div className="ai-patch-meta">
              {workspaceProposal ? <span>{tr("共 {count} 个操作", { count: proposal.operations.length })}</span> : <span>{tr("目标：{path}", { path: proposal.pathRel })}</span>}
              {!workspaceProposal ? <span>{tr("操作：{operation}", { operation: operationLabel(firstOperation, tr) })}</span> : null}
            </div>
            {workspaceProposal ? (
              <div className="ai-workspace-operation-list" role="list">
                {proposal.operations.map((operation, index) => (
                  <div key={`${operationLabel(operation, tr)}:${operationPath(operation, proposal.pathRel)}:${index}`} className="ai-workspace-operation" role="listitem">
                    <strong>{operationLabel(operation, tr)}</strong>
                    <span>{operationPath(operation, proposal.pathRel)}</span>
                  </div>
                ))}
              </div>
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
      <div className="ai-patch-actions">
        <button type="button" className="primary-button" disabled={!action.enabled} onClick={() => void onApply(proposal, action.mode)}>{action.label}</button>
        {canCreateNewDocument ? <button type="button" className="secondary-button" onClick={() => void onApply(proposal, "new-document")}>{tr("新建文档")}</button> : null}
        <button type="button" className="secondary-button" onClick={() => onCopy(text)}>{tr("复制结果")}</button>
        <button type="button" className="secondary-button" disabled={!canRetry} onClick={onRetry}>{tr("重新生成")}</button>
        <button type="button" className="secondary-button is-subtle" onClick={onDiscard}>{tr("放弃")}</button>
      </div>
    </section>
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
  return proposal.operations.some((operation) => operation.type === "createFile" || Boolean(operationPath(operation, "")));
}

function operationPath(operation: AiPatchOperation, fallbackPath: string): string {
  return "pathRel" in operation && operation.pathRel ? operation.pathRel : fallbackPath;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
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

function modelDisplayName(provider: Pick<AiProviderProfile, "name" | "model">): string {
  const name = provider.name.trim();
  const model = provider.model.trim();
  if (model && (name === "OpenAI-compatible" || name === "Local Ollama" || !name)) {
    return model;
  }
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

function providerLabel(providerId: string): string {
  return providerId === "ollama" ? "Ollama" : "OpenAI-compatible";
}
