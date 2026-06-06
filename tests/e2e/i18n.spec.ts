import { expect, test, type Page } from "@playwright/test";
import type { PluginDescriptor } from "../../src/shared/extensions";
import type { LocalePreference } from "../../src/shared/types";
import { installMockNolia } from "./helpers/mockNolia";

const englishFiles = {
  "home.md": [
    "# Home",
    "",
    "Internationalization smoke document.",
    "",
    "| Area | Status |",
    "| --- | --- |",
    "| Settings | Ready |"
  ].join("\n"),
  "assets/config.json": "{\"enabled\":true,\"count\":2}",
  "assets/notes.txt": "Plain text resource"
};

const mixedLanguageFiles = {
  "文件与资源-Settings-日本語-한국어.md": [
    "# 文件与资源 Settings 日本語 한국어",
    "",
    "User content should stay exactly as written:",
    "",
    "- 文件与资源",
    "- Settings",
    "- ワークスペース",
    "- 작업 공간"
  ].join("\n"),
  "assets/設定-데이터.json": "{\"label\":\"文件与资源 Settings 日本語 한국어\"}",
  "assets/メモ-노트.txt": "文件与资源 Settings 日本語 한국어"
};

const externalPlugin: PluginDescriptor = {
  pluginId: "local.i18n",
  pluginPath: "/tmp/local-i18n",
  rendererUrl: "nolia-plugin://local.i18n/index.js",
  enabled: false,
  manifest: {
    id: "local.i18n",
    name: "Local I18n Plugin",
    version: "1.0.0",
    apiVersion: 2,
    activationEvents: ["onStartup"],
    permissions: ["ui:contribute", "workspace:file:read", "network:request:https://example.com"],
    contributes: {
      commands: [{ id: "local.i18n.hello", title: "Plugin Command" }],
      sidebarPanels: [{ id: "local.i18n.panel", title: "Plugin Panel" }]
    }
  },
  permissionHash: "network:request:https://example.com|ui:contribute|workspace:file:read",
  diagnostics: []
};

test("English locale covers welcome, workspace, settings, editors, plugins, and restart messaging", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 860 });
  await installMockNolia(page, {
    activeWorkspace: false,
    settings: { language: "en-US", editorMode: "source" },
    recentWorkspaces: []
  });

  await page.goto("/");
  await expect(page.getByText("Local-first Markdown workstation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Continue where you left off" })).toBeVisible();
  await expect(page.getByText("暂无最近工作区。")).toHaveCount(0);
  await assertNoCoreChineseText(page);
  await assertNoPageOverflow(page);
  await page.screenshot({ path: "test-results/i18n-en-welcome.png", fullPage: false });
});

