# AI Assistant Runtime

本目录用于沉淀 Nolia AI Assistant 与底层 AI Runtime 的产品、技术、隐私、安全和测试文档。

当前实现已经从早期 V1 规划演进为基于 Vercel AI SDK Core 的 agent runtime。阅读顺序建议先看当前事实来源，再看历史规划。

## 文档索引

### 当前实现与交接

- [文档总览](DOCUMENTATION_SUMMARY.md)：汇总本目录所有 AI 文档、当前事实来源、后续测试入口和提交前状态。
- [当前实现说明](CURRENT_IMPLEMENTATION.md)：当前代码已经落地的 AI Assistant、Agent Runtime、工具、权限、写入、语义索引和测试状态。
- [测试交接](TEST_HANDOFF.md)：换位置继续测试时的启动、模型配置、UI 手动验证、自动化验证和日志检查流程。
- [语义索引与 RAG](SEMANTIC_INDEX_AND_RAG.md)：embedding、手动索引、全文检索降级、回答前读取实际文件和后续 hybrid retrieval 设计。
- [GitHub 提交说明](GITHUB_SUBMISSION_NOTES.md)：提交远端前的敏感信息检查、生成物排除、PR 描述和后续测试重点。

### V1 历史规划与阶段报告

- [V1 需求规划](V1_REQUIREMENTS.md)：第一个 AI 版本的产品范围、运行时边界、验收标准和里程碑。
- [V1 技术方案](V1_TECHNICAL_DESIGN.md)：早期 AI Runtime、Provider、Tool Registry、IPC、上下文、Patch 和安全实现方案。
- [V1 UI/UX 方案](V1_UI_UX_DESIGN.md)：AI 设置、侧边栏、选中文本操作、上下文透明度和写入确认体验。
- [V1 UI/UX Review](V1_UI_UX_REVIEW.md)：第一次用户视角走查，记录早期问题和改进方向。
- [V1 综合测试报告](V1_COMPREHENSIVE_TEST_REPORT.md)：阶段性真实 Provider、UI live workflow、自动化回归和视觉检查结果。
- [V1 开发进度](V1_DEVELOPMENT_PROGRESS.md)：2026-06-13 阶段实现范围、测试结果、预览安装状态、已知限制和下一步。

## 维护原则

- AI 文档统一放在本目录，避免散落到用户手册、架构文档和插件文档中。
- `CURRENT_IMPLEMENTATION.md` 是当前代码状态的事实来源；V1 规划和阶段报告保留历史上下文。
- 需求文档描述用户价值、交互范围和验收标准；技术方案文档描述模块、IPC、数据结构和实现步骤。
- AI 能力默认按本地优先和显式授权设计：用户不启用 AI 时不发送任何笔记内容到外部服务。
- 所有写入类 AI 能力必须走确认或提案机制，不允许模型直接修改用户笔记。
