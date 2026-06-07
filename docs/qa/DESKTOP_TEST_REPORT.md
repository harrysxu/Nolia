# Nolia Computer Use 桌面验收报告

执行时间：2026-06-07 00:10 CST

## 1. 结论

本轮已完成全量自动化基线和打包版桌面验收。桌面验收共记录 16 个用例组：15 个通过，1 个阻塞，0 个失败。

阻塞项为 `CU-APP-003` 不可用最近工作区清理。该步骤需要通过 GUI 删除本地最近工作区记录，按 Computer Use 确认策略不能在未获得动作前确认时直接执行；对应行为已由自动化 E2E 覆盖。

## 2. 测试环境

| 项目 | 内容 |
| --- | --- |
| App | `release/mac-universal/Nolia.app` |
| 版本 | `0.1.0` |
| 系统语言 | zh-CN |
| 测试工作区 | `/tmp/nolia-desktop-cu-workspace` |
| 证据目录 | `/tmp/nolia-desktop-cu-artifacts` |
| Computer Use | 可列出/识别 Nolia 前台窗口；读屏动作在收尾阶段出现 `timeoutReached`，交互动作此前出现 active-session 错误 |
| 补充执行方式 | 连接打包版 Electron CDP：`http://127.0.0.1:9333` |

## 3. 自动化基线

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npm test` | 通过，8 个文件、55 个测试 |
| `npm run e2e` | 通过，54 个 Playwright 测试 |
| `npm run build` | 通过 |
| `npm run package:unsigned` | 通过，生成 `release/mac-universal/Nolia.app` |

`npm run build` 仅出现 Vite 大 chunk 提示，未出现构建失败。

## 4. 桌面验收结果

| ID | 用例组 | 状态 | 证据 |
| --- | --- | --- | --- |
| CU-APP-001 | 启动首页 | 通过 | `/tmp/nolia-desktop-cu-artifacts/01-welcome.png` |
| CU-MENU-STRUCTURE | 菜单结构 | 通过 | `/tmp/nolia-desktop-cu-artifacts/01b-menu-bar-visible.png` |
| CU-APP-002 | 最近工作区可打开 | 通过 | `/tmp/nolia-desktop-cu-artifacts/02-workspace-open.png` |
| CU-UI-001 | 活动栏切换 | 通过 | `/tmp/nolia-desktop-cu-artifacts/03-sidebar-nav.png` |
| CU-SET-001/002/003/004 | 设置入口、基础设置、插件页 | 通过 | `/tmp/nolia-desktop-cu-artifacts/04-settings-final.png` |
| CU-MD-S-001 | 源码编辑自动保存 | 通过 | `/tmp/nolia-desktop-cu-artifacts/05-source-autosave.png` |
| CU-MD-S-002/003/004/005 | 源码工具栏、行号、目录、代码块 | 通过 | `/tmp/nolia-desktop-cu-artifacts/06-source-tools-fixed.png` |
| CU-MD-P-001/003 | 源码/编辑/分屏切换和分隔条 | 通过 | `/tmp/nolia-desktop-cu-artifacts/07-mode-switch.png` |
| CU-UI-004/005/NAV-005 | 右侧目录层级和面板宽度 | 通过 | `/tmp/nolia-desktop-cu-artifacts/08-outline-resize.png` |
| CU-NAV-002 | 搜索 Markdown 正文和路径 | 通过 | `/tmp/nolia-desktop-cu-artifacts/09-search-final.png` |
| CU-RES-001 | JSON 编辑器工具 | 通过 | `/tmp/nolia-desktop-cu-artifacts/10-json-editor-final.png` |
| CU-RES-002 | 文本编辑器工具 | 通过 | `/tmp/nolia-desktop-cu-artifacts/11-text-editor-final.png` |
| CU-RES-003/004/005 | 图片、PDF、音频、视频、压缩包、未知资源预览 | 通过 | `/tmp/nolia-desktop-cu-artifacts/12-resource-preview-final.png` |
| CU-MENU-004 | 命令面板和行号快捷键 | 通过 | `/tmp/nolia-desktop-cu-artifacts/13-shortcuts-fixed.png` |
| CU-APP-004/MENU-005 | 关闭工作区返回首页 | 通过 | `/tmp/nolia-desktop-cu-artifacts/14-close-workspace-fixed.png` |
| CU-APP-003 | 不可用最近工作区清理 | 阻塞 | 需要 GUI 删除确认；自动化 E2E 已覆盖 |

## 5. 重点复核

资源编辑器失败项已复核为测试脚本文案匹配问题。实际桌面验证中：

- `resources/data.json` 打开为 `JSON 编辑器`，`JSON 工具` toolbar 可被 ARIA 查询到，校验、格式化、排序键、压缩、诊断和重新读取按钮可见并可操作。
- `resources/notes.txt` 打开为 `文本编辑器`，`文本工具` toolbar 可被 ARIA 查询到，搜索/替换、自动换行、行号、空白符、清理空白、诊断和重新读取按钮可见并可操作。
- 复核结果写入 `/tmp/nolia-desktop-cu-artifacts/resource-editor-assertions.json`。

## 6. 数据保护

测试前已备份 `~/Library/Application Support/Nolia/global-state.json` 和插件目录。收尾时已关闭测试版 Nolia，并恢复全局状态和插件目录；`global-state.json` 的 SHA-256 与测试前备份一致，测试插件未残留。
