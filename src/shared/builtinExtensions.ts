import { createTranslator, type Translator } from "./i18n";
import type { ResolvedLocale } from "./types";
import type { ExtensionManifest, FileEditorContribution, FileViewerContribution, MenuContribution } from "./extensions";

function appSettingsContributions(tr: Translator): ExtensionManifest["contributes"]["settings"] {
  return [
    {
      id: "settings.language",
      key: "language",
      label: tr("语言"),
      category: "appearance",
      type: "select",
      order: 5,
      options: [
        { value: "system", label: tr("system") },
        { value: "zh-CN", label: tr("zh-CN") },
        { value: "zh-TW", label: tr("zh-TW") },
        { value: "en-US", label: tr("en-US") },
        { value: "ja-JP", label: tr("ja-JP") },
        { value: "ko-KR", label: tr("ko-KR") }
      ]
    },
    {
      id: "settings.theme",
      key: "theme",
      label: tr("主题"),
      category: "appearance",
      type: "select",
      order: 10,
      options: [
        { value: "system", label: tr("跟随系统") },
        { value: "light", label: tr("浅色") },
        { value: "dark", label: tr("深色") },
        { value: "paper", label: tr("纸张") },
        { value: "technical", label: tr("技术文档") }
      ]
    },
    {
      id: "settings.editorMode",
      key: "editorMode",
      label: tr("编辑模式"),
      category: "editor",
      type: "select",
      order: 20,
      options: [
        { value: "wysiwyg", label: tr("编辑") },
        { value: "source", label: tr("Markdown 源码") },
        { value: "split", label: tr("分屏预览") }
      ]
    },
    {
      id: "settings.editorWidth",
      key: "editorWidth",
      label: tr("编辑区宽度"),
      category: "editor",
      type: "select",
      order: 30,
      options: [
        { value: "narrow", label: tr("窄") },
        { value: "medium", label: tr("中等") },
        { value: "wide", label: tr("宽") },
        { value: "full", label: tr("充满") }
      ]
    },
    {
      id: "settings.fontSize",
      key: "fontSize",
      label: tr("字体大小"),
      category: "appearance",
      type: "select",
      order: 40,
      options: [
        { value: "small", label: tr("小") },
        { value: "medium", label: tr("标准") },
        { value: "large", label: tr("大") },
        { value: "extraLarge", label: tr("特大") }
      ]
    },
    {
      id: "settings.focusMode",
      key: "focusMode",
      label: tr("专注模式"),
      category: "editor",
      type: "toggle",
      order: 50
    },
    {
      id: "settings.pluginSafeMode",
      key: "pluginSafeMode",
      label: tr("外部插件安全模式"),
      category: "plugins",
      type: "toggle",
      order: 60
    }
  ];
}

function resourceViewers(tr: Translator): FileViewerContribution[] {
  return [
    {
      id: "resource.viewers.image",
      title: tr("图片预览"),
      extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico"],
      priority: 100,
      category: "image"
    },
    {
      id: "resource.viewers.pdf",
      title: tr("PDF 预览"),
      extensions: [".pdf"],
      priority: 100,
      category: "pdf"
    },
    {
      id: "resource.viewers.audio",
      title: tr("音频预览"),
      extensions: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"],
      priority: 100,
      category: "audio"
    },
    {
      id: "resource.viewers.video",
      title: tr("视频预览"),
      extensions: [".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"],
      priority: 100,
      category: "video"
    },
    {
      id: "resource.viewers.diagram",
      title: tr("draw.io 资源"),
      extensions: [".drawio", ".dio"],
      priority: 90,
      category: "diagram"
    },
    {
      id: "resource.viewers.archive",
      title: tr("压缩包资源"),
      extensions: [".zip", ".tar", ".gz", ".tgz", ".7z", ".rar"],
      priority: 80,
      category: "archive"
    },
    {
      id: "resource.viewers.text",
      title: tr("文本资源"),
      extensions: [".txt", ".csv", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".js", ".jsx", ".ts", ".tsx", ".log"],
      priority: 70,
      category: "text"
    },
    {
      id: "resource.viewers.fallback",
      title: tr("资源文件"),
      priority: -1000,
      category: "other",
      fallback: true
    }
  ];
}

