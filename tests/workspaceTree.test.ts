import { describe, expect, it } from "vitest";

import {
  canDropTreeTarget,
  collectMarkdownNotes,
  collectMoveDestinationOptions,
  collectPathSet,
  countOpenableTreeItems,
  fileNameFor,
  filterTreeNodes,
  findFileTreeNode,
  firstOpenableFileTreeNode,
  joinPath,
  pathParent,
  sanitizeItemName,
  uniqueCopiedFilePath,
  uniqueMovedPath
} from "../src/renderer/app/workspaceTree";
import type { FileTreeNode } from "../src/shared/types";

const tree: FileTreeNode[] = [
  {
    pathRel: "notes",
    name: "notes",
    kind: "directory",
    size: 0,
    mtimeMs: 3,
    children: [
      { pathRel: "notes/a.md", name: "a.md", kind: "markdown", size: 10, mtimeMs: 2 },
      { pathRel: "notes/image.png", name: "image.png", kind: "asset", size: 20, mtimeMs: 1 }
    ]
  },
  { pathRel: "root.md", name: "root.md", kind: "markdown", size: 30, mtimeMs: 4 }
];

describe("workspace tree helpers", () => {
  it("normalizes path operations", () => {
    expect(fileNameFor("notes/a.md")).toBe("a.md");
    expect(pathParent("notes/a.md")).toBe("notes");
    expect(joinPath("notes/", "b.md")).toBe("notes/b.md");
    expect(sanitizeItemName(" /hello:* world?.md ")).toBe("hello-world-.md");
  });

  it("collects and finds tree nodes", () => {
    expect([...collectPathSet(tree)].sort()).toEqual(["notes", "notes/a.md", "notes/image.png", "root.md"]);
    expect(findFileTreeNode(tree, "notes/a.md")?.name).toBe("a.md");
    expect(firstOpenableFileTreeNode(tree)?.pathRel).toBe("notes/a.md");
    expect(countOpenableTreeItems(tree)).toBe(3);
    expect(collectMarkdownNotes(tree).map((node) => node.pathRel)).toEqual(["root.md", "notes/a.md"]);
  });

  it("filters tree nodes while keeping matching ancestors", () => {
    expect(filterTreeNodes(tree, "image").map((node) => node.pathRel)).toEqual(["notes"]);
    expect(filterTreeNodes(tree, "image")[0].children?.map((node) => node.pathRel)).toEqual(["notes/image.png"]);
  });

  it("prevents invalid move targets", () => {
    const target = { pathRel: "notes", kind: "directory" as const, name: "notes" };

    expect(canDropTreeTarget(target, "notes")).toBe(false);
    expect(canDropTreeTarget(target, "notes/archive")).toBe(false);
    expect(canDropTreeTarget(target, "")).toBe(false);
    expect(canDropTreeTarget({ pathRel: "notes/a.md", kind: "file", name: "a.md" }, "")).toBe(true);
  });

  it("creates non-conflicting copy and move paths", () => {
    const existing = new Set(["notes/a.md", "notes/a 副本.md", "notes/a 2.md"]);

    expect(uniqueCopiedFilePath("notes/a.md", existing)).toBe("notes/a 副本 2.md");
    expect(uniqueMovedPath("notes/a.md", existing, "file")).toBe("notes/a 3.md");
  });

  it("excludes nested move destinations", () => {
    expect(collectMoveDestinationOptions(tree, { pathRel: "notes", kind: "directory", name: "notes" }).map((item) => item.pathRel)).toEqual([""]);
  });
});
