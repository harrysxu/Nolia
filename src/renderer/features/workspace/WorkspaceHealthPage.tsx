import { ArrowLeft, CheckCircle2, CircleAlert, Database, Eye, FolderLock, History } from "lucide-react";

import type { WorkspaceHealthSnapshot } from "../../../shared/contracts";

export function WorkspaceHealthPage({ health, onBack }: { health?: WorkspaceHealthSnapshot; onBack: () => void }) {
  return <section className="workspace-health-page"><header><button type="button" className="icon-button" aria-label="返回" onClick={onBack}><ArrowLeft size={17} /></button><div><h1>工作区健康</h1><p>{health?.issues.length ? `${health.issues.length} 个问题需要处理` : "工作区运行正常"}</p></div></header><div className="health-list"><HealthRow icon={<FolderLock size={18} />} title="目录权限" status={health?.writable ? "可读写" : health?.readable ? "只读" : "不可读取"} ok={Boolean(health?.readable)} /><HealthRow icon={<Eye size={18} />} title="文件监控" status={health?.watcher.message ?? health?.watcher.status ?? "检查中"} ok={health?.watcher.status === "ready"} /><HealthRow icon={<Database size={18} />} title="全文索引" status={health ? `${health.index.status} · ${Math.round(health.index.progress * 100)}%` : "检查中"} ok={health?.index.status !== "error"} /><HealthRow icon={<Database size={18} />} title="工作区数据库" status={health ? `Schema v${health.database.schemaVersion}` : "检查中"} ok={health?.database.status === "ready"} /><HealthRow icon={<History size={18} />} title="历史空间" status={health ? formatBytes(health.history.bytes) : "检查中"} ok />{health?.issues.map((issue) => <div className={`health-issue is-${issue.severity}`} key={issue.id}><CircleAlert size={18} /><span><strong>{issue.title}</strong><p>{issue.message}</p></span></div>)}</div></section>;
}

function HealthRow({ icon, title, status, ok }: { icon: React.ReactNode; title: string; status: string; ok?: boolean }) {
  return <div className="health-row">{icon}<strong>{title}</strong><span>{status}</span>{ok ? <CheckCircle2 size={17} className="is-ok" /> : <CircleAlert size={17} className="is-warning" />}</div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
