# Nolia AI Assistant V1 UI/UX 方案

## 设计目标

Nolia AI Assistant V1 的 UI 目标是让 AI 成为笔记工作台的一部分，而不是附加的聊天玩具。

用户应该能清楚回答三个问题：

1. AI 正在看什么？
2. AI 想做什么？
3. 我是否允许它写入？

V1 采用“一个 assistant，多入口”的产品形态：

- Chat Sidebar 处理复杂、多步、跨笔记问题。
- 选中文本快捷入口处理高频局部编辑。
- 命令面板处理键盘优先的快速任务。
- Patch Preview 负责所有写入确认。
- Context Inspector 负责透明展示发送给模型的上下文。

## 成熟产品启发

### Google Docs Gemini

可借鉴：

- 文档内 AI bottom bar 可切换到 side panel。
- 选中文本后提供 Rephrase、Shorten、Elaborate、Bulletize、Summarize。
- AI 修改以 suggestion 形式出现，用户 Accept/Reject。
- Sources 允许用户明确添加上下文。

对 Nolia 的启发：

- V1 采用侧边栏为主，后续可考虑底部 composer。
- 选中文本快捷动作必须保留。
- 写入需要用户确认。
- 上下文来源必须可见。

### Microsoft Word Copilot

可借鉴：

- 选中文本 rewrite 后给出候选。
- 用户选择 Replace、Insert below、Regenerate。
- 允许用户在建议框中进一步修改 AI 输出。

对 Nolia 的启发：

- AI 结果预览要能“替换、插入、重试、复制、取消”。
- 预览结果应允许用户继续追问“再短一点”“更正式”。

### Notion Agent

可借鉴：

- 当前页面和选中 block 是默认上下文。
- 可通过 `@` 添加页面、人员、source。
- Agent 权限继承用户权限。
- 写动作可要求先批准计划。
- 结果可以 undo。
- Chat 可在 sidebar/floating mode 切换。

对 Nolia 的启发：

- 当前笔记和选中文本是第一上下文。
- V1 先做来源 chips，V2 再做完整 `@` 引用选择器。
- 写入前确认是默认行为。
- 后续支持“批准计划”而不是一步到位执行。

### Evernote AI

可借鉴：

- AI Assistant 与 AI Edit 并存。
- Semantic Search 与笔记问答属于更高阶能力。
- 隐私控制和用户主动启用很重要。

对 Nolia 的启发：

- V1 同时做 Assistant 和选中文本 AI Edit。
- 先基于现有全文搜索，不急于 embedding。
- 设置和空状态要明确隐私边界。

### Tana AI

可借鉴：

- AI command nodes 可配置发送哪些数据、用哪个模型、输出到哪里。
- Prompt Workbench 可预览实际发送内容。

对 Nolia 的启发：

- V1 需要 Context Inspector，展示“将发送/已发送”的上下文类型和来源。
- V2 可以做用户自定义 AI commands。

## 信息架构

### 新增主入口

V1 推荐三个可见入口：

1. 右侧面板：`AI`。
2. 命令面板：`打开 AI Assistant`、`总结当前笔记`、`解释选中文本`、`润色选中文本`。
3. 选中文本浮动工具条或编辑器上下文菜单：`润色`、`总结`、`翻译`、`转待办`。

### 设置入口

设置弹窗新增 `AI` tab。

设置 tab 顺序建议：

```text
基础设置
AI
插件管理
```

原因：

- AI 是核心应用能力，不应藏在插件管理里。
- AI 与插件未来会有关联，但 V1 不是插件。

## AI 设置页

### 布局

设置页采用分组表单，不使用营销式介绍。

```text
AI
  [Enable AI] toggle

Provider
  Provider: [Ollama | OpenAI-compatible]
  Model:    [select/input]
  Base URL: [input]
  API mode: [native/chat-completions/responses]
  API key:  [password input] [Save] [Clear]
  [Test connection]

Context permissions
  [ ] Allow sending current note content
  [ ] Allow workspace search
  [ ] Allow reading search result notes
  [x] Require approval before writing changes

Status
  Provider connected / not connected
  Secret storage status
  Privacy note
```

### 默认状态

默认：