test("English workspace pages stay localized and readable across key surfaces", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 860 });
  await installMockNolia(page, {
    settings: { language: "en-US", editorMode: "source", theme: "light" },
    files: englishFiles,
    plugins: [externalPlugin]
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Notes", exact: true })).toBeVisible();
  await expect(page.getByText("Files and Resources")).toBeVisible();
  await expect(page.getByPlaceholder("Search files or resources")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Markdown Tools" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Heading 1" })).toBeVisible();
  await expect(page.locator(".statusbar")).toContainText("Saved");
  await assertNoCoreChineseText(page);
  await assertNoPageOverflow(page);
  await assertToolbarButtonsInside(page, "Markdown Tools");
  await page.screenshot({ path: "test-results/i18n-en-workspace-source.png", fullPage: false });

  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.locator(".settings-dialog-header strong").getByText("System Settings", { exact: true })).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "Preferences" })).toBeVisible();
  await expect(settingsDialog.getByLabel("Language")).toHaveValue("en-US");
  await expect(settingsDialog.getByLabel("Theme")).toBeVisible();
  await settingsDialog.getByLabel("Language").selectOption("zh-CN");
  await expect(settingsDialog.getByText("Restart required")).toBeVisible();
  await expect(settingsDialog.getByText("Language changes take effect after restarting Nolia.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  await expect(settingsDialog.getByText("重启后生效")).toHaveCount(0);
  await assertNoCoreChineseText(page);
  await assertNoPageOverflow(page);
  await page.screenshot({ path: "test-results/i18n-en-settings-restart.png", fullPage: false });

  await settingsDialog.getByRole("tab", { name: "Plugin Management" }).click();
  await expect(settingsDialog.locator(".plugin-settings header").getByText("External Plugins", { exact: true })).toBeVisible();
  await expect(settingsDialog.locator(".plugin-settings header").getByText("Built-in Extensions", { exact: true })).toBeVisible();
  await expect(settingsDialog.getByText("Plugin directory: ~/Library/Application Support/Nolia/plugins")).toBeVisible();
  const englishPluginItem = settingsDialog.locator(".plugin-settings-item").filter({ hasText: "Local I18n Plugin" }).first();
  await expect(englishPluginItem).toContainText("Contribute UI");
  await expect(englishPluginItem).toContainText("Read workspace files");
  await expect(englishPluginItem).toContainText("Network requests: https://example.com");
  await expect(englishPluginItem.getByRole("button", { name: "Accept Permissions" })).toBeVisible();
  await expect(settingsDialog.getByText("插件管理")).toHaveCount(0);
  await assertNoCoreChineseText(page);
  await assertNoPageOverflow(page);
  await page.screenshot({ path: "test-results/i18n-en-plugin-management.png", fullPage: false });

  await settingsDialog.locator(".settings-close-button").click();
  await page.getByRole("button", { name: "assets", exact: true }).click();
  await page.getByRole("button", { name: "config.json", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "JSON Tools" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Format" })).toBeVisible();
  await assertToolbarButtonsInside(page, "JSON Tools");
  await assertNoCoreChineseText(page);
  await page.screenshot({ path: "test-results/i18n-en-json-editor.png", fullPage: false });

  await page.getByRole("button", { name: "notes.txt", exact: true }).click();
  await expect(page.getByRole("toolbar", { name: "Text Tools" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clean Whitespace" })).toBeVisible();
  await assertToolbarButtonsInside(page, "Text Tools");
  await assertNoCoreChineseText(page);
  await page.screenshot({ path: "test-results/i18n-en-text-editor.png", fullPage: false });
});

test("Chinese locale remains localized and language change prompts in Chinese", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 780 });
  await installMockNolia(page, {
    settings: { language: "zh-CN", editorMode: "source", theme: "light" },
    files: {
      "home.md": "# 首页\n\n中文国际化验收文档。",
      "assets/config.json": "{\"enabled\":true}"
    },
    plugins: [externalPlugin]
  });

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "工作区导航" })).toBeVisible();
  await expect(page.getByText("文件与资源")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Markdown 工具" })).toBeVisible();
  await expect(page.getByRole("button", { name: "一级标题" })).toBeVisible();
  await expect(page.getByText("Files and Resources")).toHaveCount(0);
  await assertNoPageOverflow(page);

  await page.getByRole("button", { name: "设置" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "设置" });
  await expect(settingsDialog.getByText("系统设置")).toBeVisible();
  await expect(settingsDialog.getByRole("tab", { name: "基础设置" })).toBeVisible();
  await settingsDialog.getByLabel("语言").selectOption("en-US");
  await expect(settingsDialog.getByText("重启后生效")).toBeVisible();
  await expect(settingsDialog.getByText("语言更改将在重启 Nolia 后生效。")).toBeVisible();
  await expect(settingsDialog.getByText("Restart required")).toHaveCount(0);
  await settingsDialog.getByRole("tab", { name: "插件管理" }).click();
  await expect(settingsDialog.locator(".plugin-settings header").getByText("外部插件", { exact: true })).toBeVisible();
  const chinesePluginItem = settingsDialog.locator(".plugin-settings-item").filter({ hasText: "Local I18n Plugin" }).first();
  await expect(chinesePluginItem).toContainText("贡献界面");
  await expect(chinesePluginItem).toContainText("读取工作区文件");
  await expect(chinesePluginItem).toContainText("网络请求：https://example.com");
  await assertNoPageOverflow(page);
  await page.screenshot({ path: "test-results/i18n-zh-settings-plugin.png", fullPage: false });
});

