import { Check, History, Link2, List, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { BacklinksResponse } from "../../../shared/types";
import type { OpenDocumentTab } from "../../app/types";

export type InspectorTab = "outline" | "properties" | "links" | "history";

export function InspectorTabs({ active, onChange, external = false }: { active: InspectorTab; onChange: (tab: InspectorTab) => void; external?: boolean }) {
  const tabs = [{ id: "outline" as const, label: "目录", icon: <List size={15} /> }, { id: "properties" as const, label: "属性", icon: <SlidersHorizontal size={15} /> }, { id: "links" as const, label: "关系", icon: <Link2 size={15} /> }, { id: "history" as const, label: "历史", icon: <History size={15} /> }];
  return <div className="inspector-tabs" role="tablist" aria-label="文档检查器">{tabs.map((tab) => { const unavailable = external && (tab.id === "links" || tab.id === "history"); return <button type="button" role="tab" aria-selected={active === tab.id} aria-disabled={unavailable} title={unavailable ? `${tab.label}仅在工作区中可用` : tab.label} className={`${active === tab.id ? "is-active" : ""}${unavailable ? " is-unavailable" : ""}`} key={tab.id} onClick={() => onChange(tab.id)}>{tab.icon}<span>{tab.label}</span></button>; })}</div>;
}

export function PropertiesPanel({ document, readOnly, onSet, onDelete }: { document?: OpenDocumentTab; readOnly: boolean; onSet: (key: string, value: unknown) => void; onDelete: (key: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<NewPropertyType>("text");
  const [newValue, setNewValue] = useState("");
  const [addError, setAddError] = useState<string>();
  useEffect(() => {
    setAdding(false);
    setNewKey("");
    setNewType("text");
    setNewValue("");
    setAddError(undefined);
  }, [document?.pathRel]);
  if (!document) return <div className="inspector-empty">未打开文档</div>;
  const yamlError = document.parsed.diagnostics.find((item) => item.severity === "error");
  if (yamlError) return <div className="inspector-error" role="alert"><strong>无法编辑属性</strong><p>{yamlError.message}{yamlError.line ? `，第 ${yamlError.line} 行` : ""}</p></div>;
  const entries = Object.entries(document.parsed.frontmatter);
  const cancelAdd = () => {
    setAdding(false);
    setNewKey("");
    setNewType("text");
    setNewValue("");
    setAddError(undefined);
  };
  const submitAdd = () => {
    const key = newKey.trim();
    if (!key) {
      setAddError("请输入属性名。");
      return;
    }
    if (entries.some(([existingKey]) => existingKey === key)) {
      setAddError(`属性“${key}”已存在。`);
      return;
    }
    const parsedValue = parseNewPropertyValue(newType, newValue, key);
    if (!parsedValue.ok) {
      setAddError(parsedValue.error);
      return;
    }
    onSet(key, parsedValue.value);
    cancelAdd();
  };
  return <div className="properties-panel">
    <div className="property-add-toolbar">
      <strong>新增属性</strong>
      <button type="button" className="icon-button" aria-label={adding ? "取消新增属性" : "添加属性"} title={adding ? "取消" : "添加属性"} disabled={readOnly} onClick={() => { if (adding) cancelAdd(); else setAdding(true); }}>{adding ? <X size={15} /> : <Plus size={15} />}</button>
    </div>
    {adding ? <form className="property-add-form" onSubmit={(event) => { event.preventDefault(); submitAdd(); }}>
      <label><span>属性名</span><input autoFocus aria-label="属性名" value={newKey} onChange={(event) => { setNewKey(event.target.value); setAddError(undefined); }} placeholder="例如 status" /></label>
      <label><span>类型</span><select aria-label="属性类型" value={newType} onChange={(event) => { setNewType(event.target.value as NewPropertyType); setNewValue(""); setAddError(undefined); }}><option value="text">文本</option><option value="number">数字</option><option value="boolean">开关</option><option value="date">日期</option><option value="list">列表 / 标签</option></select></label>
      <label><span>值</span>{newType === "boolean" ? <select aria-label="属性值" value={newValue || "false"} onChange={(event) => setNewValue(event.target.value)}><option value="false">关闭</option><option value="true">开启</option></select> : <input aria-label="属性值" type={newType === "date" ? "date" : "text"} inputMode={newType === "number" ? "decimal" : undefined} value={newValue} onChange={(event) => { setNewValue(event.target.value); setAddError(undefined); }} placeholder={newType === "list" ? "用逗号分隔" : "可留空"} />}</label>
      {addError ? <p className="property-add-error" role="alert">{addError}</p> : null}
      <div className="property-add-actions"><button type="button" onClick={cancelAdd}>取消</button><button type="submit" className="is-primary"><Check size={14} />添加</button></div>
    </form> : null}
    {entries.map(([key, value]) => <PropertyRow key={key} name={key} value={value} disabled={readOnly} onChange={(next) => onSet(key, next)} onDelete={() => onDelete(key)} />)}
    {!entries.length && !adding ? <div className="inspector-empty">此文档还没有属性。</div> : null}
  </div>;
}

type NewPropertyType = "text" | "number" | "boolean" | "date" | "list";

function parseNewPropertyValue(type: NewPropertyType, draft: string, key: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (type === "number") {
    if (!draft.trim() || !Number.isFinite(Number(draft))) return { ok: false, error: "请输入有效数字。" };
    return { ok: true, value: Number(draft) };
  }
  if (type === "boolean") return { ok: true, value: draft === "true" };
  if (type === "list") {
    const values = draft.split(",").map((item) => item.trim()).filter(Boolean);
    return { ok: true, value: key.toLowerCase() === "tags" ? values.map((item) => item.replace(/^#/, "")) : values };
  }
  return { ok: true, value: draft };
}

function PropertyRow({ name, value, disabled, onChange, onDelete }: { name: string; value: unknown; disabled: boolean; onChange: (value: unknown) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(propertyText(value));
  const commit = () => onChange(parsePropertyValue(value, draft));
  return <div className="property-row"><label title={name}>{name}</label>{typeof value === "boolean" ? <input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /> : <input value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); }} />}<button type="button" className="icon-button" aria-label={`删除 ${name}`} disabled={disabled} onClick={onDelete}><Trash2 size={13} /></button></div>;
}

export function LinksPanel({ document, backlinks, onOpen, onOpenGraph, onConvertMention }: { document?: OpenDocumentTab; backlinks: BacklinksResponse; onOpen: (pathRel: string) => void; onOpenGraph: () => void; onConvertMention: (pathRel: string) => void }) {
  if (!document) return <div className="inspector-empty">未打开文档</div>;
  return <div className="links-panel"><LinkSection title="出链" items={[...document.parsed.wikilinks.map((item) => ({ key: `${item.targetText}:${item.line}`, title: item.alias || item.targetText, detail: item.targetHeading ? `#${item.targetHeading}` : "", pathRel: item.targetText })), ...document.parsed.links.filter((item) => !/^https?:/i.test(item.href)).map((item) => ({ key: `${item.href}:${item.line}`, title: item.text || item.href, detail: item.href, pathRel: item.href.split("#")[0] }))]} onOpen={onOpen} /><LinkSection title="反向链接" items={backlinks.linked.map((item) => ({ key: `${item.pathRel}:${item.line}`, title: item.title, detail: item.context, pathRel: item.pathRel }))} onOpen={onOpen} /><section><h3>未链接提及</h3>{backlinks.unlinked.map((item) => <div className="mention-row" key={`${item.pathRel}:${item.line}`}><button type="button" onClick={() => onOpen(item.pathRel)}><strong>{item.title}</strong><span>{item.context}</span></button><button type="button" onClick={() => onConvertMention(item.pathRel)}>转为链接</button></div>)}{!backlinks.unlinked.length ? <p className="inspector-empty">没有未链接提及。</p> : null}</section><button type="button" className="open-graph-button" onClick={onOpenGraph}><Link2 size={15} />打开局部关系图</button></div>;
}

function LinkSection({ title, items, onOpen }: { title: string; items: Array<{ key: string; title: string; detail: string; pathRel: string }>; onOpen: (pathRel: string) => void }) {
  return <section><h3>{title}</h3>{items.map((item) => <button type="button" className="inspector-link-row" key={item.key} onClick={() => onOpen(item.pathRel)}><strong>{item.title}</strong><span>{item.detail}</span></button>)}{!items.length ? <p className="inspector-empty">暂无内容。</p> : null}</section>;
}

function propertyText(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
}

function parsePropertyValue(previous: unknown, value: string): unknown {
  if (Array.isArray(previous)) return value.split(",").map((item) => item.trim()).filter(Boolean);
  if (typeof previous === "number") return Number.isFinite(Number(value)) ? Number(value) : previous;
  return value;
}
