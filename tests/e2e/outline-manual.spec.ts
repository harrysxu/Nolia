import { expect, test } from "@playwright/test";
import { installMockNolia } from "./helpers/mockNolia";

test("outline panel is visible and jumps to a heading", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: { editorMode: "source", autoSaveDelayMs: 40 },
    files: {
      "outline.md": "# Overview\n\nIntro\n\n" + "Body text\n\n".repeat(45) + "## Deep Section\n\nTarget body."
    }
  });

  await page.goto("/");
  await expect(page.locator(".breadcrumb strong")).toHaveText("outline.md");
  const navOutlineButton = page.locator(".app-nav").getByRole("button", { name: "目录" });
  await expect(navOutlineButton).toBeVisible();
  await navOutlineButton.click();
  await expect(page.locator(".right-panel")).toBeVisible();
  await expect(page.locator(".right-panel").getByText("目录")).toBeVisible();
  await expect(page.locator(".right-panel").getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(page.locator(".right-panel").getByRole("button", { name: "Deep Section" })).toBeVisible();
  await testInfo.attach("outline-open", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });

  await page.locator(".right-panel").getByRole("button", { name: "Deep Section" }).click();
  await expect(page.locator(".source-editor .cm-content")).toContainText("Deep Section");
  await expect(page.locator(".statusbar")).toContainText("已跳转到第");
});
