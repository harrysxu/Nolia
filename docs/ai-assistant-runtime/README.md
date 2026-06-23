# AI Assistant Runtime

更新日期：2026-06-19

本目录是 Nolia AI Assistant 与底层 AI Runtime 的唯一文档入口。当前实现已经演进为基于 Vercel AI SDK Core 的 agent runtime；后续开发、测试和提交自查优先以这里的当前事实文档为准。

## 阅读顺序

1. [当前实现说明](CURRENT_IMPLEMENTATION.md)：代码已落地的 AI 设置、Provider、agent loop、工具、权限、写入、历史和语义索引。
2. [语义索引与 RAG](SEMANTIC_INDEX_AND_RAG.md)：embedding、手动索引、全文检索降级、回答前读取真实文件和后续 hybrid retrieval 设计。
3. [测试交接](TEST_HANDOFF.md)：开发环境启动、模型配置、手动验证、自动化验证和日志检查流程。
4. [深度测试用例](DEEP_AI_TEST_CASES.md)：语义索引、AI Chat、工作区操作、历史任务、权限边界和桌面页面测试矩阵。

## 当前范围

当前已实现：

- OpenAI-compatible 和 Ollama provider，多模型配置、禁用、删除和默认模型选择。
- 聊天、多轮上下文、选中文本操作和当前文档总结。
- 工作区搜索、读取搜索命中文档、读取整个工作区文本文件、标签、大纲和反链工具。
- 当前文档和工作区 Markdown 创建/修改 proposal；所有写入必须由用户确认。
- AI task 持久化、审批、拒绝、写入事务、历史版本和撤销。
- 手动配置 embedding 模型并创建、更新、清空语义索引；不可用时降级到全文检索。
- 可见错误：缺权限、缺 API key、空回复、超时、工具失败和 provider 异常不应静默。

当前仍有限制：

- 不是完全自治 agent，删除、重命名、移动、执行 shell、外部连接器、图片/音频处理不在当前支持范围。
- 语义索引由用户手动创建和更新，不自动调用 embedding。
- 语义检索还不是完整 hybrid rerank。
- 长期聊天历史不跨重启持久化。
- Renderer AI 状态仍有较多逻辑集中在 `App.tsx`，后续应继续拆分。

## 提交自查

提交前确认不要包含：

- API key、私有 OpenAI-compatible Base URL、真实用户 workspace 内容。
- 临时 userData、`.tmp/`、日志、截图、`dist/`、`release/`、`test-results/`、`coverage/`、`playwright-report/`、`output/`、`node_modules/`。

建议检查：

```sh
git diff -- docs src tests package.json package-lock.json playwright.config.ts
rg -n "sk-|api[_-]?key|Authorization|Bearer|nolia-ai-sdk-userdata" docs src tests package.json playwright.config.ts
```

提交前至少运行：

```sh
npm run typecheck
npm run lint
npm test
```

如果改动 UI、IPC、AI runtime、文件系统、历史版本或打包配置，再运行：

```sh
npm run e2e
npm run build
```

## 维护原则

- `CURRENT_IMPLEMENTATION.md` 是当前代码状态的事实来源；过时规划和一次性报告不进入发布文档。
- 测试策略以 `TEST_HANDOFF.md` 和 `DEEP_AI_TEST_CASES.md` 为入口，避免把一次性脚本当作长期流程。
- AI 能力默认本地优先和显式授权：用户不启用 AI 或未授予权限时，不发送对应笔记内容到外部服务。
- 所有写入类 AI 能力必须走确认或提案机制，不允许模型直接修改用户笔记。
