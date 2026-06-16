import { expect, test } from "@playwright/test";

import { installMockNolia } from "./helpers/mockNolia";
import type { AppSettings } from "../../src/shared/types";

const shortcutModifier = process.platform === "darwin" ? "Meta" : "Control";

const openAiSettings = (overrides: Partial<AppSettings["ai"]> = {}): AppSettings["ai"] => ({
  enabled: true,
  defaultProviderId: "openai-compatible",
  providers: [
    {
      id: "openai-compatible",
      name: "OpenAI-compatible",
      providerId: "openai-compatible",
      model: "gpt-4.1",
      baseUrl: "https://api.example.test/v1",
      apiMode: "chat-completions"
    }
  ],
  embedding: {
    enabled: false,
    providerId: "ollama",
    model: "",
    baseUrl: "http://localhost:11434",
    apiMode: "ollama-native"
  },
  conversationHistoryTurns: 3,
  agentMaxSteps: 12,
  allowCurrentNoteContent: true,
  allowWorkspaceSearch: false,
  allowReadSearchResults: false,
  allowWorkspaceRead: false,
  allowWorkspaceOperations: false,
  ...overrides
});

test("AI sidebar opens settings and streams a mock response", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: { editorMode: "source" },
    files: {
      "ai.md": "# AI Smoke\n\nSelected context for AI."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();

  await page.getByRole("button", { name: "Nolia AI" }).click();
  await expect(page.locator(".ai-sidebar")).toBeVisible();
  await expect(page.locator(".ai-sidebar")).toContainText("AI 未启用");

  await page.getByRole("button", { name: "打开 AI 设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "AI" })).toHaveAttribute("aria-selected", "true");
  await settingsDialog.getByLabel("启用 AI").check();
  await settingsDialog.getByRole("button", { name: "编辑模型" }).click();
  const modelDialog = page.getByRole("dialog", { name: "编辑模型" });
  await modelDialog.getByLabel("服务商").selectOption("ollama");
  await modelDialog.getByLabel("模型 ID").fill("llama3.2");
  await modelDialog.getByRole("button", { name: "确认" }).click();
  await settingsDialog.getByLabel("允许发送当前笔记正文").check();
  await settingsDialog.locator(".settings-close-button").click();

  await page.locator(".ai-composer textarea").fill("总结当前笔记");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.locator(".ai-message.is-user")).toContainText("总结当前笔记");
  await expect(page.locator(".ai-message.is-assistant")).toContainText("Mock response: 请直接基于当前笔记正文输出一份简洁中文总结");
  await expect
    .poll(() =>
      page.locator(".ai-message-list").evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))
    )
    .toBeLessThan(2);
  const userBox = await page.locator(".ai-message.is-user").last().boundingBox();
  const assistantBox = await page.locator(".ai-message.is-assistant").last().boundingBox();
  expect(userBox).not.toBeNull();
  expect(assistantBox).not.toBeNull();
  expect(userBox?.x ?? 0).toBeGreaterThan(assistantBox?.x ?? 0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __noliaMock: { aiRuns: Array<{ instruction: string; via?: string; taskId?: string; options?: { requireCurrentNote?: boolean } }> } }).__noliaMock.aiRuns
      )
    )
    .toContainEqual(expect.objectContaining({ via: "task", taskId: expect.stringMatching(/^mock-task-/), instruction: "请直接基于当前笔记正文输出一份简洁中文总结，覆盖主要主题、关键结论和可执行事项；不要只说明你将查看文档。", options: expect.objectContaining({ requireCurrentNote: true }) }));
});

test("AI current-note requests explain when current note content permission is disabled", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings({ allowCurrentNoteContent: false })
    },
    files: {
      "ai.md": "# Catalog Summary\n\nCatalogs organize resources by section and owner."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.locator("button[aria-label='Nolia AI']").click();
  await page.locator(".ai-composer textarea").fill("将当前文档中的内容翻译成中文");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.locator(".ai-message.is-user")).toContainText("将当前文档中的内容翻译成中文");
  await expect(page.locator(".ai-message.is-error")).toContainText("AI 设置未允许发送当前笔记正文");
  await expect(page.locator(".ai-error-card")).toContainText("错误代码：tool_permission_denied");
  await expect(page.getByRole("button", { name: "停止" })).toBeHidden();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { aiRuns: unknown[] } }).__noliaMock.aiRuns.length))
    .toBe(0);
});

test("AI sidebar renders markdown assistant replies as preview content", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# Markdown Reply\n\nAssistant markdown should render."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("请返回 Markdown 回复");
  await page.getByRole("button", { name: "发送" }).click();

  const assistantMessage = page.locator(".ai-message.is-assistant").last();
  await expect(assistantMessage.locator(".ai-markdown-content h1")).toHaveText("渲染标题");
  await expect(assistantMessage.locator(".ai-markdown-content li")).toHaveText(["第一项", "第二项"]);
  await expect(assistantMessage.locator(":scope > pre")).toHaveCount(0);
});

