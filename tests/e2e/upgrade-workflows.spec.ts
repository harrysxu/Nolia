import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import type { AiTaskSnapshot } from "../../src/shared/ai";
import type { AppSettings } from "../../src/shared/types";
import { installMockNolia } from "./helpers/mockNolia";

const enabledAiSettings: AppSettings["ai"] = {
  enabled: true,
  defaultProviderId: "openai-compatible",
  providers: [{ id: "openai-compatible", name: "OpenAI-compatible", providerId: "openai-compatible", model: "gpt-4.1", baseUrl: "https://api.example.test/v1", apiMode: "chat-completions" }],
  embedding: { enabled: false, providerId: "ollama", model: "", baseUrl: "http://localhost:11434", apiMode: "ollama-native" },
  conversationHistoryTurns: 3,
  agentMaxSteps: 12,
  allowCurrentNoteContent: true,
  allowWorkspaceSearch: true,
  allowReadSearchResults: true,
  allowWorkspaceRead: true,
  allowWorkspaceOperations: true
};

function completedTask(id = "task-history", updatedAt = Date.now()): AiTaskSnapshot {
  return {
    id,
    runId: `run-${id}`,
    workspaceId: "ws_full_selftest",
    title: `历史任务 ${id}`,
    status: "completed",
    createdAt: updatedAt - 1_000,
    updatedAt,
    historyVersion: 2,
    instruction: "内部任务指令",
    messages: [
      { id: `${id}:user`, runId: `run-${id}`, role: "user", content: "请总结发布说明", createdAt: updatedAt - 900 },
      { id: `${id}:assistant`, runId: `run-${id}`, role: "assistant", content: "## 发布摘要\n\n已经完成核心功能。", createdAt: updatedAt - 800 }
    ],
    usage: { inputTokens: 10, outputTokens: 12, totalTokens: 22 },
    model: { providerId: "openai-compatible", providerProfileId: "openai-compatible", model: "gpt-4.1" },
    steps: [{ id: `${id}:step`, index: 1, kind: "tool", title: "searchNotes", summary: "找到发布说明", createdAt: updatedAt - 700 }],
    sources: [{ kind: "note", pathRel: "release.md", title: "Release", snippet: "Version 1.0" }],
    approvals: [{ id: `${id}:approval`, taskId: id, runId: `run-${id}`, toolName: "proposeWorkspacePatch", input: {}, status: "approved", createdAt: updatedAt - 600, proposalId: `${id}:proposal` }],
    proposals: [{ id: `${id}:proposal`, runId: `run-${id}`, taskId: id, approvalId: `${id}:approval`, createdAt: updatedAt - 500, status: "applied", workspaceId: "ws_full_selftest", pathRel: "release.md", title: "更新发布说明", summary: "追加发布摘要", sourceSnapshotHash: "before", baseHash: "before", operations: [{ id: `${id}:operation`, type: "append", pathRel: "release.md", afterText: "已经完成核心功能。" }] }],
    writes: [{ id: `${id}:write`, taskId: id, proposalId: `${id}:proposal`, workspaceId: "ws_full_selftest", createdAt: updatedAt - 400, status: "committed", operations: [{ pathRel: "release.md", operationId: `${id}:operation`, status: "applied", beforeHash: "before", afterHash: "after" }] }]
  };
}