test("localized chrome preserves user-authored content, file names, and external plugin labels", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 780 });
  await installMockNolia(page, {
    settings: { language: "en-US", editorMode: "source", theme: "light" },
    files: mixedLanguageFiles,
    plugins: [externalPlugin]
  });

  await page.goto("/");
  await expect(page.getByText("Files and Resources")).toBeVisible();
  await expect(page.getByRole("button", { name: "文件与资源-Settings-日本語-한국어.md", exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("文件与资源 Settings 日本語 한국어");
  await expect(page.locator(".cm-content")).toContainText("User content should stay exactly as written");
  await assertNoPageOverflow(page);

  await page.getByRole("button", { name: "Command Palette" }).click();
  await expect(page.getByPlaceholder("Type a command")).toBeVisible();
  await expect(page.getByText("Open Workspace")).toBeVisible();
  await page.getByPlaceholder("Type a command").fill("no-localized-match");
  await expect(page.getByText("No matching commands.")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByPlaceholder("Search workspace")).toBeVisible();
  await page.getByPlaceholder("Search workspace").fill("文件与资源");
  await expect(page.locator(".result-item").filter({ hasText: "文件与资源 Settings 日本語 한국어" })).toBeVisible();

  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await settingsDialog.getByRole("tab", { name: "Plugin Management" }).click();
  await expect(settingsDialog.getByText("Local I18n Plugin")).toBeVisible();
  await expect(settingsDialog.getByText("Plugin Command")).toHaveCount(0);
  await expect(settingsDialog.locator(".plugin-settings-item").filter({ hasText: "Local I18n Plugin" })).toContainText("Contribute UI");
  await assertNoCoreChineseText(page, { allowUserContent: true });
  await assertNoPageOverflow(page);
});

const addedLocaleCases: Array<{
  locale: Exclude<LocalePreference, "system" | "zh-CN" | "en-US">;
  nextLocale: Exclude<LocalePreference, "system">;
  navLabel: string;
  filesLabel: string;
  toolbarLabel: string;
  headingButton: string;
  settingsButton: string;
  systemSettings: string;
  preferencesTab: string;
  languageLabel: string;
  restartTitle: string;
  restartMessage: string;
  screenshot: string;
}> = [
  {
    locale: "zh-TW",
    nextLocale: "ja-JP",
    navLabel: "工作區導覽",
    filesLabel: "檔案與資源",
    toolbarLabel: "Markdown 工具",
    headingButton: "一級標題",
    settingsButton: "設定",
    systemSettings: "系統設定",
    preferencesTab: "基本設定",
    languageLabel: "語言",
    restartTitle: "重新啟動後生效",
    restartMessage: "語言變更會在重新啟動 Nolia 後生效。",
    screenshot: "test-results/i18n-zh-tw-workspace-settings.png"
  },
  {
    locale: "ja-JP",
    nextLocale: "ko-KR",
    navLabel: "ワークスペースナビゲーション",
    filesLabel: "ファイルとリソース",
    toolbarLabel: "Markdown ツール",
    headingButton: "見出し 1",
    settingsButton: "設定",
    systemSettings: "システム設定",
    preferencesTab: "基本設定",
    languageLabel: "言語",
    restartTitle: "再起動が必要",
    restartMessage: "言語の変更は Nolia の再起動後に有効になります。",
    screenshot: "test-results/i18n-ja-workspace-settings.png"
  },
  {
    locale: "ko-KR",
    nextLocale: "zh-TW",
    navLabel: "작업 공간 탐색",
    filesLabel: "파일 및 리소스",
    toolbarLabel: "Markdown 도구",
    headingButton: "제목 1",
    settingsButton: "설정",
    systemSettings: "시스템 설정",
    preferencesTab: "기본 설정",
    languageLabel: "언어",
    restartTitle: "다시 시작 필요",
    restartMessage: "언어 변경은 Nolia를 다시 시작한 후 적용됩니다.",
    screenshot: "test-results/i18n-ko-workspace-settings.png"
  }
];

for (const localeCase of addedLocaleCases) {
  test(`${localeCase.locale} locale covers workspace, toolbar, settings, and restart messaging`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await installMockNolia(page, {
      settings: { language: localeCase.locale, editorMode: "source", theme: "light" },
      files: englishFiles,
      plugins: [externalPlugin]
    });

    await page.goto("/");
    await expect(page.getByRole("navigation", { name: localeCase.navLabel })).toBeVisible();
    await expect(page.getByText(localeCase.filesLabel)).toBeVisible();
    await expect(page.getByRole("toolbar", { name: localeCase.toolbarLabel })).toBeVisible();
    await expect(page.getByRole("button", { name: localeCase.headingButton })).toBeVisible();
    await assertToolbarButtonsInside(page, localeCase.toolbarLabel);
    await assertNoPageOverflow(page);

    await page.getByRole("button", { name: localeCase.settingsButton }).click();
    const settingsDialog = page.getByRole("dialog", { name: localeCase.settingsButton });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.locator(".settings-dialog-header strong").getByText(localeCase.systemSettings, { exact: true })).toBeVisible();
    await expect(settingsDialog.getByRole("tab", { name: localeCase.preferencesTab })).toBeVisible();
    await expect(settingsDialog.getByLabel(localeCase.languageLabel)).toHaveValue(localeCase.locale);
    await settingsDialog.getByLabel(localeCase.languageLabel).selectOption(localeCase.nextLocale);
    await expect(settingsDialog.getByText(localeCase.restartTitle)).toBeVisible();
    await expect(settingsDialog.getByText(localeCase.restartMessage)).toBeVisible();
    await assertNoPageOverflow(page);
    await page.screenshot({ path: localeCase.screenshot, fullPage: false });
  });
}