test("AI sidebar does not jump to the latest message when modifier keys update the shell", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 650 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# Scroll Guard\n\nModifier keys should not move AI history."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  for (const index of [1, 2, 3]) {
    await page.locator(".ai-composer textarea").fill(`请返回长 Markdown 回复 ${index}`);
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.locator(".ai-message.is-assistant").nth(index - 1)).toContainText("大模型分类笔记");
  }
  const messageList = page.locator(".ai-message-list");
  await expect.poll(() => messageList.evaluate((list) => list.scrollHeight > list.clientHeight + 120)).toBe(true);
  await messageList.evaluate((list) => {
    list.scrollTop = 0;
  });
  await expect.poll(() => messageList.evaluate((list) => list.scrollHeight - list.clientHeight - list.scrollTop)).toBeGreaterThan(120);

  await page.keyboard.down(shortcutModifier);
  await page.locator(".ai-message.is-assistant").first().evaluate((message) => {
    message.setAttribute("data-scroll-guard", String(Date.now()));
  });
  await page.waitForTimeout(100);
  await page.keyboard.up(shortcutModifier);

  await expect.poll(() => messageList.evaluate((list) => list.scrollHeight - list.clientHeight - list.scrollTop)).toBeGreaterThan(120);
});

test("AI sidebar renders Mermaid diagrams after streaming completes", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# Mermaid Reply\n\nAssistant diagrams should render after streaming."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("请返回流式 Mermaid 图表");
  await page.getByRole("button", { name: "发送" }).click();

  const assistantMessage = page.locator(".ai-message.is-assistant").last();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
  await expect(assistantMessage.locator(":scope > pre")).toContainText("```mermaid");
  await expect(assistantMessage.locator(".mermaid")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await expect(assistantMessage.locator(".ai-markdown-content .mermaid[data-rendered='true'] svg")).toBeVisible();
});

test("AI translation chat does not create a patch proposal", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# Translation\n\nHello world."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("翻译成中文");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.locator(".ai-message.is-assistant")).toContainText("Mock response: 翻译成中文");
  await expect(page.locator(".ai-patch-preview")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const run = (window as typeof window & { __noliaMock: { aiRuns: Array<{ instruction: string; options?: { patchFallback?: boolean } }> } }).__noliaMock.aiRuns.at(-1);
        return { instruction: run?.instruction, patchFallback: run?.options?.patchFallback ?? false };
      })
    )
    .toEqual({ instruction: "翻译成中文", patchFallback: false });
});

test("AI sidebar sends recent conversation history for follow-up turns", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# Multi Turn\n\nConversation history should be preserved."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.getByRole("button", { name: "AI 设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog.getByLabel("多轮上下文")).toHaveValue("3");
  await settingsDialog.getByLabel("多轮上下文").fill("1");
  await settingsDialog.locator(".settings-close-button").click();

  await page.locator(".ai-composer textarea").fill("我们聊 catalog 设计");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant").last()).toContainText("Mock response: 我们聊 catalog 设计");

  await page.locator(".ai-composer textarea").fill("刚才我们聊了什么？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant").last()).toContainText("我们聊 catalog 设计");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const run = (window as typeof window & {
          __noliaMock: { aiRuns: Array<{ conversation?: Array<{ role: string; content: string }> }> };
        }).__noliaMock.aiRuns.at(-1);
        return run?.conversation;
      })
    )
    .toEqual([
      { role: "user", content: "我们聊 catalog 设计" },
      { role: "assistant", content: "Mock response: 我们聊 catalog 设计" }
    ]);

  await page.getByRole("button", { name: "AI 设置" }).click();
  await settingsDialog.getByLabel("多轮上下文").fill("0");
  await settingsDialog.locator(".settings-close-button").click();
  await page.locator(".ai-composer textarea").fill("刚才还记得吗？");
  await page.getByRole("button", { name: "发送" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const run = (window as typeof window & {
          __noliaMock: { aiRuns: Array<{ conversation?: Array<{ role: string; content: string }> }> };
        }).__noliaMock.aiRuns.at(-1);
        return run?.conversation;
      })
    )
    .toEqual([]);
});

test("AI workspace overview requests are handled by agent tools instead of keyword-injected context", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings({ allowWorkspaceRead: true })
    },
    files: {
      "ai.md": "# Workspace Overview\n\nThe current note.",
      "docs/guide.md": "# Guide\n\nReadable guide.",
      "notes/today.md": "# Today\n\nDaily note.",
      "notes/data.json": "{\"ok\":true}"
    },
    binaries: {
      "assets/logo.png": { size: 128 }
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("当前工作目录中都有哪些内容？");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.locator(".ai-message.is-assistant").last()).toContainText("Mock response: 当前工作目录中都有哪些内容？");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const run = (window as typeof window & { __noliaMock: { aiRuns: Array<{ instruction: string; options?: { allowWorkspaceRead?: boolean } }> } }).__noliaMock.aiRuns.at(-1);
        return run?.instruction ?? "";
      })
    )
    .toBe("当前工作目录中都有哪些内容？");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const run = (window as typeof window & { __noliaMock: { aiRuns: Array<{ instruction: string; options?: { allowWorkspaceRead?: boolean } }> } }).__noliaMock.aiRuns.at(-1);
        return run?.options?.allowWorkspaceRead;
      })
    )
    .toBe(true);
});