test("opens the AI task center and returns to the current document", async ({ page }) => {
  await installMockNolia(page, {
    files: {
      "project.md": "# Project\n\nKeep this document open while visiting the AI task center."
    }
  });
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "工作区导航" });
  const aiButton = navigation.getByRole("button", { name: "AI", exact: true });
  await aiButton.click();

  await expect(aiButton).toHaveClass(/is-active/);
  await expect(page.getByRole("heading", { name: "AI 任务" })).toBeVisible();
  await expect(page.getByText("还没有 AI 任务。", { exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "打开的文档" })).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "文档检查器" })).toHaveCount(0);

  await navigation.getByRole("button", { name: "文件", exact: true }).click();
  await expect(page.getByRole("tab", { name: "打开文档 project.md" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tablist", { name: "文档检查器" })).toBeVisible();
});

test("restores the AI task center from the workspace session", async ({ page }) => {
  const now = Date.now();
  await installMockNolia(page, {
    files: {
      "project.md": "# Project"
    },
    session: {
      workspaceId: "ws_full_selftest",
      activePathRel: "project.md",
      documents: [{ pathRel: "project.md", mode: "source", lastActiveAt: now }],
      recentlyClosed: [],
      sidebarView: "ai",
      inspectorView: "outline",
      updatedAt: now
    }
  });
  await page.goto("/");

  const aiButton = page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "AI", exact: true });
  await expect(aiButton).toHaveClass(/is-active/);
  await expect(page.getByRole("heading", { name: "AI 任务" })).toBeVisible();
});

test("opens persisted AI task details without showing an empty sidebar", async ({ page }) => {
  const task = completedTask();
  await installMockNolia(page, { aiTasks: [task] });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "AI", exact: true }).click();
  await page.getByText(task.title, { exact: true }).click();

  await expect(page.getByRole("heading", { name: task.title })).toBeVisible();
  await expect(page.getByRole("region", { name: "Nolia AI" })).toHaveCount(0);
  await expect(page.getByText("请总结发布说明", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "发布摘要" })).toBeVisible();

  await page.getByRole("tab", { name: "执行记录" }).click();
  await expect(page.getByText("searchNotes", { exact: true })).toBeVisible();
  await expect(page.getByText("Release", { exact: true })).toBeVisible();
  await expect(page.getByText("Token 使用：22", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "变更" }).click();
  await expect(page.getByText("更新发布说明", { exact: true })).toBeVisible();
  await expect(page.getByText("已提交", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 780, height: 520 });
  const accessibility = await new AxeBuilder({ page }).include(".ai-task-detail").analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "返回 AI 任务" }).click();
  await expect(page.getByRole("heading", { name: "AI 任务" })).toBeVisible();
});

test("ignores stale task reads when switching between current task details", async ({ page }) => {
  const now = Date.now();
  const slow = completedTask("slow", now + 1);
  const fast = completedTask("fast", now);
  await installMockNolia(page, { aiTasks: [slow, fast], aiTaskReadDelays: { slow: 100 } });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "AI", exact: true }).click();
  await page.getByText(slow.title, { exact: true }).click();
  await page.getByRole("button", { name: "返回 AI 任务" }).click();
  await page.getByText(fast.title, { exact: true }).click();

  await expect(page.getByRole("heading", { name: fast.title })).toBeVisible();
  await page.waitForTimeout(150);
  await expect(page.getByRole("heading", { name: fast.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: slow.title })).toHaveCount(0);
});

test("continues history in a linked task and resets it for a new conversation", async ({ page }) => {
  const task = completedTask();
  await installMockNolia(page, { aiTasks: [task], settings: { ai: enabledAiSettings } });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "AI", exact: true }).click();
  await page.getByText(task.title, { exact: true }).click();
  await page.getByRole("button", { name: "继续对话" }).click();

  const sidebar = page.getByRole("region", { name: "Nolia AI" });
  await expect(sidebar).toContainText("已经完成核心功能");
  await sidebar.getByPlaceholder("询问 Nolia AI...").fill("还有哪些风险？");
  await sidebar.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { aiRuns: Array<{ parentTaskId?: string; userMessage?: string }> } }).__noliaMock.aiRuns.at(-1))).toMatchObject({ parentTaskId: task.id, userMessage: "还有哪些风险？" });
  await expect(sidebar).toContainText("Mock response: 还有哪些风险？");

  await sidebar.getByRole("button", { name: "关闭 AI" }).click();
  await page.getByRole("button", { name: "返回 AI 任务" }).click();
  await page.getByRole("button", { name: "新对话", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Nolia AI" })).not.toContainText("已经完成核心功能");
});

