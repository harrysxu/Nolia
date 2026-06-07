import { expect, test, type Page } from "@playwright/test";
import { installMockNolia } from "./helpers/mockNolia";

test("built-in JSON and TXT editors expose the right tools and autosave safely", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: { editorMode: "source", autoSaveDelayMs: 40 },
    files: {
      "home.md": "# Home\n\nResource editor smoke.",
      "assets/config.json": "{\"z\":2,\"a\":{\"b\":1},\"中文\":\"值\"}",
      "assets/invalid.json": "{ bad json",
      "assets/notes.txt": "    indented value  \nword   gap\t\n\n\tkeep\t",
      "assets/component.tsx": "export const Label = () => <span>Suffix editor</span>;"
    }
  });

  await page.goto("/");
  await openAssetsFolder(page);

  await page.getByRole("button", { name: "config.json", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("JSON 编辑器");
  await expect(page.getByTestId("builtin-json-editor")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "JSON 工具" })).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Markdown 工具" })).toHaveCount(0);
  await expect(page.locator(".editor-toolbar, .markdown-actionbar")).toHaveCount(0);
  await expect(page.getByTestId("builtin-json-editor").getByRole("button", { name: "保存" })).toHaveCount(0);
  await expect(page.getByRole("tree", { name: "JSON 结构" })).toHaveCount(0);

  for (const name of ["撤销", "重做", "搜索/替换", "自动换行", "行号", "空白符", "校验", "格式化", "排序键", "压缩", "诊断", "重新读取"]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }

  await page.getByRole("button", { name: "搜索/替换" }).click();
  await expect(page.locator(".text-resource-codemirror .cm-search")).toBeVisible();
  await page.getByRole("button", { name: "自动换行" }).click();
  await expect(page.getByRole("button", { name: "自动换行" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "行号" }).click();
  await expect(page.getByRole("button", { name: "行号" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "空白符" }).click();
  await expect(page.getByRole("button", { name: "空白符" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "空白符" }).click();
  await expect(page.getByRole("button", { name: "空白符" })).toHaveAttribute("aria-pressed", "false");

  const jsonCode = page.getByTestId("builtin-json-editor").locator(".cm-content");
  await page.getByRole("button", { name: "校验" }).click();
  await expect(page.getByTestId("builtin-json-status")).toHaveText("JSON 有效");
  await page.getByRole("button", { name: "格式化" }).click();
  await expect(jsonCode).toContainText("\"z\": 2");
  await page.evaluate(() =>
    (window as typeof window & { __emitWorkspaceIndexed?: (event?: { pathRel?: string }) => void }).__emitWorkspaceIndexed?.({ pathRel: "assets/config.json" })
  );
  await expect(page.locator(".statusbar")).toContainText("已格式化 assets/config.json");
  await page.getByRole("button", { name: "排序键" }).click();
  await expect(jsonCode).toContainText("\"a\": {");
  await expect(jsonCode).toContainText("\"中文\": \"值\"");
  await page.getByRole("button", { name: "压缩" }).click();
  await expect(jsonCode).toContainText("{\"a\":{\"b\":1},\"z\":2,\"中文\":\"值\"}");
  await page.getByRole("button", { name: "诊断" }).click();
  await expect(page.locator(".statusbar")).toContainText("无诊断问题");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { savedText: Record<string, string> } }).__noliaMock.savedText["assets/config.json"]))
    .toBe("{\"a\":{\"b\":1},\"z\":2,\"中文\":\"值\"}");

  await page.getByRole("button", { name: "invalid.json", exact: true }).click();
  await expect(page.getByTestId("builtin-json-status")).toHaveText("JSON 无效");
  const invalidCode = page.getByTestId("builtin-json-editor").locator(".cm-content");
  await expect(invalidCode).toContainText("{ bad json");
  await page.getByRole("button", { name: "格式化" }).click();
  await expect(page.getByTestId("builtin-json-status")).toHaveText("格式化失败");
  await expect(invalidCode).toContainText("{ bad json");

  await page.getByRole("button", { name: "notes.txt", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("文本编辑器");
  await expect(page.getByTestId("builtin-text-editor")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "文本工具" })).toBeVisible();
  await expect(page.getByRole("button", { name: "清理空白" })).toBeVisible();
  await expect(page.getByRole("button", { name: "格式化" })).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Markdown 工具" })).toHaveCount(0);
  await expect(page.getByTestId("builtin-text-editor").getByRole("button", { name: "保存" })).toHaveCount(0);
  await expect(page.getByLabel("文本语言")).toHaveCount(0);
  await expect(page.locator("[aria-label='自动识别文本类型：TXT']")).toBeVisible();
  await page.getByRole("button", { name: "清理空白" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { savedText: Record<string, string> } }).__noliaMock.savedText["assets/notes.txt"]))
    .toBe("    indented value\nword   gap\n\n\tkeep");

  await page.getByRole("button", { name: "component.tsx", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("文本编辑器");
  await expect(page.locator("[aria-label='自动识别文本类型：TSX']")).toBeVisible();
  await expect(page.getByTestId("builtin-text-editor").locator(".cm-content")).toContainText("Suffix editor");

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "最近", exact: true }).click();
  await expect(page.getByRole("button", { name: "component.tsx", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "最近编辑" }).click();
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible();
});