test("AI cancellation clears the running state and keeps the composer usable", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Cancel\n\nCancel should not block the next turn."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();

  await page.locator(".ai-composer textarea").fill("保持运行直到取消");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
  await page.getByRole("button", { name: "停止" }).click();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  await expect(page.locator(".ai-message.is-error")).toHaveCount(0);

  await page.locator(".ai-composer textarea").fill("继续");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant")).toContainText("Mock response: 继续");
});

test("AI typed regenerate reuses the previous real instruction", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# Regenerate\n\nThe previous instruction should be reused."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("聊聊世界杯");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant").last()).toContainText("Mock response: 聊聊世界杯");

  await page.locator(".ai-composer textarea").fill("重新生成");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-user").last()).toContainText("重新生成");
  await expect(page.locator(".ai-message.is-assistant").last()).toContainText("Mock response: 聊聊世界杯");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __noliaMock: { aiRuns: Array<{ instruction: string }> } }).__noliaMock.aiRuns.map((run) => run.instruction)
      )
    )
    .toEqual(["聊聊世界杯", "聊聊世界杯"]);
});

test("AI settings handles model table, edit dialog, API key state, and model switching", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings({ allowCurrentNoteContent: false })
    },
    files: {
      "ai.md": "# AI Settings\n\nProvider settings."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.getByRole("button", { name: "AI 设置" }).click();

  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "AI" })).toHaveAttribute("aria-selected", "true");
  await expect(settingsDialog.getByRole("table", { name: "模型列表" })).toContainText("gpt-4.1");
  await expect(settingsDialog.getByRole("table", { name: "模型列表" })).toContainText("自定义(OpenAI Compatible)");

  await settingsDialog.getByRole("button", { name: "编辑模型" }).click();
  const editDialog = page.getByRole("dialog", { name: "编辑模型" });
  await expect(editDialog).toBeVisible();
  await editDialog.getByRole("button", { name: "刷新模型" }).click();
  await expect(editDialog.getByLabel("模型 ID")).toContainText("gpt-4.1");
  await editDialog.getByRole("button", { name: "测试连接" }).click();
  await expect(editDialog.locator(".plugin-empty-state.is-ok")).toContainText("Mock AI provider connected");

  await editDialog.getByLabel("API key").fill("test-key");
  await editDialog.getByRole("button", { name: "显示密钥" }).click();
  await expect(editDialog.getByLabel("API key")).toHaveAttribute("type", "text");
  await editDialog.getByRole("button", { name: "测试连接" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __noliaMock: { aiProviderTests: Array<{ apiKey?: string }> } }).__noliaMock.aiProviderTests.at(-1)?.apiKey
      )
    )
    .toBe("test-key");
  await editDialog.getByText("高级配置").click();
  await editDialog.getByLabel("模型展示名称").fill("gpt-4.1 tuned");
  await editDialog.getByRole("button", { name: "确认" }).click();
  await expect(settingsDialog.getByRole("table", { name: "模型列表" })).toContainText("gpt-4.1 tuned");

  await settingsDialog.getByRole("button", { name: "编辑模型" }).click();
  await expect(editDialog.getByLabel("API key")).toHaveAttribute("placeholder", "已保存");
  await editDialog.getByRole("button", { name: "显示密钥" }).click();
  await expect(editDialog.getByLabel("API key")).toHaveValue("test-key");
  await editDialog.getByLabel("API key").fill("");
  await editDialog.getByLabel("服务商").selectOption("ollama");
  await expect(editDialog.getByLabel("自定义请求地址")).toHaveValue("http://localhost:11434");
  await expect(editDialog.getByLabel("API 格式")).toHaveValue("ollama-native");
  await expect(editDialog.getByLabel("API key")).toBeHidden();
  await expect(editDialog).toContainText("本地 Ollama 不需要 API key");
  await editDialog.getByRole("button", { name: "刷新模型" }).click();
  await expect(editDialog.getByLabel("模型 ID")).toContainText("llama3.2");
  await editDialog.getByLabel("模型 ID").selectOption("llama3.2");
  await editDialog.getByRole("button", { name: "确认" }).click();
  await expect(settingsDialog.getByRole("table", { name: "模型列表" })).toContainText("llama3.2");

  await settingsDialog.getByLabel("允许发送当前笔记正文").check();
  await settingsDialog.getByLabel("多轮上下文").fill("12");
  await expect(settingsDialog.getByLabel("多轮上下文")).toHaveValue("12");
  await settingsDialog.getByLabel("允许搜索笔记").check();
  await settingsDialog.getByLabel("允许读取搜索命中笔记摘录").check();

  await settingsDialog.getByRole("button", { name: "添加模型" }).click();
  const addDialog = page.getByRole("dialog", { name: "添加模型" });
  await expect(addDialog).toBeVisible();
  await addDialog.getByLabel("模型 ID").fill("gpt-5.5");
  await addDialog.getByLabel("自定义请求地址").fill("https://api.example.test/v1");
  await addDialog.getByLabel("API key").fill("new-key");
  await addDialog.getByRole("button", { name: "确认" }).click();
  await expect(settingsDialog.getByRole("table", { name: "模型列表" })).toContainText("gpt-5.5");
  await settingsDialog.getByRole("switch", { name: "启用模型 gpt-5.5" }).click();
  await expect(settingsDialog.getByRole("table", { name: "模型列表" })).toContainText("已禁用");
  await settingsDialog.getByRole("button", { name: "删除模型" }).nth(1).click();
  await expect(settingsDialog.getByRole("table", { name: "模型列表" })).not.toContainText("gpt-5.5");

  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __noliaMock: { settingsHistory: Array<{ key: string; value: unknown }> } }).__noliaMock.settingsHistory
      )
    )
    .toContainEqual(expect.objectContaining({ key: "ai" }));
});