test("shows failed task diagnostics and opens pending approvals from task details", async ({ page }) => {
  const now = Date.now();
  const failed: AiTaskSnapshot = { ...completedTask("failed", now), title: "失败任务", status: "failed", lastError: "模型服务连接超时" };
  const pendingBase = completedTask("pending", now + 1);
  const pending: AiTaskSnapshot = {
    ...pendingBase,
    title: "待审批任务",
    status: "waiting_approval",
    pendingApprovalId: "pending:approval",
    approvals: pendingBase.approvals.map((approval) => ({ ...approval, status: "pending" })),
    proposals: pendingBase.proposals.map((proposal) => ({ ...proposal, status: "pending" }))
  };
  await installMockNolia(page, { aiTasks: [pending, failed] });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "AI", exact: true }).click();

  await page.getByText(failed.title, { exact: true }).click();
  await page.getByRole("tab", { name: "执行记录" }).click();
  await expect(page.getByText("模型服务连接超时", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回 AI 任务" }).click();

  await page.getByText(pending.title, { exact: true }).click();
  await page.getByRole("button", { name: "查看审批" }).click();
  await expect(page.getByRole("heading", { name: "审查 AI 修改" })).toBeVisible();
  await page.getByRole("button", { name: "返回任务" }).click();
  await expect(page.getByRole("heading", { name: pending.title })).toBeVisible();
});

test("renders AI task history navigation in English", async ({ page }) => {
  const task = completedTask("english");
  await installMockNolia(page, { aiTasks: [task], settings: { language: "en-US" } });
  await page.goto("/");
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: "AI", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI Tasks" })).toBeVisible();
  await page.getByText(task.title, { exact: true }).click();
  await expect(page.getByRole("tab", { name: "Conversation" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Changes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to AI tasks" })).toBeVisible();
});

test("initializes a writable Markdown folder only after confirmation", async ({ page }) => {
  await installMockNolia(page, {
    activeWorkspace: false,
    session: null,
    workspaceProbe: {
      path: "/tmp/imported-notes",
      name: "Imported Notes",
      status: "initializable",
      readable: true,
      writable: true,
      markdownCount: 12,
      hasNoliaDirectory: false
    }
  });

  await page.goto("/");
  await page.getByRole("button", { name: "打开工作区" }).click();
  const dialog = page.getByRole("dialog", { name: "初始化 Imported Notes？" });
  await expect(dialog).toContainText("发现 12 个 Markdown 文件");
  await dialog.getByRole("button", { name: "初始化并打开" }).click();
  await expect(page.getByRole("heading", { name: "Full Selftest Workspace" })).toBeVisible();
});

test("workspace home captures Inbox notes and passes its accessibility scan", async ({ page }) => {
  await installMockNolia(page, { session: null });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Full Selftest Workspace" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include(".workspace-home").analyze();
  expect(accessibility.violations).toEqual([]);

  await page.getByRole("button", { name: "快速捕获" }).click();
  const dialog = page.getByRole("dialog", { name: "快速捕获" });
  await dialog.getByLabel("标题").fill("Meeting follow-up");
  await dialog.getByLabel("正文").fill("Call Alice and update the launch checklist.");
  await dialog.getByRole("button", { name: "捕获", exact: true }).click();

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { createdPaths: string[] } }).__noliaMock.createdPaths.some((path) => /^Inbox\/\d{4}-\d{2}\.md$/.test(path)))).toBe(true);
  await expect(page.locator(".source-editor .cm-content")).toContainText("Meeting follow-up");
});

test("workspace home creates Daily Notes and expands safe template variables", async ({ page }) => {
  await installMockNolia(page, {
    session: null,
    files: {
      "home.md": "# Home",
      "Templates/Project.md": "# {{title}}\n\nWorkspace: {{workspace}}\nDate: {{date}} {{time}}"
    }
  });
  await page.goto("/");

  await page.getByRole("button", { name: "今日笔记" }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { createdPaths: string[] } }).__noliaMock.createdPaths.some((path) => /^Daily\/\d{4}-\d{2}-\d{2}\.md$/.test(path)))).toBe(true);
  await page.getByRole("button", { name: /关闭文档/ }).click();

  await page.getByRole("button", { name: "从模板新建" }).click();
  const templateDialog = page.getByRole("dialog", { name: "从模板新建" });
  await templateDialog.getByText("Project.md", { exact: true }).click();
  await templateDialog.getByLabel("新笔记标题").fill("Apollo");
  await templateDialog.getByRole("button", { name: "创建笔记" }).click();

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["Apollo.md"])).toContain("# Apollo");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["Apollo.md"])).toContain("Workspace: Full Selftest Workspace");
});

