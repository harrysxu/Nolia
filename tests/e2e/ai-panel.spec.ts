import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_AI_SETTINGS } from "../../src/shared/ai";
import { installMockNolia } from "./helpers/mockNolia";

test("AI assistant panel sends a mock request", async ({ page }) => {
  await installMockNolia(page, {
    settings: {
      ai: {
        ...DEFAULT_AI_SETTINGS,
        enabled: true
      }
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "AI 助手" }).click();
  await page.getByPlaceholder("向当前上下文提问").fill("总结当前工作区");
  await page.getByRole("button", { name: "发送" }).click();
  await confirmAiContextIfVisible(page);

  await expect(page.getByText("Mock AI: 总结当前工作区")).toBeVisible();
});

test("AI assistant panel refreshes and applies organization suggestions", async ({ page }) => {
  await installMockNolia(page, {
    settings: {
      ai: {
        ...DEFAULT_AI_SETTINGS,
        enabled: true
      }
    },
    files: {
      "home.md": "# Home\n\nAI workspace notes need tags.",
      "notes/related.md": "# Related\n\nAdditional AI note."
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "AI 助手" }).click();
  await page.getByRole("button", { name: "刷新建议" }).click();

  await expect(page.locator(".ai-insight-panel").getByText("建议标签：#ai")).toBeVisible();
  await page.locator(".ai-insight-item").filter({ hasText: "建议标签：#ai" }).getByRole("button", { name: "应用建议" }).click();
  await expect(page.locator(".statusbar")).toContainText("整理建议已应用到当前文档");
  await expect(page.locator(".source-editor .cm-content")).toContainText("#ai");
});

test("AI assistant panel persists and clears local conversation history", async ({ page }) => {
  await installMockNolia(page, {
    settings: {
      ai: {
        ...DEFAULT_AI_SETTINGS,
        enabled: true,
        privacy: {
          ...DEFAULT_AI_SETTINGS.privacy,
          saveLocalConversationHistory: true
        }
      }
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "AI 助手" }).click();
  await page.getByPlaceholder("向当前上下文提问").fill("保留这次对话");
  await page.getByRole("button", { name: "发送" }).click();
  await confirmAiContextIfVisible(page);

  await expect(page.getByText("Mock AI: 保留这次对话")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("nolia:ws_full_selftest:aiConversation.v1"))).toContain("保留这次对话");

  await page.reload();
  await page.getByRole("button", { name: "AI 助手" }).click();
  await expect(page.getByText("保留这次对话", { exact: true })).toBeVisible();
  await expect(page.getByText("Mock AI: 保留这次对话")).toBeVisible();

  await page.getByRole("button", { name: "清空对话" }).click();
  await expect(page.getByText("选择命令或直接提问。")).toBeVisible();
  await expect(page.getByText("Mock AI: 保留这次对话")).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("nolia:ws_full_selftest:aiConversation.v1"))).toBeNull();

  await page.reload();
  await page.getByRole("button", { name: "AI 助手" }).click();
  await expect(page.getByText("Mock AI: 保留这次对话")).toBeHidden();
});

test("AI assistant panel does not persist conversation history when disabled", async ({ page }) => {
  await installMockNolia(page, {
    settings: {
      ai: {
        ...DEFAULT_AI_SETTINGS,
        enabled: true,
        privacy: {
          ...DEFAULT_AI_SETTINGS.privacy,
          saveLocalConversationHistory: false
        }
      }
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "AI 助手" }).click();
  await page.getByPlaceholder("向当前上下文提问").fill("不应保留");
  await page.getByRole("button", { name: "发送" }).click();
  await confirmAiContextIfVisible(page);
  await expect(page.getByText("Mock AI: 不应保留")).toBeVisible();
  await expect(page.evaluate(() => window.localStorage.getItem("nolia:ws_full_selftest:aiConversation.v1"))).resolves.toBeNull();

  await page.reload();
  await page.getByRole("button", { name: "AI 助手" }).click();
  await expect(page.getByText("Mock AI: 不应保留")).toBeHidden();
});

test("AI editor context menu runs a built-in command", async ({ page }) => {
  await installMockNolia(page, {
    settings: {
      ai: {
        ...DEFAULT_AI_SETTINGS,
        enabled: true
      }
    },
    files: {
      "home.md": "# Home\n\nSelected context menu content."
    }
  });

  await page.goto("/");
  await expect(page.locator(".source-editor .cm-content")).toBeVisible();
  await page.locator(".source-editor .cm-content").click({ button: "right" });
  const menu = page.locator(".ai-editor-context-menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "总结选区" }).click();
  await confirmAiContextIfVisible(page);

  await expect(page.locator(".ai-assistant-panel")).toBeVisible();
  await expect(page.locator(".ai-message.is-user").filter({ hasText: "总结选区" })).toBeVisible();
});

async function confirmAiContextIfVisible(page: Page) {
  const dialog = page.getByRole("dialog", { name: "确认 AI 上下文" });
  await dialog.waitFor({ state: "visible", timeout: 700 }).catch(() => undefined);
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "确认发送" }).click();
  }
}