test("AI settings configures semantic index manually", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings({ allowCurrentNoteContent: false })
    },
    files: {
      "ai.md": "# AI Semantic\n\nSemantic index settings."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.getByRole("button", { name: "AI 设置" }).click();

  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog.getByText("语义索引", { exact: true })).toBeVisible();
  await settingsDialog.getByLabel("启用语义检索").check();
  await settingsDialog.getByLabel("Embedding 模型").fill("mock-embed");
  await settingsDialog.getByRole("button", { name: "测试 embedding" }).click();
  await expect(settingsDialog.locator(".plugin-empty-state.is-ok")).toContainText("Mock embedding connected");
  await settingsDialog.getByRole("button", { name: "更新语义索引" }).click();
  await expect(settingsDialog.locator(".ai-semantic-status")).toContainText("可用");
  await expect(settingsDialog.locator(".ai-semantic-summary")).toContainText("分块");
});

test("AI settings opens with legacy public settings that do not include embedding", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    legacyAiPublicSettingsWithoutEmbedding: true,
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Legacy\n\nOlder settings should not blank the page."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.getByRole("button", { name: "AI 设置" }).click();

  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("table", { name: "模型列表" })).toContainText("gpt-4.1");
  await expect(settingsDialog.getByText("语义索引", { exact: true })).toBeVisible();
  await expect(settingsDialog.getByLabel("Embedding 服务商")).toHaveValue("ollama");
  await expect(settingsDialog.getByLabel("Embedding 地址")).toHaveValue("http://localhost:11434");
});

test("AI sidebar model selector updates the default provider", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings({
        defaultProviderId: "openai-compatible-2",
        providers: [
          {
            id: "openai-compatible",
            name: "OpenAI-compatible",
            providerId: "openai-compatible",
            model: "gpt-4.1",
            baseUrl: "https://api.example.test/v1",
            apiMode: "chat-completions"
          },
          {
            id: "openai-compatible-2",
            name: "OpenAI-compatible 2",
            providerId: "openai-compatible",
            model: "",
            baseUrl: "https://api.example.test/v1",
            apiMode: "chat-completions"
          },
          {
            id: "ollama-local",
            name: "Local Ollama",
            providerId: "ollama",
            model: "qwen3.5:latest",
            baseUrl: "http://localhost:11434",
            apiMode: "ollama-native"
          }
        ]
      })
    },
    files: {
      "ai.md": "# AI Models\n\nModel selector."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();

  const modelSelect = page.locator(".ai-composer-model-row").getByLabel("模型");
  await expect(modelSelect).toBeVisible();
  await expect(modelSelect.locator("option")).toContainText(["选择模型", "gpt-4.1 · OpenAI-compatible", "qwen3.5:latest · Ollama"]);
  await modelSelect.selectOption("ollama-local");
  await expect(page.locator(".ai-sidebar-header")).toContainText("qwen3.5:latest");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const last = (window as typeof window & { __noliaMock: { settingsHistory: Array<{ key: string; value: { defaultProviderId?: string } }> } })
          .__noliaMock.settingsHistory.at(-1);
        return last?.value.defaultProviderId;
      })
    )
    .toBe("ollama-local");
  await modelSelect.selectOption("openai-compatible");
  await expect(page.locator(".ai-sidebar-header")).toContainText("gpt-4.1");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const last = (window as typeof window & { __noliaMock: { settingsHistory: Array<{ key: string; value: { defaultProviderId?: string } }> } })
          .__noliaMock.settingsHistory.at(-1);
        return last?.value.defaultProviderId;
      })
    )
    .toBe("openai-compatible");
});

test("AI immediate missing model error does not leave the run stuck", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings({
        providers: [
          {
            id: "openai-compatible",
            name: "OpenAI-compatible",
            providerId: "openai-compatible",
            model: "",
            baseUrl: "https://api.example.test/v1",
            apiMode: "chat-completions"
          }
        ]
      })
    },
    files: {
      "ai.md": "# AI Missing Model\n\nNo model configured."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("你好啊");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.locator(".ai-message.is-error")).toContainText("AI model is not configured");
  await expect(page.getByRole("button", { name: "停止" })).toBeHidden();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
});

test("AI selection actions require selected text and send selected context", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "selection.md": "# Selection\n\nalpha selected phrase beta."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();

  await page.getByRole("button", { name: "命令面板" }).click();
  await page.getByPlaceholder("输入命令").fill("润色选中文本");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ai-message.is-error")).toContainText("请先选择文本。");

  await selectSourceRange(page, "selected phrase");
  await page.getByRole("button", { name: "命令面板" }).click();
  await page.getByPlaceholder("输入命令").fill("润色选中文本");
  await page.keyboard.press("Enter");

  await expect(page.locator(".ai-sidebar")).toBeVisible();
  await expect(page.locator(".ai-message.is-user").last()).toContainText("润色选中文本");
  await expect(page.locator(".ai-context-bar")).toContainText("已选择 15 字符");
  await expect(page.locator(".ai-message.is-assistant")).toContainText("Mock response");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const runs = (window as typeof window & {
          __noliaMock: { aiRuns: Array<{ entryPoint?: string; actionId?: string; clientContext?: { selection?: { text?: string } } }> };
        }).__noliaMock.aiRuns;
        return runs.at(-1);
      })
    )
    .toMatchObject({
      entryPoint: "selection-action",
      actionId: "polish",
      clientContext: { selection: { text: "selected phrase" } }
    });
});

