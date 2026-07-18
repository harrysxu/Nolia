import { Dot, Files, Menu, Search, Settings2, Sparkles } from "lucide-react";

import noliaIconUrl from "../../../build/icon.svg";
import type { SidebarView } from "./types";
import { useRendererI18n } from "./i18n";

interface AppNavigationProps {
  sidebarView: SidebarView;
  onChange: (view: SidebarView) => void;
  onOpenCommandPalette: () => void;
  onToggleSettings: () => void;
  settingsOpen: boolean;
}

export function AppNavigation({ sidebarView, onChange, onOpenCommandPalette, onToggleSettings, settingsOpen }: AppNavigationProps) {
  const { tr } = useRendererI18n();
  const items = [
    { id: "files", title: tr("文件"), icon: <Files size={18} /> },
    { id: "search", title: tr("发现"), icon: <Search size={18} /> },
    { id: "ai", title: "AI", icon: <Sparkles size={18} /> }
  ];
  return (
    <nav className="app-nav" aria-label={tr("工作区导航")}>
      <div className="nav-avatar" role="img" aria-label="Nolia">
        <img className="nav-avatar-logo" src={noliaIconUrl} alt="" />
      </div>
      <div className="app-nav-main">
        {items.map((item) => (
          <button key={item.id} type="button" className={`nav-item${sidebarView === item.id ? " is-active" : ""}`} title={item.title} aria-label={item.title} onClick={() => onChange(item.id)}>
            {item.icon}
            <span>{item.title}</span>
            {sidebarView === item.id ? <Dot className="nav-active-dot" size={18} aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div className="app-nav-bottom">
        <button type="button" className="nav-icon-button" title={tr("命令面板")} aria-label={tr("命令面板")} onClick={onOpenCommandPalette}><Menu size={18} /></button>
        <button type="button" className={`nav-icon-button${settingsOpen ? " is-active" : ""}`} title={tr("设置")} aria-label={tr("设置")} onClick={onToggleSettings}><Settings2 size={18} /></button>
      </div>
    </nav>
  );
}
