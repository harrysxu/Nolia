import { ArrowLeft, Check, FilePlus2, FileText, FolderPlus, Move, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { AiPatchOperation, AiPatchProposal } from "../../../shared/ai";

export function AiApprovalView({ proposal, applying, onBack, onReject, onApply }: { proposal: AiPatchProposal; applying: boolean; onBack: () => void; onReject: () => void; onApply: (selectedOperationIds: string[]) => void }) {
  const operations = useMemo(() => proposal.operations.map((operation, index) => ({ ...operation, id: operation.id ?? `operation-${index + 1}` })), [proposal]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(operations.map((operation) => operation.id)));
  const toggle = (operation: AiPatchOperation & { id: string }) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(operation.id)) next.delete(operation.id);
      else {
        next.add(operation.id);
        includeDependencies(operation, operations, next);
      }
      for (const candidate of operations) {
        if ((candidate.dependsOn ?? []).some((dependency) => !next.has(dependency))) next.delete(candidate.id);
      }
      return next;
    });
  };
  return <section className="ai-approval-page" aria-labelledby="ai-approval-title"><header><button type="button" className="icon-button" onClick={onBack} aria-label="返回任务"><ArrowLeft size={17} /></button><div><h1 id="ai-approval-title">审查 AI 修改</h1><p>{proposal.summary}</p></div><button type="button" className="danger-text" onClick={onReject} disabled={applying}><X size={16} />拒绝</button><button type="button" className="is-primary" onClick={() => onApply([...selected])} disabled={applying || !selected.size}><Check size={16} />{applying ? "正在应用" : `应用 ${selected.size} 项修改`}</button></header><div className="ai-approval-list">{operations.map((operation) => <label key={operation.id} className={selected.has(operation.id) ? "is-selected" : ""}><input type="checkbox" checked={selected.has(operation.id)} onChange={() => toggle(operation)} disabled={applying} />{operationIcon(operation)}<span><strong>{operationLabel(operation)}</strong><small>{operationPath(operation, proposal.pathRel)}</small>{operation.dependsOn?.length ? <em>依赖 {operation.dependsOn.join(", ")}</em> : null}</span>{"beforeText" in operation ? <pre><del>{operation.beforeText.slice(0, 500)}</del><ins>{operation.afterText.slice(0, 500)}</ins></pre> : "afterText" in operation ? <pre><ins>{operation.afterText.slice(0, 700)}</ins></pre> : null}</label>)}</div></section>;
}

function includeDependencies(operation: AiPatchOperation & { id: string }, operations: Array<AiPatchOperation & { id: string }>, selected: Set<string>) {
  for (const id of operation.dependsOn ?? []) {
    if (selected.has(id)) continue;
    selected.add(id);
    const dependency = operations.find((item) => item.id === id);
    if (dependency) includeDependencies(dependency, operations, selected);
  }
}

function operationIcon(operation: AiPatchOperation) {
  if (operation.type === "createDirectory") return <FolderPlus size={17} />;
  if (operation.type === "createFile") return <FilePlus2 size={17} />;
  if (operation.type === "movePath") return <Move size={17} />;
  return <FileText size={17} />;
}

function operationLabel(operation: AiPatchOperation): string {
  if (operation.type === "createDirectory") return "创建目录";
  if (operation.type === "createFile") return "创建文件";
  if (operation.type === "movePath") return "移动路径";
  if (operation.type === "append") return "追加内容";
  if (operation.type === "insertAt") return "插入内容";
  return operation.type === "replaceDocument" ? "替换文档" : "替换选区";
}

function operationPath(operation: AiPatchOperation, fallback: string): string {
  if (operation.type === "movePath") return `${operation.sourcePathRel} -> ${operation.targetPathRel}`;
  return "pathRel" in operation && operation.pathRel ? operation.pathRel : fallback;
}
