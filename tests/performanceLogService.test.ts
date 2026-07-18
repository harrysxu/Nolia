import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PerformanceLogService } from "../src/main/services/performanceLogService";

describe("performance log service", () => {
  it("writes privacy-safe JSONL and rotates bounded local files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "nolia-performance-"));
    try {
      const service = new PerformanceLogService(root, { maxBytes: 180, maxFiles: 2 });
      await service.init();
      for (let index = 0; index < 8; index += 1) service.record("search.exact", index + 0.25, { resultLimit: 40, semantic: false });
      await service.flush();

      const files = (await readdir(service.logRoot)).sort();
      expect(files).toEqual(expect.arrayContaining(["performance.jsonl", "performance.jsonl.1"]));
      expect(files).not.toContain("performance.jsonl.3");
      const current = await readFile(service.logFilePath, "utf8");
      const record = JSON.parse(current.trim().split("\n")[0]) as Record<string, unknown>;
      expect(record).toMatchObject({ operation: "search.exact", meta: { resultLimit: 40, semantic: false } });
      expect(record).not.toHaveProperty("query");
      expect(record).not.toHaveProperty("content");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
