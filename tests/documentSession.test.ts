import { describe, expect, it } from "vitest";

import { selectActiveDocument, updateDocumentByPath } from "../src/renderer/features/documents/useDocumentSession";
import type { OpenDocumentTab } from "../src/renderer/app/types";

describe("document session helpers", () => {
  it("selects the active document and falls back to the first open document", () => {
    const documents = [documentTab("first.md"), documentTab("second.md")];

    expect(selectActiveDocument(documents, "second.md")?.pathRel).toBe("second.md");
    expect(selectActiveDocument(documents, "missing.md")?.pathRel).toBe("first.md");
    expect(selectActiveDocument([], "missing.md")).toBeUndefined();
  });

  it("updates only the document matching the requested path", () => {
    const first = documentTab("first.md");
    const second = documentTab("second.md");
    const updated = updateDocumentByPath([first, second], "second.md", (document) => ({ ...document, dirty: true }));

    expect(updated[0]).toBe(first);
    expect(updated[1]).toEqual({ ...second, dirty: true });
  });
});

function documentTab(pathRel: string): OpenDocumentTab {
  return {
    pathRel,
    title: pathRel,
    sourceText: "",
    baseHash: "hash",
    lastSavedHash: "hash",
    dirty: false,
    mode: "source",
    parsed: {
      frontmatter: {},
      title: pathRel,
      body: "",
      plainText: "",
      headings: [],
      tags: [],
      links: [],
      wikilinks: [],
      attachments: [],
      diagnostics: [],
      wordCount: 0,
      lineCount: 0
    }
  };
}
