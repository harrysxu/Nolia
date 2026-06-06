import type { DocumentListItem, FavoriteDocument, StoredDocumentItem } from "./types";

const MAX_WORKSPACE_LIST_ITEMS = 30;

export function loadWorkspaceLocalLists(workspaceId: string): {
  favorites: FavoriteDocument[];
  recentViewed: DocumentListItem[];
  recentEdited: DocumentListItem[];
} {
  return {
    favorites: readWorkspaceLocalList<FavoriteDocument>(workspaceId, "favorites", isFavoriteDocument),
    recentViewed: readWorkspaceLocalList<DocumentListItem>(workspaceId, "recentViewed", isDocumentListItem),
    recentEdited: readWorkspaceLocalList<DocumentListItem>(workspaceId, "recentEdited", isDocumentListItem)
  };
}

export function readWorkspaceLocalList<T extends StoredDocumentItem>(workspaceId: string, name: string, guard: (value: StoredDocumentItem) => value is T): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(workspaceStorageKey(workspaceId, name)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is T => isStoredDocumentItem(item) && guard(item)).slice(0, MAX_WORKSPACE_LIST_ITEMS);
  } catch {
    return [];
  }
}

export function saveWorkspaceLocalList(workspaceId: string, name: string, items: StoredDocumentItem[]) {
  localStorage.setItem(workspaceStorageKey(workspaceId, name), JSON.stringify(items.slice(0, MAX_WORKSPACE_LIST_ITEMS)));
}

export function workspaceStorageKey(workspaceId: string, name: string): string {
  return `nolia:${workspaceId}:${name}`;
}

export function upsertDocumentListItem(items: DocumentListItem[], item: DocumentListItem): DocumentListItem[] {
  return [item, ...items.filter((entry) => entry.pathRel !== item.pathRel)]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, MAX_WORKSPACE_LIST_ITEMS);
}

export function isStoredDocumentItem(value: unknown): value is StoredDocumentItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<StoredDocumentItem>;
  return typeof item.pathRel === "string" && typeof item.title === "string";
}

export function isDocumentListItem(value: StoredDocumentItem | undefined): value is DocumentListItem {
  return Boolean(
    value &&
      "timestamp" in value &&
      typeof value.timestamp === "number" &&
      (!("kind" in value) || value.kind === undefined || value.kind === "file" || value.kind === "resource")
  );
}

export function isFavoriteDocument(value: StoredDocumentItem | undefined): value is FavoriteDocument {
  return Boolean(value && "addedAt" in value && typeof value.addedAt === "number");
}