test("AI patch proposal actions require explicit confirmation and support replace copy retry discard", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Smoke\n\nOriginal body for patch review."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();

  await page.locator(".ai-composer textarea").fill("请生成提案");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-patch-preview")).toContainText("Mock patch proposal");
  await page.locator(".ai-patch-preview").getByText("影响范围", { exact: true }).click();
  await expect(page.locator(".ai-patch-preview")).toContainText("目标：ai.md");
  await expect(page.locator(".ai-patch-preview")).toContainText("操作：替换全文");
  await expect(page.locator(".ai-diff-block.is-before")).toContainText("Original body for patch review.");
  await expect(page.locator(".ai-diff-block.is-after")).toContainText("Mock patch proposal body.");
  await expect(page.locator(".ai-diff-content.is-after .ai-markdown-content h1")).toHaveText("AI Patch Applied");
  await expect(page.locator(".ai-patch-preview").getByRole("button", { name: "新建文档", exact: true })).toBeVisible();
  await expect(page.locator(".source-editor .cm-content")).toContainText("Original body for patch review.");

  await page.getByRole("button", { name: "复制结果" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __noliaMock: { clipboardWrites: Array<{ text?: string }> } }).__noliaMock.clipboardWrites.map((item) => item.text ?? "")
      )
    )
    .toContain("# AI Patch Applied\n\nMock patch proposal body.");

  await page.getByRole("button", { name: "重新生成" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { aiRuns: unknown[] } }).__noliaMock.aiRuns.length)).toBe(2);
  await expect(page.locator(".ai-patch-preview")).toContainText("Mock patch proposal");

  await page.getByRole("button", { name: "放弃" }).click();
  await expect(page.locator(".ai-patch-preview")).toBeHidden();
  await expect(page.locator(".source-editor .cm-content")).toContainText("Original body for patch review.");

  await createPatchProposal(page);
  await expect(page.locator(".ai-patch-preview").getByRole("button", { name: "插入", exact: true })).toBeHidden();
  await expect(page.locator(".ai-patch-preview").getByRole("button", { name: "追加", exact: true })).toBeHidden();
  await page.locator(".ai-patch-preview").getByRole("button", { name: "替换全文", exact: true }).click();
  await expect(page.locator(".source-editor .cm-content")).toContainText("AI Patch Applied");
  await expect(page.locator(".ai-patch-preview")).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(() => (window as typeof window & { __noliaMock: { savedText: Record<string, string> } }).__noliaMock.savedText["ai.md"])
    )
    .toContain("AI Patch Applied");
});

test("AI workspace operation proposals require confirmation and create history snapshots", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings({ allowWorkspaceRead: true, allowWorkspaceOperations: true })
    },
    files: {
      "ai.md": "# Workspace Source\n\nOriginal workspace body."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("请生成工作区操作提案");
  await page.getByRole("button", { name: "发送" }).click();

  const proposal = page.locator(".ai-patch-preview");
  await expect(proposal).toContainText("Mock workspace operations");
  await proposal.getByText("影响范围", { exact: true }).click();
  await expect(proposal).toContainText("共 2 个操作");
  await expect(proposal).toContainText("ai.md");
  await expect(proposal).toContainText("ai-created.md");
  await expect(page.locator(".source-editor .cm-content")).toContainText("Original workspace body.");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["ai-created.md"])).toBeUndefined();

  await proposal.getByRole("button", { name: "确认应用工作区操作" }).click();
  await expect(page.locator(".ai-patch-preview")).toBeHidden();
  await expect(page.locator(".source-editor .cm-content")).toContainText("AI Workspace Applied");
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files))
    .toMatchObject({
      "ai.md": "# AI Workspace Applied\n\nExisting note updated.",
      "ai-created.md": "# AI Created\n\nNew workspace note."
    });
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { historySnapshots: Array<{ pathRel: string; content: string }> } }).__noliaMock.historySnapshots))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ pathRel: "ai.md", content: "# Workspace Source\n\nOriginal workspace body." }),
      expect.objectContaining({ pathRel: "ai-created.md", content: "# AI Created\n\nNew workspace note." })
    ]));
});

