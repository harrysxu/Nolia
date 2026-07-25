import { Bot, CheckCircle2, CircleAlert, Clock3, Play, ShieldCheck } from "lucide-react";

import type { AiTaskSummary } from "../../../shared/ai";
import type { Translator } from "../../../shared/i18n";
import { useRendererI18n } from "../../app/i18n";

export function AiTaskCenter({ tasks, onNewTask, onOpenTask }: { tasks: AiTaskSummary[]; onNewTask: () => void; onOpenTask: (task: AiTaskSummary) => void }) {
  const { locale, tr } = useRendererI18n();
  const sorted = [...tasks].sort((left, right) => taskPriority(left) - taskPriority(right) || right.updatedAt - left.updatedAt);
  return <section className="ai-task-center" aria-labelledby="ai-task-title"><header><div><h1 id="ai-task-title">{tr("AI 任务")}</h1><p>{tr("所有写入都需要审批，并保留可撤销事务。")}</p></div><button type="button" onClick={onNewTask}><Bot size={16} />{tr("新对话")}</button></header><nav aria-label={tr("任务状态")}><span>{tr("待审批 {count}", { count: tasks.filter((task) => task.status === "waiting_approval").length })}</span><span>{tr("运行中 {count}", { count: tasks.filter((task) => task.status === "running" || task.status === "queued").length })}</span><span>{tr("已完成 {count}", { count: tasks.filter((task) => task.status === "completed").length })}</span><span>{tr("失败 {count}", { count: tasks.filter((task) => task.status === "failed").length })}</span></nav><div className="ai-task-list">{sorted.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask(task)}>{taskIcon(task)}<span><strong>{task.title}</strong><small>{taskStatus(task, tr)} · {new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(task.updatedAt)}</small></span></button>)}{!tasks.length ? <div className="ai-task-empty"><ShieldCheck size={24} /><p>{tr("还没有 AI 任务。")}</p><button type="button" onClick={onNewTask}>{tr("新对话")}</button></div> : null}</div></section>;
}

function taskPriority(task: AiTaskSummary): number {
  if (task.status === "waiting_approval") return 0;
  if (task.status === "running" || task.status === "queued") return 1;
  if (task.status === "failed" || task.status === "interrupted") return 2;
  return 3;
}

function taskIcon(task: AiTaskSummary) {
  if (task.status === "waiting_approval") return <Clock3 size={18} />;
  if (task.status === "running" || task.status === "queued") return <Play size={18} />;
  if (task.status === "failed" || task.status === "interrupted") return <CircleAlert size={18} />;
  return <CheckCircle2 size={18} />;
}

function taskStatus(task: AiTaskSummary, tr: Translator): string {
  if (task.status === "waiting_approval") return tr("等待审批");
  if (task.status === "running" || task.status === "queued") return tr("运行中");
  if (task.status === "failed") return tr("失败");
  if (task.status === "interrupted") return tr("已中断");
  if (task.status === "completed") return tr("已完成");
  return tr("已取消");
}
