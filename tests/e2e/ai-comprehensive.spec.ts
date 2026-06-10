import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_AI_SETTINGS } from "../../src/shared/ai";
import { installMockNolia } from "./helpers/mockNolia";

const aiSettings = {
  ...DEFAULT_AI_SETTINGS,
  enabled: true,
  defaultProviderId: "mock",
  defaultModel: "mock-fast",
  providers: {
    ...DEFAULT_AI_SETTINGS.providers,
    ollama: {
      ...DEFAULT_AI_SETTINGS.providers.ollama,
      enabled: false
    }
  },
  privacy: {
    ...DEFAULT_AI_SETTINGS.privacy,
    allowWorkspaceContext: true
  },
  index: {
    ...DEFAULT_AI_SETTINGS.index,
    enabled: true
  }
};

const files = {
  "notes/ai-overview.md": "# AI Overview\n\nNolia AI uses provider-agnostic settings, visible context, local index rebuilds, and review-before-write change plans.\n",
  "notes/project-plan.md": "# Project Plan\n\n- [ ] Validate provider connectivity.\n- [ ] Rebuild AI index.\n- [ ] Review AI change plans.\n",
  "notes/meeting.md": "# Meeting Notes\n\nDecision: Keep AI write operations reviewable before saving files.\n",
  "data/context.txt": "Text resource indexing should include non-Markdown workspace references.\n"
};

