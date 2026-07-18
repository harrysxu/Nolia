import { expect, test } from "@playwright/test";

import { installMockNolia } from "./helpers/mockNolia";

test("opens, switches, and closes multiple Markdown document tabs", async ({ page }) => {
  await installMockNolia(page, {
    files: {
      "alpha.md": "# Alpha\n\nFirst document.",
      "beta.md": "# Beta\n\nSecond document."
    }
  });

  await page.goto("/");
  const tabList = page.getByRole("tablist", { name: "打开的文档" });
  await expect(tabList.getByRole("tab", { name: "打开文档 alpha.md" })).toBeVisible();

  await page.getByRole("button", { name: "beta.md", exact: true }).click();
  await expect(tabList.getByRole("tab", { name: "打开文档 alpha.md" })).toBeVisible();
  await expect(tabList.getByRole("tab", { name: "打开文档 beta.md" })).toHaveAttribute("aria-selected", "true");

  await tabList.getByRole("tab", { name: "打开文档 alpha.md" }).click();
  await expect(tabList.getByRole("tab", { name: "打开文档 alpha.md" })).toHaveAttribute("aria-selected", "true");

  await page.getByRole("button", { name: "关闭文档 alpha.md" }).click();
  await expect(tabList.getByRole("tab", { name: "打开文档 alpha.md" })).toHaveCount(0);
  await expect(tabList.getByRole("tab", { name: "打开文档 beta.md" })).toHaveAttribute("aria-selected", "true");
});
