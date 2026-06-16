# Nolia AI Assistant V1 需求规划

## 背景

市面上的文本类工具已经从单点 AI 功能演进到统一的 assistant/agent 形态。Notion、Google Docs Gemini、Microsoft Word Copilot、Evernote、Coda 和 Tana 的共同模式是：一边提供聊天侧边栏处理复杂任务，一边保留选中文本改写、总结、翻译、命令面板、AI block 或自动化列等高频入口。

这些产品的底层实现并不是把每个 AI 按钮做成孤立功能，而是共享同一套上下文、工具调用、权限控制和写入确认机制。Nolia V1 应采用相同方向：先建立可控的 AI Runtime，再在编辑器和侧边栏提供少量高价值入口。

## 市场参考

以下资料用于判断成熟文本工具的 AI 产品形态，仅作为 V1 需求取舍参考，不代表 Nolia V1 需要完整复刻这些能力。

- Google Docs Gemini：提供集中式 Gemini 写作体验，也保留选中文本后的 rephrase、shorten、elaborate、bulletize、summarize 等快捷编辑入口，并可引用其他文件作为上下文。参考：[Write & edit with Gemini in Docs](https://support.google.com/docs/answer/13447609?hl=en)。
- Microsoft Word Copilot：支持从空白文档起草、基于已有文件补充内容，也支持选中文本后的 rewrite，并由用户选择接受、插入或重试。参考：[Draft and add content with Copilot in Word](https://support.microsoft.com/en-au/office/draft-and-add-content-with-copilot-in-word-069c91f0-9e42-4c9a-bbce-fddf5d581541)、[Rewrite text with Copilot in Word](https://support.microsoft.com/en-us/office/rewrite-text-with-copilot-in-word-923d9763-f896-4da7-8a3f-5b12c3bfc475)。
- Notion Agent：默认读取当前页面上下文，选中 blocks 时优先聚焦选区，并可通过 `@` 添加页面、人员或其他来源。参考：[Notion Agent](https://www.notion.com/help/notion-agent)。
- Evernote AI：同时提供 AI Assistant、Semantic Search、AI Edit、AI Note Cleanup 等能力，说明笔记产品通常同时保留 assistant 与局部编辑入口。参考：[Evernote AI Features Overview](https://help.evernote.com/hc/en-us/articles/46594411188371-Evernote-s-AI-Features-Overview)、[Semantic Search](https://help.evernote.com/hc/en-us/articles/45706285591955-Semantic-search)。
- Coda AI：将 AI chat、AI assistant、AI column、AI block 组合在同一个文档产品中，说明 AI 可以同时作为侧边栏助手、内容生成器和结构化自动化能力。参考：[How to get started with Coda AI](https://coda.io/resources/guides/how-to-get-started-with-coda-ai)。
- Tana AI：AI command nodes 可配置输入数据、模型、prompt 和输出位置，并通过 Prompt Workbench 预览实际发送内容。参考：[AI command nodes](https://outliner.tana.inc/learn/features/ai-command-nodes)、[Tana AI](https://outliner.tana.inc/learn/features/tana-ai)。

## 产品定位

Nolia AI Assistant V1 是本地优先 Markdown 知识工作台中的受控写作与整理助手。

V1 的目标不是一次性完成完整知识库 agent，而是验证三件事：

1. AI 能理解当前笔记、选中文本和用户指令。
2. AI 能通过受控工具提出编辑建议，而不是直接覆盖用户内容。
3. Chat、选中文本菜单和命令入口能复用同一个 runtime。

## 设计原则

- 一个 AI Runtime，多个入口：Chat Sidebar、选中文本操作、命令面板都调用同一套运行时。
- main process 掌控模型调用、API key、工具执行和权限判断；renderer 只提交意图和展示结果。
- 写操作默认生成 proposal，由用户预览后确认。
- V1 优先用现有全文搜索能力，暂不引入复杂 embedding/RAG pipeline。
- 默认关闭 AI；用户明确启用并配置 provider 后才可使用。
- 云端模型和本地模型统一 provider 抽象，V1 必须支持 OpenAI-compatible 和 Ollama。
- 结果必须可取消、可重试、可复制；写入必须可追踪到用户确认。

## 目标用户与核心场景

### 写作整理用户

用户在编辑一篇 Markdown 笔记时，希望快速完成润色、压缩、扩写、翻译、摘要和待办提取。

### 知识管理用户

用户希望 AI 能基于当前笔记和工作区搜索结果回答问题，帮助定位相关笔记，但 V1 不承诺语义级知识库问答。

### 插件与高级用户

用户未来希望通过插件或命令扩展 AI 行为。V1 需要预留 runtime 和 tool registry 的边界，但不要求开放完整插件 API。

## V1 范围

### 1. AI 设置

必须提供一个设置区域，用于控制 AI 是否可用。

功能要求：

- 启用/关闭 AI。
- 选择 provider：OpenAI-compatible 或 Ollama。
- 配置 model。
- 配置 API base URL，支持 OpenAI-compatible endpoint。
- 配置 API key；Ollama 本地服务默认不需要 API key。
- 测试连接。
- 显示云端模型会发送内容到第三方服务的提示。

安全要求：

- API key 不暴露给 renderer。
- API key 不应明文进入普通 `global-state.json`。如果 V1 暂时无法接入系统钥匙串，必须在技术方案中标记为阻塞项或临时限制。
- 设置保存后，renderer 只能读取脱敏状态，例如是否已配置 key。

### 2. AI Chat Sidebar

提供一个右侧或侧边栏 AI 面板，用于处理当前工作区中的自然语言任务。

V1 必须支持：

- 打开/关闭 AI 面板。
- 输入用户消息。
- 流式显示模型回答。
- 取消正在运行的请求。
- 重试最近一次请求。
- 将回答复制到剪贴板。
- 在回答中展示模型使用过的上下文概览，例如当前笔记、选中文本、搜索结果。

上下文要求：

- 默认包含当前打开的笔记元信息：路径、标题、编辑模式。
- 当用户允许时，可包含当前笔记正文。
- 如果存在选中文本，优先把选中文本作为局部上下文。
- 用户可以在 prompt 中要求搜索工作区，runtime 通过 `searchNotes` 工具执行。

V1 不要求：

- 长期聊天历史跨重启保存。
- 多 agent 协作。
- 自动执行跨文件批量修改。
- 外部应用连接器。

### 3. 选中文本 AI 操作

在 Markdown 编辑场景中，用户选中一段文本后可以调用常用 AI 动作。

V1 内置动作：

- 润色：保持原意，提高表达清晰度。
- 总结：把选中文本压缩为简短摘要。
- 翻译：中文与英文之间翻译，保留 Markdown 结构。
- 转待办：提取可执行事项并生成 Markdown task list。

实现要求：

- 这些动作不应走独立 AI 逻辑，而是作为预设 instruction 调用同一个 AI Runtime。
- AI 返回结果后进入预览状态。
- 用户可以选择替换选区、插入到光标下方、复制或取消。

### 4. Patch Proposal 与写入确认

所有修改笔记内容的 AI 能力必须先生成写入提案。

提案至少包含：

- 目标 `workspaceId`。
- 目标 `pathRel`。
- 基准 `baseHash`。
- 操作类型：替换选区、光标插入、追加到文末、替换全文。
- 原文片段。
- 新文本。
- 简短说明。

验收要求：

- renderer 展示提案预览。
- 用户确认后，才调用现有 `file.writeAtomic` 或后续专用 apply patch IPC。
- 如果 `baseHash` 已变化，写入应返回冲突，不覆盖用户新内容。
- 确认写入时保留历史快照。

### 5. 当前笔记上下文工具

V1 Runtime 内置工具应控制在小集合。

必须实现：

- `getCurrentNoteContext`：读取当前笔记路径、标题、baseHash、正文或选中文本。
- `searchNotes`：使用现有 workspace FTS 搜索笔记，返回路径、标题和片段。
- `readNote`：读取指定 Markdown 笔记内容，受权限和数量限制。
- `proposePatch`：生成编辑提案，不直接写入。

可选实现：

- `listRecentNotes`：读取最近浏览或编辑的笔记。
- `listTags`：读取当前工作区标签。

V1 禁止：

- AI 直接删除、重命名或移动文件。
- AI 未确认创建大量文件。
- AI 读取工作区外文件。
- AI 访问插件私有数据。

### 6. 简单跨笔记问答

V1 支持基于现有搜索的跨笔记问答，但不承诺完整语义搜索。

功能要求：

- 用户在 Chat 中询问与工作区内容相关的问题时，AI 可以调用 `searchNotes`。
- 回答中应展示来源笔记路径。
- 如果搜索结果不足，应明确说明未找到足够上下文。

不做内容：

- embedding 索引。
- 本地向量数据库。
- 自动切片与重排。
- 外部知识库连接器。

## 非目标

V1 不做以下内容：

- 完整 autonomous agent。
- 多 agent 协作。
- 自动批量改写整个工作区。
- 日程、邮件、浏览器等外部工具连接。
- 图像生成、语音输入、会议转写。
- 企业级管理员策略。
- 插件直接注册 AI tool。
- 长期向量记忆。

这些能力可以作为 V2+ 方向，但不能阻塞 V1。

## Runtime 架构要求

Nolia 现有架构已经形成清晰边界：

- `src/main/` 负责本地服务、IPC handler、workspace、index、history、settings。
- `src/preload/` 通过 `window.nolia` 暴露受控 API。
- `src/renderer/` 负责 React UI、编辑器、设置、命令面板。
- `src/shared/ipc.ts` 使用 Zod 定义跨进程契约。

AI Runtime 应顺着此边界设计。

建议模块：

```text
src/main/ai/
  aiService.ts
  aiSessionService.ts
  aiSettingsService.ts
  providers/
    openAiCompatibleProvider.ts
    ollamaProvider.ts
  tools/
    toolRegistry.ts
    getCurrentNoteContext.ts
    searchNotes.ts
    readNote.ts
    proposePatch.ts
  context/
    buildAssistantContext.ts
  security/
    aiPermissionService.ts
    secretService.ts

src/shared/ai.ts
src/shared/ipc.ts
src/shared/channels.ts

src/renderer/ai/
  AiSidebar.tsx
  AiPatchPreview.tsx
  aiActions.ts
```

V1 可先不完全按目录拆分，但接口边界必须按以上职责设计，避免把 AI 逻辑塞进 `App.tsx`。

## Agent Engine 策略

V1 推荐采用轻量 engine，而不是引入重型 agent 框架作为核心。

建议：

- 模型调用可使用官方 SDK、OpenAI-compatible HTTP client 或轻量 AI SDK。
- Tool registry、权限、上下文构建、patch proposal 由 Nolia 自己实现。
- 预留 `AgentEngine` 适配接口，后续可接入 Mastra、LangGraph.js 等引擎。

接口方向：

```ts
interface AgentEngine {
  run(input: AgentRunInput): AsyncIterable<AgentEvent>;
}
```

这样 V1 可以快速交付，未来也能替换底层 agent engine。

## IPC 与事件要求

V1 至少需要支持：

- 获取 AI 设置脱敏状态。
- 更新 AI 设置。
- 测试 provider 连接。
- 启动一次 AI run。
- 取消一次 AI run。
- 获取或接收流式事件。
- 应用 patch proposal。

事件类型方向：

```ts
type AiStreamEvent =
  | { type: "text-delta"; runId: string; text: string }
  | { type: "tool-call"; runId: string; toolName: string }
  | { type: "tool-result"; runId: string; toolName: string; summary: string }
  | { type: "patch-proposal"; runId: string; proposal: AiPatchProposal }
  | { type: "done"; runId: string }
  | { type: "error"; runId: string; message: string };
```

具体 schema 必须定义在 `src/shared/ipc.ts` 或新的 shared AI contract 中，并由 main process 校验。

## UI 入口

V1 推荐三个入口，按优先级交付：

1. AI Sidebar：主入口，用于聊天、总结当前笔记、搜索工作区。
2. 选中文本菜单：润色、总结、翻译、转待办。
3. 命令面板：打开 AI、总结当前笔记、解释选中文本。

UI 要求：

- AI 面板是工作界面，不做营销式欢迎页。
- 回答区域支持流式更新和运行状态。
- 写入提案与普通回答视觉区分。
- 错误状态需要可理解，例如未配置 key、网络失败、provider 返回错误、上下文过长。

## 隐私与权限

V1 必须明确以下规则：

- 默认不启用 AI。
- 未启用时，不发起任何模型请求。
- 云端 provider 请求前，需要用户完成设置并理解内容会发送到第三方服务。
- AI 工具只能访问当前 workspace 内的 Markdown 内容和现有索引。
- 读取整篇当前笔记、搜索工作区、读取搜索命中的笔记应作为独立权限开关或至少在设置中明确说明。
- 写操作必须由用户确认。
- 日志中不得记录 API key 或完整 prompt 内容。诊断日志只能记录 runId、provider、错误类型和脱敏摘要。

## 成功指标

V1 完成后应满足：

- 用户能在 3 分钟内配置 provider 并完成一次 AI 回答。
- 用户能对选中文本执行润色，并安全地替换选区。
- 用户能要求 AI 总结当前笔记。
- 用户能让 AI 搜索当前工作区，并在回答中看到来源路径。
- 用户取消请求后，UI 不再追加流式内容。
- 未确认的 AI 修改不会落盘。
- API key 不会出现在 renderer 可读取的状态中。

## 里程碑

### M0：技术准备

- 定义 shared AI 类型、IPC channel 和 Zod schema。
- 增加 AI 设置模型和脱敏读取接口。
- 确定 API key 存储方案。

### M1：Provider 与基础 Runtime

- 实现 OpenAI-compatible provider。
- 实现 Ollama provider。
- 实现 AI run、流式事件和取消。
- 实现最小 Chat Sidebar。

### M2：上下文与工具

- 实现当前笔记上下文。
- 实现 `searchNotes` 和 `readNote`。
- 在 Chat 中显示工具调用摘要和来源。

### M3：编辑提案

- 实现 `proposePatch`。
- 实现 Patch Preview。
- 支持替换选区、插入到光标、复制。
- 确认写入走现有原子写入和历史快照。

### M4：快捷入口

- 增加选中文本 AI 操作。
- 增加命令面板入口。
- 补齐错误、空状态和未配置状态。

### M5：验证与文档

- 补充单元测试和关键 e2e。
- 更新用户手册和隐私声明。
- 记录 provider 配置和故障排查。

## 测试要求

单元测试：

- AI 设置 schema。
- provider 请求构造和错误映射。
- tool registry 权限校验。
- patch proposal 冲突判断。
- 搜索工具不会越权读取 workspace 外路径。

E2E 测试：

- 未配置 AI 时，入口显示配置引导。
- 配置 mock provider 后，Chat 能收到流式回答。
- 选中文本润色生成预览，确认后写入文档。
- 取消请求后停止输出。
- 搜索工作区回答展示来源路径。

手工 QA：

- 网络失败。
- provider 返回限流。
- 当前笔记很长。
- 用户在 AI 生成期间继续编辑导致 baseHash 冲突。
- 切换 workspace 后旧 run 不应写入新 workspace。

## 风险与约束

- Electron 打包：新增 SDK 或 secret storage 依赖可能引入 native module，需要优先验证 macOS、Windows、Linux 打包。
- 隐私合规：如果使用云端 provider，需要更新隐私声明。
- 上下文过长：V1 需要简单裁剪策略，优先保留选中文本、标题、当前段落和搜索片段。
- `App.tsx` 已较大：AI UI 应尽量放入新模块，避免继续扩大主组件。
- API key 存储是安全基线，不能长期使用普通设置文件明文存储。

## 后续版本方向

- Embedding 与语义搜索。
- 更多本地模型 provider。
- 插件 AI API。
- 用户自定义 AI commands。
- 跨笔记批量整理。
- 可恢复的长任务 agent。
- 外部工具连接器或 MCP。
