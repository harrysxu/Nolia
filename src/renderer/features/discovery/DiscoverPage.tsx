import { BookmarkPlus, LoaderCircle, Pencil, Search, Star, Tags, X } from "lucide-react";
import { useState } from "react";

import type { SavedSearch, SearchMode, TagSummary, UnifiedSearchResult } from "../../../shared/contracts";
import { useRendererI18n } from "../../app/i18n";
import type { DocumentListItem, FavoriteDocument } from "../../app/types";

interface DiscoverPageProps {
  query: string;
  mode: SearchMode;
  results: UnifiedSearchResult[];
  fallbackReason?: string;
  loading: boolean;
  error?: string;
  recent: DocumentListItem[];
  favorites: FavoriteDocument[];
  savedSearches: SavedSearch[];
  tags: TagSummary[];
  selectedTag?: string;
  writable: boolean;
  onQueryChange: (query: string) => void;
  onModeChange: (mode: SearchMode) => void;
  onOpen: (pathRel: string) => void;
  onSaveSearch: (name: string) => void;
  onRunSaved: (search: SavedSearch) => void;
  onDeleteSaved: (id: string) => void;
  onSelectTag: (tag?: string) => void;
  onRenameTag: (sourceTag: string, targetTag: string) => void;
}

export function DiscoverPage(props: DiscoverPageProps) {
  const { tr } = useRendererI18n();
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [renamingTag, setRenamingTag] = useState<string>();
  const [tagName, setTagName] = useState("");
  const hasQuery = Boolean(props.query.trim() || props.selectedTag);
  return (
    <section className="discover-page" aria-labelledby="discover-title">
      <header className="discover-header">
        <h1 id="discover-title">{tr("发现")}</h1>
        <div className="discover-search-row">
          <label className="discover-search">
            {props.loading ? <LoaderCircle className="discover-search-spinner" size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
            <input autoFocus value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder={tr("搜索标题、正文、路径、标签或属性")} />
          </label>
          <div className="search-mode" aria-label={tr("搜索模式")}>
            <button type="button" className={props.mode === "exact" ? "is-active" : ""} onClick={() => props.onModeChange("exact")}>{tr("精确")}</button>
            <button type="button" className={props.mode === "hybrid" ? "is-active" : ""} onClick={() => props.onModeChange("hybrid")}>{tr("混合")}</button>
          </div>
          <button type="button" className="icon-button" title={tr("保存搜索")} aria-label={tr("保存搜索")} disabled={!hasQuery} onClick={() => setSaving(true)}><BookmarkPlus size={17} /></button>
        </div>
        {props.fallbackReason ? <p className="discover-fallback" role="status">{props.fallbackReason}</p> : null}
        {props.error ? <p className="discover-search-error" role="alert">{props.error}</p> : null}
        {saving ? <form className="save-search-form" onSubmit={(event) => { event.preventDefault(); if (saveName.trim()) { props.onSaveSearch(saveName.trim()); setSaveName(""); setSaving(false); } }}><input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder={tr("搜索名称")} autoFocus /><button type="submit">{tr("保存")}</button><button type="button" className="icon-button" onClick={() => setSaving(false)} aria-label={tr("取消")}><X size={15} /></button></form> : null}
      </header>

      <div className="discover-layout">
        <aside className="discover-nav" aria-label={tr("发现分类")}>
          <h2><Star size={15} />{tr("收藏")}</h2>
          {props.favorites.slice(0, 8).map((item) => <button type="button" key={item.pathRel} onClick={() => props.onOpen(item.pathRel)}>{item.title}</button>)}
          <h2><Tags size={15} />{tr("标签")}</h2>
          {props.tags.map((tag) => <div className={`tag-filter-row${props.selectedTag === tag.name ? " is-active" : ""}`} key={tag.name}>
            <button type="button" aria-pressed={props.selectedTag === tag.name} onClick={() => props.onSelectTag(props.selectedTag === tag.name ? undefined : tag.name)}><span>#{tag.displayName}</span><small>{tag.count}</small></button>
            {props.writable ? <button type="button" className="icon-button" aria-label={`重命名标签 ${tag.displayName}`} onClick={() => { setRenamingTag(tag.name); setTagName(tag.displayName); }}><Pencil size={12} /></button> : null}
          </div>)}
          {renamingTag ? <form className="tag-rename-form" onSubmit={(event) => { event.preventDefault(); const next = tagName.trim().replace(/^#/, ""); if (next && next !== renamingTag) props.onRenameTag(renamingTag, next); setRenamingTag(undefined); }}><input aria-label="新标签名称" autoFocus value={tagName} onChange={(event) => setTagName(event.target.value)} /><button type="submit">预览</button><button type="button" className="icon-button" aria-label={tr("取消")} onClick={() => setRenamingTag(undefined)}><X size={12} /></button></form> : null}
          <h2><Tags size={15} />{tr("保存搜索")}</h2>
          {props.savedSearches.map((search) => <div className="saved-search-row" key={search.id}><button type="button" onClick={() => props.onRunSaved(search)}>{search.name}</button><button type="button" className="icon-button" aria-label={tr("删除 {name}", { name: search.name })} onClick={() => props.onDeleteSaved(search.id)}><X size={13} /></button></div>)}
        </aside>
        <div className="discover-content">
          {hasQuery ? <SearchResults results={props.results} query={props.query || props.selectedTag || ""} loading={props.loading} onOpen={props.onOpen} /> : <>
            <h2>{tr("最近编辑")}</h2>
            <div className="discover-recent-list">{props.recent.slice(0, 12).map((item) => <button type="button" key={item.pathRel} onClick={() => props.onOpen(item.pathRel)}><strong>{item.title}</strong><span>{item.pathRel}</span></button>)}</div>
          </>}
        </div>
      </div>
    </section>
  );
}

function SearchResults({ results, query, loading, onOpen }: { results: UnifiedSearchResult[]; query: string; loading: boolean; onOpen: (pathRel: string) => void }) {
  const { tr } = useRendererI18n();
  if (loading && !results.length) return <div className="discover-empty" role="status" aria-busy="true">{tr("正在搜索...")}</div>;
  if (!results.length) return <div className="discover-empty">{tr("没有匹配结果。")}</div>;
  return <div className="discover-results" role="listbox" aria-label={tr("搜索结果")}>{results.map((item) => <button type="button" role="option" aria-selected="false" key={item.pathRel} onClick={() => onOpen(item.pathRel)}><div><strong>{item.title}</strong>{item.source !== "exact" ? <em>{item.source === "both" ? tr("精确 + 语义") : tr("语义相关")}</em> : null}</div><small>{item.pathRel}</small><p>{highlightPlain(item.snippets[0] || "", query)}</p></button>)}</div>;
}

function highlightPlain(value: string, query: string): string {
  return value.replace(/<\/?mark>/g, "").slice(0, 280) || query;
}
