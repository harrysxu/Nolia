import { describe, expect, it } from "vitest";

import { stripLeadingBom } from "../src/renderer/components/TextResourceEditor";

describe("text resource editor helpers", () => {
  it("removes a leading UTF-8 BOM before JSON parsing", () => {
    const source = "\ufeff{\"z\":2,\"a\":{\"b\":1}}";

    expect(JSON.parse(stripLeadingBom(source))).toEqual({ z: 2, a: { b: 1 } });
  });

  it("does not remove BOM-like characters after the first character", () => {
    expect(stripLeadingBom("{\"text\":\"\ufeffkeep\"}")).toBe("{\"text\":\"\ufeffkeep\"}");
  });
});
