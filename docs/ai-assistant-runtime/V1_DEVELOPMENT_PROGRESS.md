# Nolia AI V1 Development Progress

日期：2026-06-13

更新说明：2026-06-16 之后的当前实现、语义索引、Vercel AI SDK Core agent runtime、工作区读取和最新测试结果，以 [当前实现说明](CURRENT_IMPLEMENTATION.md) 为准。本文保留 2026-06-13 阶段性开发进度。

## 当前结论

Nolia AI V1 的核心链路已经完成并通过自动化回归。当前版本已具备可本地试用的 AI Assistant、Provider 设置、OpenAI-compatible/Ollama provider、上下文控制、流式运行事件、工具调用、Patch Proposal 和显式写入确认能力。

本轮重点补齐了 AI Provider 设置体验：不再使用单独的保存/清除 API key 按钮，改为普通设置式自动保存；支持多个 provider profile，并可新增、修改、删除和选择默认 Provider。

## 已完成范围

### 文档与规划

- 建立 `docs/ai-assistant-runtime/` 作为 AI 相关文档目录。
- 完成 V1 需求规划、技术方案、UI/UX 方案、UI/UX Review 和综合测试报告。
- 技术方案已更新为多 provider profile 模型，避免后续按旧的单 provider 字段继续实现。

### Shared Contract

- 新增 `src/shared/ai.ts`，集中定义 AI Provider、设置、运行事件、上下文、工具结果和 Patch Proposal 类型。
- `AppSettings.ai` 已升级为：
  - `enabled`
  - `defaultProviderId`
  - `providers`
  - `allowCurrentNoteContent`
  - `allowWorkspaceSearch`
  - `allowReadSearchResults`
- 保留 active/default provider 的兼容 convenience 字段，便于 UI 和 runtime 使用。
- 支持旧版单 Provider 设置迁移为一个 provider profile。

### Main Process Runtime

- 新增 `src/main/ai/` runtime 模块。
- 实现 `AiSettingsService`，负责脱敏设置读取、设置归一化、Provider 解析和 API key 状态查询。
- 实现 `AiSecretService`，使用 Electron `safeStorage` 在 main process 侧保存密钥。
- API key 使用 provider profile id 存储，支持同类型 Provider 配置多套 key。
- 实现 OpenAI-compatible Provider。
- 实现 Ollama Provider。
- 实现 Provider Registry、Provider test、model list。
- 实现 `AiSessionService`、`AgentEngine`、工具注册和流式事件。
- 写入能力统一通过 Patch Proposal 返回，不由模型直接写文件。

### IPC 与 Preload

- 新增 AI IPC channels：
  - `ai.settings.get`
  - `ai.settings.set`
  - `ai.secret.set`
  - `ai.secret.clear`
  - `ai.provider.test`
  - `ai.models.list`
  - `ai.run.start`
  - `ai.run.cancel`
  - `ai.run.event`
- `src/shared/ipc.ts` 增加 Zod schema 校验。
- `src/preload/index.ts` 暴露脱敏 AI API，renderer 不能读取明文 API key。

### Renderer UI/UX

- 新增 AI 侧边栏入口，使用顶部工具栏 `Nolia AI`。
- AI 侧边栏支持：
  - 启用状态提示。
  - 当前 Provider/模型展示。
  - 当前上下文提示。
  - 消息流式展示。
  - 工具调用/来源展示。
  - 错误卡片、复制错误、打开设置、重试。
  - Patch Proposal diff、影响范围和操作按钮。
- 设置页新增 AI tab。
- AI 设置页已拆分为：
  - Provider 配置。
  - 连接详情。
  - 模型与连接。
  - 上下文与安全。
- Provider 设置支持：
  - 多 provider profile 列表。
  - 新增 OpenAI-compatible。
  - 新增 Ollama。
  - 修改名称、Provider 类型、Base URL、API mode、模型。
  - 设置默认 Provider。
  - 删除 Provider。
  - 每个 Provider 独立 API key 状态。
