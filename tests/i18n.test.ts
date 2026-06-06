import { describe, expect, it } from "vitest";

import { getBuiltInExtensionManifests, getBuiltInMenuContributions } from "../src/shared/builtinExtensions";
import { createTranslator, formatDate, formatFileSize, formatNumber, getLocaleDictionaries, resolveLocale } from "../src/shared/i18n";
import type { ResolvedLocale } from "../src/shared/types";

const supportedLocales: ResolvedLocale[] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];

describe("i18n", () => {
  it("resolves system locale preferences", () => {
    expect(resolveLocale("system", "zh")).toBe("zh-CN");
    expect(resolveLocale("system", "zh-CN")).toBe("zh-CN");
    expect(resolveLocale("system", "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLocale("system", "zh_Hans_SG")).toBe("zh-CN");
    expect(resolveLocale("system", "zh-Hant-TW")).toBe("zh-TW");
    expect(resolveLocale("system", "zh-HK")).toBe("zh-TW");
    expect(resolveLocale("system", "zh-MO")).toBe("zh-TW");
    expect(resolveLocale("system", "en")).toBe("en-US");
    expect(resolveLocale("system", "en-US")).toBe("en-US");
    expect(resolveLocale("system", "ja")).toBe("ja-JP");
    expect(resolveLocale("system", "ja-JP")).toBe("ja-JP");
    expect(resolveLocale("system", "ko")).toBe("ko-KR");
    expect(resolveLocale("system", "ko-KR")).toBe("ko-KR");
    expect(resolveLocale("system", "fr-FR")).toBe("en-US");
    expect(resolveLocale("system", "")).toBe("en-US");
    expect(resolveLocale(undefined, "de-DE")).toBe("en-US");
  });

  it("keeps explicit locale preferences", () => {
    supportedLocales.forEach((locale) => {
      expect(resolveLocale(locale, "en-US")).toBe(locale);
    });
  });

  it("keeps locale dictionaries in sync", () => {
    const dictionaries = getLocaleDictionaries();
    const zhKeys = Object.keys(dictionaries["zh-CN"]).sort();

    supportedLocales.forEach((locale) => {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(zhKeys);
    });
  });

  it("translates built-in extension contributions", () => {
    const manifests = getBuiltInExtensionManifests("en-US");
    const settings = manifests.find((manifest) => manifest.id === "settings.panel");
    const languageSetting = settings?.contributes.settings?.find((item) => item.key === "language");

    expect(manifests.find((manifest) => manifest.id === "core.workspace")?.name).toBe("Workspace");
    expect(languageSetting?.label).toBe("Language");
    expect(languageSetting?.options?.map((option) => option.label)).toEqual(["Use system setting", "Simplified Chinese", "Traditional Chinese", "English", "Japanese", "Korean"]);
  });

  it("translates built-in menu contributions", () => {
    expect(getBuiltInMenuContributions("zh-CN").find((item) => item.id === "menu.file.workspace.open")?.label).toBe("打开工作区");
    expect(getBuiltInMenuContributions("zh-TW").find((item) => item.id === "menu.file.workspace.open")?.label).toBe("開啟工作區");
    expect(getBuiltInMenuContributions("en-US").find((item) => item.id === "menu.file.workspace.open")?.label).toBe("Open Workspace");
    expect(getBuiltInMenuContributions("ja-JP").find((item) => item.id === "menu.file.workspace.open")?.label).toBe("ワークスペースを開く");
    expect(getBuiltInMenuContributions("ko-KR").find((item) => item.id === "menu.file.workspace.open")?.label).toBe("작업 공간 열기");
  });

  it("formats translation params", () => {
    const tr = createTranslator("en-US");
    expect(tr("已打开 {path}", { path: "notes/today.md" })).toBe("Opened notes/today.md");
  });

  it("keeps file paths and third-party names intact inside localized messages", () => {
    const pathRel = "notes/設定/Meeting-日本語-한국어.md";
    expect(createTranslator("ja-JP")("已打开 {path}", { path: pathRel })).toContain(pathRel);
    expect(createTranslator("ko-KR")("插件加载失败：{message}", { message: "Local I18n Plugin" })).toContain("Local I18n Plugin");
  });

  it("formats dates, numbers, and file sizes with locale-aware helpers", () => {
    const sampleDate = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

    expect(formatDate("en-US", sampleDate, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })).toBe("01/02/2026");
    expect(formatDate("ja-JP", sampleDate, { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })).toContain("2026");
    expect(formatNumber("en-US", 12345.6)).toBe("12,345.6");
    expect(formatNumber("ko-KR", 12345.6)).toBe("12,345.6");
    expect(formatFileSize("en-US", 999)).toBe("999 B");
    expect(formatFileSize("en-US", 1536)).toBe("1.5 KB");
    expect(formatFileSize("en-US", 2 * 1024 * 1024)).toBe("2 MB");
  });

  it("translates core settings labels for added locales", () => {
    expect(createTranslator("zh-TW")("语言")).toBe("語言");
    expect(createTranslator("ja-JP")("语言")).toBe("言語");
    expect(createTranslator("ko-KR")("语言")).toBe("언어");
  });

  it("localizes added-locale chrome and editor labels without core fallback text", () => {
    expect(createTranslator("zh-TW")("视图")).toBe("檢視");
    expect(createTranslator("zh-TW")("窗口")).toBe("視窗");
    expect(createTranslator("zh-TW")("重新加载")).toBe("重新載入");
    expect(createTranslator("zh-TW")("字体大小")).toBe("字體大小");

    expect(createTranslator("ja-JP")("撤销")).toBe("元に戻す");
    expect(createTranslator("ja-JP")("重新加载")).toBe("再読み込み");
    expect(createTranslator("ja-JP")("2 空格")).toBe("2 スペース");
    expect(createTranslator("ja-JP")("选中 {count} 字符", { count: 3 })).toBe("3 文字選択");
    expect(createTranslator("ja-JP")("反向链接面板")).toBe("バックリンクパネル");

    expect(createTranslator("ko-KR")("撤销")).toBe("실행 취소");
    expect(createTranslator("ko-KR")("重新加载")).toBe("다시 불러오기");
    expect(createTranslator("ko-KR")("2 空格")).toBe("공백 2개");
    expect(createTranslator("ko-KR")("选中 {count} 字符", { count: 3 })).toBe("3자 선택됨");
    expect(createTranslator("ko-KR")("反向链接面板")).toBe("백링크 패널");
  });
});