test("edits frontmatter properties and opens the keyboard-accessible local graph", async ({ page }) => {
  await installMockNolia(page, {
    files: {
      "project.md": "---\npriority: 2\npublished: false\n---\n# Project\n\nSee [[Roadmap]].",
      "Roadmap.md": "# Roadmap"
    }
  });
  await page.goto("/");

  const inspector = page.getByRole("tablist", { name: "文档检查器" });
  await inspector.getByRole("tab", { name: "属性" }).click();
  await page.getByRole("button", { name: "添加属性" }).click();
  await page.getByLabel("属性名").fill("status");
  await page.getByLabel("属性值").fill("active");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["project.md"])).toContain("status: active");
  const priority = page.locator(".property-row", { hasText: "priority" }).locator("input");
  await priority.fill("3");
  await priority.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["project.md"])).toContain("priority: 3");

  await inspector.getByRole("tab", { name: "关系" }).click();
  await expect.poll(() => page.evaluate(async () => (await window.nolia.graph.getLocal?.({ workspaceId: "ws_full_selftest", pathRel: "project.md", depth: 1, limit: 60 }))?.nodes.length)).toBe(1);
  await page.getByRole("button", { name: "打开局部关系图" }).click();
  await expect(page.getByRole("heading", { name: "Project 的关系" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "关系节点" }).getByRole("button", { name: "project project.md" })).toBeVisible();
  await page.getByLabel("关系深度").selectOption("2");
  await expect(page.getByLabel("关系深度")).toHaveValue("2");
});

test("keeps the export menu above split editor content", async ({ page }) => {
  await installMockNolia(page, {
    files: {
      "table.md": "| Service | Decision | Notes |\n| --- | --- | --- |\n| ai-voice-agent-core | required | Keep the existing pipeline |"
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "分屏", exact: true }).click();
  await page.getByLabel("导出", { exact: true }).click();

  const pdfItem = page.getByRole("menuitem", { name: "PDF" });
  await expect(pdfItem).toBeVisible();
  await expect.poll(() => pdfItem.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
});

test("runs exact and fallback hybrid search and persists a saved search", async ({ page }) => {
  await installMockNolia(page, {
    session: null,
    files: {
      "alpha.md": "# Alpha\n\nLaunch checklist and notes.",
      "beta.md": "# Beta\n\nUnrelated content."
    }
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "发现" }).click();

  await page.getByPlaceholder("搜索标题、正文、路径、标签或属性").fill("launch");
  await expect(page.getByRole("listbox", { name: "搜索结果" }).getByRole("option")).toHaveCount(1);
  await page.getByRole("button", { name: "混合" }).click();
  await expect(page.getByRole("status")).toContainText("已降级为精确搜索");

  await page.getByRole("button", { name: "保存搜索" }).click();
  await page.getByPlaceholder("搜索名称").fill("Launch notes");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "Launch notes", exact: true })).toBeVisible();
});

