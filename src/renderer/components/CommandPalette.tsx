import { useEffect, useMemo, useRef } from "react";
import { Search } from "lucide-react";

import { useRendererI18n } from "../app/i18n";

export interface PaletteAction {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  run: () => void | Promise<void>;
}

interface CommandPaletteProps {
  open: boolean;
  query: string;
  actions: PaletteAction[];
  onQueryChange: (query: string) => void;
  onClose: () => void;
}

export function CommandPalette({ open, query, actions, onQueryChange, onClose }: CommandPaletteProps) {
  const { tr } = useRendererI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) {
      return actions.slice(0, 12);
    }
    return actions.filter((action) => {
      const haystack = [action.label, action.description, ...(action.keywords ?? [])].join(" ").toLowerCase();
      return haystack.includes(lower);
    });
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="command-palette" role="dialog" aria-modal="true">
      <div className="command-palette-surface">
        <label className="command-palette-input">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
              }
              if (event.key === "Enter") {
                const action = filtered[0];
                if (action) {
                  void action.run();
                  onClose();
                }
              }
            }}
            placeholder={tr("输入命令")}
          />
        </label>
        <div className="command-palette-list">
          {filtered.map((action) => (
            <button
              key={action.id}
              type="button"
              className="command-item"
              onClick={() => {
                void action.run();
                onClose();
              }}
            >
              <span className="command-label">{action.label}</span>
              {action.description ? <span className="command-description">{action.description}</span> : null}
            </button>
          ))}
          {filtered.length === 0 ? <div className="empty-state">{tr("没有匹配的命令。")}</div> : null}
        </div>
      </div>
      <button type="button" className="command-backdrop" aria-label={tr("关闭命令面板")} onClick={onClose} />
    </div>
  );
}