- AI disabled。
- Provider: Ollama。
- Base URL: `http://localhost:11434`。
- Model empty。
- 所有正文/工作区权限关闭。
- 写入确认固定开启。

### Provider 切换

#### Ollama

展示：

- `Base URL` 默认 `http://localhost:11434`。
- `Refresh models` 按钮。
- 如果 `/api/tags` 成功，model 用 select。
- 如果失败，显示“未连接到 Ollama，本地服务可能未启动”。
- API key 默认隐藏，仅当用户选择 ollama.com/cloud URL 时显示。

#### OpenAI-compatible

展示：

- `Base URL` 必填。
- `API key` 必填。
- `Model` 手动输入，后续可支持拉取 models。
- `API mode`：
  - `Chat Completions` 默认。
  - `Responses` 可选，提示“适合 OpenAI 或明确支持 Responses 的服务”。

### 隐私提示

提示文案建议：

```text
AI 默认不会读取或发送你的笔记内容。启用云端 provider 后，只有你发起 AI 请求并允许对应上下文时，Nolia 才会把相关内容发送给配置的服务。
```

Ollama 本地提示：

```text
本地 Ollama 请求发送到你的本机服务。模型、日志和性能取决于本地 Ollama 配置。
```

OpenAI-compatible 提示：

```text
此 provider 可能是云端服务。当前笔记、选中文本和搜索片段可能会发送到你配置的 Base URL。
```

## AI Sidebar

### 位置与尺寸

V1 使用右侧面板，不新开窗口。

推荐尺寸：

- 默认宽度：400px。
- 最小宽度：340px。
- 最大宽度：520px。
- 可拖拽调整宽度可作为 V1.1，不阻塞 V1。

### 顶部栏

```text
[Sparkles] Nolia AI
Current provider/model chip       [Settings] [Close]
```

状态 chips：

- `Ollama · llama3.2`
- `OpenAI-compatible · gpt-4.1`
- `Not configured`
- `Local`
- `Cloud`

如果 AI disabled，顶部显示：

```text
AI is off
[Open AI settings]
```

### Context Bar

顶部栏下方展示当前上下文 chips：

```text
[Current note: V1_REQUIREMENTS.md] [Selection: 248 chars] [Search: Off]
```

交互：

- 点击 chip 打开 Context Inspector。
- `Search: Off` 可以切换为 `Search: Ask first` 或 `Search: On`。
- 当没有 active document 时，显示 `No note selected`。

### Message Feed

消息类型：

- User message。
- Assistant message。
- Tool event。
- Source used。
- Patch proposal。
- Error。

Tool event 默认折叠：

```text
Searched notes for "AI runtime" · 5 results
```

展开后显示：

- query。
- result count。
- source paths。
- snippets 裁剪预览。

### Composer

底部输入区：

```text
[Ask Nolia AI...                                      ]
[Context] [Search notes] [Stop/Send]
```

按钮：

- Send：纸飞机图标。
- Stop：方形停止图标，运行中替代 Send。
- Context：打开 Context Inspector。
- Search notes：允许本次 run 使用 `searchNotes`。

快捷键：

- `Enter` 发送。
- `Shift+Enter` 换行。
- `Esc` 停止当前 run 或关闭浮层。

### Quick Prompts

空会话且有当前笔记时，显示紧凑 quick prompts：

- 总结当前笔记
- 提取行动项
- 改进结构
- 搜索相关笔记

这些是按钮，不是说明性大段文字。

## Context Inspector

Context Inspector 是 V1 的关键 UX，用来建立用户信任。

入口：

- AI Sidebar context chips。
- Composer `Context` 按钮。
- Patch Preview 的“查看上下文”。

展示内容：

```text
Context for this run

Included
  Current note metadata
    path: docs/ai-assistant-runtime/V1_REQUIREMENTS.md
    title: Nolia AI Assistant V1 需求规划
  Selection
    248 chars

Available but off
  Current note body
  Workspace search
  Read search result notes

Provider
  OpenAI-compatible
  Base URL: https://api.example.com
```

如果 run 已发送，展示“已发送”快照，不随当前编辑变化。

V1 不需要展示完整 prompt，但需要展示：

- 发送的上下文类型。
- 来源路径。
- 字符数量。
- 是否包含全文。
- provider base URL 域名。

