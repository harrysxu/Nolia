# AI Assistant Runtime Documentation Summary

更新日期：2026-06-16

本文汇总 `docs/ai-assistant-runtime/` 下所有 AI 相关文档的用途、当前事实来源和后续测试入口。后续换位置继续测试时，优先阅读本文、`CURRENT_IMPLEMENTATION.md` 和 `TEST_HANDOFF.md`。

## 当前事实来源

- [当前实现说明](CURRENT_IMPLEMENTATION.md)
  - 记录当前代码实际落地状态。
  - 覆盖 Vercel AI SDK Core agent runtime、OpenAI-compatible、Ollama、多模型配置、权限、工具、task、写入确认、历史版本和语义索引。
  - 后续开发、回归测试和提交说明应以此为准。
- [测试交接](TEST_HANDOFF.md)
  - 记录如何启动开发环境、配置 Ollama `qwen3.5:latest`、验证设置页、验证权限错误、验证工作区读取、验证写入 proposal、运行自动化测试和检查日志。
  - 用于换机器、换目录或继续人工验证。
- [语义索引与 RAG](SEMANTIC_INDEX_AND_RAG.md)
  - 记录手动配置 embedding、手动更新/重建索引、语义检索、全文检索降级和回答前读取实际文件的规则。
  - 当前设计是不自动创建索引，由用户显式配置和更新。
- [GitHub 提交说明](GITHUB_SUBMISSION_NOTES.md)
  - 记录提交远端前的敏感信息检查、生成物排除、建议 PR 描述和后续测试重点。

## 历史规划与阶段报告

- [V1 需求规划](V1_REQUIREMENTS.md)
  - 记录最初的产品范围、运行时边界、权限模型、上下文策略、写入确认和验收标准。
  - 仍可用于理解产品原则，但部分实现已经演进。
- [V1 技术方案](V1_TECHNICAL_DESIGN.md)
  - 记录早期 runtime、provider、tool registry、IPC、上下文、patch 和安全方案。
  - 当前实际实现已经从自研轻量 agent loop 演进为 Vercel AI SDK Core。
- [V1 UI/UX 方案](V1_UI_UX_DESIGN.md)
  - 记录 AI 设置、侧边栏、快捷操作、Patch Proposal、错误态和上下文透明度方案。
  - 当前 UI 已经历多轮修复，具体状态以当前实现说明和测试交接为准。
- [V1 UI/UX Review](V1_UI_UX_REVIEW.md)
  - 记录第一次用户视角走查发现的问题。
  - 其中部分问题已经修复，作为历史问题库保留。
- [V1 综合测试报告](V1_COMPREHENSIVE_TEST_REPORT.md)
  - 记录 2026-06-13 阶段性真实 provider、mock runtime、UI workflow 和自动化回归结果。
  - 其中测试源、路径和模型均已脱敏，作为阶段性质量记录保留。
- [V1 开发进度](V1_DEVELOPMENT_PROGRESS.md)
  - 记录 2026-06-13 阶段的开发进度。
  - 文件顶部有 2026-06-16 当前状态说明；详细当前状态以 `CURRENT_IMPLEMENTATION.md` 为准。

## 当前 AI Runtime 范围

当前已实现：

- 基于 Vercel AI SDK Core 的 agent loop。
- OpenAI-compatible 和 Ollama provider。
- 多模型列表、编辑、删除、禁用和默认模型。
- API key 本地安全存储、显示/隐藏和连接测试。
- 多轮会话上下文轮数配置。
- 当前文档读取权限、工作区搜索权限、搜索命中文档读取权限、整个工作区读取权限和工作区操作权限。
- 工作区工具：搜索、读取搜索命中文档、列文件、读文件、批量读文件、大纲、反链、标签。
- 写入 proposal：当前文档替换/插入/追加/新建/复制，工作区 Markdown 创建/修改。
- 写入前确认、历史版本、写入事务和撤销。
- 手动语义索引：embedding 配置、测试、更新、清空重建、全文检索降级。
- 错误可见化：缺权限、缺 API key、provider 空回复、超时、工具失败等不应静默。

当前仍有限制：

- 不是完全自治 agent，所有写入必须用户确认。
- 语义索引由用户手动创建和更新，不自动跟随文件保存实时更新。
- 语义检索当前不是完整 hybrid retrieval。
- 长期聊天历史不跨重启持久化。
- AI renderer 状态仍有较多逻辑集中在 `App.tsx`。

## 后续测试入口

推荐顺序：

1. 读 [当前实现说明](CURRENT_IMPLEMENTATION.md)，确认功能边界。
2. 按 [测试交接](TEST_HANDOFF.md) 启动开发环境。
3. 用 Ollama `qwen3.5:latest` 验证聊天和权限错误。
4. 验证工作区读取和写入 proposal。
5. 如果有 embedding 模型，再验证 [语义索引与 RAG](SEMANTIC_INDEX_AND_RAG.md)。
6. 提交前按 [GitHub 提交说明](GITHUB_SUBMISSION_NOTES.md) 做敏感信息和生成物检查。

## 提交前状态

最近一次完整验证记录在 `CURRENT_IMPLEMENTATION.md` 和 `TEST_HANDOFF.md`：

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run e2e`

结果摘要：

- Vitest：14 files / 91 tests passed。
- Playwright：87 tests passed。
- Build：passed。