test("resource previews cover image, PDF, audio, video, archive, and unknown files", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    files: {
      "home.md": "# Home\n\nPreview resources."
    },
    binaries: {
      "assets/mock.png": { bytes: [137, 80, 78, 71], mimeType: "image/png" },
      "assets/manual.pdf": { bytes: [37, 80, 68, 70], mimeType: "application/pdf" },
      "assets/sound.mp3": { bytes: [73, 68, 51], mimeType: "audio/mpeg" },
      "assets/movie.mp4": { bytes: [0, 0, 0, 24], mimeType: "video/mp4" },
      "assets/archive.zip": { bytes: [80, 75, 3, 4], mimeType: "application/zip" },
      "assets/blob.bin": { bytes: [1, 2, 3, 4], mimeType: "application/octet-stream" }
    }
  });

  await page.goto("/");
  await openAssetsFolder(page);

  await page.getByRole("button", { name: "mock.png", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("图片预览");
  await expect(page.locator(".resource-preview img")).toHaveAttribute("src", "nolia-asset://workspace/ws_full_selftest/assets/mock.png");

  await page.getByRole("button", { name: "manual.pdf", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("PDF 预览");
  await expect(page.locator(".resource-preview iframe")).toHaveAttribute("src", "nolia-asset://workspace/ws_full_selftest/assets/manual.pdf");

  await page.getByRole("button", { name: "sound.mp3", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("音频预览");
  await expect(page.locator(".resource-preview audio")).toHaveAttribute("src", "nolia-asset://workspace/ws_full_selftest/assets/sound.mp3");

  await page.getByRole("button", { name: "movie.mp4", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("视频预览");
  await expect(page.locator(".resource-preview video")).toHaveAttribute("src", "nolia-asset://workspace/ws_full_selftest/assets/movie.mp4");

  await page.getByRole("button", { name: "archive.zip", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("压缩包资源");
  await expect(page.locator(".resource-placeholder")).toContainText("压缩包不会在笔记内解压预览");
  await expect(page.locator(".resource-placeholder")).toContainText("资源管理器");

  await page.getByRole("button", { name: "blob.bin", exact: true }).click();
  await expect(page.locator(".resource-kind-pill")).toHaveText("资源文件");
  await expect(page.locator(".resource-placeholder")).toContainText("暂不支持内嵌预览");
  await page.getByRole("button", { name: "用系统应用打开" }).click();
  await page.getByRole("button", { name: "在资源管理器中显示" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { openedExternal: string[] } }).__noliaMock.openedExternal))
    .toContain("assets/blob.bin");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { revealed: string[] } }).__noliaMock.revealed))
    .toContain("assets/blob.bin");
});

async function openAssetsFolder(page: Page) {
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "笔记", exact: true }).click();
  await page.getByPlaceholder("搜索文件或资源").fill("");
  const assetsFolder = page.getByRole("button", { name: /assets/ }).first();
  await expect(assetsFolder).toBeVisible();
  await assetsFolder.click();
}
