import { expect, test, type Locator } from "@playwright/test";

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

test("keeps the reading position independent for each document tab", async ({ page }) => {
  const longDocument = (title: string) => [
    `# ${title}`,
    ...Array.from({ length: 180 }, (_, index) => `## ${title} section ${index + 1}\n\n${title} reading position paragraph ${index + 1}.`)
  ].join("\n\n");

  await page.setViewportSize({ width: 1280, height: 760 });
  await installMockNolia(page, {
    settings: { editorMode: "wysiwyg" },
    files: {
      "alpha.md": longDocument("Alpha"),
      "beta.md": longDocument("Beta")
    }
  });

  await page.goto("/");
  const tabList = page.getByRole("tablist", { name: "打开的文档" });
  const scroller = page.locator(".wysiwyg-editor");
  await expect(scroller).toBeVisible();
  await expect.poll(() => scrollRange(scroller)).toBeGreaterThan(1_000);

  await setScrollRatio(scroller, 0.65);
  await page.getByRole("button", { name: "beta.md", exact: true }).click();
  await expect(tabList.getByRole("tab", { name: "打开文档 beta.md" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => scrollRatio(scroller)).toBeLessThan(0.02);

  await setScrollRatio(scroller, 0.25);
  await tabList.getByRole("tab", { name: "打开文档 alpha.md" }).click();
  await expect.poll(() => scrollRatio(scroller)).toBeGreaterThan(0.6);

  await tabList.getByRole("tab", { name: "打开文档 beta.md" }).click();
  await expect.poll(() => scrollRatio(scroller)).toBeGreaterThan(0.2);
  await expect.poll(() => scrollRatio(scroller)).toBeLessThan(0.3);
});

async function scrollRange(scroller: Locator): Promise<number> {
  return scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
}

async function scrollRatio(scroller: Locator): Promise<number> {
  return scroller.evaluate((element) => {
    const range = element.scrollHeight - element.clientHeight;
    return range > 0 ? element.scrollTop / range : 0;
  });
}

async function setScrollRatio(scroller: Locator, ratio: number): Promise<void> {
  await scroller.evaluate((element, nextRatio) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) * nextRatio;
    element.dispatchEvent(new Event("scroll"));
  }, ratio);
  await expect.poll(() => scrollRatio(scroller)).toBeGreaterThan(ratio - 0.02);
}
