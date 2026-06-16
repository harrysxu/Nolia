# Nolia AI Assistant Current Implementation

更新日期：2026-06-16

本文记录当前代码中已经落地的 AI Assistant、Agent Runtime、工具、权限、语义索引和测试状态。它是后续换位置继续测试、提交 GitHub 和交接开发时的事实来源。

## 当前结论

Nolia AI 已经从早期 V1 方案演进为基于 Vercel AI SDK Core 的 agent runtime：

- 支持 OpenAI-compatible 和 Ollama。
- 支持多模型配置、禁用、删除、默认模型选择。
- 支持聊天、多轮上下文、选中文本操作、当前文档总结。
- 支持工作区搜索、读取搜索命中文档、读取整个工作区文本文件。
- 支持工作区写入提案，但写入必须由用户确认。
- 支持 AI task 持久化、审批、拒绝、写入事务和撤销。
- 支持手动配置 embedding 模型并手动创建/更新/清空语义索引。
- 语义检索未配置、未创建、过期或失败时会降级到全文检索。

当前仍应视为 AI runtime V1/V1.1 阶段，不是完全自治 agent。所有写入仍必须由用户确认。

## 关键源码入口

### Shared contract

- `src/shared/ai.ts`
  - AI 设置、Provider、Embedding、Run event、Patch proposal、Task snapshot 等类型。
  - 默认 Provider 与 embedding 设置。
  - 旧版 AI 设置兼容与归一化。
- `src/shared/channels.ts`
  - AI IPC channel。
- `src/shared/ipc.ts`
  - AI IPC 请求的 Zod schema。

### Main process runtime

- `src/main/ai/aiService.ts`
  - AI 设置、Provider 测试、模型列表、embedding 测试、语义索引、run 启停入口。
- `src/main/ai/aiTaskService.ts`
  - 持久化 AI task、审批 proposal、拒绝 proposal、记录写入事务、撤销写入。
- `src/main/ai/aiSdkAgentEngine.ts`
  - Vercel AI SDK Core agent loop。
  - `streamText`、tool calling、step limit、usage event、fallback proposal。
- `src/main/ai/aiSdkProvider.ts`
  - 把当前 AI provider settings 转换成 AI SDK language model。
- `src/main/ai/providerRegistry.ts`
  - 根据 providerId/apiMode 选择 provider adapter。
- `src/main/ai/providers/openAiCompatibleProvider.ts`
  - OpenAI-compatible provider adapter。
- `src/main/ai/providers/ollamaProvider.ts`
  - Ollama native provider adapter。
- `src/main/ai/embeddingService.ts`
  - OpenAI-compatible / Ollama embedding 调用。
- `src/main/ai/context/aiContextBuilder.ts`
  - 系统提示、当前文档、选区、会话历史与工具提示构建。
- `src/main/ai/tools/`
  - Agent tools。
- `src/main/services/semanticIndexService.ts`
  - 手动创建/更新/重建语义索引。
- `src/main/services/workspaceDb.ts`
  - FTS、文档索引、语义 chunks、semantic search。

### Renderer UI

- `src/renderer/ai/AiSidebar.tsx`
  - AI 侧边栏、消息、错误、来源、patch proposal UI。
- `src/renderer/ai/AiSettingsPanel.tsx`
  - AI 设置页、多模型列表、模型弹窗、embedding 配置、语义索引操作。
- `src/renderer/App.tsx`
  - 当前仍承担 AI run UI 状态、事件处理、写入确认、历史版本和设置弹窗编排。

### Preload

- `src/preload/index.ts`
  - 暴露 `window.nolia.ai.*`。
  - Renderer 只能通过脱敏 API 调用 main process。

## AI 设置模型

当前 `AppSettings.ai` 包含：

- `enabled`
- `defaultProviderId`
- `providers`
- `embedding`
- `conversationHistoryTurns`
- `agentMaxSteps`
- `allowCurrentNoteContent`
- `allowWorkspaceSearch`
- `allowReadSearchResults`
- `allowWorkspaceRead`
- `allowWorkspaceOperations`

Provider profile 字段：

- `id`
- `name`
- `providerId`: `openai-compatible` 或 `ollama`
- `model`
- `baseUrl`
- `apiMode`: `chat-completions`、`responses` 或 `ollama-native`
- `disabled`

Embedding settings 字段：

- `enabled`
- `providerId`
- `model`
- `baseUrl`
- `apiMode`: `openai-embeddings` 或 `ollama-native`

兼容性要求：