function jsonFileEditor(tr: Translator): FileEditorContribution {
  return {
    id: "json.editor.fileEditor",
    title: tr("JSON 编辑器"),
    extensions: [".json"],
    mimeTypes: ["application/json"],
    priority: 120
  };
}

function textFileEditor(tr: Translator): FileEditorContribution {
  return {
    id: "text.editor.fileEditor",
    title: tr("文本编辑器"),
    extensions: [".txt", ".log", ".csv", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".js", ".jsx", ".ts", ".tsx"],
    mimeTypes: ["text/plain", "text/csv", "application/x-yaml", "application/toml", "application/xml", "text/html", "text/javascript", "application/javascript", "application/typescript"],
    priority: 90
  };
}

export function getBuiltInExtensionManifests(locale: ResolvedLocale = "zh-CN"): ExtensionManifest[] {
  const tr = createTranslator(locale);
  return [
    {
      id: "core.workspace",
      name: tr("工作区"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      required: true,
      enabledByDefault: true,
      activationEvents: ["onStartup"],
      permissions: ["workspace:read", "workspace:write", "ui:contribute"],
      contributes: {
        commands: [
          { id: "workspace.open", title: tr("打开工作区"), keywords: ["open workspace"], order: 10 },
          { id: "workspace.create", title: tr("创建工作区"), keywords: ["create workspace"], order: 20 },
          { id: "workspace.close", title: tr("关闭工作区"), keywords: ["close workspace"], order: 30 }
        ],
        menus: [
          { id: "menu.file.workspace.open", label: tr("打开工作区"), command: "workspace.open", location: "file", group: "workspace", order: 20 },
          { id: "menu.file.workspace.close", label: tr("关闭工作区"), command: "workspace.close", location: "file", group: "workspace", order: 30 }
        ]
      }
    },
    {
      id: "core.commands",
      name: tr("命令系统"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      required: true,
      enabledByDefault: true,
      activationEvents: ["onStartup"],
      permissions: ["ui:contribute"],
      contributes: {
        commands: [{ id: "commandPalette.open", title: tr("打开命令面板"), keywords: ["command palette"], order: 30 }],
        menus: [{ id: "menu.view.commandPalette", label: tr("命令面板"), command: "commandPalette.open", location: "view", group: "command", order: 10 }]
      }
    },
    {
      id: "markdown.editor",
      name: tr("Markdown 编辑器"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      required: true,
      enabledByDefault: true,
      activationEvents: ["onStartup", "onFileOpen:.md", "onFileOpen:.markdown"],
      permissions: ["workspace:read", "workspace:write", "ui:contribute"],
      contributes: {
        commands: [
          { id: "mode.wysiwyg", title: tr("编辑模式命令"), keywords: ["wysiwyg mode"], order: 110 },
          { id: "mode.source", title: tr("源码模式"), keywords: ["source mode markdown"], order: 120 },
          { id: "mode.split", title: tr("分屏预览"), keywords: ["split preview mode"], order: 130 },
          { id: "document.save", title: tr("保存文档"), keywords: ["save document"], order: 210 },
          { id: "view.immersive.toggle", title: tr("切换沉浸式编辑"), keywords: ["immersive focus single file"], order: 140 },
          { id: "view.toolbar.toggle", title: tr("显示/隐藏工具栏"), keywords: ["toolbar markdown"], order: 150 },
          { id: "view.lineNumbers.toggle", title: tr("显示/隐藏行号"), keywords: ["line numbers gutter"], order: 160 }
        ],
        menus: [
          { id: "menu.file.save", label: tr("保存"), command: "document.save", location: "file", group: "document", order: 40 },
          { id: "menu.view.mode.wysiwyg", label: tr("编辑模式命令"), command: "mode.wysiwyg", location: "view", group: "mode", order: 100 },
          { id: "menu.view.mode.source", label: tr("源码模式"), command: "mode.source", location: "view", group: "mode", order: 110 },
          { id: "menu.view.mode.split", label: tr("分屏预览"), command: "mode.split", location: "view", group: "mode", order: 120 },
          { id: "menu.view.immersive", label: tr("沉浸式编辑"), command: "view.immersive.toggle", location: "view", group: "layout", order: 140 },
          { id: "menu.view.toolbar", label: tr("显示/隐藏工具栏"), command: "view.toolbar.toggle", location: "view", group: "layout", order: 150 },
          { id: "menu.view.lineNumbers", label: tr("显示/隐藏行号"), command: "view.lineNumbers.toggle", location: "view", group: "layout", order: 160 }
        ],
        fileEditors: [
          {
            id: "markdown.editor.fileEditor",
            title: tr("Markdown 编辑器"),
            extensions: [".md", ".markdown", ".mdown", ".mkd"],
            mimeTypes: ["text/markdown"],
            priority: 100
          }
        ],
        editorExtensions: [{ id: "markdown.editor.codemirror", title: "CodeMirror Markdown", modes: ["source", "split"], order: 10 }],
        toolbarItems: [
          { id: "markdown.editor.toolbar.bold", title: tr("加粗"), command: "markdown.insert.bold", icon: "Bold", group: "format", order: 10 }
        ]
      }
    },
    {
      id: "markdown.preview",
      name: tr("Markdown 预览"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      required: true,
      enabledByDefault: true,
      activationEvents: ["onMarkdown"],
      permissions: ["ui:contribute"],
      contributes: {
        markdownRenderers: [
          { id: "markdown.preview.html", title: tr("Markdown HTML 渲染"), priority: 100 },
          { id: "markdown.preview.mermaid", title: tr("Mermaid 渲染"), languages: ["mermaid"], priority: 110 },
          { id: "markdown.preview.math", title: tr("数学公式渲染"), languages: ["math"], priority: 105 }
        ]
      }
    },
    {
      id: "json.editor",
      name: tr("JSON 编辑器"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      enabledByDefault: true,
      activationEvents: ["onStartup", "onFileOpen:.json"],
      permissions: ["workspace:read", "workspace:write", "ui:contribute"],
      contributes: {
        fileEditors: [jsonFileEditor(tr)]
      }
    },
    {
      id: "text.editor",
      name: tr("文本编辑器"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      enabledByDefault: true,
      activationEvents: ["onStartup", "onFileOpen:.txt", "onFileOpen:.log", "onFileOpen:.csv"],
      permissions: ["workspace:read", "workspace:write", "ui:contribute"],
      contributes: {
        fileEditors: [textFileEditor(tr)]
      }
    },
    {
      id: "files.panel",
      name: tr("笔记面板"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      enabledByDefault: true,
      activationEvents: ["onView:files"],
      permissions: ["workspace:read", "workspace:write", "ui:contribute"],
      contributes: {
        commands: [
          { id: "view.files", title: tr("笔记"), keywords: ["files", "notes"], order: 60 },
          { id: "file.new", title: tr("新建笔记"), keywords: ["new note"], order: 220 }
        ],
        sidebarPanels: [{ id: "files", title: tr("笔记"), icon: "FolderOpen", command: "view.files", order: 20, visibleInNav: true }],
        menus: [
          { id: "menu.file.new", label: tr("新建笔记"), command: "file.new", location: "file", group: "workspace", order: 10 },
          { id: "menu.view.files", label: tr("笔记"), command: "view.files", location: "view", group: "sidebar", order: 30 }
        ]
      }
    },
    {
      id: "recent.panel",
      name: tr("最近记录面板"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      enabledByDefault: true,
      activationEvents: ["onView:recent"],
      permissions: ["workspace:read", "ui:contribute"],
      contributes: {
        commands: [{ id: "view.recent", title: tr("最近"), keywords: ["recent"], order: 50 }],
        sidebarPanels: [{ id: "recent", title: tr("最近"), icon: "Clock3", command: "view.recent", order: 10, visibleInNav: true }],
        menus: [{ id: "menu.view.recent", label: tr("最近"), command: "view.recent", location: "view", group: "sidebar", order: 20 }]
      }
    },
    {
      id: "favorites.panel",
      name: tr("收藏面板"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      enabledByDefault: true,
      activationEvents: ["onView:favorites"],
      permissions: ["workspace:read", "workspace:write", "ui:contribute"],
      contributes: {
        commands: [{ id: "view.favorites", title: tr("收藏"), keywords: ["favorites"], order: 70 }],
        sidebarPanels: [{ id: "favorites", title: tr("收藏"), icon: "Star", command: "view.favorites", order: 30, visibleInNav: true }],
        menus: [{ id: "menu.view.favorites", label: tr("收藏"), command: "view.favorites", location: "view", group: "sidebar", order: 40 }]
      }
    },
    {
      id: "search.panel",
      name: tr("搜索面板"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      enabledByDefault: true,
      activationEvents: ["onView:search"],
      permissions: ["workspace:read", "ui:contribute"],
      contributes: {
        commands: [{ id: "view.search", title: tr("搜索"), keywords: ["search"], order: 80 }],
        sidebarPanels: [{ id: "search", title: tr("搜索"), icon: "Search", command: "view.search", order: 40, visibleInNav: true }],
        menus: [{ id: "menu.view.search", label: tr("搜索"), command: "view.search", location: "view", group: "sidebar", order: 50 }]
      }
    },
    {
      id: "backlinks.panel",
      name: tr("反向链接面板"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      enabledByDefault: true,
      activationEvents: ["onView:backlinks"],
      permissions: ["workspace:read", "ui:contribute"],
      contributes: {
        commands: [{ id: "view.backlinks", title: tr("反向链接"), keywords: ["backlinks"], order: 90 }],
        sidebarPanels: [{ id: "backlinks", title: tr("反向链接"), icon: "Link2", command: "view.backlinks", order: 50, visibleInNav: false }],
        menus: [{ id: "menu.view.backlinks", label: tr("反向链接"), command: "view.backlinks", location: "view", group: "sidebar", order: 60 }]
      }
    },
    {
      id: "resource.viewers",
      name: tr("资源预览器"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      required: true,
      enabledByDefault: true,
      activationEvents: ["onFileOpen:*"],
      permissions: ["workspace:read", "ui:contribute"],
      contributes: {
        fileViewers: resourceViewers(tr)
      }
    },
    {
      id: "settings.panel",
      name: tr("设置面板"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      required: true,
      enabledByDefault: true,
      activationEvents: ["onStartup", "onCommand:view.settings"],
      permissions: ["ui:contribute"],
      contributes: {
        commands: [{ id: "view.settings", title: tr("设置"), keywords: ["settings"], order: 100 }],
        menus: [{ id: "menu.app.settings", label: tr("设置"), command: "view.settings", location: "app", group: "settings", order: 10 }],
        settings: appSettingsContributions(tr)
      }
    },
    {
      id: "export.document",
      name: tr("文档导出"),
      version: "1.0.0",
      apiVersion: 2,
      builtIn: true,
      required: true,
      enabledByDefault: true,
      activationEvents: ["onCommand:document.export"],
      permissions: ["workspace:read", "ui:contribute"],
      contributes: {
        commands: [{ id: "document.export", title: tr("导出文档"), keywords: ["export document"], order: 230 }],
        menus: [{ id: "menu.file.export", label: tr("导出"), command: "document.export", location: "file", group: "document", order: 50 }]
      }
    }
  ];
}

export const BUILT_IN_EXTENSION_MANIFESTS: ExtensionManifest[] = getBuiltInExtensionManifests("zh-CN");

export function getBuiltInMenuContributions(locale: ResolvedLocale = "zh-CN"): MenuContribution[] {
  return getBuiltInExtensionManifests(locale).flatMap((manifest) => manifest.contributes.menus ?? []);
}