async function assertNoCoreChineseText(page: Page, options: { allowUserContent?: boolean } = {}) {
  const visibleText = await page.evaluate(() => document.body.innerText);
  const forbidden = [
    "基础设置",
    "插件管理",
    "系统设置",
    "重启后生效",
    "语言更改将在重启 Nolia 后生效。",
    "Markdown 工具",
    "JSON 工具",
    "文本工具",
    "搜索工作区",
    "暂无最近工作区。",
    "外部插件",
    "内置扩展",
    "接受权限",
    "贡献界面",
    "读取工作区文件"
  ];
  if (!options.allowUserContent) {
    forbidden.push("文件与资源");
  }
  expect(forbidden.filter((text) => visibleText.includes(text))).toEqual([]);
}

async function assertNoPageOverflow(page: Page) {
  const problems = await page.evaluate(() => {
    const bodyOverflow = document.body.scrollWidth > document.body.clientWidth + 1 ? `body horizontal overflow ${document.body.scrollWidth}/${document.body.clientWidth}` : "";
    const clipped = [...document.querySelectorAll(".titlebar, .app-nav, .sidebar, .editor-zone, .right-panel, .statusbar, .settings-dialog")]
      .flatMap((element) => {
        if (!(element instanceof HTMLElement)) {
          return [];
        }
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") {
          return [];
        }
        const rect = element.getBoundingClientRect();
        const issues: string[] = [];
        if (rect.width <= 0 || rect.height <= 0) {
          issues.push(`${element.className} has no visible size`);
        }
        if (rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1) {
          issues.push(`${element.className} outside viewport`);
        }
        return issues;
      });
    return [bodyOverflow, ...clipped].filter(Boolean);
  });
  expect(problems).toEqual([]);
}

async function assertToolbarButtonsInside(page: Page, toolbarLabel: string) {
  const problems = await page.evaluate((label) => {
    const toolbar = document.querySelector(`[role="toolbar"][aria-label="${label}"]`);
    if (!(toolbar instanceof HTMLElement)) {
      return [`${label} toolbar missing`];
    }
    const toolbarRect = toolbar.getBoundingClientRect();
    return [...toolbar.querySelectorAll("button")].flatMap((button) => {
      const rect = button.getBoundingClientRect();
      const name = button.getAttribute("aria-label") ?? button.getAttribute("title") ?? "unnamed";
      if (rect.left < toolbarRect.left - 1 || rect.top < toolbarRect.top - 1 || rect.right > toolbarRect.right + 1 || rect.bottom > toolbarRect.bottom + 1) {
        return [`${label} button ${name} clipped`];
      }
      return [];
    });
  }, toolbarLabel);
  expect(problems).toEqual([]);
}
