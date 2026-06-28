# Nolia AI Runtime

本文是 Nolia AI Assistant 的当前事实来源，覆盖运行架构、权限边界、Provider 配置、语义索引和发布前测试。

## 当前能力

- Provider：OpenAI-compatible Chat Completions、OpenAI Responses、Ollama native、Ollama OpenAI-compatible。
- 多模型配置：可添加、禁用、删除并选择默认模型；API key 通过 Electron safeStorage 或本机密钥文件保存。
- 对话能力：普通聊天、选中文本操作、当前文档总结、多轮上下文、来源展示和可见错误。
- Workspace tools：搜索笔记、读取搜索命中、列出/读取工作区文本文件、最近文件、大纲、反链和标签。
- 写入能力：当前文档 patch proposal、工作区 Markdown 创建/修改 proposal；所有写入都必须由用户确认。
- Task runtime：AI task、审批、拒绝、写入事务、历史版本和撤销写入。
- Semantic index：手动配置 embedding，手动创建/更新/清空索引；不可用或过期时降级全文检索。

当前 AI 仍是受控 agent，不执行 shell，不删除文件，不绕过权限读取工作区，不直接落盘修改用户内容。

## 关键源码

- `src/shared/ai.ts`：AI 设置、Provider、Embedding、Run event、Patch proposal 和 Task 类型。
- `src/shared/ipc.ts`：AI IPC Zod schema。
- `src/main/ai/aiService.ts`：AI 设置、模型列表、连接测试、embedding、语义索引和 run/task 入口。
- `src/main/ai/aiSdkAgentEngine.ts`：基于 Vercel AI SDK Core 的 agent loop、tool calling、step limit 和 proposal fallback。
- `src/main/ai/aiSdkProvider.ts`：把 Nolia provider settings 转为 AI SDK language model。
- `src/main/ai/providers/`：OpenAI-compatible 与 Ollama native provider adapter。
- `src/main/ai/tools/`：所有 AI tool 注册、权限检查和结果摘要。
- `src/main/services/semanticIndexService.ts` 与 `src/main/services/workspaceDb.ts`：全文检索、semantic chunks 和 semantic search。
- `src/renderer/ai/`：AI sidebar 与 AI settings UI。
- `src/preload/index.ts`：`window.nolia.ai.*` 安全桥接。

## Provider 配置

OpenAI-compatible Chat Completions：

- Base URL 必须是兼容服务的 API root，推荐显式填写 `/v1`，例如 `https://api.example.com/v1`。
- Nolia 会在正式运行中追加 `/chat/completions`；连接测试、模型列表和正式运行必须使用同一 API root。
- 如果服务商只提供裸域名，Nolia 会在 AI SDK 路径中补 `/v1`，避免测试与正式请求路径不一致。

OpenAI Responses：

- 仅建议用于明确支持 `/v1/responses` 的服务。
- 自定义 OpenAI-compatible 中转不一定完整支持 Responses streaming、reasoning 或 tool calling。

Ollama：

- OpenAI-compatible 模式：`http://localhost:11434/v1` + Chat Completions。
- Native 模式：`http://localhost:11434` + Ollama native `/api/chat`。
- embedding 建议使用专用 embedding 模型；聊天模型不能默认视为可 embedding。
- 大上下文/工具读取场景需要模型实际上下文足够，否则 Ollama 可能截断 prompt 并返回空输出。

## 权限模型

设置页权限开关决定本轮可用工具：

- `allowCurrentNoteContent`：允许发送当前笔记正文。
- `allowWorkspaceSearch`：允许搜索标题、路径、正文片段或 semantic candidates。
- `allowReadSearchResults`：允许读取本轮搜索命中的 Markdown 摘录，依赖 workspace search。
- `allowWorkspaceRead`：允许列出并读取工作区文本/Markdown 文件。
- `allowWorkspaceOperations`：允许生成工作区文件创建/修改 proposal，依赖 workspace read。

工具仍有硬边界：`.nolia`、`.git`、`node_modules` 等忽略路径不可读；非文本资源不可作为正文发送；写入只能通过 proposal。

## Semantic Index 与 RAG

- embedding provider 在 AI 设置中独立配置。
- 索引由用户手动创建、更新或清空，不在聊天中自动调用 embedding。
- `searchNotes` 在 semantic index ready 且 embedding 可用时优先 semantic candidates，否则使用本地全文检索。
- 搜索结果只是检索提示；回答需要事实依据时，agent 应调用 `readNote` 或 workspace read 工具读取真实文件摘录。
- 后续优化方向：hybrid retrieval、rerank、自动增量索引、chunk 命中解释和更严格的上下文预算。

## 错误诊断

- `missing_api_key`：OpenAI-compatible provider 未保存 API key。
- `provider_empty_response`：服务端 2xx 但没有返回可用文本、工具调用或 reasoning；优先检查 Base URL 是否为 `/v1` API root、streaming 是否支持、模型是否支持工具调用。
- `tool_failed`：工具参数、权限、调用次数或模型连续工具调用未给最终回答。
- `run_timeout`：模型或工具长时间无输出，检查网络、模型服务和上下文大小。
- Ollama 空响应：确认模型支持当前接口模式、上下文没有被截断、必要时调大 `num_ctx`。

## 发布前测试

自动化基线：

```sh
npm run typecheck
npm run lint
npm test
npm run e2e
npm run build
```

AI 手工冒烟：

1. OpenAI-compatible：保存 API key，刷新模型，测试连接，发送“你好”。
2. 检查 Base URL：无论用户填写裸域名或 `/v1`，聊天请求都应返回文本；工具调用场景不应出现空输出。
3. Ollama：测试 chat-completions 与 native 模式至少一种可用。
4. 权限边界：关闭 workspace read 后，workspace file tools 不应暴露；关闭写入权限后不应生成 workspace proposal。
5. 写入 proposal：创建或修改 Markdown 后必须等待用户确认，确认前不能落盘。
6. Semantic index：未配置 embedding 时全文检索可降级；配置后可创建/更新/清空索引。

提交前不要包含 API key、私有 Base URL、真实用户 workspace 内容、日志、截图或生成产物。