test("discovery fills the editor area and searches title, body, and path while documents stay open", async ({ page }) => {
  await installMockNolia(page, {
    files: {
      "claude-notes.md": "# Claude Notes\n\nProvider comparison.",
      "research/providers.md": "# Providers\n\nThe body mentions claude as a fallback model.",
      "other.md": "# Other\n\nUnrelated content."
    }
  });
  await page.goto("/");
  await expect(page.locator(".document-tab")).toHaveCount(1);
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "发现" }).click();

  const discoverPage = page.locator(".discover-page");
  const editorZone = page.locator(".editor-zone");
  const [discoverHeight, editorHeight] = await Promise.all([
    discoverPage.evaluate((element) => element.getBoundingClientRect().height),
    editorZone.evaluate((element) => element.getBoundingClientRect().height)
  ]);
  expect(discoverHeight).toBeGreaterThan(editorHeight * 0.9);

  const search = page.getByPlaceholder("搜索标题、正文、路径、标签或属性");
  await search.fill("claude");
  await expect(page.getByRole("listbox", { name: "搜索结果" }).getByRole("option")).toHaveCount(2);
  await search.fill("research/providers");
  await expect(page.getByRole("status").filter({ hasText: "正在搜索" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "搜索结果" })).toHaveCount(0);
  await expect(page.getByRole("listbox", { name: "搜索结果" }).getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("Providers");
  await search.fill("missing-provider-boundary");
  await expect(page.getByText("没有匹配结果。")).toBeVisible();
});

test("keeps the newest search results when an older request finishes later", async ({ page }) => {
  await installMockNolia(page, {
    session: null,
    files: {
      "alpha.md": "# Alpha\n\nNewest result.",
      "slow.md": "# Slow\n\nOlder delayed result."
    }
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "发现" }).click();
  await page.evaluate(() => {
    const original = window.nolia.search.unified!;
    window.nolia.search.unified = async (request) => {
      if (request.query.text === "slow") {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return original(request);
    };
  });

  const search = page.getByPlaceholder("搜索标题、正文、路径、标签或属性");
  await search.fill("slow");
  await expect(page.getByRole("status", { name: "" }).filter({ hasText: "正在搜索" }).first()).toBeVisible();
  await page.waitForTimeout(180);
  await search.fill("alpha");
  await expect(page.getByRole("option")).toContainText("Alpha");
  await page.waitForTimeout(550);
  await expect(page.getByRole("option")).toContainText("Alpha");
  await expect(page.getByRole("option")).not.toContainText("Slow");
});

test("filters by indexed tags and confirms transactional tag rename previews", async ({ page }) => {
  await installMockNolia(page, {
    session: null,
    files: {
      "alpha.md": "---\ntags: [dev]\n---\n# Alpha\n\nShip #dev notes.",
      "beta.md": "---\ntags: [research]\n---\n# Beta\n\nResearch notes."
    }
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "发现" }).click();

  await page.getByRole("button", { name: "#dev 1" }).click();
  await expect(page.getByRole("listbox", { name: "搜索结果" }).getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option")).toContainText("Alpha");

  await page.getByRole("button", { name: "重命名标签 dev" }).click();
  await page.getByLabel("新标签名称").fill("engineering");
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /重命名标签并更新/ });
  await expect(dialog).toContainText("#dev → #engineering");
  await dialog.getByRole("button", { name: "重命名并更新标签" }).click();

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { files: Record<string, string> } }).__noliaMock.files["alpha.md"])).toContain("#engineering");
  await expect(page.getByRole("button", { name: "#engineering 1" })).toBeVisible();
});

test("completes wikilinks by title and creates missing notes without leaving the editor", async ({ page }) => {
  await installMockNolia(page, {
    settings: { editorMode: "source", autoSaveDelayMs: 30 },
    files: {
      "current.md": "# Current\n\n",
      "Roadmap.md": "# Product Roadmap\n"
    }
  });
  await page.goto("/");
  const editor = page.locator(".source-editor .cm-content");
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.insertText("[[Roa");
  const completion = page.locator(".cm-tooltip-autocomplete li", { hasText: "Product Roadmap" });
  await expect(completion).toBeVisible();
  await expect(completion).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { savedText: Record<string, string> } }).__noliaMock.savedText["current.md"])).toContain("[[Roadmap]]");

  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await page.keyboard.insertText("\n[[Brand New");
  const createCompletion = page.locator(".cm-tooltip-autocomplete li", { hasText: "创建“Brand New”" });
  await expect(createCompletion).toBeVisible();
  await expect(createCompletion).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __noliaMock: { createdPaths: string[] } }).__noliaMock.createdPaths)).toContain("Brand-New.md");
  await expect(page.locator(".source-editor .cm-content")).toBeVisible();
});
