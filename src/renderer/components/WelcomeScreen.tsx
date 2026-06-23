import { ArrowRight, CircleAlert, Clock3, FilePlus2, FolderOpen } from "lucide-react";
import type { RecentWorkspace, ResolvedLocale } from "../../shared/types";
import { formatDate } from "../../shared/i18n";
import { useRendererI18n } from "../app/i18n";
import noliaIconUrl from "../../../build/icon.svg";

interface WelcomeScreenProps {
  recentWorkspaces: RecentWorkspace[];
  openingWorkspaceId?: string;
  errorMessage?: string;
  onOpenWorkspace: () => void;
  onCreateWorkspace: () => void;
  onOpenRecent: (workspace: RecentWorkspace) => void;
}

export function WelcomeScreen({ recentWorkspaces, openingWorkspaceId, errorMessage, onOpenWorkspace, onCreateWorkspace, onOpenRecent }: WelcomeScreenProps) {
  const { locale, tr } = useRendererI18n();
  const availableCount = recentWorkspaces.filter((workspace) => workspace.exists).length;
  const unavailableCount = recentWorkspaces.length - availableCount;
  return (
    <div className="welcome-screen">
      <main className="welcome-content" aria-label="Nolia">
        <section className="welcome-intro">
          <div className="welcome-brand-lockup">
            <img className="welcome-logo" src={noliaIconUrl} alt="" aria-hidden="true" />
            <div>
              <div className="welcome-eyebrow">{tr("本地 Markdown 工作台")}</div>
              <div className="welcome-hero">
                <h1>Nolia</h1>
                <p>{tr("打开一个工作区，继续写作、整理和检索。")}</p>
              </div>
            </div>
          </div>
          <div className="welcome-summary">
            <div className="welcome-snapshot" aria-label={tr("启动状态")}>
              <span>
                <strong>{recentWorkspaces.length}</strong>
                <em>{tr("最近记录")}</em>
              </span>
              <span>
                <strong>{availableCount}</strong>
                <em>{tr("可打开")}</em>
              </span>
              <span className={unavailableCount ? "is-warning" : ""}>
                <strong>{unavailableCount}</strong>
                <em>{tr("需定位")}</em>
              </span>
            </div>
          </div>
          <div className="welcome-actions" aria-label={tr("工作区操作")}>
            <button type="button" className="primary-button" onClick={onOpenWorkspace}>
              <FolderOpen size={16} /> {tr("打开工作区")}
            </button>
            <button type="button" className="secondary-button" onClick={onCreateWorkspace}>
              <FilePlus2 size={16} /> {tr("创建工作区")}
            </button>
          </div>
        </section>
        <section className="welcome-recent-panel" aria-labelledby="welcome-recent-title">
          <div className="welcome-recent-header">
            <div>
              <div className="section-label">{tr("最近工作区")}</div>
              <h2 id="welcome-recent-title">{tr("继续上次的工作")}</h2>
            </div>
            <Clock3 size={18} aria-hidden="true" />
          </div>
          {errorMessage ? (
            <div className="welcome-error" role="status">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          ) : null}
          {recentWorkspaces.length === 0 ? <div className="empty-state">{tr("暂无最近工作区。")}</div> : null}
          <div className="welcome-recent-items">
            {recentWorkspaces.map((workspace) => {
              const unavailable = !workspace.exists;
              const opening = openingWorkspaceId === workspace.workspaceId;
              return (
                <button
                  key={workspace.workspaceId}
                  type="button"
                  className={`welcome-recent-item${unavailable ? " is-unavailable" : ""}`}
                  aria-label={`${unavailable ? tr("无法打开") : tr("打开最近工作区")} ${workspace.name}, ${tr("路径 {path}", { path: workspace.path })}`}
                  title={unavailable ? tr("路径不可用：{path}", { path: workspace.path }) : tr("打开 {path}", { path: workspace.path })}
                  disabled={opening}
                  onClick={() => onOpenRecent(workspace)}
                >
                  <span className="welcome-recent-icon">
                    {unavailable ? <CircleAlert size={15} /> : <Clock3 size={15} />}
                  </span>
                  <span className="welcome-recent-meta">
                    <strong>{workspace.name}</strong>
                    <span>{workspace.path}</span>
                    <em>{unavailable ? tr("路径不可用") : opening ? tr("正在打开...") : formatRecentTime(workspace.lastOpenedAt, locale, tr)}</em>
                  </span>
                  {!unavailable ? (
                    <span className="welcome-recent-open">
                      {tr("打开")} <ArrowRight className="welcome-recent-arrow" size={16} aria-hidden="true" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

function formatRecentTime(timestamp: number, locale: ResolvedLocale, tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return tr("最近打开");
  }
  return tr("上次打开 {time}", { time: formatDate(locale, timestamp, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) });
}
