import type { SidebarView } from "./types";

const BUILT_IN_WORKSPACE_PAGE_VIEWS = new Set<SidebarView>(["ai"]);

export function isWorkspaceNavigationViewAvailable(view: SidebarView, sidebarPanels: ReadonlyArray<{ id: string }>): boolean {
  return BUILT_IN_WORKSPACE_PAGE_VIEWS.has(view) || sidebarPanels.some((panel) => panel.id === view);
}
