import { existsSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";

import { getBuiltInMenuContributions } from "../shared/builtinExtensions";
import { APP_NAME } from "../shared/constants";
import { createTranslator } from "../shared/i18n";
import type { MenuContribution } from "../shared/extensions";
import type { ResolvedLocale } from "../shared/types";

export function installApplicationMenu(
  getMainWindow: () => BrowserWindow | undefined,
  menuContributions: MenuContribution[] = getBuiltInMenuContributions(),
  locale: ResolvedLocale = "zh-CN"
): void {
  const tr = createTranslator(locale);
  const send = (command: string) => {
    getMainWindow()?.webContents.send("app.command", command);
  };
  const minimizeWindow = () => {
    getMainWindow()?.minimize();
  };
  const zoomWindow = () => {
    const window = getMainWindow();
    if (!window) {
      return;
    }
    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }
    window.maximize();
  };
  const toggleFullScreen = () => {
    const window = getMainWindow();
    if (!window) {
      return;
    }
    window.setFullScreen(!window.isFullScreen());
  };

  const appMenuItems = menuItemsForLocation(menuContributions, "app", send);
  const fileMenuItems = menuItemsForLocation(menuContributions, "file", send);
  const viewMenuItems = menuItemsForLocation(menuContributions, "view", send);
  const template: MenuItemConstructorOptions[] = [
    {
      label: APP_NAME,
      submenu: [
        { label: tr("关于 {appName}", { appName: APP_NAME }), role: "about" },
        { type: "separator" },
        ...appMenuItems,
        { type: "separator" },
        { label: tr("隐藏 {appName}", { appName: APP_NAME }), role: "hide" },
        { label: tr("隐藏其他应用"), role: "hideOthers" },
        { label: tr("显示全部"), role: "unhide" },
        { type: "separator" },
        { label: tr("退出 {appName}", { appName: APP_NAME }), role: "quit" }
      ]
    },
    {
      label: tr("文件"),
      submenu: [
        ...fileMenuItems,
        { type: "separator" },
        { label: tr("关闭窗口"), role: "close" }
      ]
    },
    {
      label: tr("编辑菜单"),
      submenu: [
        { label: tr("撤销"), role: "undo" },
        { label: tr("重做"), role: "redo" },
        { type: "separator" },
        { label: tr("剪切"), role: "cut" },
        { label: tr("复制"), role: "copy" },
        { label: tr("粘贴"), role: "paste" },
        { label: tr("全选"), role: "selectAll" }
      ]
    },
    {
      label: tr("视图"),
      submenu: [
        ...viewMenuItems,
        { type: "separator" },
        { label: tr("重新加载"), role: "reload" },
        { label: tr("开发者工具"), role: "toggleDevTools" },
        { label: tr("切换全屏"), accelerator: "Control+Command+F", click: toggleFullScreen }
      ]
    },
    {
      label: tr("窗口"),
      submenu: [
        { label: tr("最小化"), accelerator: "Command+M", click: minimizeWindow },
        { label: tr("缩放"), click: zoomWindow },
        { type: "separator" },
        { label: tr("前置所有窗口"), role: "front" }
      ]
    },
    {
      label: tr("帮助"),
      submenu: [
        {
          label: tr("{appName} 文档", { appName: APP_NAME }),
          click: () => {
            void shell.openPath(resolveDocumentationPath(locale));
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function menuItemsForLocation(menuContributions: MenuContribution[], location: MenuContribution["location"], send: (command: string) => void): MenuItemConstructorOptions[] {
  const items = menuContributions
    .filter((item) => item.location === location && item.command)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
  const menuItems: MenuItemConstructorOptions[] = [];
  let previousGroup: string | undefined;
  for (const item of items) {
    if (menuItems.length > 0 && (item.separatorBefore || (previousGroup && item.group && previousGroup !== item.group))) {
      menuItems.push({ type: "separator" });
    }
    menuItems.push({
      label: item.label,
      accelerator: acceleratorForCommand(item.command),
      click: () => {
        if (item.command) {
          send(item.command);
        }
      }
    });
    if (item.separatorAfter) {
      menuItems.push({ type: "separator" });
    }
    previousGroup = item.group;
  }
  return trimMenuSeparators(menuItems);
}

function trimMenuSeparators(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const result: MenuItemConstructorOptions[] = [];
  for (const item of items) {
    if (item.type === "separator" && (result.length === 0 || result[result.length - 1]?.type === "separator")) {
      continue;
    }
    result.push(item);
  }
  while (result[result.length - 1]?.type === "separator") {
    result.pop();
  }
  return result;
}

function acceleratorForCommand(command: string | undefined): string | undefined {
  switch (command) {
    case "view.settings":
      return "Command+,";
    case "file.new":
      return "Command+N";
    case "workspace.open":
      return "Command+O";
    case "document.save":
      return "Command+S";
    case "document.export":
      return "Command+Shift+E";
    case "commandPalette.open":
      return "Command+K";
    case "view.recent":
      return "Command+1";
    case "view.files":
      return "Command+2";
    case "view.favorites":
      return "Command+3";
    case "view.search":
      return "Command+4";
    case "view.backlinks":
      return "Command+5";
    case "mode.wysiwyg":
      return "Command+Alt+1";
    case "mode.source":
      return "Command+Alt+2";
    case "mode.split":
      return "Command+Alt+3";
    case "view.immersive.toggle":
      return "Command+Shift+I";
    case "view.toolbar.toggle":
      return "Command+Shift+T";
    case "view.lineNumbers.toggle":
      return "Command+Shift+L";
    default:
      return undefined;
  }
}

export function resolveDocumentationPath(locale: ResolvedLocale = "zh-CN"): string {
  const readmePath = documentationReadmePath(locale);
  const candidates = documentationCandidates(readmePath);
  return candidates.find((candidate) => existsSync(candidate)) ?? app.getPath("documents");
}

function documentationCandidates(readmePath: string): string[] {
  const localeDir = path.dirname(path.join("docs", readmePath));
  return [
    path.join(process.resourcesPath, "docs", readmePath),
    path.join(process.resourcesPath, localeDir),
    path.join(process.resourcesPath, "docs"),
    path.join(app.getAppPath(), "docs", readmePath),
    path.join(app.getAppPath(), localeDir),
    path.join(app.getAppPath(), "docs"),
    path.join(process.cwd(), "docs", readmePath),
    path.join(process.cwd(), localeDir),
    path.join(process.cwd(), "docs")
  ];
}

function documentationReadmePath(locale: ResolvedLocale): string {
  if (locale === "zh-CN" || locale === "zh-TW") {
    return "README.md";
  }
  return path.join("en-US", "README.md");
}
