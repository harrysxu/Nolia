import { create } from "zustand";

import type { RightPanelView, SidebarView } from "./types";
import type { EditorMode } from "../../shared/types";

interface UiState {
  sidebarView: SidebarView;
  rightPanelView: RightPanelView;
  commandPaletteOpen: boolean;
  theme: string;
  setSidebarView: (view: SidebarView) => void;
  setRightPanelView: (view: RightPanelView) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTheme: (theme: string) => void;
  setEditorMode: (mode: EditorMode) => void;
  editorMode: EditorMode;
  focusMode: boolean;
  toolbarVisible: boolean;
  lineNumbersVisible: boolean;
  setFocusMode: (value: boolean) => void;
  setToolbarVisible: (value: boolean) => void;
  setLineNumbersVisible: (value: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarView: "files",
  rightPanelView: "outline",
  commandPaletteOpen: false,
  theme: "system",
  editorMode: "wysiwyg",
  focusMode: false,
  toolbarVisible: true,
  lineNumbersVisible: true,
  setSidebarView: (view) => set({ sidebarView: view }),
  setRightPanelView: (view) => set({ rightPanelView: view }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setTheme: (theme) => set({ theme }),
  setEditorMode: (editorMode) => set({ editorMode }),
  setFocusMode: (focusMode) => set({ focusMode }),
  setToolbarVisible: (toolbarVisible) => set({ toolbarVisible }),
  setLineNumbersVisible: (lineNumbersVisible) => set({ lineNumbersVisible })
}));
