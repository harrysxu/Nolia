import { describe, expect, it } from "vitest";

import { isWorkspaceNavigationViewAvailable } from "../src/renderer/app/navigation";

describe("workspace navigation availability", () => {
  it("keeps the built-in AI task page available without a sidebar contribution", () => {
    expect(isWorkspaceNavigationViewAvailable("ai", [])).toBe(true);
  });

  it("accepts registered sidebar panels and rejects removed plugin panels", () => {
    const panels = [{ id: "files" }, { id: "plugin.notes" }];

    expect(isWorkspaceNavigationViewAvailable("files", panels)).toBe(true);
    expect(isWorkspaceNavigationViewAvailable("plugin.notes", panels)).toBe(true);
    expect(isWorkspaceNavigationViewAvailable("plugin.removed", panels)).toBe(false);
  });
});
