import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface PackageBuildConfig {
  build?: {
    mac?: { mergeASARs?: boolean };
    fileAssociations?: Array<{ ext?: string }>;
  };
}

describe("packaging configuration", () => {
  it("keeps universal resources unmerged and registers every Markdown extension", async () => {
    const packageJson = JSON.parse(
      await readFile(path.resolve("package.json"), "utf8")
    ) as PackageBuildConfig;

    expect(packageJson.build?.mac?.mergeASARs).toBe(false);
    expect(packageJson.build?.fileAssociations?.map((item) => item.ext)).toEqual([
      "md",
      "markdown",
      "mdown",
      "mkd"
    ]);
  });
});