test("AI long table patch proposal keeps content inside the card", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# World Cup\n\nOriginal body."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("请生成长表格提案");
  await page.getByRole("button", { name: "发送" }).click();

  const proposal = page.locator(".ai-patch-preview");
  await expect(proposal.locator(".ai-diff-content.is-after .ai-markdown-content h1")).toContainText("历届世界杯");
  await expect(proposal.locator(".ai-diff-content.is-after table")).toBeVisible();
  await expect(proposal.getByRole("button", { name: "替换全文", exact: true })).toBeVisible();
  const layout = await proposal.evaluate((element) => {
    const rectFor = (selector: string) => element.querySelector(selector)?.getBoundingClientRect();
    const card = element.getBoundingClientRect();
    const diff = rectFor(".ai-patch-diff");
    const content = rectFor(".ai-diff-content.is-after");
    const details = rectFor(".ai-patch-details");
    const actions = rectFor(".ai-patch-actions");
    return {
      cardBottom: card.bottom,
      contentBottom: content?.bottom ?? 0,
      detailsTop: details?.top ?? 0,
      detailsBottom: details?.bottom ?? 0,
      actionsTop: actions?.top ?? 0,
      actionsBottom: actions?.bottom ?? 0,
      diffScrolls: element.querySelector(".ai-diff-content.is-after")
        ? (element.querySelector(".ai-diff-content.is-after") as HTMLElement).scrollHeight > (element.querySelector(".ai-diff-content.is-after") as HTMLElement).clientHeight
        : false,
      diffBottom: diff?.bottom ?? 0
    };
  });
  expect(layout.contentBottom).toBeLessThanOrEqual(layout.detailsTop + 1);
  expect(layout.detailsBottom).toBeLessThanOrEqual(layout.actionsTop + 1);
  expect(layout.actionsBottom).toBeLessThanOrEqual(layout.cardBottom + 1);
  expect(layout.diffBottom).toBeLessThanOrEqual(layout.actionsTop + 1);
  expect(layout.diffScrolls).toBe(true);
});

test("AI replace can be undone and records a history snapshot", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Undo\n\nOriginal body before AI replacement."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await createPatchProposal(page);
  await page.locator(".ai-patch-preview").getByRole("button", { name: "替换全文", exact: true }).click();
  await expect(page.locator(".source-editor .cm-content")).toContainText("AI Patch Applied");

  await page.getByRole("button", { name: "撤销" }).click();
  await expect(page.locator(".source-editor .cm-content")).toContainText("Original body before AI replacement.");
  await expect(page.locator(".source-editor .cm-content")).not.toContainText("AI Patch Applied");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __noliaMock: { historySnapshots: Array<{ pathRel: string; content: string }> } }).__noliaMock.historySnapshots
      )
    )
    .toContainEqual(expect.objectContaining({ pathRel: "ai.md", content: "# AI Undo\n\nOriginal body before AI replacement." }));
});

test("history panel can restore the pre-AI version", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI History\n\nOriginal version for history restore."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await createPatchProposal(page);
  await page.locator(".ai-patch-preview").getByRole("button", { name: "替换全文", exact: true }).click();
  await expect(page.locator(".source-editor .cm-content")).toContainText("AI Patch Applied");

  await page.getByRole("button", { name: "关闭 AI" }).click();
  await page.getByRole("button", { name: "历史版本" }).click();
  await expect(page.locator(".right-panel.history")).toBeVisible();
  await expect(page.locator(".history-item")).toContainText("手动版本");
  await page.locator(".history-item").first().click();
  await expect(page.locator(".history-compare")).toContainText("历史版本与当前版本对比");
  await expect(page.locator(".history-diff-line.is-removed").filter({ hasText: "Original version for history restore." })).toBeVisible();
  await expect(page.locator(".history-diff-line.is-added").filter({ hasText: "AI Patch Applied" })).toBeVisible();
  await page.locator(".history-item").getByRole("button", { name: "恢复" }).first().click();
  await expect(page.locator(".source-editor .cm-content")).toContainText("Original version for history restore.");
  await expect(page.locator(".source-editor .cm-content")).not.toContainText("AI Patch Applied");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __noliaMock: { historySnapshots: Array<{ pathRel: string; reason: string; content: string }> } }).__noliaMock.historySnapshots
      )
    )
    .toEqual([
      expect.objectContaining({ pathRel: "ai.md", reason: "manual", content: "# AI History\n\nOriginal version for history restore." }),
      expect.objectContaining({ pathRel: "ai.md", reason: "autosave", content: "# AI Patch Applied\n\nMock patch proposal body." })
    ]);
});

test("AI can write the previous assistant response into a new document without re-asking the model", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# Summary Source\n\nOriginal body for generated summary."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();

  await page.locator(".ai-composer textarea").fill("总结一下目录系统");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant")).toContainText("Mock response: 总结一下目录系统");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { aiRuns: unknown[] } }).__noliaMock.aiRuns.length)).toBe(1);

  await page.locator(".ai-composer textarea").fill("将内容写入到新的文档中");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.locator(".ai-patch-preview")).toContainText("将上一条 AI 回复写入新文档");
  await expect(page.locator(".ai-patch-preview").getByRole("button", { name: "新建文档", exact: true })).toBeVisible();
  await expect(page.locator(".ai-patch-preview").getByRole("button", { name: "插入", exact: true })).toBeHidden();
  await expect(page.locator(".ai-patch-preview").getByRole("button", { name: "追加", exact: true })).toBeHidden();
  await expect(page.locator(".ai-diff-block.is-after")).toContainText("Mock response: 总结一下目录系统");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { aiRuns: unknown[] } }).__noliaMock.aiRuns.length)).toBe(1);

  await page.locator(".ai-patch-preview").getByRole("button", { name: "新建文档", exact: true }).click();
  await expect(page.locator(".source-editor .cm-content")).toContainText("Mock response: 总结一下目录系统");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const mock = (window as typeof window & {
          __noliaMock: {
            createdPaths: string[];
            historySnapshots: Array<{ pathRel: string; content: string }>;
          };
        }).__noliaMock;
        return {
          createdPaths: mock.createdPaths,
          historySnapshots: mock.historySnapshots
        };
      })
    )
    .toEqual({
      createdPaths: expect.arrayContaining([expect.stringMatching(/\.md$/)]),
      historySnapshots: expect.arrayContaining([expect.objectContaining({ content: "Mock response: 总结一下目录系统" })])
    });
});

