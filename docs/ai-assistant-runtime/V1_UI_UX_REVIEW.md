# Nolia AI V1 UI/UX Review

日期：2026-06-13

复测状态：本文件记录的是第一次用户视角走查发现的问题。后续优化和真实 OpenAI-compatible Provider 综合测试见 [V1 综合测试报告](V1_COMPREHENSIVE_TEST_REPORT.md)。截至 2026-06-13，本文中的状态冲突、窄宽 Patch Proposal、diff/影响范围、错误恢复、设置页分组、来源 chips、composer 上下文反馈等核心问题已经完成复测并通过自动化回归。

测试方式：以普通用户视角创建全新工作区，依次试用 AI 入口、禁用态、设置页、聊天、来源展示、选中文本入口、Patch Proposal、错误态、窄屏与移动宽度布局，并使用 Computer Use 读取真实 Electron 窗口和可访问性树。

测试工作区：

- `/tmp/nolia-ai-ux-review-20260613014946/workspace`

截图目录：

- `/tmp/nolia-ai-ux-review-20260613014946/artifacts`

## 总体判断

当前 AI 功能已经具备 V1 的核心骨架：右侧 Assistant、Provider 设置、上下文提示、消息流、来源、Patch Proposal、确认写入、错误卡片都已经串起来了。问题主要不在“能不能用”，而在“用户是否能放心、清楚、高效地用”。

从使用者角度看，当前体验偏工程化，缺少三个层面的产品化打磨：

1. 状态一致性：AI 是否启用、当前是否可发送、当前 proposal 是否仍有效，这些状态现在会出现冲突。
2. 安全感：Patch Proposal 是 Nolia AI 最重要的差异点，但当前只展示结果，不展示差异和影响范围。
3. 操作引导：错误、空态、权限、Provider 配置都缺少明确下一步。

## P0 / 必须修复

### 1. AI 状态显示与实际内容冲突

现象：

- 在已出现 assistant 回答、来源和 patch proposal 后，AI header 仍显示 `AI 未启用`。
- 禁用态空态仍和历史消息、错误、proposal 同屏出现。
- composer 被禁用，但底部仍显示 `复制` / `重试` 按钮，用户会误解哪些操作可用。

影响：

- 用户无法判断 AI 当前是否真的可用。
- 如果出现 patch proposal 时仍显示“未启用”，会削弱写入确认的可信度。

建议：

- AI sidebar 的顶部状态应只来自最新 `aiSettings`，避免旧状态残留。
- 禁用 AI 时，将聊天区分为两种状态：
  - 无历史：显示配置引导。
  - 有历史：显示历史只读，并在 composer 区显示“AI 已禁用，重新启用后可继续”。
- 当 `settings.enabled === false` 时，隐藏或禁用 `重试`，并解释原因。

参考截图：

- `05-ai-chat-with-source.png`
- `07-patch-proposal.png`
- `10-mobile-width-ai-sidebar.png`

### 2. 移动/窄宽下 Patch Proposal 操作按钮不可完整访问

现象：

- 390px 宽度下，Patch Proposal 内容可见，但底部操作按钮区域被截断，`替换 / 插入 / 追加 / 复制结果 / 重新生成 / 放弃` 不能完整显示。
- 右侧浮层宽度接近满屏，但内部卡片没有为 action bar 做响应式换行和 sticky footer。

影响：

- 用户在小窗口或窄侧边栏中无法安全完成 proposal review。
- 这会直接影响“写入前确认”的核心承诺。

建议：

- Patch action bar 在窄宽下改为两行或垂直分组：
  - 主操作：`替换`
  - 次操作：`插入`、`追加`
  - 辅助操作：`复制结果`、`重新生成`、`放弃`
- action bar 固定在 proposal 卡片底部可见区域，proposal 内容内部滚动。
- 小宽度下按钮文案可以缩短为 `替换`、`插入`、`追加`、`复制`、`重试`、`放弃`，但需要 tooltip 或 aria-label 保留完整含义。

参考截图：

- `10-mobile-width-ai-sidebar.png`

## P1 / 高优先级

### 3. Patch Proposal 缺少 diff 视图和影响范围说明

现象：

- 当前 proposal 只显示 `afterText`。
- 用户看不到将删除哪些内容、保留哪些内容、插入位置在哪里。
- `替换`、`插入`、`追加` 的差异不够明确。

影响：

- 用户需要手动对照编辑器内容，成本高。
- 对长文档或局部修改，误操作风险明显。

建议：

- Patch Proposal 默认展示 diff：
  - 删除内容用轻量红色背景。
  - 新增内容用轻量绿色背景。
  - unchanged 内容弱化或折叠。
- 卡片头部展示影响范围：
  - `目标：projects/patch-target.md`
  - `操作：替换全文 / 替换选区 / 插入到第 N 行 / 追加到末尾`
  - `基于版本：未保存更改 / 已保存版本`
- `替换` 按钮文案根据 proposal 类型变化：
  - `替换全文`
  - `替换选区`
  - `应用修改`

参考截图：

- `07-patch-proposal.png`
- `08-error-with-patch.png`

### 4. 错误态不可行动

现象：

- 错误卡片只显示 `Provider unreachable: check Base URL or network.`。
- 没有直接入口去修复 Base URL、切换 Provider 或重试。
- 错误和当前 patch proposal 混在一起，用户不清楚错误是否影响 proposal 的有效性。

