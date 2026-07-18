import { Bot, CheckCircle2, CircleAlert, Clock3, Play, ShieldCheck } from "lucide-react";

import type { AiTaskSummary } from "../../../shared/ai";

export function AiTaskCenter({ tasks, onNewTask, onOpenTask }: { tasks: AiTaskSummary[]; onNewTask: () => void; onOpenTask: (task: AiTaskSummary) => void }) {
  const sorted = [...tasks].sort((left, right) => taskPriority(left) - taskPriority(right) || right.updatedAt - left.updatedAt);
  return <section className="ai-task-center" aria-labelledby="ai-task-title"><header><div><h1 id="ai-task-title">AI 任务</h1><p>所有写入都需要审批，并保留可撤销事务。</p></div><button type="button" onClick={onNewTask}><Bot size={16} />新对话</button></header><nav aria-label="任务状态"><span>待审批 {tasks.filter((task) => task.status === "waiting_approval").length}</span><span>运行中 {tasks.filter((task) => task.status === "running" || task.status === "queued").length}</span><span>已完成 {tasks.filter((task) => task.status === "completed").length}</span><span>失败 {tasks.filter((task) => task.status === "failed").length}</span></nav><div className="ai-task-list">{sorted.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask(task)}>{taskIcon(task)}<span><strong>{task.title}</strong><small>{taskStatus(task)} · {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(task.updatedAt)}</small></span></button>)}{!tasks.length ? <div className="ai-task-empty"><ShieldCheck size={24} /><p>还没有 AI 任务。</p><button type="button" onClick={onNewTask}>新对话</button></div> : null}</div></section>;
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

function taskStatus(task: AiTaskSummary): string {
  if (task.status === "waiting_approval") return "等待审批";
  if (task.status === "running" || task.status === "queued") return "运行中";
  if (task.status === "failed") return "失败";
  if (task.status === "interrupted") return "已中断";
  if (task.status === "completed") return "已完成";
  return "已取消";
}