test("AI keeps the generated document proposal fully visible after long markdown replies", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# Catalogs\n\nOriginal body for generated document."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();

  await page.locator(".ai-composer textarea").fill("请返回长 Markdown 回复");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant .ai-markdown-content h1")).toHaveText("大模型分类笔记");

  await page.locator(".ai-composer textarea").fill("将我们刚才讨论的问题，整理成一份新的文档，然后保存");
  await page.getByRole("button", { name: "发送" }).click();

  const proposal = page.locator(".ai-patch-preview");
  await expect(proposal).toContainText("将上一条 AI 回复写入新文档");
  await expect(proposal.getByRole("button", { name: "新建文档", exact: true })).toBeVisible();
  await expect(proposal.locator(".ai-diff-content.is-after .ai-markdown-content h1")).toHaveText("大模型分类笔记");

  await expect
    .poll(() =>
      page.locator(".ai-message-list").evaluate((list) => {
        const listRect = list.getBoundingClientRect();
        const proposalRect = list.querySelector(".ai-patch-preview")?.getBoundingClientRect();
        const actionsRect = list.querySelector(".ai-patch-actions")?.getBoundingClientRect();
        return {
          distanceFromBottom: Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop),
          proposalVisibleBottom: proposalRect ? proposalRect.bottom <= listRect.bottom + 1 : false,
          actionsVisibleBottom: actionsRect ? actionsRect.bottom <= listRect.bottom + 1 : false
        };
      })
    )
    .toEqual({
      distanceFromBottom: expect.any(Number),
      proposalVisibleBottom: true,
      actionsVisibleBottom: true
    });
  await expect
    .poll(() => page.locator(".ai-message-list").evaluate((list) => Math.abs(list.scrollHeight - list.clientHeight - list.scrollTop)))
    .toBeLessThan(2);
});

test("AI runtime errors are shown in the sidebar without breaking the composer", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Error\n\nRuntime error path."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("触发错误");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-error")).toContainText("Mock AI failure");
  await expect(page.locator(".ai-error-card")).toContainText("错误代码：provider_bad_request");
  await page.locator(".ai-error-card").getByRole("button", { name: "复制错误" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as typeof window & { __noliaMock: { clipboardWrites: Array<{ text?: string }> } }).__noliaMock.clipboardWrites.map((item) => item.text ?? "")
      )
    )
    .toContain("Mock AI failure");
  await page.locator(".ai-error-card").getByRole("button", { name: "打开 AI 设置" }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await page.getByRole("dialog", { name: "设置" }).locator(".settings-close-button").click();

  await page.locator(".ai-composer textarea").fill("错误后继续对话");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant")).toContainText("Mock response: 错误后继续对话");
});

test("AI empty responses are shown as visible errors and release the composer", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Empty\n\nThe provider can return an empty completion."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("模拟空回复");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.locator(".ai-message.is-error")).toContainText("没有收到任何文本、工具结果或修改建议");
  await expect(page.locator(".ai-error-card")).toContainText("错误代码：provider_empty_response");
  await expect(page.getByRole("button", { name: "停止" })).toBeHidden();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();

  await page.locator(".ai-composer textarea").fill("空回复后继续对话");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant").last()).toContainText("Mock response: 空回复后继续对话");
});

test("AI runs without terminal events show a timeout error and release the composer", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Timeout\n\nThe provider can forget to send a terminal event."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("模拟无终止事件");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
  await expect(page.locator(".ai-message.is-error")).toContainText("AI 请求长时间没有返回结果", { timeout: 4_000 });
  await expect(page.getByRole("button", { name: "停止" })).toBeHidden();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();

  await page.locator(".ai-composer textarea").fill("超时后继续对话");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant").last()).toContainText("Mock response: 超时后继续对话");
});

test("AI startRun hangs are surfaced instead of leaving the sidebar stuck", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Start Timeout\n\nThe IPC start call can hang."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await page.locator(".ai-composer textarea").fill("模拟启动无响应");
  await page.getByRole("button", { name: "发送" }).click();

  await expect(page.locator(".ai-message.is-error")).toContainText("AI 请求长时间没有返回结果", { timeout: 4_000 });
  await expect(page.getByRole("button", { name: "停止" })).toBeHidden();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
});

