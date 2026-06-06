# 代码结构地图

本文是当前架构事实来源。过期的产品方案和长技术方案已合并为本页的维护边界与优化路线。

## 运行时分层

- `src/main/`：Electron main process。负责窗口、菜单、协议注册、IPC handler，以及文件系统、工作区、索引、历史、导出、插件等本地服务。
- `src/preload/`：安全桥接层。只暴露受控的 `window.nolia` API，不让 renderer 直接访问 Node/Electron 能力。
- `src/renderer/`：React UI。负责工作台状态、编辑器、预览、资源查看、设置、命令面板和插件渲染。
- `src/shared/`：跨进程契约。包括 IPC channel、Zod schema、共享类型、Markdown 解析和内置扩展声明。

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

这些文件可维护，但已接近拆分阈值：

- `src/renderer/App.tsx`：约 6000 行，承担工作区、标签页、资源编辑、设置和布局编排。
- `src/renderer/components/WysiwygEditor.tsx`：约 3700 行，承担 Markdown 所见即所得、源码回显、表格、链接和复杂语法交互。
- `src/renderer/styles/global.css`：约 4200 行，承载全局布局、编辑器、资源和设置样式。
- `src/shared/i18n.ts`：约 2000 行，集中维护多语言文案。

## 优化路线

优先做低风险、可测试的渐进拆分：

1. 将 `App.tsx` 中的工作区加载、文档标签、资源编辑和设置弹窗逻辑拆到 `src/renderer/app/` hooks 或 feature 组件。
2. 将 `WysiwygEditor.tsx` 中的 Markdown 源码回显、表格操作、代码块语言选择、链接/图片交互拆成独立 helper 和组件。
3. 将 `global.css` 按布局、编辑器、资源编辑器、设置、插件视图分段拆分，或引入明确的 CSS module 边界。
4. 将 `src/shared/i18n.ts` 拆为按功能聚合的文案对象，再统一导出。
5. 任何拆分都先补充 Vitest 或 Playwright 覆盖，避免改变 Markdown 编辑、工作区恢复和插件运行时行为。

## 生成产物

`dist/`、`release/`、`release-arch-compare/`、`test-results/`、`coverage/`、`playwright-report/` 和 `output/` 都是生成产物，不作为源码维护。需要验证时重新运行构建、测试或打包命令。
