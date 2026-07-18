import { Bot, CalendarDays, FilePlus2, Inbox, Star } from "lucide-react";

import type { AiTaskSummary } from "../../../shared/ai";
import type { WorkspaceInfo } from "../../../shared/types";
import type { DocumentListItem, FavoriteDocument } from "../../app/types";

interface WorkspaceHomeProps {
  workspace: WorkspaceInfo;
  recent: DocumentListItem[];
  favorites: FavoriteDocument[];
  aiTasks: AiTaskSummary[];
  onNewNote: () => void;
  onDailyNote: () => void;
  onQuickCapture: () => void;
  onFromTemplate: () => void;
  onOpenHealth: () => void;
  onOpen: (pathRel: string) => void;
  onOpenAiTask: (taskId: string) => void;
}

export function WorkspaceHome({ workspace, recent, favorites, aiTasks, onNewNote, onDailyNote, onQuickCapture, onFromTemplate, onOpenHealth, onOpen, onOpenAiTask }: WorkspaceHomeProps) {
  const attention = [
    ...(!workspace.permissions.writable ? ["此工作区为只读"] : []),
    ...(workspace.indexState.status === "error" ? [workspace.indexState.message || "搜索索引需要重新建立"] : []),
    ...aiTasks.filter((task) => task.status === "waiting_approval").map((task) => `${task.title} 等待审批`)
  ];

  return (
    <section className="workspace-home" aria-labelledby="workspace-home-title">
      <header className="workspace-home-header">
        <div>
          <h1 id="workspace-home-title">{workspace.name}</h1>
          <p>{workspace.rootPath}</p>
        </div>
        <time>{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date())}</time>
      </header>

      <div className="workspace-home-actions" aria-label="快速操作">
        <button type="button" onClick={onNewNote} disabled={!workspace.permissions.writable}><FilePlus2 size={16} />新建笔记</button>
        <button type="button" onClick={onDailyNote} disabled={!workspace.permissions.writable}><CalendarDays size={16} />今日笔记</button>
        <button type="button" onClick={onQuickCapture} disabled={!workspace.permissions.writable}><Inbox size={16} />快速捕获</button>
        <button type="button" onClick={onFromTemplate} disabled={!workspace.permissions.writable}><FilePlus2 size={16} />从模板新建</button>
      </div>

      {recent.length ? <HomeSection title="最近编辑" icon={<FilePlus2 size={16} />}>
        {recent.slice(0, 8).map((item) => <HomeRow key={item.pathRel} title={item.title} detail={item.pathRel} timestamp={item.timestamp} onOpen={() => onOpen(item.pathRel)} />)}
      </HomeSection> : null}

      {favorites.length ? <HomeSection title="收藏" icon={<Star size={16} />}>
        {favorites.slice(0, 6).map((item) => <HomeRow key={item.pathRel} title={item.title} detail={item.pathRel} timestamp={item.addedAt} onOpen={() => onOpen(item.pathRel)} />)}
      </HomeSection> : null}

      {attention.length ? <HomeSection title="待处理" icon={<Inbox size={16} />}>
        {attention.map((message) => <button type="button" className="workspace-home-notice" key={message} onClick={onOpenHealth}>{message}</button>)}
      </HomeSection> : null}

      {aiTasks.length ? <HomeSection title="最近 AI 任务" icon={<Bot size={16} />}>
        {aiTasks.slice(0, 5).map((task) => <HomeRow key={task.id} title={task.title} detail={taskStatusLabel(task.status)} timestamp={task.updatedAt} onOpen={() => onOpenAiTask(task.id)} />)}
      </HomeSection> : null}

      {!recent.length && !favorites.length && !aiTasks.length ? (
        <div className="workspace-home-empty">
          <FilePlus2 size={24} />
          <p>创建第一篇笔记，开始整理这个工作区。</p>
          <button type="button" onClick={onNewNote} disabled={!workspace.permissions.writable}>新建笔记</button>
        </div>
      ) : null}
    </section>
  );
}

function HomeSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section className="workspace-home-section"><h2>{icon}{title}</h2><div className="workspace-home-list">{children}</div></section>;
}

function HomeRow({ title, detail, timestamp, onOpen }: { title: string; detail: string; timestamp: number; onOpen: () => void }) {
  return <button type="button" className="workspace-home-row" onClick={onOpen}><strong>{title}</strong><span>{detail}</span><time>{formatRelativeTime(timestamp)}</time></button>;
}

function formatRelativeTime(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function taskStatusLabel(status: AiTaskSummary["status"]): string {
  if (status === "waiting_approval") return "等待审批";
  if (status === "running" || status === "queued") return "运行中";
  if (status === "failed") return "失败";
  if (status === "interrupted") return "已中断";
  return status === "completed" ? "已完成" : "已取消";
}
