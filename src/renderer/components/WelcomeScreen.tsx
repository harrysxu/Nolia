import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, FilePlus2, FileText, FolderOpen, Trash2 } from "lucide-react";
import type { RecentWorkspace, ResolvedLocale } from "../../shared/types";
import type { RecentExternalFile } from "../../shared/externalDocuments";
import { formatDate } from "../../shared/i18n";
import { useRendererI18n } from "../app/i18n";
import noliaIconUrl from "../../../build/icon.svg";

interface WelcomeScreenProps {
  recentWorkspaces: RecentWorkspace[];
  recentExternalFiles: RecentExternalFile[];
  openingWorkspaceId?: string;
  errorMessage?: string;
  onOpenWorkspace: () => void;
  onOpenFile: () => void;
  onCreateWorkspace: () => void;
  onOpenRecent: (workspace: RecentWorkspace) => void;
  onRemoveRecent: (workspace: RecentWorkspace) => void;
  onOpenRecentFile: (file: RecentExternalFile) => void;
  onRemoveRecentFile: (file: RecentExternalFile) => void;
}

export function WelcomeScreen({ recentWorkspaces, recentExternalFiles, openingWorkspaceId, errorMessage, onOpenWorkspace, onOpenFile, onCreateWorkspace, onOpenRecent, onRemoveRecent, onOpenRecentFile, onRemoveRecentFile }: WelcomeScreenProps) {
  const { locale, tr } = useRendererI18n();
  const [recentTab, setRecentTab] = useState<"workspaces" | "files">(() => recentExternalFiles.length && !recentWorkspaces.length ? "files" : "workspaces");
  const totalCount = recentWorkspaces.length + recentExternalFiles.length;
  const availableCount = recentWorkspaces.filter((workspace) => workspace.exists).length + recentExternalFiles.filter((file) => file.availability === "available").length;
  const unavailableCount = totalCount - availableCount;

  useEffect(() => {
    if (recentTab === "workspaces" && !recentWorkspaces.length && recentExternalFiles.length) {
      setRecentTab("files");
    } else if (recentTab === "files" && !recentExternalFiles.length && recentWorkspaces.length) {
      setRecentTab("workspaces");
    }
  }, [recentExternalFiles.length, recentTab, recentWorkspaces.length]);

  return (
    <div className="welcome-screen">
      <main className="welcome-content" aria-label="Nolia">
        <header className="welcome-intro">
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
          <div className="welcome-actions" aria-label={tr("工作区操作")}>
            <button type="button" className="primary-button" onClick={onOpenFile}>
              <FileText size={16} /> {tr("打开文件")}
            </button>
            <button type="button" className="secondary-button" onClick={onOpenWorkspace}>
              <FolderOpen size={16} /> {tr("打开工作区")}
            </button>
            <button type="button" className="secondary-button" onClick={onCreateWorkspace}>
              <FilePlus2 size={16} /> {tr("创建工作区")}
            </button>
          </div>
        </header>
        <div className="welcome-summary">
          <div className="welcome-snapshot" aria-label={tr("启动状态")}>
            <span><strong>{totalCount}</strong><em>{tr("最近记录")}</em></span>
            <span><strong>{availableCount}</strong><em>{tr("可打开")}</em></span>
            <span className={unavailableCount ? "is-warning" : ""}><strong>{unavailableCount}</strong><em>{tr("需定位")}</em></span>
          </div>
        </div>
        <section className="welcome-recent-panel" aria-labelledby="welcome-recent-title">
          <div className="welcome-recent-toolbar">
            <div className="welcome-recent-header">
              <div>
                <div className="section-label">{tr("最近记录")}</div>
                <h2 id="welcome-recent-title">{tr("继续上次的工作")}</h2>
              </div>
            </div>
            <div className="welcome-recent-tabs" role="tablist" aria-label={tr("最近记录")}>
              <button id="welcome-workspaces-tab" type="button" role="tab" aria-selected={recentTab === "workspaces"} aria-controls="welcome-workspaces-panel" tabIndex={recentTab === "workspaces" ? 0 : -1} className={recentTab === "workspaces" ? "is-active" : ""} onClick={() => setRecentTab("workspaces")}>
                <FolderOpen size={15} aria-hidden="true" /><span>{tr("工作区")}</span><em>{recentWorkspaces.length}</em>
              </button>
              <button id="welcome-files-tab" type="button" role="tab" aria-selected={recentTab === "files"} aria-controls="welcome-files-panel" tabIndex={recentTab === "files" ? 0 : -1} className={recentTab === "files" ? "is-active" : ""} onClick={() => setRecentTab("files")}>
                <FileText size={15} aria-hidden="true" /><span>{tr("单文件")}</span><em>{recentExternalFiles.length}</em>
              </button>
            </div>
          </div>
          {recentTab === "workspaces" && errorMessage ? (
            <div className="welcome-error" role="status">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          ) : null}
          {recentTab === "workspaces" ? (
            <div id="welcome-workspaces-panel" className="welcome-recent-tabpanel" role="tabpanel" aria-labelledby="welcome-workspaces-tab">
              {recentWorkspaces.length === 0 ? <div className="empty-state">{tr("暂无最近工作区。")}</div> : null}
              <div className="welcome-recent-items">
                {recentWorkspaces.map((workspace) => {
                  const unavailable = !workspace.exists;
                  const opening = openingWorkspaceId === workspace.workspaceId;
                  const unavailableReason = recentWorkspaceUnavailableReason(workspace, tr);
                  return <div key={workspace.workspaceId} className={`welcome-recent-item${unavailable ? " is-unavailable" : ""}`}><button type="button" className="welcome-recent-main" aria-label={`${unavailable ? tr("无法打开") : tr("打开最近工作区")} ${workspace.name}, ${tr("路径 {path}", { path: workspace.path })}`} title={unavailable ? tr("{reason}：{path}", { reason: unavailableReason, path: workspace.path }) : tr("打开 {path}", { path: workspace.path })} disabled={opening} onClick={() => onOpenRecent(workspace)}><span className="welcome-recent-icon">{unavailable ? <CircleAlert size={17} /> : <FolderOpen size={17} />}</span><span className="welcome-recent-meta"><strong>{workspace.name}</strong><span>{workspace.path}</span><em>{unavailable ? unavailableReason : opening ? tr("正在打开...") : formatRecentTime(workspace.lastOpenedAt, locale, tr)}</em></span>{!unavailable ? <span className="welcome-recent-open" title={tr("打开")}><ArrowRight className="welcome-recent-arrow" size={17} aria-hidden="true" /></span> : null}</button><button type="button" className="welcome-recent-delete" aria-label={tr("删除工作区记录 {name}", { name: workspace.name })} title={tr("删除工作区记录")} onClick={() => onRemoveRecent(workspace)}><Trash2 size={15} aria-hidden="true" /></button></div>;
                })}
              </div>
            </div>
          ) : (
            <div id="welcome-files-panel" className="welcome-recent-tabpanel" role="tabpanel" aria-labelledby="welcome-files-tab">
              {recentExternalFiles.length === 0 ? <div className="empty-state">{tr("暂无最近文件。")}</div> : null}
              <div className="welcome-recent-items">
                {recentExternalFiles.map((file) => {
                  const unavailable = file.availability !== "available";
                  return <div key={file.filePath} className={`welcome-recent-item${unavailable ? " is-unavailable" : ""}`}><button type="button" className="welcome-recent-main" aria-label={`${unavailable ? tr("无法打开") : tr("打开")} ${file.name}, ${tr("路径 {path}", { path: file.filePath })}`} title={file.filePath} onClick={() => onOpenRecentFile(file)}><span className="welcome-recent-icon">{unavailable ? <CircleAlert size={17} /> : <FileText size={17} />}</span><span className="welcome-recent-meta"><strong>{file.name}</strong><span>{file.filePath}</span><em>{unavailable ? tr("文件不可用") : formatRecentTime(file.lastOpenedAt, locale, tr)}</em></span>{!unavailable ? <span className="welcome-recent-open" title={tr("打开")}><ArrowRight className="welcome-recent-arrow" size={17} aria-hidden="true" /></span> : null}</button><button type="button" className="welcome-recent-delete" aria-label={tr("删除文件记录 {name}", { name: file.name })} onClick={() => onRemoveRecentFile(file)}><Trash2 size={15} /></button></div>;
                })}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export function recentWorkspaceUnavailableReason(workspace: RecentWorkspace, tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  return workspace.availability === "notWorkspace" ? tr("不是 Nolia 工作区") : tr("路径不可用");
}

function formatRecentTime(timestamp: number, locale: ResolvedLocale, tr: ReturnType<typeof useRendererI18n>["tr"]): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return tr("最近打开");
  }
  return tr("上次打开 {time}", { time: formatDate(locale, timestamp, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) });
}