test("AI patch proposal actions remain reachable in narrow sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Narrow\n\nOriginal body for patch review."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await createPatchProposal(page);

  const proposal = page.locator(".ai-patch-preview");
  await expect(proposal).toBeVisible();
  for (const name of ["替换全文", "新建文档", "复制结果", "重新生成", "放弃"]) {
    await expect(proposal.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(proposal.getByRole("button", { name: "插入", exact: true })).toBeHidden();
  await expect(proposal.getByRole("button", { name: "追加", exact: true })).toBeHidden();
  await expect(proposal.locator(".ai-diff-content.is-after .ai-markdown-content h1")).toHaveText("AI Patch Applied");

  const sidebarBox = await page.locator(".ai-sidebar").boundingBox();
  const actionsBox = await proposal.locator(".ai-patch-actions").boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect((actionsBox?.x ?? 0) + (actionsBox?.width ?? 0)).toBeLessThanOrEqual((sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0) + 1);
  const patchLayout = await proposal.evaluate((element) => {
    const header = element.querySelector(".ai-patch-header")?.getBoundingClientRect();
    const diff = element.querySelector(".ai-patch-diff")?.getBoundingClientRect();
    const actions = element.querySelector(".ai-patch-actions")?.getBoundingClientRect();
    return {
      headerBottom: header?.bottom ?? 0,
      diffTop: diff?.top ?? 0,
      diffBottom: diff?.bottom ?? 0,
      actionsTop: actions?.top ?? 0
    };
  });
  expect(patchLayout.headerBottom).toBeLessThanOrEqual(patchLayout.diffTop + 1);
  expect(patchLayout.diffBottom).toBeLessThanOrEqual(patchLayout.actionsTop + 1);
});

test("AI critical controls stay reachable by role and avoid horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1320, height: 860 });
  await installMockNolia(page, {
    settings: {
      editorMode: "source",
      ai: openAiSettings()
    },
    files: {
      "ai.md": "# AI Reachability\n\nAI controls should be reachable."
    }
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Nolia AI" })).toBeVisible();
  await page.getByRole("button", { name: "Nolia AI" }).click();
  await expect(page.getByRole("region", { name: "Nolia AI" })).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 设置" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭 AI" })).toBeVisible();
  await expect(page.locator(".ai-context-bar")).toContainText("当前笔记");
  await expect(page.locator(".ai-composer textarea")).toBeEditable();

  await page.getByRole("button", { name: "AI 设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "AI" })).toHaveAttribute("aria-selected", "true");
  await expect(settingsDialog.getByLabel("启用 AI")).toBeChecked();
  await expect(settingsDialog.getByRole("table", { name: "模型列表" })).toContainText("gpt-4.1");
  await settingsDialog.getByRole("button", { name: "编辑模型" }).click();
  const modelDialog = page.getByRole("dialog", { name: "编辑模型" });
  await expect(modelDialog.getByLabel("服务商")).toHaveValue("openai-compatible");
  await expect(modelDialog.getByLabel("自定义请求地址")).toHaveValue("https://api.example.test/v1");
  await expect(modelDialog.getByLabel("API 格式")).toHaveValue("chat-completions");
  await expect(modelDialog.getByLabel("模型 ID")).toHaveValue("gpt-4.1");
  await modelDialog.getByRole("button", { name: "测试连接" }).click();
  await expect(modelDialog.locator(".plugin-empty-state.is-ok")).toContainText("Mock AI provider connected");
  await modelDialog.locator(".ai-model-dialog-header").getByLabel("取消").click();
  await settingsDialog.locator(".settings-close-button").click();

  await page.locator(".ai-composer textarea").fill("可达性检查");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-message.is-assistant")).toContainText("Mock response: 可达性检查");
  await expect(page.locator(".ai-composer-note")).toContainText("当前笔记");

  await page.setViewportSize({ width: 390, height: 820 });
  await expect(page.getByRole("region", { name: "Nolia AI" })).toBeVisible();
  await expect(page.locator(".ai-composer textarea")).toBeVisible();
  const overflowProblems = await page.locator(".ai-sidebar").evaluate((sidebar) => {
    const sidebarRect = sidebar.getBoundingClientRect();
    return [...sidebar.querySelectorAll("*")].flatMap((node) => {
      const rect = node.getBoundingClientRect();
      const label = node.getAttribute("aria-label") ?? node.textContent?.trim().replace(/\s+/g, " ").slice(0, 48) ?? node.tagName;
      return rect.right > sidebarRect.right + 1 ? [label] : [];
    });
  });
  expect(overflowProblems).toEqual([]);
});

async function createPatchProposal(page: import("@playwright/test").Page) {
  await page.locator(".ai-composer textarea").fill("请生成提案");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator(".ai-patch-preview")).toContainText("Mock patch proposal");
}

async function selectSourceRange(page: import("@playwright/test").Page, text: string) {
  await page.locator(".source-editor .cm-content").evaluate((element, targetText) => {
    const typedElement = element as HTMLElement & {
      cmTile?: { view?: { state: { doc: { toString: () => string } }; dispatch: (spec: unknown) => void; focus: () => void } };
      cmView?: { view?: { state: { doc: { toString: () => string } }; dispatch: (spec: unknown) => void; focus: () => void } };
    };
    const view = typedElement.cmView?.view ?? typedElement.cmTile?.view;
    if (!view) {
      throw new Error("CodeMirror view not found");
    }
    const source = view.state.doc.toString();
    const from = source.indexOf(targetText);
    if (from < 0) {
      throw new Error(`Selection text not found: ${targetText}`);
    }
    view.dispatch({
      selection: { anchor: from, head: from + targetText.length },
      scrollIntoView: true
    });
    view.focus();
  }, text);
}
