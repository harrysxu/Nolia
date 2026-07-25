import { Suspense, lazy, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Bot, Clock3, FilePenLine, Link2, Play, RotateCcw, Wrench } from "lucide-react";

import type { AiPatchOperation, AiPatchProposal, AiTaskSnapshot, AiTaskStatus, AiWriteTransaction } from "../../../shared/ai";
import type { Translator } from "../../../shared/i18n";
import { useRendererI18n } from "../../app/i18n";

const MarkdownPreview = lazy(async () => ({ default: (await import("../../components/MarkdownPreview")).MarkdownPreview }));

type DetailTab = "conversation" | "execution" | "changes";

interface AiTaskDetailProps {
  task?: AiTaskSnapshot;
  loading: boolean;
  error?: string;
  onBack: () => void;
  onRetry: () => void;
  onContinue: (task: AiTaskSnapshot) => void;
  onReviewApproval: (task: AiTaskSnapshot) => void;
}

export function AiTaskDetail({ task, loading, error, onBack, onRetry, onContinue, onReviewApproval }: AiTaskDetailProps) {
  const { locale, tr } = useRendererI18n();
  const [activeTab, setActiveTab] = useState<DetailTab>("conversation");

  useEffect(() => {
    setActiveTab("conversation");
  }, [task?.id]);

  if (loading) {
    return <TaskDetailState label={tr("正在读取 AI 任务...")} onBack={onBack} />;
  }
  if (error || !task) {
    return <TaskDetailState label={error ?? tr("AI 任务不存在或已被移除。")} onBack={onBack} onRetry={onRetry} />;
  }

  const pendingProposal = getPendingProposal(task);
  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: "conversation", label: tr("对话") },
    { id: "execution", label: tr("执行记录") },
    { id: "changes", label: tr("变更") }
  ];

  return (
    <section className="ai-task-detail" aria-labelledby="ai-task-detail-title">
      <header className="ai-task-detail-header">
        <button type="button" className="icon-button" title={tr("返回 AI 任务")} aria-label={tr("返回 AI 任务")} onClick={onBack}>
          <ArrowLeft size={17} />
        </button>
        <div>
          <span className={`ai-task-status is-${task.status}`}>{taskStatusLabel(task.status, tr)}</span>
          <h1 id="ai-task-detail-title">{task.title}</h1>
          <p>
            {formatTaskDate(task.createdAt, locale)}
            {task.model?.model ? ` · ${task.model.model}` : ""}
          </p>
        </div>
        <div className="ai-task-detail-actions">
          {pendingProposal ? <button type="button" className="secondary-button" onClick={() => onReviewApproval(task)}><FilePenLine size={15} />{tr("查看审批")}</button> : null}
          <button type="button" className="primary-button" onClick={() => onContinue(task)}><Bot size={15} />{tr("继续对话")}</button>
        </div>
      </header>

      <div className="ai-task-detail-tabs" role="tablist" aria-label={tr("AI 任务详情")}>
        {tabs.map((tab) => (
          <button
            type="button"
            role="tab"
            id={`ai-task-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`ai-task-panel-${tab.id}`}
            className={activeTab === tab.id ? "is-active" : undefined}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ai-task-detail-body" role="tabpanel" id={`ai-task-panel-${activeTab}`} aria-labelledby={`ai-task-tab-${activeTab}`}>
        {activeTab === "conversation" ? <ConversationPanel task={task} /> : null}
        {activeTab === "execution" ? <ExecutionPanel task={task} /> : null}
        {activeTab === "changes" ? <ChangesPanel task={task} /> : null}
      </div>
    </section>
  );
}

function TaskDetailState({ label, onBack, onRetry }: { label: string; onBack: () => void; onRetry?: () => void }) {
  const { tr } = useRendererI18n();
  return (
    <section className="ai-task-detail ai-task-detail-state" aria-label={tr("AI 任务详情")}>
      <button type="button" className="icon-button" title={tr("返回 AI 任务")} aria-label={tr("返回 AI 任务")} onClick={onBack}><ArrowLeft size={17} /></button>
      <div role="status">
        <Clock3 size={22} />
        <p>{label}</p>
        {onRetry ? <button type="button" className="secondary-button" onClick={onRetry}><RotateCcw size={15} />{tr("重试")}</button> : null}
      </div>
    </section>
  );
}

function ConversationPanel({ task }: { task: AiTaskSnapshot }) {
  const { tr } = useRendererI18n();
  const messages = task.messages ?? [];
  return (
    <div className="ai-task-conversation">
      {messages.map((message) => (
        <article className={`ai-task-message is-${message.role}`} key={message.id}>
          <header>{message.role === "user" ? tr("你") : tr("Nolia AI")}</header>
          {message.role === "assistant" ? <TaskMarkdown text={message.content} /> : <pre>{message.content}</pre>}
        </article>
      ))}
      {!messages.length ? <EmptyDetail icon={<Bot size={22} />} label={tr("此任务没有可显示的对话内容。")} /> : null}
    </div>
  );
}

function ExecutionPanel({ task }: { task: AiTaskSnapshot }) {
  const { locale, tr } = useRendererI18n();
  return (
    <div className="ai-task-execution">
      {task.lastError ? <div className="ai-task-error"><AlertTriangle size={17} /><span>{task.lastError}</span></div> : null}
      {task.steps.length ? <ol className="ai-task-timeline">
        {task.steps.map((step) => (
          <li key={step.id}>
            <span className="ai-task-timeline-icon">{stepIcon(step.kind)}</span>
            <div><strong>{step.title}</strong>{step.summary ? <p>{step.summary}</p> : null}<time>{formatTaskDate(step.createdAt, locale)}</time></div>
          </li>
        ))}
      </ol> : <EmptyDetail icon={<Clock3 size={22} />} label={tr("此任务没有执行记录。")} />}
      {task.sources.length ? <section className="ai-task-source-list"><h2>{tr("来源")}</h2>{task.sources.map((source, index) => <article key={`${source.kind}:${source.pathRel ?? source.title ?? index}`}><Link2 size={15} /><div><strong>{source.title ?? source.pathRel ?? source.kind}</strong>{source.snippet ? <p>{source.snippet}</p> : null}</div></article>)}</section> : null}
      {task.usage ? <p className="ai-task-usage">{tr("Token 使用：{count}", { count: task.usage.totalTokens ?? (task.usage.inputTokens ?? 0) + (task.usage.outputTokens ?? 0) })}</p> : null}
    </div>
  );
}

function ChangesPanel({ task }: { task: AiTaskSnapshot }) {
  const { tr } = useRendererI18n();
  const hasChanges = task.approvals.length > 0 || task.proposals.length > 0 || task.writes.length > 0;
  if (!hasChanges) {
    return <EmptyDetail icon={<FilePenLine size={22} />} label={tr("此任务没有提出或执行文件变更。")} />;
  }
  return (
    <div className="ai-task-changes">
      {task.approvals.length ? <section><h2>{tr("审批")}</h2>{task.approvals.map((approval) => <article className="ai-task-change-card" key={approval.id}><header><strong>{approval.toolName}</strong><span>{approvalStatusLabel(approval.status, tr)}</span></header></article>)}</section> : null}
      {task.proposals.length ? <section><h2>{tr("建议修改")}</h2>{task.proposals.map((proposal) => <article className="ai-task-change-card" key={proposal.id}><header><strong>{proposal.title}</strong><span>{proposal.status ? proposalStatusLabel(proposal.status, tr) : tr("等待处理")}</span></header><p>{proposal.summary}</p><div className="ai-task-operation-list">{proposal.operations.map((operation, index) => <OperationDetail operation={operation} fallbackPath={proposal.pathRel} key={operation.id ?? `${operation.type}:${index}`} />)}</div></article>)}</section> : null}
      {task.writes.length ? <section><h2>{tr("写入事务")}</h2>{task.writes.map((transaction) => <TransactionDetail transaction={transaction} key={transaction.id} />)}</section> : null}
    </div>
  );
}

function OperationDetail({ operation, fallbackPath }: { operation: AiPatchOperation; fallbackPath: string }) {
  const { tr } = useRendererI18n();
  const beforeText = "beforeText" in operation ? operation.beforeText : undefined;
  const afterText = "afterText" in operation ? operation.afterText : undefined;
  return (
    <details>
      <summary><strong>{operationLabel(operation, tr)}</strong><span>{operationPath(operation, fallbackPath)}</span></summary>
      {beforeText !== undefined ? <div><small>{tr("修改前")}</small><pre>{beforeText}</pre></div> : null}
      {afterText !== undefined ? <div><small>{tr("修改后")}</small><pre>{afterText}</pre></div> : null}
    </details>
  );
}

function TransactionDetail({ transaction }: { transaction: AiWriteTransaction }) {
  const { tr } = useRendererI18n();
  return <article className="ai-task-change-card"><header><strong>{transaction.id}</strong><span>{transactionStatusLabel(transaction.status, tr)}</span></header><ul>{transaction.operations.map((operation, index) => <li key={operation.operationId ?? `${operation.pathRel}:${index}`}><span>{operation.targetPathRel ? `${operation.pathRel} → ${operation.targetPathRel}` : operation.pathRel}</span><small>{operation.status ? transactionOperationStatusLabel(operation.status, tr) : tr("等待处理")}</small></li>)}</ul></article>;
}

function TaskMarkdown({ text }: { text: string }) {
  const [html, setHtml] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    setHtml(undefined);
    void import("../../../shared/markdown").then(({ renderMarkdownToHtml }) => renderMarkdownToHtml(text)).then((value) => {
      if (!cancelled) setHtml(value);
    });
    return () => { cancelled = true; };
  }, [text]);
  return html ? <div className="ai-markdown-content"><Suspense fallback={<pre>{text}</pre>}><MarkdownPreview html={html} /></Suspense></div> : <pre>{text}</pre>;
}

function getPendingProposal(task: AiTaskSnapshot): AiPatchProposal | undefined {
  if (!task.pendingApprovalId) {
    return undefined;
  }
  const approval = task.approvals.find((item) => item.id === task.pendingApprovalId && item.status === "pending");
  if (!approval) {
    return undefined;
  }
  const proposal = task.proposals.find((item) => item.id === approval.proposalId && item.status === "pending");
  return proposal;
}

function EmptyDetail({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <div className="ai-task-detail-empty">{icon}<p>{label}</p></div>;
}

function taskStatusLabel(status: AiTaskStatus, tr: Translator): string {
  if (status === "waiting_approval") return tr("等待审批");
  if (status === "running" || status === "queued") return tr("运行中");
  if (status === "failed") return tr("失败");
  if (status === "interrupted") return tr("已中断");
  if (status === "completed") return tr("已完成");
  return tr("已取消");
}

function approvalStatusLabel(status: "pending" | "approved" | "rejected", tr: Translator): string {
  if (status === "approved") return tr("已批准");
  if (status === "rejected") return tr("已拒绝");
  return tr("等待审批");
}

function proposalStatusLabel(status: "pending" | "approved" | "rejected" | "applied", tr: Translator): string {
  if (status === "approved") return tr("已批准");
  if (status === "rejected") return tr("已拒绝");
  if (status === "applied") return tr("已应用");
  return tr("等待审批");
}

function transactionStatusLabel(status: AiWriteTransaction["status"], tr: Translator): string {
  if (status === "committed") return tr("已提交");
  if (status === "rolled_back") return tr("已回滚");
  if (status === "partial_failure") return tr("部分失败");
  if (status === "rollback_failed") return tr("回滚失败");
  return tr("准备中");
}

function transactionOperationStatusLabel(status: NonNullable<AiWriteTransaction["operations"][number]["status"]>, tr: Translator): string {
  if (status === "applied") return tr("已应用");
  if (status === "rolled_back") return tr("已回滚");
  if (status === "failed") return tr("失败");
  return tr("等待处理");
}

function operationLabel(operation: AiPatchOperation, tr: Translator): string {
  if (operation.type === "createDirectory") return tr("创建文件夹");
  if (operation.type === "createFile") return tr("创建文件");
  if (operation.type === "movePath") return tr("移动或重命名");
  if (operation.type === "append") return tr("追加到末尾");
  if (operation.type === "insertAt") return tr("插入内容");
  if (operation.type === "replaceRange") return tr("替换选区");
  return tr("替换全文");
}

function operationPath(operation: AiPatchOperation, fallbackPath: string): string {
  if (operation.type === "movePath") return `${operation.sourcePathRel} → ${operation.targetPathRel}`;
  return "pathRel" in operation && operation.pathRel ? operation.pathRel : fallbackPath;
}

function stepIcon(kind: AiTaskSnapshot["steps"][number]["kind"]) {
  if (kind === "tool") return <Wrench size={15} />;
  if (kind === "error") return <AlertTriangle size={15} />;
  if (kind === "write" || kind === "approval") return <FilePenLine size={15} />;
  return <Play size={15} />;
}

function formatTaskDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}