- 旧配置可能没有 `providers`，会从旧 `providerId/model/baseUrl/apiMode` 迁移。
- 旧配置可能没有 `embedding`，必须补 `DEFAULT_AI_EMBEDDING_SETTINGS`。
- Renderer 收到 public AI settings 后也会做归一化，避免旧持久化状态导致设置页崩溃。

## Provider 支持

### OpenAI-compatible

推荐配置：

- Provider: `openai-compatible`
- API mode: `chat-completions`
- Base URL: 兼容服务的 `/v1` 根地址
- API key: 存储在 Electron safeStorage 管理的本地密钥存储中

支持：

- 测试连接。
- 刷新模型列表。
- SSE streaming。
- Vercel AI SDK tool calling。
- OpenAI-compatible embedding。

### Ollama

当前有两种可用模式：

1. OpenAI-compatible 模式
   - Base URL: `http://localhost:11434/v1`
   - API mode: `chat-completions`
   - 不需要 API key。
   - 当前本地 `qwen3.5:latest` 已验证可用于聊天。

2. Ollama native 模式
   - Base URL: `http://localhost:11434`
   - API mode: `ollama-native`
   - 用于 native `/api/chat` 或 embedding。

注意：

- 不同 Ollama 模型对工具调用、streaming 和 embedding 支持不同。
- `qwen3.5:latest` 可用于聊天，但本机 Ollama 返回过 `This server does not support embeddings. Start it with --embeddings`，因此它不能直接假定可用于 embedding。
- 建议 embedding 使用专用 embedding 模型或明确支持 embedding 的 Ollama 配置。

## Agent 执行流程

用户发送消息后，当前流程如下：

1. Renderer 收集 UI 上下文：
   - 当前工作区。
   - 当前打开文档。
   - 当前文档未保存正文。
   - 选区。
   - 最近 N 轮会话历史。
2. Renderer 根据设置和本次请求构造 `AiRunStartRequest` 或 `AiTaskStartRequest`。
3. Preload 通过 IPC 发送到 main process。
4. Main process 解析 AI 设置、Provider、API key 和权限开关。
5. `AiService` 校验：
   - AI 是否启用。
   - 模型是否配置。
   - 云端 provider 是否有 API key。
   - 当前文档权限是否允许。
6. `AiSdkAgentEngine` 构建初始消息。
7. 根据权限暴露可用 tools。
8. Vercel AI SDK Core 让模型决定是否调用 tools。
9. 每次 tool 调用：
   - 先做权限检查。
   - 再执行工具。
   - 产生 `tool-call`、`tool-result`、`source-used` 或 `patch-proposal` 事件。
10. Renderer 流式展示文本、工具状态、来源、修改建议和错误。
11. 如果产生写入 proposal：
   - UI 展示影响范围和 diff。
   - 用户确认后才落盘。
   - 写入前创建历史版本或写入事务。
12. Task 模式下，步骤、来源、审批、写入事务会持久化到 workspace `.nolia/ai/tasks`。

## 当前工具列表

工具由 `src/main/ai/tools/toolRegistry.ts` 注册。

| Tool | 权限 | 作用 |
| --- | --- | --- |
| `getCurrentNoteContext` | current-note | 读取当前文档上下文。 |
| `searchNotes` | workspace-search | 搜索 Markdown 笔记；语义索引 ready 时优先语义检索，否则全文检索。 |
| `readNote` | read-note | 只能读取本轮搜索命中的 Markdown 笔记摘录。 |
| `listWorkspaceFiles` | workspace-read | 列出工作区内目录和可读文本/Markdown 文件。 |
| `workspace_recent_files` | workspace-read | 列出最近打开的 Markdown 文件。 |
| `readWorkspaceFile` | workspace-read | 读取单个可读文本/Markdown 文件摘录。 |
| `workspace_read_many_files` | workspace-read | 批量读取可读文本/Markdown 文件摘录。 |
| `workspace_get_outline` | workspace-read | 读取 Markdown 大纲、标签、链接和字数。 |
| `workspace_get_backlinks` | workspace-read | 读取反链和未链接提及。 |
| `proposePatch` | proposal | 对当前文档生成修改建议。 |
| `proposeWorkspacePatch` | workspace-proposal | 对工作区 Markdown 文件生成创建/修改建议。 |
| `listTags` | tags | 列出工作区标签。 |

限制：

- `readNote` 不能绕过搜索结果范围读取任意文件。
- whole-workspace read 只支持文本/Markdown 等白名单扩展。
- `.nolia`、`.git`、`node_modules` 等忽略目录不能读取。
- 工作区写入 proposal 当前只允许 Markdown 文件。
- 工具每轮有调用次数上限。

## 权限模型

设置页中的权限开关决定 agent 可用工具：

