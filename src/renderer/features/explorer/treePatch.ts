import type { FileTreeNode, WorkspaceIndexedEvent } from "../../../shared/types";

export function applyWorkspaceTreeEvent(nodes: FileTreeNode[], event: WorkspaceIndexedEvent): FileTreeNode[] {
  if (!event.operation || !event.pathRel) return nodes;
  if (event.operation === "delete") {
    return nodes.filter((node) => node.pathRel !== event.pathRel && !node.pathRel.startsWith(`${event.pathRel}/`)).map((node) => node.children ? { ...node, children: applyWorkspaceTreeEvent(node.children, event) } : node);
  }
  if (!event.node) return nodes;
  let replaced = false;
  const replace = (items: FileTreeNode[]): FileTreeNode[] => items.map((item) => {
    if (item.pathRel === event.pathRel) {
      replaced = true;
      return { ...event.node!, children: event.node!.kind === "directory" ? item.children ?? event.node!.children : undefined };
    }
    return item.children ? { ...item, children: replace(item.children) } : item;
  });
  const updated = replace(nodes);
  if (replaced || event.operation === "change") return updated;
  const parentPath = event.pathRel.includes("/") ? event.pathRel.slice(0, event.pathRel.lastIndexOf("/")) : "";
  if (!parentPath) return sortTreePatchNodes([...updated, event.node]);
  const insert = (items: FileTreeNode[]): FileTreeNode[] => items.map((item) => item.pathRel === parentPath && item.kind === "directory"
    ? { ...item, children: sortTreePatchNodes([...(item.children ?? []), event.node!]) }
    : item.children ? { ...item, children: insert(item.children) } : item);
  return insert(updated);
}

function sortTreePatchNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.kind === "directory" && right.kind !== "directory") return -1;
    if (left.kind !== "directory" && right.kind === "directory") return 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
}