V2 可做类似 Tana Prompt Workbench 的完整 prompt preview。

## 选中文本 AI 操作

### 触发方式

V1 推荐两个触发方式：

1. 编辑器内选中文本后显示浮动工具条。
2. 命令面板里执行“润色选中文本”等命令。

浮动工具条内容：

```text
[Sparkles] [润色] [总结] [翻译] [转待办] [...]
```

规则：

- 仅在选中文本长度 > 0 时显示。
- 选区超过上限时显示“选区过长，请缩小范围”。
- WYSIWYG 模式如无法安全替换，只允许生成预览、复制、插入下方。

### 内置动作

#### 润色

Instruction：

```text
润色选中文本，保持原意，保留 Markdown 结构，输出可直接替换的文本。
```

#### 总结

Instruction：

```text
总结选中文本，保留关键信息，用简洁中文输出。
```

#### 翻译

默认：

- 中文 -> 英文。
- 英文 -> 中文。
- 混合文本由模型判断主要目标语言。

#### 转待办

输出：

```markdown
- [ ] ...
- [ ] ...
```

## Patch Preview

### 形态

Patch Preview 放在 AI Sidebar 内，不弹大模态框。原因：

- 用户可以继续看原文。
- 不打断 AI 对话。
- 适合后续“继续调整这个提案”。

结构：

```text
Suggested change
润色选中文本，保持原意

[Diff preview]

[Replace selection] [Insert below] [Copy] [Regenerate] [Discard]
```

### Diff 展示

V1 使用简洁 diff：

- 删除内容红色淡背景。
- 新增内容绿色淡背景。
- Markdown 保持等宽字体。
- 长 diff 默认折叠中间部分。

### 操作

- Replace selection：仅当 range 可验证时可用。
- Insert below：source/split 和 WYSIWYG 都优先支持。
- Copy：始终可用。
- Regenerate：复用原 instruction 和上下文快照。
- Discard：关闭 proposal。

### 冲突状态

如果当前文档已变化：

```text
This suggestion was generated from an older version of the note.
[Copy result] [Regenerate] [Discard]
```

中文文案：

```text
这条建议基于旧版本笔记生成。当前内容已经变化，不能安全应用。
```

## 跨笔记问答体验

### 搜索触发

V1 不做隐式大范围搜索的强侵入体验。建议：

- 用户显式点击 `Search notes`。
- 或 prompt 明显包含“在我的笔记里找”“搜索工作区”“之前写过什么”时，agent 可调用 search，但前提是设置允许。

### 来源展示

回答末尾展示来源：

```text
Sources
1. docs/ai-assistant-runtime/V1_REQUIREMENTS.md
2. docs/architecture/CODEBASE_MAP.md
```

消息正文中也可以用小标记：

```text
根据 V1_REQUIREMENTS.md，V1 的重点是...
```

### 不足上下文

如果搜索不到：

```text
没有找到足够相关的笔记。我可以改用当前笔记继续回答，或你可以换一个关键词。
```

不要编造来源。

## 命令面板入口

新增命令：

- `ai.assistant.open`：打开 AI Assistant。
- `ai.currentNote.summarize`：总结当前笔记。
- `ai.selection.polish`：润色选中文本。
- `ai.selection.explain`：解释选中文本。
- `ai.selection.translate`：翻译选中文本。
- `ai.selection.todo`：转待办。

命令规则：

- 未配置 AI：执行后打开设置页。
- 无当前笔记：相关命令禁用或显示不可用。
- 无选区：selection 命令禁用或提示“先选择文本”。

## 空状态与错误状态

### AI 未启用

```text
AI is off
Enable AI and choose a provider before using Nolia AI.
[Open AI settings]
```

### Ollama 未连接

```text
Cannot reach Ollama at http://localhost:11434.
Start Ollama or change the base URL.
[Retry] [Open settings]
```

### API key 缺失

```text
API key is missing for OpenAI-compatible provider.
[Add API key]
```

### 当前权限不足

```text
Workspace search is disabled.
Enable workspace search for this run or change AI settings.
[Allow this run] [Open settings]
```

V1 可以先没有“Allow this run”的持久例外，按钮打开设置即可。

### Provider 错误