- `allowCurrentNoteContent`
  - 允许发送当前笔记正文。
  - 当前文档总结、翻译当前文档等请求需要该权限。
- `allowWorkspaceSearch`
  - 允许调用本地搜索。
  - 搜索标题和片段可能进入模型上下文。
- `allowReadSearchResults`
  - 允许读取搜索命中文档摘录。
  - 必须依赖 `allowWorkspaceSearch`。
- `allowWorkspaceRead`
  - 允许列出并读取整个工作区内的文本/Markdown 文件。
  - 不包含忽略目录或二进制文件。
- `allowWorkspaceOperations`
  - 允许生成工作区创建/修改 proposal。
  - 必须依赖 `allowWorkspaceRead`。

无论权限如何，写入仍必须确认。

## 写入、历史和回滚

AI 写入分两类：

1. 当前文档 patch proposal
   - 替换全文。
   - 插入。
   - 追加。
   - 新建文档。
   - 复制结果。
   - 放弃或重新生成。

2. 工作区操作 proposal
   - 修改已有 Markdown 文件。
   - 创建新 Markdown 文件。
   - 由 `proposeWorkspacePatch` 生成。

写入安全机制：

- AI 不直接落盘。
- 用户点击确认后才调用文件服务。
- 写入前记录历史版本。
- Task 写入事务可以执行 undo。
- 恢复历史版本时避免重复生成大量历史文档。

## 语义索引与检索

当前实现支持手动语义索引：

- 设置页配置 embedding provider、base URL、model。
- 用户手动点击 `更新语义索引`。
- 用户可点击 `清空并重建`。
- 状态包括 `not_configured`、`not_created`、`ready`、`updating`、`stale`、`failed`。

检索策略：

1. `searchNotes` 读取当前 embedding 设置。
2. 如果语义索引状态为 `ready`：
   - 为 query 生成 embedding。
   - 从 `semantic_chunks` 做 cosine similarity。
   - 返回 semantic results。
3. 如果语义索引不可用、为空或 embedding 调用失败：
   - 降级到全文搜索。
   - tool result 里返回 fallback reason。

重要原则：

- Semantic chunks 只是召回提示，不是真实数据。
- Agent 回答前应该调用 `readNote` 或 workspace read tools 读取实际文件摘录。
- 当前打开文档永远使用 renderer 实时内容，不依赖索引。

## 已验证测试

最近一次完整验证：

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
```

结果：

- Vitest：14 files / 91 tests passed。
- Playwright：87 tests passed。
- Build：通过。
- 开发版 Electron 重启后，Computer Use 验证 `设置 -> AI` 可打开并显示模型列表、语义索引和上下文权限。
- 日志检查未发现新的 `Unhandled` / `TypeError`。

重点 AI e2e 覆盖：

- AI 设置模型列表、编辑、API key 查看、测试连接、切换模型。
- 旧 public settings 缺少 `embedding` 时 AI 设置页仍可打开。
- 语义索引配置、测试、更新。
- 多轮会话历史。
- 当前文档权限缺失时显示明确错误。
- 空回复、超时、启动挂起都释放输入框并显示错误。
- Mermaid 流式结束后再渲染。
- 翻译类聊天不会误生成修改卡片。
- Patch proposal 操作在窄侧栏仍可访问。
- AI replace 可撤销并记录历史版本。
- 工作区操作 proposal 必须确认并创建历史快照。

## 已知限制

- AI UI 状态仍有较多逻辑在 `App.tsx`，后续应拆成 store/hook。
- 语义索引目前是人工创建/更新，不自动跟随文件保存实时更新。
- 当前没有独立向量数据库，embedding JSON 存在 workspace SQLite。
- 语义检索没有做 hybrid rerank，只是 semantic ready 优先，失败后全文 fallback。
- Embedding 模型必须用户自己配置；聊天模型不能自动推断可用于 embedding。
- 对超大工作区的索引速度和 token 成本还需要真实压力测试。
- 不支持插件注册 AI tools。
- 不支持用户自定义 AI commands。
- 没有长期聊天历史跨重启恢复。

## 后续建议

1. 将 renderer AI 状态从 `App.tsx` 拆到独立 module。
2. 增加语义索引版本和 chunk 策略版本，模型变更时自动标记 stale。
3. 增加 Hybrid Retrieval：BM25 + semantic + rerank。
4. 为重建索引增加取消、进度事件和更细错误日志。
5. 增加 task 列表 UI，让用户查看历史 AI task、审批记录和写入事务。
6. 增加真实 Ollama/OpenAI-compatible provider 的 CI 外手动测试脚本。
7. 将 AI 文档中的早期方案与当前实现差异继续收敛，避免维护两套事实。
