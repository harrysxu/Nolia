import type { FileTreeNode } from "../../shared/types";
import { createTranslator, type Translator } from "../../shared/i18n";
import type { RenameTarget } from "./types";

export function parentPathFor(pathRel: string, tr: Translator = createTranslator("zh-CN")): string {
  const parts = pathRel.split("/");
  if (parts.length <= 1) {
    return tr("全部文件");
  }
  return parts.slice(0, -1).join("/");
}

export function fileNameFor(pathRel: string): string {
  return pathRel.split("/").filter(Boolean).pop() ?? pathRel;
}

export function joinPath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath.replace(/\/+$/g, "")}/${name}` : name;
}

export function pathParent(pathRel: string): string {
  const parts = pathRel.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "";
  }
  return parts.slice(0, -1).join("/");
}

export function canDropTreeTarget(target: RenameTarget | undefined, destinationPath: string): boolean {
  if (!target) {
    return false;
  }
  if (pathParent(target.pathRel) === destinationPath || target.pathRel === destinationPath) {
    return false;
  }
  if (target.kind === "directory" && destinationPath.startsWith(`${target.pathRel}/`)) {
    return false;
  }
  return true;
}

export function sanitizeItemName(value: string): string {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}_.\-/ ]+/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^[-/]+|[-/]+$/g, "");
}

export function collectPathSet(nodes: FileTreeNode[]): Set<string> {
  const paths = new Set<string>();
  const visit = (items: FileTreeNode[]) => {
    items.forEach((item) => {
      paths.add(item.pathRel);
      if (item.children) {
        visit(item.children);
      }
    });
  };
  visit(nodes);
  return paths;
}

export function findFileTreeNode(nodes: FileTreeNode[], pathRel: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.pathRel === pathRel) {
      return node;
    }
    const child = node.children ? findFileTreeNode(node.children, pathRel) : undefined;
    if (child) {
      return child;
    }
  }
  return undefined;
}

export function firstOpenableFileTreeNode(nodes: FileTreeNode[]): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.kind === "markdown") {
      return node;
    }
    const child = node.children ? firstOpenableFileTreeNode(node.children) : undefined;
    if (child) {
      return child;
    }
    if (node.kind !== "directory") {
      return node;
    }
  }
  return undefined;
}

export function uniqueCopiedFilePath(preferredPath: string, existingPaths: Set<string>, tr: Translator = createTranslator("zh-CN")): string {
  if (!existingPaths.has(preferredPath)) {
    return preferredPath;
  }
  const parent = pathParent(preferredPath);
  const { stem, ext } = splitName(fileNameFor(preferredPath));
  let index = 1;
  while (true) {
    const suffix = index === 1 ? ` ${tr("副本")}` : ` ${tr("副本 {index}", { index })}`;
    const candidate = joinPath(parent, `${stem}${suffix}${ext}`);
    if (!existingPaths.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

export function uniqueMovedPath(preferredPath: string, existingPaths: Set<string>, kind: RenameTarget["kind"]): string {
  if (!existingPaths.has(preferredPath)) {
    return preferredPath;
  }
  const parent = pathParent(preferredPath);
  const { stem, ext } = kind === "directory" ? { stem: fileNameFor(preferredPath), ext: "" } : splitName(fileNameFor(preferredPath));
  let index = 2;
  while (true) {
    const candidate = joinPath(parent, `${stem} ${index}${ext}`);
    if (!existingPaths.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

export function splitName(name: string): { stem: string; ext: string } {
  const match = /^(.*?)(\.[^.]*)?$/.exec(name);
  const stem = match?.[1] || name;
  const ext = match?.[2] ?? "";
  return { stem, ext };
}

export function collectMoveDestinationOptions(nodes: FileTreeNode[], target?: RenameTarget, tr: Translator = createTranslator("zh-CN")): Array<{ pathRel: string; label: string }> {
  const options: Array<{ pathRel: string; label: string }> = [{ pathRel: "", label: tr("全部文件") }];
  const visit = (items: FileTreeNode[], depth: number) => {
    items.forEach((item) => {
      if (item.kind !== "directory") {
        return;
      }
      const isExcluded = target?.kind === "directory" && (item.pathRel === target.pathRel || item.pathRel.startsWith(`${target.pathRel}/`));
      if (!isExcluded) {
        options.push({ pathRel: item.pathRel, label: `${"　".repeat(depth)}${item.name}` });
        if (item.children) {
          visit(item.children, depth + 1);
        }
      }
    });
  };
  visit(nodes, 0);
  return options;
}

export function collectMarkdownNotes(nodes: FileTreeNode[]): FileTreeNode[] {
  const notes: FileTreeNode[] = [];
  const walk = (items: FileTreeNode[]) => {
    for (const item of items) {
      if (item.kind === "markdown") {
        notes.push(item);
      }
      if (item.children?.length) {
        walk(item.children);
      }
    }
  };
  walk(nodes);
  return notes.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
}

export function countOpenableTreeItems(nodes: FileTreeNode[]): number {
  return nodes.reduce((total, node) => {
    const current = node.kind === "directory" ? 0 : 1;
    return total + current + (node.children ? countOpenableTreeItems(node.children) : 0);
  }, 0);
}

export function filterTreeNodes(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  return nodes.flatMap((node) => {
    const selfMatches = `${node.name} ${node.pathRel}`.toLowerCase().includes(query);
    const children = node.children ? filterTreeNodes(node.children, query) : undefined;
    if (selfMatches || children?.length) {
      return [
        {
          ...node,
          children
        }
      ];
    }
    return [];
  });
}