test("AI settings, commands, index, assistant actions, and change plan review work through the UI", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 860 });
  await installMockNolia(page, {
    settings: {
      ai: aiSettings
    },
    files
  });

  await page.goto("/");
  await expect(page.locator(".breadcrumb strong").getByText("ai-overview.md", { exact: true })).toBeVisible();

  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole("tab", { name: "AI" }).click();
  await expect(settingsDialog.getByText("Provider", { exact: true })).toBeVisible();
  await expect(settingsDialog.getByText("工作区 AI 索引", { exact: true })).toBeVisible();
  await expect(settingsDialog.getByText("预置命令", { exact: true })).toBeVisible();
  await expect(settingsDialog.getByText("允许联网搜索", { exact: true })).toHaveCount(0);
  await expect(settingsDialog.getByText("Web 搜索", { exact: true })).toHaveCount(0);

  const mockProvider = settingsDialog.locator(".ai-provider-item:has(input[value='Mock AI'])");
  await mockProvider.getByLabel("Temperature").fill("0.4");
  await mockProvider.getByLabel("Max Tokens").fill("1024");
  await settingsDialog.getByLabel("上下文预算字符").fill("12000");
  await expect.poll(() => page.evaluate(() => {
    const history = (window as typeof window & { __noliaMock: { settingsHistory: Array<{ key: string; value: { privacy?: { maxContextChars?: number } } }> } }).__noliaMock.settingsHistory;
    return history.findLast((entry) => entry.key === "ai")?.value.privacy?.maxContextChars;
  })).toBe(12_000);
  await mockProvider.getByRole("button", { name: "加载模型" }).click();
  await expect(mockProvider.getByText("已加载 1 个模型")).toBeVisible();
  await expect(mockProvider.getByLabel("模型列表")).toBeVisible();

  await settingsDialog.getByRole("button", { name: "重建索引" }).click();
  await expect(settingsDialog.getByText("AI 索引可用")).toBeVisible();
  await expect(settingsDialog.getByText("片段 4")).toBeVisible();

  await settingsDialog.getByRole("button", { name: "复制为自定义" }).first().click();
  await expect(settingsDialog.locator(".ai-custom-command-item")).toHaveCount(1);
  await settingsDialog.locator(".ai-custom-command-item input").first().fill("测试自定义命令");
  await settingsDialog.locator(".ai-custom-command-item textarea").first().fill("请输出当前上下文的三个测试要点。");
  await settingsDialog.locator(".settings-close-button").click();

  await page.getByRole("button", { name: "AI 助手" }).click();
  await expect(page.locator(".ai-assistant-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "测试自定义命令" })).toBeVisible();
  await page.getByRole("button", { name: "刷新建议" }).click();
  await expect(page.locator(".ai-insight-panel").getByText("建议标签：#ai")).toBeVisible();
  await page.locator(".ai-insight-item").filter({ hasText: "建议标签：#ai" }).getByRole("button", { name: "应用建议" }).click();
  await expect(page.locator(".statusbar")).toContainText("整理建议已应用到当前文档");
  await expect(page.locator(".source-editor .cm-content")).toContainText("#ai");

  await page.getByPlaceholder("向当前上下文提问").fill("总结当前文档的 AI 安全策略");
  await page.getByRole("button", { name: "发送" }).click();
  await confirmAiContextIfVisible(page);
  await expect(page.getByText("Mock AI: 总结当前文档的 AI 安全策略")).toBeVisible();
  await expect(page.locator(".ai-context-item").filter({ hasText: "当前文档" })).toBeVisible();
  await page.locator(".ai-citations").getByRole("button", { name: "notes/ai-overview.md" }).click();
  await expect(page.locator(".statusbar")).toContainText("引用位于第 1 行");

  await page.getByRole("button", { name: "新建笔记" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { createdPaths: string[] } }).__noliaMock.createdPaths)).toContain("notes/AI-生成笔记.md");

  await page.getByPlaceholder("向当前上下文提问").fill('{"changes":[{"action":"create","pathRel":"notes/ai-created.md","title":"创建 AI 文件","content":"# AI Created\\n\\nCreated from reviewed change plan."},{"action":"modify","pathRel":"notes/project-plan.md","title":"更新项目计划","content":"# Project Plan\\n\\n- [x] Validate AI change plan review.\\n"},{"action":"rename","pathRel":"notes/meeting.md","targetPathRel":"notes/meeting-renamed.md","title":"重命名会议记录"},{"action":"delete","pathRel":"notes/ai-created.md","title":"删除临时 AI 文件"}]}');
  await page.getByRole("button", { name: "发送" }).click();
  await confirmAiContextIfVisible(page);
  await expect(page.getByText("Mock AI: {\"changes\"")).toBeVisible();
  await page.getByRole("button", { name: "变更计划", exact: true }).click();
  const planDialog = page.getByRole("dialog", { name: "AI 变更计划" });
  await expect(planDialog).toBeVisible();
  await expect(planDialog.getByText("创建 AI 文件")).toBeVisible();
  await expect(planDialog.getByText("更新项目计划")).toBeVisible();
  await expect(planDialog.getByText("重命名会议记录")).toBeVisible();
  await expect(planDialog.getByText("删除临时 AI 文件")).toBeVisible();
  await expect(planDialog.locator("pre").first()).toContainText("--- a/notes/ai-created.md");
  await expect(planDialog.locator("pre").first()).toContainText("+++ b/notes/ai-created.md");
  const createChange = planDialog.locator(".ai-change-item").filter({ hasText: "创建 AI 文件" });
  await createChange.getByRole("button", { name: "拒绝" }).click();
  await expect(createChange.getByRole("button", { name: "应用" })).toBeDisabled();
  await expect(createChange.getByRole("button", { name: "重新接受" })).toBeVisible();
  await createChange.getByRole("button", { name: "重新接受" }).click();
  await expect(createChange.getByRole("button", { name: "应用" })).toBeEnabled();
  await planDialog.getByRole("button", { name: "应用全部" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { createdPaths: string[] } }).__noliaMock.createdPaths)).toContain("notes/ai-created.md");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { savedText: Record<string, string> } }).__noliaMock.savedText["notes/project-plan.md"] ?? "")).toContain("Validate AI change plan review");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { renamedPaths: Array<{ sourcePathRel: string; targetPathRel: string }> } }).__noliaMock.renamedPaths)).toContainEqual({
    sourcePathRel: "notes/meeting.md",
    targetPathRel: "notes/meeting-renamed.md"
  });
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { trashedPaths: string[] } }).__noliaMock.trashedPaths)).toContain("notes/ai-created.md");
  await expect(planDialog.getByRole("button", { name: "应用全部" })).toBeDisabled();

  await assertNoVisibleOverflow(page);
  await page.screenshot({ path: "test-results/ai-comprehensive-panel.png", fullPage: false });
});

async function confirmAiContextIfVisible(page: Page) {
  const dialog = page.getByRole("dialog", { name: "确认 AI 上下文" });
  await dialog.waitFor({ state: "visible", timeout: 700 }).catch(() => undefined);
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "确认发送" }).click();
  }
}

async function assertNoVisibleOverflow(page: Page) {
  const problems = await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>(".ai-assistant-panel, .ai-result-actions, .ai-context-preview, .ai-insight-panel, .settings-dialog")];
    return elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          horizontalOverflow: element.scrollWidth > Math.ceil(rect.width) + 2,
          verticalOverflow: element.scrollHeight > Math.ceil(rect.height) + 2 && !["auto", "scroll"].includes(getComputedStyle(element).overflowY)
        };
      })
      .filter((item) => item.horizontalOverflow || item.verticalOverflow);
  });
  expect(problems).toEqual([]);
}
