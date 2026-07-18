import { CircleAlert, FileText, X } from "lucide-react";

import type { OpenDocumentTab } from "../../app/types";
import { useRendererI18n } from "../../app/i18n";

interface DocumentTabBarProps {
  documents: OpenDocumentTab[];
  activePathRel?: string;
  onActivate: (document: OpenDocumentTab) => void;
  onClose: (document: OpenDocumentTab) => void;
}

export function DocumentTabBar({ documents, activePathRel, onActivate, onClose }: DocumentTabBarProps) {
  const { tr } = useRendererI18n();
  if (!documents.length) {
    return null;
  }

  return (
    <div className="document-tab-bar" role="tablist" aria-label={tr("打开的文档")}>
      <div className="document-tab-scroll">
        {documents.map((document) => {
          const active = document.pathRel === activePathRel;
          const label = documentFileName(document);
          return (
            <div key={`${document.sourceKind ?? "workspace"}:${document.pathRel}`} className={`document-tab${active ? " is-active" : ""}${document.dirty ? " is-dirty" : ""}${document.externalConflict ? " is-conflict" : ""}`}>
              <button
                type="button"
                className="document-tab-main"
                role="tab"
                aria-selected={active}
                aria-label={tr("打开文档 {name}", { name: label })}
                title={document.pathRel}
                onClick={() => onActivate(document)}
              >
                <FileText size={14} aria-hidden="true" />
                <span className="document-tab-label">{label}</span>
                {document.externalConflict ? <CircleAlert className="document-tab-conflict" size={13} aria-label="文件冲突" /> : document.dirty ? <span className="document-tab-dirty" aria-label={tr("未保存")} /> : null}
              </button>
              <button
                type="button"
                className="document-tab-close"
                aria-label={tr("关闭文档 {name}", { name: label })}
                title={tr("关闭文档")}
                onClick={() => onClose(document)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function documentFileName(document: OpenDocumentTab): string {
  const normalized = document.pathRel.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() ?? document.title ?? document.pathRel;
}
