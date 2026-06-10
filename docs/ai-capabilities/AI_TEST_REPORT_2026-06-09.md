# Nolia AI 全量测试报告

日期：2026-06-09  
分支：`feature/ai-capabilities`  
范围：AI 设置、OpenAI-compatible provider、预置/自定义命令、AI 面板、上下文预览、工作区索引、编辑器应用、新建笔记、变更计划审核、错误边界、UI 交互与构建回归。

## 结论

本次 AI 功能测试通过。测试中发现 4 个问题，均已修复并完成回归：

- 自定义命令在 AI 面板中可能因命令数量截断不可见。
- 禁用按钮缺少明确的不可操作视觉状态。
- AI 变更计划弹窗的背景遮罩与真实关闭按钮同名，辅助技术/自动化可能命中错误控件。
- 测试 Electron 强制终止时 `global-state.json` 可能被截断，暴露设置持久化非原子写风险。

## 测试配置

- Provider 类型：OpenAI-compatible `/v1`
- 配置来源：`/Users/long/tmp/codexx`
- 测试节点：`https://sub2.de5.net/v1`
- 默认模型：`gpt-5.4-mini`
- 安全约束：API key 仅在本地 smoke 中读取，不写入仓库、不写入文档、不在命令结果中输出。

## 执行结果

| 项目 | 结果 | 说明 |
|---|---|---|
| TypeScript | 通过 | `npm run typecheck` |
| ESLint | 通过 | `npm run lint` |
| 单元测试 | 通过 | `npm test`，11 个文件、67 个用例 |
| AI e2e | 通过 | `tests/e2e/ai-panel.spec.ts` 与 `tests/e2e/ai-comprehensive.spec.ts` |
| 全量 e2e | 通过 | `npm run e2e`，60 个用例 |
| 生产构建 | 通过 | `npm run build`，仅有既有 chunk size 警告 |
| 真实 provider smoke | 通过 | `/v1/models` 返回 17 个模型；默认模型存在；最小 chat 请求成功 |
| UI 人工检查 | 通过 | 检查 `test-results/ai-comprehensive-panel.png`；真实桌面截图在测试过程中已人工检查，后续 e2e 清理了临时截图 |
| Computer Use 桌面检查 | 通过 | 已卸载 `/Applications/Nolia.app`，源码 Electron 桌面实例完成真实界面读取、设置、AI 面板和变更计划检查 |
| 真实桌面 provider | 通过 | 设置页 codexx provider 连接测试成功 |
| 真实桌面 AI 索引 | 通过 | 重建索引后状态为可用，片段数 9 |
| 真实桌面 chat | 通过 | codexx 返回 `NOLIA_REAL_AI_OK`，上下文预览显示当前文档 |
| 真实桌面写入 | 通过 | 新建笔记、变更计划 create/modify 均写入临时工作区 |

## 覆盖说明

本次自动化覆盖了以下高风险路径：

- AI 设置页打开、AI tab 切换、provider 配置区域、索引状态区域、预置命令和自定义命令区域。
- 工作区 AI 索引重建，状态从设置页可见，并验证 chunk 数展示。
- 预置命令复制为自定义命令，自定义名称和 prompt 编辑，自定义命令在 AI 面板可见。
- AI 面板发送 prompt，展示 mock AI 回复，展示当前文档上下文预览。
- 真实桌面发送 codexx prompt，展示真实 AI 回复和上下文预览。
- AI 回复结果的新建笔记动作，验证创建路径。
- JSON 变更计划解析、审核弹窗、create/modify 两类 change 展示和应用全部。
- 应用全部后的 disabled 状态，防止重复应用。
- AI 面板、结果按钮、上下文预览、设置弹窗的可见溢出检查。
- modal 背景遮罩不再污染“关闭”按钮的可访问名称查找。

## 修复记录

| 文件 | 修复 |
|---|---|
| `src/renderer/App.tsx` | AI 面板不再截断可见命令，避免自定义命令被隐藏 |
| `src/renderer/App.tsx` | modal backdrop 标记为 `aria-hidden` 且移出 tab 顺序，避免和真实关闭按钮同名冲突 |
| `src/main/services/settingsService.ts` | 设置持久化改为临时文件 + rename 原子写入，降低崩溃/强退造成配置损坏的风险 |
| `src/renderer/styles/global.css` | 增加 primary/secondary/icon disabled 样式，禁用态不再表现为可点击 |
| `tests/settingsService.test.ts` | 补充设置持久化后没有遗留临时文件、可重新加载的断言 |
| `tests/e2e/helpers/mockNolia.ts` | AI mock 支持内置命令、自定义命令和索引状态 |
| `tests/e2e/ai-comprehensive.spec.ts` | 新增 AI 设置、命令、索引、面板、变更计划和 UI 溢出综合测试 |
| `tests/e2e/ai-panel.spec.ts` | 新增 AI 面板最小发送链路测试 |

## 真实桌面环境

- `/Applications/Nolia.app` 已按要求从应用目录移除，备份在 `/Users/long/tmp/nolia-uninstalled-20260609-233513/Nolia.app`。
- 测试期间真实 `~/Library/Application Support/Nolia` 已备份，临时替换为测试数据；测试结束后已恢复真实用户数据。
- 测试用户数据过程归档保留在 `/Users/long/tmp/nolia-ai-desktop-test/test-userdata-after-20260609-235331`；其中设置文件可能因修复前强制终止被截断，仅用于复盘，不作为可直接复用的数据集。

## 风险与限制

- 当前没有正式的测试 userData override。真实桌面测试为避免触碰用户数据，采用了备份/替换/恢复流程；后续应实现 `NOLIA_USER_DATA_DIR` 或独立测试 app identity。
- provider smoke 只覆盖当前要求的 codexx/OpenAI-compatible 节点，其他 provider 暂未接入测试矩阵。
- `npm run build` 存在既有 Vite chunk size 警告；本次 AI 测试未处理构建拆包。

## 后续建议

- 为 AI 桌面人工回归准备独立 app identity 或测试开关，允许在不触碰真实 Nolia 的情况下运行 Computer Use 点击、输入、拖拽和截图。
- 接入其他 provider 后，为每个 provider 增加模型列表、chat、错误码、禁用态、缺 key、超时和 fallback 测试。
- 把真实 provider smoke 封装为可选脚本，默认读取本机环境变量，CI 中保持禁用。