- API key 交互已改为：
  - 输入后自动保存到系统安全存储。
  - 不再显示单独“保存 API key / 清除 API key”按钮。
  - 已保存状态用掩码提示。
  - 清空输入框会移除该 Provider 的 key。
  - 本地 Ollama 隐藏 API key 输入并显示说明。
- 窄宽度下 AI 侧边栏和 Patch Proposal 操作按钮保持可访问，无横向溢出。

### Editor Integration

- Source Editor 支持 AI 快照，提供选区、光标和文档上下文。
- WYSIWYG Editor 提供基础 AI 快照。
- 命令面板加入 AI 入口：
  - 打开 AI Assistant。
  - 总结当前笔记。
  - 润色选中文本。
  - 解释选中文本。
  - 翻译选中文本。
  - 转为待办。

## 当前已验证

### 自动化验证

以下命令已通过：

```sh
npm run typecheck
npm run lint
npm test
npm run e2e
npx playwright test tests/e2e/ai-assistant.spec.ts
```

结果摘要：

- Vitest：`11` 个 test files 通过，`70` 个 tests 通过。
- Playwright 全量 E2E：`65` 个 tests 通过。
- AI 专项 E2E：`7` 个 tests 通过。

### AI 专项 E2E 覆盖

- AI sidebar 可打开设置并流式展示 mock response。
- AI settings 可刷新模型、测试连接、自动保存/清空 API key。
- Provider 可新增、修改名称、设为默认、删除。
- Ollama 模式隐藏 API key 输入。
- 选中文本 AI action 要求选区，并正确发送 selection context。
- Patch Proposal 必须显式确认，支持替换全文、插入、追加、复制结果、重新生成和放弃。
- Runtime error 可展示并支持后续继续输入。
- 窄宽度 sidebar 下 Patch Proposal 操作仍可见。
- 关键 AI 控件可通过 role 定位，无横向溢出。

### 真实 Provider 验证

已使用私有 OpenAI-compatible 测试源完成真实 Provider smoke 和 UI workflow。测试报告见 [V1 综合测试报告](V1_COMPREHENSIVE_TEST_REPORT.md)。

安全说明：

- 文档不记录真实 API key。
- 文档不记录真实 Base URL。
- API key 只写入 Electron `safeStorage` 管理的本地安全存储。

### 本地预览安装

已构建并安装本地 unsigned preview，安装后已确认应用可启动到欢迎页。该包不是正式签名发布包。

## 当前已知限制

- `npm run package:unsigned` 在本次执行中于 300 秒超时，但 `release/mac-universal/Nolia.app` 已生成并可用于本地预览安装；超时发生在打包产物收尾阶段。
- macOS `spctl` 对本地 unsigned preview 返回 rejected，符合未正式签名预览包预期。
- Runtime 当前会话状态仍主要在 `App.tsx` 内维护；技术方案建议后续拆出更独立的 renderer AI store。
- V1 不做聊天历史持久化，刷新或重启后 AI 会话可丢失。
- WYSIWYG 的复杂 Markdown offset 替换仍不作为 V1 承诺范围。
- Ollama tool calling 取决于模型能力，V1 只提供 runtime 支持和基础提示。
- 插件注册 AI commands/tools 不在 V1 范围。

## 下一步建议

1. 拆分 renderer AI state，把 `App.tsx` 中 AI 会话、事件处理和 patch apply 逻辑迁移到独立 store/hook。
2. 增加 Provider profile 管理的更多边界测试，例如重复 id、删除默认 provider、旧设置迁移、多 key 状态。
3. 增加安全存储不可用场景的单测和 UI E2E。
4. 补充 OpenAI-compatible `responses` mode 的真实服务兼容测试。
5. 在设置页展示云端 Provider 的域名和上下文发送提示，进一步增强用户信任感。
6. 为正式测试包建立更快的 macOS dir target 安装流程，避免每次都等待 DMG/zip 收尾。
