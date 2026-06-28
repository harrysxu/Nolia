# 代码结构地图

本文是当前架构事实来源。过期的产品方案和长技术方案已合并为本页的维护边界与优化路线。

## 运行时分层

- `src/main/`：Electron main process。负责窗口、菜单、协议注册、IPC handler，以及文件系统、工作区、索引、历史、导出、插件等本地服务。
- `src/preload/`：安全桥接层。只暴露受控的 `window.nolia` API，不让 renderer 直接访问 Node/Electron 能力。
- `src/renderer/`：React UI。负责工作台状态、编辑器、预览、资源查看、设置、命令面板和插件渲染。
- `src/shared/`：跨进程契约。包括 IPC channel、Zod schema、共享类型、Markdown 解析和内置扩展声明。

## AI Runtime 边界

- `src/main/ai/aiService.ts`：AI facade，负责设置、密钥、provider、embedding、semantic index、run 和 task 入口。
- `src/main/ai/aiSdkAgentEngine.ts`：AI SDK Core agent loop，处理 tool calling、step limit、事件流和 proposal fallback。
- `src/main/ai/aiSdkProvider.ts`：把 Nolia provider profile 映射为 AI SDK language model，并统一 OpenAI-compatible `/v1` API root。
- `src/main/ai/providers/`：低层 provider adapter，负责模型列表、连接测试、embedding 或 native 调用。
- `src/main/ai/tools/`：所有 agent tool 的注册、权限 gating、参数校验和结果摘要。
- `src/main/ai/security/secretService.ts`：API key 本地保存，优先使用 Electron safeStorage，不把密钥写入普通设置。
- `src/main/services/semanticIndexService.ts` 与 `src/main/services/workspaceDb.ts`：全文检索、semantic chunk 存储和 semantic search。

AI 写入必须通过 proposal 和用户确认完成。当前不允许 AI 执行 shell、删除文件、绕过 workspace 边界读取文件或直接落盘修改用户内容。

## Renderer 边界

- `src/renderer/App.tsx`：应用壳和跨功能编排层，仍是最大模块；新增功能应优先下沉。
- `src/renderer/app/types.ts`：renderer 会话模型，例如标签页、资源状态、文件树选择和列表项。
- `src/renderer/app/store.ts`：轻量 UI 偏好状态。
- `src/renderer/app/documentLists.ts`：最近浏览、最近编辑和收藏列表的 localStorage 持久化。
- `src/renderer/app/workspaceTree.ts`：文件树路径、移动、复制、过滤和名称清洗规则。
- `src/renderer/components/`：编辑器、预览器、命令面板和可复用 UI。
- `src/renderer/extensions/`：renderer 插件注册、贡献点筛选和运行时挂载。

## 数据与安全边界

用户文档保留在用户选择的 workspace 目录中。`.nolia/` 下的数据是索引、快照、日志和缓存；应用包中的 `docs/` 是帮助文档，不应写入用户内容。

新的跨进程能力必须先定义 `src/shared/ipc.ts` schema，再在 preload 和 main handler 中接入。main process 负责验证路径、权限和输入形状，renderer 不直接访问文件系统。

## 当前模块热点

这些文件可维护，但已经超过或接近拆分阈值：

- `src/renderer/App.tsx`：约 8600 行，承担工作区、标签页、资源编辑、设置、AI sidebar 和布局编排。
- `src/renderer/components/WysiwygEditor.tsx`：约 4000 行，承担 Markdown 所见即所得、源码回显、表格、链接和复杂语法交互。
- `src/renderer/styles/global.css`：约 6200 行，承载全局布局、编辑器、资源、AI、设置和插件样式。
- `src/shared/i18n.ts`：约 2600 行，集中维护多语言文案。
- `src/shared/ai.ts`：约 650 行，集中维护 AI 设置、运行事件、proposal、task 和迁移兼容类型。

1.0.0 打包前已完成第一阶段低风险拆分：renderer 启用 Vite/Rolldown code splitting，并将 SourceEditor、WysiwygEditor、MarkdownPreview、TextResourceEditor、AI sidebar 和 AI settings 改为按需加载。主 renderer 入口 chunk 已从约 6.1 MB 降到约 190 KB。

剩余大 chunk 主要来自 WYSIWYG/TipTap/ProseMirror、CodeMirror 和 Mermaid vendor。它们已经不阻塞首屏，但仍是后续性能优化重点。

## 优化路线

优先做低风险、可测试的渐进拆分：

1. 将 `App.tsx` 中的工作区加载、文档标签、资源编辑和设置弹窗逻辑拆到 `src/renderer/app/` hooks 或 feature 组件。
2. 将 `WysiwygEditor.tsx` 中的 Markdown 源码回显、表格操作、代码块语言选择、链接/图片交互拆成独立 helper 和组件。
3. 继续拆 WYSIWYG chunk，把 Markdown preview block、math、image、table 和 code language 逻辑分成更细的局部模块。
4. 将 AI sidebar、AI 设置页和 AI task/proposal 展示拆出更明确的 renderer feature 边界。
5. 将 `global.css` 按布局、编辑器、资源编辑器、AI、设置、插件视图分段拆分，或引入明确的 CSS module 边界。
6. 将 `src/shared/i18n.ts` 拆为按功能聚合的文案对象，再统一导出。
7. 将 AI 类型按 settings、events、proposal、task 分段导出，保持 IPC schema 与迁移函数的测试覆盖。
8. 任何拆分都先补充 Vitest 或 Playwright 覆盖，避免改变 Markdown 编辑、工作区恢复、AI 权限和插件运行时行为。

## 发布前清理边界

- 可以删除：重复文档、历史打包记录、生成产物、无引用的测试临时文件和确定不可达的代码。
- 不应删除：设置迁移、legacy profile 兼容、fallback viewer、semantic search 降级、错误兜底和安全边界逻辑。这些都是用户升级、插件兼容或异常恢复路径。
- 不应在发布前临时升级：Electron、React、TypeScript、Vite、AI SDK、CodeMirror、TipTap 等核心依赖。依赖升级需要单独验证编辑器、打包和跨平台行为。

## 生成产物

`dist/`、`release/`、`release-arch-compare/`、`test-results/`、`coverage/`、`playwright-report/` 和 `output/` 都是生成产物，不作为源码维护。需要验证时重新运行构建、测试或打包命令。
