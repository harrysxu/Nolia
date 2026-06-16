# Nolia AI V1 Comprehensive Test Report

日期：2026-06-13

## 测试目标

本次测试基于 V1 UI/UX 原则和 AI Runtime 设计要求，验证 Nolia AI 是否满足第一个版本的可发布质量：

- 用户能清楚知道 AI 会使用哪些上下文。
- AI 不直接写入笔记，所有修改都通过 Patch Proposal 和显式确认。
- Provider 配置、模型刷新、连接测试、API key 状态清晰可理解。
- 错误状态有明确下一步，不阻断后续输入。
- 窄宽度下关键动作仍可见、可点击、无横向溢出。
- OpenAI-compatible 真实服务和本地 mock runtime 都能跑通。

## 测试环境

- 分支：`feature/ai-assistant-runtime`
- 应用：Electron + React + TypeScript
- 真实 Provider：OpenAI-compatible 测试服务
- Base URL：私有 OpenAI-compatible endpoint，仓库文档中不记录具体地址。
- 模型：私有测试模型
- 测试密钥来源：本机临时密钥文件，未提交到仓库。
- 隔离测试目录：本机临时目录。
- 截图目录：本机临时 artifacts 目录。

说明：API key 只写入临时 Electron `userData`，没有输出到日志、截图或仓库文档。

## 真实 Provider 结果

### OpenAI-compatible API smoke

结果：通过。

- `/v1/models` 可访问。
- 模型列表包含目标测试模型。
- `/v1/chat/completions` 返回预期标记 `OK-NOLIA-UX`。

### Nolia UI live workflow

结果：通过。

使用隔离 userData 和新建临时 workspace 启动 Nolia，通过真实 UI 完成：

1. 打开最近工作区 `AI UX Comprehensive`。
2. 打开 `Nolia AI` 侧边栏。
3. 进入 `AI 设置`。
4. 选择或新增 OpenAI-compatible Provider。
5. 填入测试 API key，输入后自动写入系统安全存储。
6. 执行 `测试连接`，结果为 `Connected`。
7. 执行 `刷新模型`，返回 26 个模型。
8. 选择/保持目标测试模型。
9. 发送真实 prompt。
10. 收到真实模型回复，包含 `OK-NOLIA-LIVE-UX` 和当前笔记路径 `ai-live.md`。
11. 检查 AI 侧边栏无横向溢出。
12. 检查 390px 窄宽度布局。

脚本结果摘要：

```json
{
  "baseUrl": "<redacted-openai-compatible>",
  "model": "<redacted-test-model>",
  "testConnection": "Connected",
  "refreshedModels": 26,
  "responseContainsMarker": true,
  "noHorizontalOverflow": true
}
```

## UI/UX 观察

### 通过项

- AI 入口位于标题栏，和主编辑区分离，不打断编辑器主任务。
- AI 侧边栏顶部展示 Provider 和模型，用户能判断当前使用的是哪个 AI 服务。
- 上下文 bar 明确展示 `当前笔记` 和 `允许发送当前笔记`，符合上下文透明原则。
- Composer 底部重复展示“将使用”的上下文摘要，发送前能再次确认。
- 设置页已拆分为 `Provider`、`模型与连接`、`上下文与安全` 三组，认知负担明显低于早期版本。
- OpenAI-compatible 的 API key 输入、自动保存、清空删除和已保存状态可见。
- AI 设置支持多个 Provider 配置，可新增、修改、删除，并选择默认 Provider。
- Ollama 模式隐藏 API key 输入，并提示本地 Ollama 不需要 API key。
- Patch Proposal 显示目标、操作、建议内容和原文，按钮包含 `替换全文`、`插入`、`追加`、`复制结果`、`重新生成`、`放弃`。
- 写入动作必须由用户点击确认，AI 不会自动改写笔记。
- 错误卡片提供 `打开 AI 设置`、`重试`、`复制错误`，具备可恢复路径。
- 390px 窄宽度下 AI 消息、上下文 chips、composer 和按钮均未发生横向溢出。

### 仍可优化

- 设置弹窗在 1365px 宽度下右侧留白偏多，Provider 和模型两列偏左；不影响使用，但视觉密度还可以更平衡。
- 最近工作区卡片的长路径会截断，视觉上合理，但可考虑 hover 或 tooltip 展示完整路径。
- 普通对话没有 source-used 事件时，来源区不会出现；当前上下文 bar 已经提供透明度。后续如果模型实际使用了工具或搜索结果，需要更稳定地展示 source chips。
- Computer Use 可读取 Electron 窗口和无障碍树，但点击最近工作区时出现过动作通道不稳定；Playwright 和真实 Electron UI 流程均可通过。后续若要加强无障碍质量，应增加真实键盘 Tab 顺序专项测试。

## 自动化回归

### 已通过

- `npm run typecheck`
- `npm run lint`
- `npm test`
  - 11 个测试文件
  - 70 个测试通过
- `npx playwright test tests/e2e/ai-assistant.spec.ts`
  - 7 个 AI E2E 测试通过
- `npm run e2e`
  - 65 个 E2E 测试通过
- `npm run build`

### 新增覆盖

新增 E2E：

- `AI critical controls stay reachable by role and avoid horizontal overflow`

覆盖内容：

- `Nolia AI` 入口可通过 role 定位。
- AI 侧边栏是 `region`，名称为 `Nolia AI`。
- `AI 设置` 和 `关闭 AI` 控件可见。
- Composer 可编辑。
- 设置弹窗通过 `dialog` role 定位。
- AI tab 被正确选中。
- Provider、Base URL、API mode、模型、启用状态可读。
- `测试连接` 有成功反馈。
- 真实窄宽度下 AI 侧边栏无横向溢出。

## 截图索引

- `01-ai-sidebar-initial.png`：AI 侧边栏初始状态，展示当前笔记上下文。
- `02-live-settings-connected.png`：真实 OpenAI-compatible 配置、API key 已保存、连接成功。
- `03-live-chat-response.png`：真实模型回复，包含测试标记和当前笔记路径。
- `04-live-narrow-sidebar.png`：390px 窄宽度 AI 侧边栏。

## 结论

Nolia AI V1 当前符合第一个版本的核心要求：真实 OpenAI-compatible Provider 可用，设置和连接链路完整，聊天和上下文透明可用，Patch Proposal 保持用户确认写入，错误恢复路径明确，窄宽度下关键交互没有布局阻断。

当前没有发现阻断发布 V1 的 UI/UX 或逻辑问题。剩余问题属于产品打磨和无障碍专项增强，建议作为 V1.1 继续推进。