影响：

- 用户需要猜测下一步。
- 错误出现后，当前 AI 会话是否还能继续不明确。

建议：

- 错误卡片增加 action：
  - `打开 AI 设置`
  - `重试`
  - `切换到 Ollama`
  - `复制错误`
- 错误卡片增加上下文：
  - provider、model、base URL host，不展示 secret。
  - 是否 retryable。
- 如果错误发生在 proposal 生成之后，明确提示：
  - `当前建议修改仍可查看，但重新生成失败。`

参考截图：

- `08-error-with-patch.png`

### 5. AI 设置页缺少分步结构和权限解释

现象：

- Provider、模型、Base URL、API mode、API key、按钮、权限开关都挤在同一屏。
- Ollama 本地模式仍显示 API key 的保存/清除按钮，增加认知噪声。
- 权限开关只有名称，没有解释“发送给谁、发送什么、何时发送”。

影响：

- 新用户第一次配置容易困惑。
- 对云端 Provider 的数据发送边界不够透明。

建议：

- 设置页改为三个区块：
  - Provider：Provider、Base URL、API mode、API key。
  - Model：模型输入/模型列表刷新/连接测试。
  - Context & Safety：当前笔记、workspace search、读取搜索结果、写入确认。
- Ollama 本地模式隐藏 API key 行，或显示只读说明。
- 每个权限开关增加短说明：
  - `允许发送当前笔记正文：仅在当前会话需要上下文时发送给所选 Provider。`
  - `允许搜索工作区：AI 可请求本地搜索，搜索结果片段可能发送给 Provider。`
  - `允许读取搜索结果笔记：AI 可读取搜索命中的笔记片段。`
- `测试连接` 的结果应显示在按钮附近，而不是和其他提示混在一起。

参考截图：

- `03-ai-settings-default.png`

## P2 / 中优先级

### 6. 禁用态空态过大，下一步不够聚焦

现象：

- 禁用态有一个很大的虚线空白区域。
- 主要按钮在中下部，用户视线容易散。

建议：

- 空态改为紧凑配置向导：
  - 标题：`启用 Nolia AI`
  - 说明：`选择本地 Ollama 或 OpenAI-compatible Provider。`
  - 两个快捷按钮：`使用 Ollama`、`配置 OpenAI-compatible`
  - 次要链接：`了解会发送哪些内容`

参考截图：

- `02-ai-disabled-empty-state.png`

### 7. 来源展示太弱

现象：

- 来源只显示 `ai-main.md`。
- 不能点击跳转，无法看到 snippet，也不知道是 current note、selection 还是 search result。

建议：

- 来源以 chips/list 显示类型：
  - `当前笔记 · ai-main.md`
  - `选区 · 28 字符`
  - `搜索结果 · search-target.md`
- 支持点击打开对应笔记。
- hover 或展开显示 snippet。

参考截图：

- `05-ai-chat-with-source.png`

### 8. Composer 区域缺少上下文反馈

现象：

- placeholder 只有 `询问 Nolia AI...`。
- 用户不知道本次会带哪些上下文、是否能搜索、是否会读取笔记。

建议：

- composer 上方或 footer 显示简洁上下文状态：
  - `将发送：当前笔记 · 选区 · 搜索片段`
  - 禁用项灰显：`未启用：读取搜索结果`
- 发送按钮旁增加小 shield/lock 图标，强调写入只会生成 proposal。

## P3 / 打磨项

### 9. 中英文混排不统一

现象：

- 中文 UI 中出现 `Provider`、`Base URL`、`API mode`、`Patch Target` 等英文。
- 部分 AI 结果是英文，卡片头是中文，整体可接受但不够统一。

建议：

- 产品术语保留英文可以，但标签建议中文 + 英文辅助：
  - `服务提供方 Provider`
  - `接口地址 Base URL`
  - `接口模式 API mode`

### 10. AI sidebar 视觉层级偏卡片堆叠

现象：

- 消息、错误、来源、proposal 都是相近边框卡片，层级差异主要靠颜色。
- proposal 卡片在视觉上足够明显，但普通消息和来源占据过多纵向空间。

建议：

- 普通 assistant 消息使用更轻的容器。
- 来源列表可折叠到消息底部。
- proposal 保持强容器，因为它代表潜在写入。

## 建议的 V1.1 改进顺序

1. 修复 AI enabled 状态同步和禁用态历史消息逻辑。
2. 修复窄宽 Patch Proposal action bar。
3. Patch Proposal 增加 diff/影响范围/更明确按钮文案。
4. 错误卡片增加行动按钮。
5. 重构 AI 设置页为 Provider / Model / Context & Safety 三段。
6. 来源展示增强为可点击、可解释的 source chips。

## 本次测试截图索引

- `01-workspace-before-ai.png`：打开工作区但未打开 AI。
- `02-ai-disabled-empty-state.png`：AI 禁用态。
- `03-ai-settings-default.png`：默认 AI 设置。
- `04-ai-enabled-empty-chat.png`：启用后空聊天。
- `05-ai-chat-with-source.png`：消息和来源。
- `06-command-palette-selection-action.png`：命令面板选区入口。
- `07-patch-proposal.png`：Patch Proposal。
- `08-error-with-patch.png`：错误与 proposal 同屏。
- `09-narrow-ai-sidebar.png`：窄屏布局。
- `10-mobile-width-ai-sidebar.png`：移动宽度布局。