展示简短错误，不直接展示长 JSON：

```text
The provider rejected the request.
Details are available in diagnostics logs.
```

## 运行中状态

运行中必须可见：

- Composer send 按钮变 stop。
- Assistant message 显示流式光标。
- Tool events 显示 pending。
- 侧边栏关闭时不取消 run；重新打开仍能看到当前 run。
- 切换 workspace 时取消当前 run，避免上下文错位。

## 视觉设计

Nolia 是本地优先 Markdown 知识工作台，AI UI 应该安静、密集、可扫描。

原则：

- 不做大面积渐变和营销 hero。
- AI 入口使用 `Sparkles` 类图标即可。
- 面板背景沿用现有 sidebar/right panel。
- Patch diff 使用功能性色彩，不制造强装饰感。
- Cards 只用于消息、tool event、patch proposal，不做 card 嵌套 card。
- 字体、间距、圆角遵循现有 UI。

建议组件尺寸：

- Icon button：32px。
- Sidebar padding：12px。
- Message gap：10px。
- Patch proposal border radius：8px。
- Composer min height：44px，max height：140px。

## 可访问性

要求：

- 所有 icon button 有 `aria-label`。
- AI Sidebar 是 landmark 或 labelled section。
- Patch Preview 操作按钮可键盘访问。
- 流式输出不要每个 token 都打断 screen reader；可用 `aria-live="polite"` 在段落完成后更新。
- 错误状态使用明确文本，不只靠颜色。

## 国际化

V1 至少补齐中文和英文文案。

中文建议：

- `Nolia AI`
- `打开 AI Assistant`
- `润色选中文本`
- `总结当前笔记`
- `查看发送给 AI 的上下文`
- `替换选区`
- `插入到下方`
- `重新生成`
- `复制结果`
- `放弃`

英文建议：

- `Open AI Assistant`
- `Polish selection`
- `Summarize current note`
- `View context sent to AI`
- `Replace selection`
- `Insert below`
- `Regenerate`
- `Copy result`
- `Discard`

## V1 用户流程

### 流程 1：首次使用 Ollama

1. 用户打开 AI Sidebar。
2. 空状态提示 AI 未启用。
3. 用户进入设置，启用 AI。
4. Provider 默认 Ollama。
5. 点击 Refresh models。
6. 选择本地模型。
7. Test connection 成功。
8. 返回 sidebar，输入“总结当前笔记”。

### 流程 2：首次使用 OpenAI-compatible

1. 用户进入 AI 设置。
2. 选择 OpenAI-compatible。
3. 输入 Base URL、Model、API key。
4. 选择 API mode。
5. Test connection。
6. 打开权限：允许当前笔记正文。
7. 在 sidebar 中提问。

### 流程 3：润色选中文本

1. 用户选中一段 Markdown。
2. 浮动工具条出现。
3. 点击“润色”。
4. AI Sidebar 显示运行状态。
5. 返回 patch preview。
6. 用户点击 Replace selection。
7. 当前文档变 dirty。
8. autosave 或手动保存走现有保存流程。

### 流程 4：搜索工作区

1. 用户在 composer 输入“我之前关于插件权限写过什么？”。
2. 如果 workspace search 未开启，提示需要启用。
3. 启用后 agent 调用 `searchNotes`。
4. Tool event 显示搜索摘要。
5. 回答中显示来源路径。

### 流程 5：冲突处理

1. 用户生成 patch proposal。
2. 用户继续编辑原文。
3. 点击 Replace selection。
4. 系统检测 sourceSnapshotHash 不匹配。
5. 显示冲突状态。
6. 用户可 Copy 或 Regenerate。

## V1 不做的 UI

- 不做全屏 AI 首页。
- 不做营销式 onboarding。
- 不做多 agent 管理界面。
- 不做自定义 AI command builder。
- 不做完整 prompt workbench。
- 不做 embedding 索引管理。
- 不做批量修改计划视图。
- 不做插件 AI marketplace。

## V2 UI 预留

V1 组件需要为后续预留位置：

- `@` 上下文选择器。
- 自定义 AI actions。
- Agent plan approval。
- 多文件 patch review。
- 长任务进度。
- Context Workbench。
- Semantic Search 管理。
- 插件注册的 AI commands。
