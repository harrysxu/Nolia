# 更新日志

本文记录 Nolia 的用户可见变更。格式参考 Keep a Changelog，但按项目当前节奏保持简洁。

## 1.0.0 - 2026-06-28

升级注意事项见 [Nolia 1.0.0 升级说明](UPGRADE.md)。

### Added

- AI Assistant runtime，支持 OpenAI-compatible、OpenAI Responses 和 Ollama provider。
- AI 多模型配置、连接测试、模型刷新、API key 本地保存和独立 embedding 配置。
- AI 权限控制、工具调用、当前文档 patch proposal、工作区 Markdown proposal、任务历史和撤销写入。
- Semantic index 与 RAG 检索入口，支持手动创建、更新、清空索引，并在不可用时降级全文检索。
- 更完整的资源编辑体验，覆盖 JSON、文本资源、图片和多媒体预览。

### Changed

- 版本号提升到 `1.0.0`。
- OpenAI-compatible Chat Completions 的正式运行路径与连接测试统一到 `/v1` API root，避免测试通过但聊天空响应。
- QA、AI、发布和架构文档合并为稳定入口，移除开发过程和历史打包记录。
- 发布检查清单和 macOS 签名指南更新为 1.0.0 产物命名。

### Fixed

- 修复 OpenAI-compatible 裸 Base URL 在 AI SDK 正式聊天中未补 `/v1` 导致服务返回空流的问题。

## 0.1.0 - 2026-05-31

### Added

- Electron 桌面应用基础框架。
- 本地工作区、文件树、最近、收藏、搜索、反向链接。
- Markdown 编辑、源码、分屏预览三种模式。
- Markdown 工具栏、表格、图片、链接、公式、任务列表、代码块。
- JSON 编辑器，支持校验、格式化、排序键、压缩和诊断。
- 文本编辑器，按后缀自动识别文本资源。
- 图片、PDF、音频、视频、压缩包和未知资源预览。
- 设置页，支持主题、编辑模式、编辑区宽度、字体大小、专注模式和插件安全模式。
- 外部插件加载、权限确认、启用/停用和诊断。
- macOS unsigned 打包，支持 universal、x64、arm64 对比构建。
- Windows NSIS 安装器和 zip 打包，包含 Windows 图标、快捷方式和可执行文件资源信息。
- Linux AppImage/deb 打包。

### Changed

- 编辑模式下复杂 Markdown 节点逐步改为可回到 Markdown 源码修改。
- 所见即所得编辑模式中的自动目录改为只读导航，点击目录项直接跳转到对应标题。
- 表格单元格内容在编辑和预览中垂直居中。
- 代码块保留语言信息并支持主题化高亮。

### Fixed

- 修复在所见即所得模式点击目录块会展开 Markdown 块源码编辑器的问题。

### Documentation

- 新增用户文档、安装说明、格式支持、Markdown 指南、快捷键、故障排查、数据备份、隐私声明、使用条款、第三方声明和发布清单。
