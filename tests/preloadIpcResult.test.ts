import { describe, expect, it } from "vitest";

import { isPreloadIpcResult } from "../src/preload/ipcResult";

describe("preload IPC result guard", () => {
  it("recognizes success and error envelopes without runtime schema dependencies", () => {
    expect(isPreloadIpcResult({ ok: true, data: { value: 1 } })).toBe(true);
    expect(isPreloadIpcResult({
      ok: false,
      error: { code: "internal_error", message: "Failed", operationId: "op-1", retryable: false }
    })).toBe(true);
  });

  it("does not unwrap legacy payloads that only contain an ok field", () => {
    expect(isPreloadIpcResult({ ok: true, affectedPaths: ["note.md"] })).toBe(false);
    expect(isPreloadIpcResult({ ok: false, error: "Failed" })).toBe(false);
    expect(isPreloadIpcResult(undefined)).toBe(false);
  });
});
