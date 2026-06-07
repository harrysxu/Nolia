import { expect, test } from "@playwright/test";
import { installMockNolia } from "./helpers/mockNolia";

test("outline panel is visible and jumps to a heading", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: { editorMode: "source", autoSaveDelayMs: 40 },
    files: {
      "outline.md": "# Overview\n\nIntro\n\n" + "Body text\n\n".repeat(45) + "## Deep Section\n\n### Nested Section\n\nTarget body."
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
  await expect(page.locator(".right-panel").getByRole("button", { name: "Nested Section" })).toBeVisible();
  const outlineIndents = await page.locator(".right-panel .outline-item").evaluateAll((items) =>
    items.map((item) => ({
      text: item.textContent?.trim(),
      paddingLeft: Number.parseFloat(getComputedStyle(item).paddingLeft)
    }))
  );
  const overviewIndent = outlineIndents.find((item) => item.text === "Overview")?.paddingLeft ?? 0;
  const deepIndent = outlineIndents.find((item) => item.text === "Deep Section")?.paddingLeft ?? 0;
  const nestedIndent = outlineIndents.find((item) => item.text === "Nested Section")?.paddingLeft ?? 0;
  expect(deepIndent).toBeGreaterThan(overviewIndent);
  expect(nestedIndent).toBeGreaterThan(deepIndent);
  const rightPanelResizer = page.getByRole("button", { name: "拖拽调整右侧面板宽度" });
  await expect(rightPanelResizer).toBeVisible();
  const rightPanelWidthBeforeResize = await page.locator(".right-panel").evaluate((element) => element.getBoundingClientRect().width);
  const resizerBox = await rightPanelResizer.boundingBox();
  expect(resizerBox).not.toBeNull();
  if (resizerBox) {
    await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + resizerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizerBox.x + resizerBox.width / 2 - 80, resizerBox.y + resizerBox.height / 2);
    await page.mouse.up();
  }
  const rightPanelWidthAfterResize = await page.locator(".right-panel").evaluate((element) => element.getBoundingClientRect().width);
  expect(rightPanelWidthAfterResize).toBeGreaterThan(rightPanelWidthBeforeResize + 20);
  await rightPanelResizer.focus();
  await page.keyboard.press("ArrowRight");
  const rightPanelWidthAfterArrowRight = await page.locator(".right-panel").evaluate((element) => element.getBoundingClientRect().width);
  expect(rightPanelWidthAfterArrowRight).toBeLessThan(rightPanelWidthAfterResize);
  await page.keyboard.press("ArrowLeft");
  const rightPanelWidthAfterArrowLeft = await page.locator(".right-panel").evaluate((element) => element.getBoundingClientRect().width);
  expect(rightPanelWidthAfterArrowLeft).toBeGreaterThan(rightPanelWidthAfterArrowRight);
  await rightPanelResizer.dblclick();
  const rightPanelWidthAfterReset = await page.locator(".right-panel").evaluate((element) => element.getBoundingClientRect().width);
  expect(Math.abs(rightPanelWidthAfterReset - rightPanelWidthBeforeResize)).toBeLessThanOrEqual(2);
  await testInfo.attach("outline-open", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });

  await page.locator(".right-panel").getByRole("button", { name: "Deep Section" }).click();
  await expect(page.locator(".source-editor .cm-content")).toContainText("Deep Section");
  await expect(page.locator(".statusbar")).toContainText("已跳转到第");
});
