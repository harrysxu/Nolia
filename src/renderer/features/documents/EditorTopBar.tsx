import { Clock3, Download, FolderOpen, List, Menu, PanelLeftClose, PanelLeftOpen, PanelRightOpen, RefreshCw, Save, SaveAll, Search, Settings2, Sparkles, Star } from "lucide-react";

import type { ActiveResource, OpenDocumentTab } from "../../app/types";
import { useRendererI18n } from "../../app/i18n";

interface EditorTopBarProps {
  document?: OpenDocumentTab;
  resource?: ActiveResource;
  resourceKindLabel?: string;
  mode: OpenDocumentTab["mode"];
  leftPanelCollapsed: boolean;
  canToggleLeft: boolean;
  isImmersive: boolean;
  isFavorite: boolean;
  showShellActions: boolean;
  inspectorCollapsed: boolean;
  aiOpen: boolean;
  onToggleLeft: () => void;
  onOpenCommandPalette: () => void;
  onToggleAi: () => void;
  onToggleSettings: () => void;
  onOpenOutline: () => void;
  onOpenHistory: () => void;
  onModeChange: (mode: OpenDocumentTab["mode"]) => void;
  onToggleFavorite: () => void;
  onOpenFindReplace: () => void;
  onRefresh: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: (format: "pdf" | "html" | "markdown") => void;
  onOpenFolder: () => void;
}

export function EditorTopBar(props: EditorTopBarProps) {
  const { tr } = useRendererI18n();
  if (props.isImmersive && props.document) {
    const fileName = documentFileName(props.document.pathRel);
    return <div className="editor-topbar immersive-topbar"><div className="immersive-title" aria-label={tr("当前文件")} title={fileName}><strong>{fileName}</strong></div></div>;
  }
  return (
    <div className={`editor-topbar${props.showShellActions ? " is-single-file" : ""}`}>
      <div className="editor-topbar-left">
        {props.canToggleLeft ? <button type="button" className="icon-button compact" title={props.leftPanelCollapsed ? tr("展开左侧栏") : tr("收起左侧栏")} onClick={props.onToggleLeft}>{props.leftPanelCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button> : null}
        {props.showShellActions ? <div className="editor-shell-actions" aria-label="Nolia"><button type="button" className="icon-button compact" title={tr("命令面板")} aria-label={tr("命令面板")} onClick={props.onOpenCommandPalette}><Menu size={15} /></button><button type="button" className={`icon-button compact${props.aiOpen ? " is-active" : ""}`} title={tr("Nolia AI")} aria-label={tr("Nolia AI")} onClick={props.onToggleAi}><Sparkles size={15} /></button><button type="button" className="icon-button compact" title={tr("设置")} aria-label={tr("设置")} onClick={props.onToggleSettings}><Settings2 size={15} /></button></div> : null}
        {props.document && !props.showShellActions ? <div className="editor-document-identity"><strong>{documentFileName(props.document.pathRel)}</strong>{props.document.sourceKind === "external" ? <span title={documentDirectory(props.document.pathRel)}>{documentDirectory(props.document.pathRel)}</span> : null}{props.document.externalConflict ? <em>冲突</em> : props.document.dirty ? <em>未保存</em> : <em className="is-saved">已保存</em>}</div> : null}
        {props.document && props.showShellActions ? <span className={`editor-save-state${props.document.externalConflict ? " is-conflict" : props.document.dirty ? " is-dirty" : " is-saved"}`}>{props.document.externalConflict ? "冲突" : props.document.dirty ? "未保存" : "已保存"}</span> : null}
      </div>
      <div className="editor-topbar-right">
        {!props.showShellActions ? <button type="button" className={`icon-button compact${props.aiOpen ? " is-active" : ""}`} title={tr("Nolia AI")} aria-label={tr("Nolia AI")} onClick={props.onToggleAi}><Sparkles size={15} /></button> : null}
        {props.document ? <>
          <button type="button" className="icon-button compact" title={tr("保存")} aria-label={tr("保存")} disabled={Boolean(props.document.readonly)} onClick={props.onSave}><Save size={15} /></button>
          {props.document.sourceKind === "external" ? <button type="button" className="icon-button compact" title="另存为" aria-label="另存为" onClick={props.onSaveAs}><SaveAll size={15} /></button> : null}
          <details className="editor-export-menu"><summary className="icon-button compact" title="导出" aria-label="导出"><Download size={15} /></summary><div role="menu"><button type="button" role="menuitem" onClick={() => props.onExport("pdf")}>PDF</button><button type="button" role="menuitem" onClick={() => props.onExport("html")}>HTML</button><button type="button" role="menuitem" onClick={() => props.onExport("markdown")}>Markdown</button></div></details>
          {props.document.sourceKind === "external" ? <button type="button" className={`icon-button compact${props.document.folderSession ? " is-active" : ""}`} title="打开所在文件夹" aria-label="打开所在文件夹" onClick={props.onOpenFolder}><FolderOpen size={15} /></button> : null}
          {props.document.sourceKind !== "external" ? <button type="button" className={`icon-button compact favorite-toggle${props.isFavorite ? " is-active" : ""}`} title={props.isFavorite ? tr("取消收藏") : tr("收藏文档")} aria-label={props.isFavorite ? tr("取消收藏") : tr("收藏文档")} onClick={props.onToggleFavorite}><Star size={15} fill={props.isFavorite ? "currentColor" : "none"} /></button> : null}
          <button type="button" className="icon-button compact" title={tr("查找和替换")} aria-label={tr("查找和替换")} onClick={props.onOpenFindReplace}><Search size={15} /></button>
          {props.document.sourceKind !== "external" ? <button type="button" className="icon-button compact" title={tr("重新读取")} aria-label={tr("重新读取")} onClick={props.onRefresh}><RefreshCw size={15} /></button> : null}
          <div className="editor-topbar-outline-slot"><button type="button" data-inspector-trigger className={`outline-toggle-button${props.inspectorCollapsed ? " is-collapsed" : ""}`} title={props.inspectorCollapsed ? tr("展开右侧面板") : tr("目录")} aria-label={props.inspectorCollapsed ? tr("展开右侧面板") : tr("目录")} onClick={props.onOpenOutline}>{props.inspectorCollapsed ? <PanelRightOpen size={15} /> : <List size={15} />}<span>{props.inspectorCollapsed ? tr("检查器") : tr("目录")}</span></button>{props.document.sourceKind !== "external" ? <button type="button" className="outline-toggle-button" title={tr("历史版本")} aria-label={tr("历史版本")} onClick={props.onOpenHistory}><Clock3 size={15} /><span>{tr("历史")}</span></button> : null}</div>
          <div className="segmented-control" aria-label={tr("编辑模式")}>{(["wysiwyg", "source", "split"] as const).map((item) => <button key={item} type="button" className={props.mode === item ? "is-active" : ""} onClick={() => props.onModeChange(item)}>{item === "wysiwyg" ? tr("编辑") : item === "source" ? tr("MD") : tr("分屏")}</button>)}</div>
        </> : props.resource ? <span className="resource-kind-pill">{props.resourceKindLabel}</span> : null}
      </div>
    </div>
  );
}

function documentFileName(pathRel: string): string {
  return pathRel.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? pathRel;
}

function documentDirectory(pathRel: string): string {
  const normalized = pathRel.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}
