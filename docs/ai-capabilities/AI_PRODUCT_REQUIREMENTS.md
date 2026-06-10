# Nolia AI 化需求文档

状态：草案  
日期：2026-06-09  
适用版本：Nolia AI 最终态产品规划

## 1. 背景

Nolia 当前是一款本地优先的 Markdown 知识工作台，已经具备工作区文件管理、Markdown 源码/所见即所得/分屏编辑、全文索引、反向链接、资源预览、插件机制、自动保存和历史快照能力。AI 化不应脱离这些基础能力另起一套聊天产品，而应成为“编辑、搜索、整理、理解工作区”的增强层。

本需求建议 Nolia 的 AI 定位为：

> 面向本地 Markdown 工作区的可控 AI 写作、问答与知识整理助手。

核心方向：

- 增强编辑、阅读、搜索、整理和附件理解，而不是另做一个孤立聊天框。
- 完整支持当前选区、当前文档、工作区问答、语义检索、批量整理和审核式 Agent。
- 所有涉及写文件的 AI 行为默认必须经过用户确认。
- 保持 provider-agnostic，同时支持用户自带密钥、本地模型和主流云模型。

## 2. 竞品启发

参考产品：

- Notion AI：强调工作区内联写作、工作区/连接器搜索、AI blocks、翻译、Agent，以及“变更可接受或丢弃”的编辑体验。Notion 还提供 AI 设置项，例如数据分享、Web Search 开关和外部请求确认。参考：[Notion AI FAQ](https://www.notion.com/help/notion-ai-faqs)。
- Craft Assistant：提供 Explore/Execute 两种模式，Explore 先提出更改并等待用户批准，Execute 直接执行；同时强调本地模型、最小必要数据发送和内容不用于训练。参考：[Craft AI Assistant](https://support.craft.do/en/ai-assistant)。
- Obsidian Copilot：围绕本地 vault 做聊天、命令、自定义 prompts、Vault QA、Projects 和 Composer；Agent 模式强调从 vault 中读取上下文，但所有写入默认先进入可审核变更。参考：[Copilot for Obsidian Docs](https://www.obsidiancopilot.com/en/docs)、[Copilot v4 Agent Mode](https://www.obsidiancopilot.com/en/v4)。
- Capacities AI：从笔记、反链、搜索和知识图谱中扩展上下文，强调 discovery、synthesis 和 clear boundaries。参考：[Capacities AI Assistant update](https://capacities.io/whats-new/release-59/)。

对 Nolia 的产品结论：

1. AI 入口必须贴近编辑器：选区、命令面板、右侧面板、工具栏。
2. 工作区问答必须带来源，不能只给无引用回答。
3. 本地优先产品必须把“发送了什么上下文”展示给用户。
4. AI 写入必须先预览，默认不能自动保存。
5. 支持用户自带密钥和本地模型是差异化能力，不应只绑定单一云模型。

## 3. 产品原则

### 3.1 本地优先

用户文档仍保存在本地工作区。AI 索引、缓存、会话、提示词模板等派生数据应存放在 `.nolia/` 下，且可删除重建。

### 3.2 用户可控

用户必须知道：

- 当前 AI 请求会发送哪些内容。
- 使用哪个 provider 和模型。
- 是否包含工作区搜索结果、反链、当前文档、选区或附件内容。
- AI 结果将以插入、替换、追加、复制、生成新文档或 diff 的哪种方式应用。

### 3.3 写入前确认

AI 修改文件必须默认走确认流程：

- 单点编辑：插入到光标、替换选区、追加到文末、复制到剪贴板。
- 文件级编辑：展示 Markdown diff 或文件变更计划，用户批准后写入。
- 批量整理：逐项展示创建、修改、重命名、删除建议，用户逐项确认。

### 3.4 Provider 无关

产品层不依赖单一厂商。底层通过统一 `AiProvider` 适配：

- OpenAI 或 OpenAI-compatible endpoint
- Ollama / 本地模型
- Anthropic
- Gemini
- 插件提供的 AI provider

### 3.5 来源可信

工作区问答、总结、相关笔记推荐必须尽可能展示来源文件、标题、行号或片段。没有足够证据时应明确说明“不确定”。

## 4. 用户画像与核心场景

### 4.1 个人知识库用户

目标：快速从大量笔记中找到答案、整理旧笔记、生成标签和双链。

关键场景：

- 询问“这个工作区里关于某个主题的结论是什么？”
- 让 AI 总结当前笔记并列出相关文档。
- 自动推荐缺失的 `[[双链]]`。

### 4.2 技术文档/项目文档用户

目标：让 AI 辅助写设计文档、整理 changelog、解释代码片段、归纳会议记录。

关键场景：

- 对选中文本执行“改成技术方案风格”。
- 从多篇项目文档生成实施步骤。
- 对当前文档生成摘要和待办。

### 4.3 写作者

目标：润色、改写、翻译、扩写、调整语气。

关键场景：

- 选中一段文本，要求“更简洁”“更正式”“翻译成英文”。
- 生成文章大纲或标题候选。
- 对全文生成摘要。

### 4.4 隐私敏感用户

目标：使用本地模型或自带密钥，不把整个工作区无感发送到云端。

关键场景：

- 设置 Ollama 本地模型。
- 在每次请求前查看上下文范围。
- 禁止 AI 读取工作区，只允许处理当前选区。

## 5. 最终产品范围

Nolia AI 的最终产品范围包含编辑、问答、检索、整理、附件理解和插件扩展，作为一个完整 AI 工作台交付。本文档定义最终可用产品，能力边界以完整体验为准。

### 5.1 AI 编辑助手

- AI 设置页：Provider、模型、API Key、Base URL、本地模型地址。
- 选区 AI 命令：总结、改写、润色、翻译、扩写、缩写、提取待办、生成标题、生成标签。
- 当前文档 AI 面板：提问、总结全文、生成大纲、列出待办。
- 流式输出。
- 应用结果：复制、插入到光标、替换选区、追加到文末。
- 请求前展示上下文范围。
- 默认不记录用户正文到日志。

### 5.2 工作区问答与引用

- 基于全文检索、向量检索、反链、标签和文件结构的混合召回。
- 回答时展示引用来源：文件、标题、行号、片段。
- 支持“只问当前文档”“问当前文件夹”“问整个工作区”。
- 支持从回答跳转到对应文件和标题。
- 支持“生成相关笔记列表”“推荐双链”“推荐标签”。

### 5.3 语义索引与知识整理

- `.nolia/` 下新增 AI chunk/embedding 索引。
- 支持本地 embedding 或云 embedding。
- 基于文件树、反链、标签、全文搜索和向量召回的混合检索。
- 支持重建 AI 索引、暂停索引、查看索引状态和索引错误。
- 支持相似文档发现、重复内容提示、主题聚类和相关笔记推荐。

### 5.4 审核式 Agent

- AI 生成文件变更计划：创建、修改、重命名、删除建议。
- Diff 审核界面，用户逐项批准。
- 批量整理工作区：补标签、补双链、拆分长文档、生成索引页、整理文件夹。
- 可选 trusted workflow，但默认关闭。
- 所有写入走现有 hash 冲突检测和历史快照。

### 5.5 附件与多模态理解

- PDF 文本提取和问答。
- 图片 OCR 和图片内容描述。
- 音频转写和会议纪要。
- 附件摘要写回 Markdown。

### 5.6 插件与自定义能力

- 插件可注册 AI provider。
- 插件可注册 AI action。
- 插件可注册 prompt 模板。
- AI 命令采用“预置命令 + 自定义命令 + 插件命令”的统一模式。
- 用户可复制预置命令并改造成自己的命令，也可从零创建自定义命令。
- 用户可选择命令是否显示在命令面板、编辑器工具栏、右键菜单或 AI 面板中。

## 6. 功能需求

### AI-FR-001 AI 设置

用户可以在设置中配置 AI：

- 开启/关闭 AI。
- Provider 类型：OpenAI-compatible、OpenAI、Ollama、本地、自定义。
- Base URL。
- API Key。
- 默认模型。
- 默认温度、最大输出长度。
- 是否允许发送当前文档。
- 是否允许发送工作区搜索片段。
- 联网搜索当前版本不支持；兼容字段可保留在底层类型中，但设置 UI 不展示入口。
- 是否允许记录本地会话历史。

验收标准：

- 未配置 provider 时，AI 入口可见但提示先配置。
- API Key 不明文存入 `global-state.json`。
- 切换 provider 后不影响已有工作区内容。

### AI-FR-002 上下文确认

每次 AI 请求需要有清晰的上下文标签：

- `选区`
- `当前文档`
- `当前文件夹`
- `工作区搜索结果`
- `反向链接`
- `附件内容`

首次使用涉及当前文档、工作区或附件的 AI 请求时，应弹出确认。用户可在设置中记住选择。当前版本不支持联网搜索，任何 `includeWebSearch` 请求都只返回“不支持”警告，不得进入上下文。

验收标准：

- 用户能在发送前看到“将发送的内容范围”。
- 用户可以取消发送。
- 如果用户禁用工作区上下文，AI 不得自动读取其他文件。

### AI-FR-003 选区 AI 命令

在源码模式和 WYSIWYG 模式中，用户选中文本后可以执行：

- 总结
- 改写
- 润色
- 翻译为中文/英文/日文/韩文
- 扩写
- 缩写
- 改为正式/简洁/技术文档风格
- 提取待办
- 解释这段内容

入口：

- 命令面板
- 编辑器工具栏 AI 按钮
- 右键菜单或浮动菜单

命令来源：

- 系统预置命令。
- 用户自定义命令。
- 插件注册命令。

验收标准：

- 无选区时命令可针对当前段落或当前文档执行，但必须标明范围。
- 生成结果可复制、替换选区、插入到光标、追加到文末。
- 替换选区前展示确认。
- 自定义命令与预置命令使用相同的上下文确认和结果应用流程。

### AI-FR-004 当前文档助手

右侧面板新增 AI 视图，支持围绕当前文档提问。

基础问题：

- 总结本文。
- 这篇文档有哪些待办？
- 根据本文生成标题候选。
- 根据本文生成标签。
- 根据本文生成大纲。
- 找出本文逻辑不清晰的地方。

验收标准：

- 回答不直接修改文档。
- 用户可以将回答插入当前文档。
- 如果当前文档未保存，AI 使用内存中的最新内容，而不是磁盘旧版本。

### AI-FR-005 工作区问答

用户可以在 AI 面板中选择“问工作区”。

流程：

1. 用户输入问题。
2. Nolia 使用现有全文索引检索候选文档。
3. Nolia 组装有限上下文发送给模型。
4. AI 返回答案和来源。
5. 用户点击来源跳转文档。

验收标准：

- 每个回答最多展示 3-8 个来源。
- 来源包含文件路径、标题或片段。
- 没有可靠来源时，回答必须提示“未在工作区找到明确依据”。
- 搜索结果不应包含 `.nolia/`、`node_modules/`、`.git` 等忽略路径。

### AI-FR-006 AI 结果应用

AI 结果支持以下操作：

- 复制
- 插入到光标
- 替换选区
- 追加到文末
- 新建文档
- 生成 diff 预览
- 应用多文件变更计划

验收标准：

- 替换和新建文档必须走现有文件写入流程。
- 工作区文件写入必须保留 hash 冲突检测和历史快照。
- 冲突时不能覆盖磁盘内容。

### AI-FR-007 AI 命令与提示词模板

AI 命令采用“预置 + 自定义”的模式。预置命令负责覆盖高频场景，自定义命令负责承载用户自己的写作、整理和项目工作流。

预置命令：

- 总结为三句话
- 生成会议纪要
- 提取行动项
- 改写为技术文档
- 翻译并保留 Markdown 格式
- 生成 README 草稿
- 生成发布说明
- 生成标签和双链建议

用户可以对预置命令执行：

- 启用或禁用。
- 调整排序。
- 复制为自定义命令。
- 查看命令使用的上下文范围、默认模型和默认应用方式。

用户可以创建自定义命令。自定义命令字段包括：

- 名称。
- 描述。
- 适用范围：选区、当前段落、当前文档、当前文件夹、工作区。
- Prompt 模板。
- 变量：`{{selection}}`、`{{currentParagraph}}`、`{{document}}`、`{{frontmatter}}`、`{{workspaceResults}}`、`{{language}}`。
- 默认上下文范围。
- 默认输出方式：回答、复制、插入、替换、追加、新建文档、生成 diff。
- 可选 provider/model 覆盖。
- 是否显示在命令面板、编辑器工具栏、右键菜单、AI 面板快捷入口。

存储策略：

- 全局自定义命令存储在全局设置中。
- 工作区自定义命令存储在 `.nolia/ai/commands.json`。
- 工作区命令可以覆盖同名全局命令，但覆盖关系必须在 UI 中可见。
- 插件命令由插件 manifest 或插件运行时注册，必须展示来源插件和权限。

验收标准：

- 预置命令不可被直接破坏，用户修改时生成副本。
- 自定义命令必须支持创建、编辑、删除、启用、禁用、排序。
- 自定义命令运行前必须展示上下文范围。
- 自定义命令如果会写入文档，必须进入与预置命令一致的确认流程。
- 插件命令必须显示插件来源，并受现有插件权限系统约束。
- 命令配置损坏时不影响预置命令可用性。

### AI-FR-008 用量与状态

AI 面板需要展示：

- 当前模型
- 请求状态
- 错误信息
- 估算 token 或字符数
- 本地模型/云模型标识

验收标准：

- 请求中可以取消。
- provider 错误应可读，例如 key 无效、余额不足、网络失败、模型不存在。
- 日志中不记录 prompt 正文和模型回答正文。

### AI-FR-009 插件扩展

AI 能力需要预留插件扩展点：

- 插件可注册 AI provider。
- 插件可注册 AI action。
- 插件可注册 prompt 模板。

验收标准：

- 插件 AI 能力沿用现有权限系统。
- 插件读取工作区内容必须具备 `workspace:file:read` 或更高权限。
- 插件发起网络请求必须具备 `network:request` 权限。

### AI-FR-010 语义索引

Nolia 需要为 Markdown、文本资源和可解析附件建立 AI 语义索引。

索引内容：

- Markdown 文档正文、标题、标签、双链、反链。
- 文本资源，包括 TXT、JSON、YAML、XML、HTML、代码文件。
- PDF 提取文本。
- 图片 OCR 文本。
- 音频转写文本。

验收标准：

- AI 索引数据保存在 `.nolia/` 下，可删除重建。
- 索引状态在 UI 中可见，包括待索引、索引中、完成、错误。
- 文件变更后增量更新对应 chunk 和 embedding。
- 用户可以关闭语义索引，仅保留全文检索能力。

### AI-FR-011 审核式 Agent

用户可以让 AI 对工作区执行多步骤整理任务，但所有变更必须进入审核队列。

支持任务：

- 为一组文档补标签。
- 为当前文档推荐并插入双链。
- 将长文档拆分为多篇笔记。
- 根据工作区内容生成索引页。
- 整理文件夹结构。
- 生成或更新 README、会议纪要、发布说明。

验收标准：

- Agent 输出文件变更计划，而不是直接写入。
- 变更计划展示创建、修改、重命名、删除的文件列表。
- 修改文件必须展示 Markdown diff。
- 用户可以逐项接受、拒绝或编辑。
- 应用变更时必须保留历史快照和 hash 冲突检测。

### AI-FR-012 附件理解

AI 需要理解工作区中的常见附件。

支持能力：

- PDF 文本提取、摘要和问答。
- 图片 OCR、图片内容描述、截图内容总结。
- 音频转写、摘要、待办提取。
- 将附件摘要写入当前 Markdown 或新建笔记。

验收标准：

- 附件内容必须作为独立上下文项展示。
- 附件解析失败时不影响原始文件。
- 大附件需要显示处理状态和取消入口。
- 用户可以选择不将附件内容发送到云端模型。

### AI-FR-013 联网搜索

当前版本不提供联网搜索能力。接口层可保留 `includeWebSearch`、`ai.webSearch` 等兼容字段，供未来扩展和旧调用安全降级，但产品 UI 不展示联网搜索开关、入口或来源。

验收标准：

- 设置页和 AI 面板不得出现“允许联网搜索”或“Web 搜索”入口。
- `includeWebSearch: true` 不产生 `web` 类型上下文项。
- `ai.webSearch` 兼容返回 `providerId: "disabled"` 和空结果。
- 用户可见警告使用“当前版本不支持联网搜索。”。

## 7. 体验设计

### 7.1 入口

建议新增三个入口：

1. 活动栏或右侧面板：AI 助手。
2. 编辑器工具栏：AI 按钮。
3. 命令面板：AI 命令。

### 7.2 AI 面板布局

AI 面板包含：

- 顶部模式切换：当前选区 / 当前文档 / 工作区。
- 中部对话区。
- 下方输入框。
- 上下文条：展示将发送的范围。
- 结果操作栏：复制、插入、替换、追加、新建文档。

### 7.3 首次使用流程

1. 用户点击 AI。
2. 如果未配置 provider，打开设置页 AI 区。
3. 用户选择 OpenAI-compatible 或 Ollama。
4. 测试连接。
5. 保存配置。
6. 返回 AI 面板执行请求。

### 7.4 写入确认流程

1. AI 生成结果或文件变更计划。
2. 用户选择应用方式：复制、插入、替换、追加、新建文档、应用 diff。
3. 单点编辑弹出确认，说明将影响的选区、光标位置或目标文件。
4. 文件级编辑展示 Markdown diff。
5. 多文件变更展示创建、修改、重命名、删除列表。
6. 用户逐项批准。
7. Nolia 按现有 `file.writeAtomic` 或编辑器自动保存链路写入。

## 8. 技术方案建议

### 8.1 总体结论

采用“自研轻量 AI 层 + provider SDK/API 适配”的方式，不把 LangChain/LlamaIndex/Mastra 作为主架构。

原因：

- Nolia 的核心复杂度在本地文件、Markdown、权限、上下文和写入确认，不在模型调用。
- 现有 IPC 和插件机制已经适合承载 AI 能力。
- 轻量抽象更容易支持本地模型和 OpenAI-compatible endpoint。

### 8.2 模块划分

新增建议：

```text
src/shared/ai.ts
src/main/services/aiService.ts
src/main/services/aiProviderService.ts
src/main/services/credentialService.ts
src/main/services/aiContextService.ts
src/renderer/app/aiTypes.ts
src/renderer/components/AiAssistantPanel.tsx
src/renderer/components/AiResultActions.tsx
```

修改建议：

```text
src/shared/channels.ts
src/shared/ipc.ts
src/preload/index.ts
src/main/ipc.ts
src/shared/constants.ts
src/shared/types.ts
src/shared/builtinExtensions.ts
src/renderer/App.tsx
src/renderer/app/store.ts
src/renderer/styles/global.css
```

### 8.3 AI Provider 接口

建议定义统一接口：

```ts
export interface AiProvider {
  id: string;
  label: string;
  listModels(): Promise<AiModel[]>;
  chat(request: AiChatRequest, signal?: AbortSignal): AsyncIterable<AiChatEvent>;
  embed?(request: AiEmbeddingRequest, signal?: AbortSignal): Promise<AiEmbeddingResponse>;
}
```

内置 provider：

- `openai-compatible`
- `ollama`
- `openai`
- `anthropic`
- `gemini`
- 插件 provider

### 8.4 IPC 设计

建议新增通道：

- `ai.settings.get`
- `ai.settings.set`
- `ai.provider.test`
- `ai.models.list`
- `ai.chat.start`
- `ai.chat.cancel`
- `ai.action.run`
- `ai.context.preview`
- `ai.commands.list`
- `ai.commands.create`
- `ai.commands.update`
- `ai.commands.delete`
- `ai.commands.reorder`
- `ai.commands.run`

流式输出可以采用：

- `ai.chat.start` 返回 `requestId`
- main process 通过 `webContents.send("ai.chat.delta", event)` 推送 token
- renderer 通过 `ai.chat.cancel` 取消

### 8.5 上下文构造

上下文来源：

- 当前选区
- 当前打开文档的 `sourceText`
- 当前文档解析结果：标题、目录、标签
- `WorkspaceDb.search()` 搜索结果
- `WorkspaceDb.getBacklinks()`
- 文件树路径和标题
- Markdown chunk
- embeddings
- 双链图谱
- 标签、最近文档、收藏文档
- 附件文本
- 网络搜索结果

上下文组装规则：

- 明确 token/字符预算。
- 优先当前选区，其次当前文档，再次工作区检索。
- 每个片段保留 `pathRel`、`title`、`startLine`、`endLine`。
- prompt 中要求模型引用来源 id。

### 8.6 写入链路

AI 不直接写磁盘。写入必须走 renderer 当前编辑器状态或 main 文件服务：

- 当前打开文档：更新 `sourceText` 或 WYSIWYG draft，再走现有自动保存。
- 资源/文件写入：走 `file.writeAtomic`。
- 批量变更：通过 diff 和变更计划审核后逐项写入。

### 8.7 密钥存储

建议新增 `CredentialService`：

- macOS/Windows/Linux 优先使用 Electron `safeStorage` 加密保存。
- 如果环境不支持安全加密，提示用户风险并允许只保存到会话。
- `global-state.json` 只保存 provider 配置和 key 引用，不保存明文 key。

### 8.8 日志策略

诊断日志只记录：

- provider id
- model id
- 请求状态
- 错误码
- token 估算
- 耗时

不得记录：

- API Key
- 用户 prompt 正文
- 文档正文
- 模型回答正文

## 9. 数据结构建议

### 9.1 全局 AI 设置

```ts
interface AiSettings {
  enabled: boolean;
  defaultProviderId?: string;
  defaultModel?: string;
  providers: Record<string, {
    type: "openai-compatible" | "ollama" | "openai" | "anthropic" | "gemini";
    label: string;
    baseUrl?: string;
    apiKeyRef?: string;
    defaultModel?: string;
  }>;
  privacy: {
    allowCurrentDocumentContext: boolean;
    allowWorkspaceContext: boolean;
    allowNetworkSearch: boolean;
    saveLocalConversationHistory: boolean;
  };
}
```

### 9.2 AI 请求上下文

```ts
interface AiContextItem {
  id: string;
  kind: "selection" | "document" | "search-result" | "backlink" | "attachment";
  pathRel?: string;
  title?: string;
  startLine?: number;
  endLine?: number;
  content: string;
}
```

### 9.3 AI 结果

```ts
interface AiGeneratedResult {
  requestId: string;
  text: string;
  citations?: Array<{
    contextItemId: string;
    pathRel?: string;
    line?: number;
  }>;
  proposedActions?: AiApplyAction[];
}
```

### 9.4 AI 命令

```ts
interface AiCommandDefinition {
  id: string;
  source: "builtin" | "user" | "workspace" | "plugin";
  pluginId?: string;
  name: string;
  description?: string;
  enabled: boolean;
  order: number;
  scopes: Array<"selection" | "paragraph" | "document" | "folder" | "workspace">;
  promptTemplate: string;
  variables: string[];
  defaultContext: {
    includeSelection?: boolean;
    includeCurrentParagraph?: boolean;
    includeCurrentDocument?: boolean;
    includeWorkspaceResults?: boolean;
    includeBacklinks?: boolean;
    includeAttachments?: boolean;
  };
  defaultApplyMode: "answer" | "copy" | "insert" | "replace" | "append" | "new-document" | "diff";
  providerOverride?: {
    providerId?: string;
    model?: string;
  };
  ui: {
    commandPalette: boolean;
    editorToolbar: boolean;
    contextMenu: boolean;
    aiPanel: boolean;
  };
}
```

## 10. 权限与隐私

默认策略：

- AI 默认关闭，用户主动配置后启用。
- 默认只处理选区或当前文档。
- 工作区上下文需要用户明确允许。
- 当前版本不支持联网搜索，任何联网搜索请求必须安全降级并提示不支持。
- 所有云 provider 均显示“内容会发送到第三方模型服务”。
- 本地模型显示“请求在本机模型服务处理”，但仍提示本地服务地址。

敏感边界：

- 不允许 AI 自动读取 `.nolia/`。
- 不允许读取工作区外文件，除非是用户直接打开的外部 Markdown 文件。
- 外部插件提供 AI 能力时必须明确权限。

## 11. 非功能需求

### 11.1 性能

- AI 面板打开不应阻塞主编辑器。
- 工作区问答检索应在 500ms 内返回候选片段，模型响应不计入该指标。
- 大文档上下文构造需要截断和提示。

### 11.2 稳定性

- provider 请求失败不影响编辑器内容。
- 取消请求后不应再向 UI 写入 token。
- 应处理网络断开、模型不可用、超时、key 无效。

### 11.3 可测试性

- AI provider 需要 mock 实现。
- Playwright E2E 不依赖真实模型。
- 单元测试覆盖上下文构造、隐私开关、provider 错误映射、结果应用。

## 12. 成功指标

- 用户首次配置 provider 并完成一次 AI 请求的路径不超过 2 分钟。
- 选区 AI 命令从点击到首 token 输出小于 2 秒，网络和模型性能除外。
- 100% 涉及工作区上下文的请求在 UI 中显示上下文范围。
- 100% AI 写入动作需要用户显式操作。
- AI 请求日志中不包含用户正文和 API Key。
- 工作区问答 90% 以上回答展示至少一个来源。
- 用户能从来源跳转到对应文件。
- 无来源回答明确提示证据不足。
- 语义索引可完整重建，重建后搜索和问答来源一致。
- Agent 生成的多文件变更 100% 进入审核队列。
- 附件理解失败不影响原始附件和当前编辑器状态。

## 13. 验收测试计划

### 13.1 单元测试

- AI settings 读写和默认值。
- CredentialService 不输出明文 key。
- AiContextService 在不同隐私开关下的上下文选择。
- FTS 检索结果转换为 context item。
- AI 结果应用到选区、光标、文末。
- provider 错误映射。
- AI command schema 校验、变量替换、启用禁用和排序。

### 13.2 E2E 测试

使用 mock AI provider：

- 未配置 provider 时点击 AI 显示配置引导。
- 配置 mock provider 后，选中文本执行总结。
- 流式输出可见。
- 替换选区前出现确认。
- 工作区问答展示来源并可跳转。
- 关闭工作区上下文后，问工作区按钮禁用或提示。
- 创建自定义命令后，该命令出现在命令面板并可执行。
- 复制预置命令生成自定义命令，原预置命令保持不变。

### 13.3 安全测试

- 日志中不出现 API Key。
- 日志中不出现 prompt 正文。
- AI 不读取 `.nolia/`。
- 禁用工作区上下文后，请求 payload 不包含其他文件内容。
- 插件无权限时不能注册或调用 AI 文件读取能力。

## 14. 研发实现模块

以下内容是完整产品所需的实现模块清单，所有模块都属于最终产品的一部分。

### 14.1 技术底座

- 定义 `src/shared/ai.ts`。
- 新增 IPC schema 和 preload API。
- 新增 `AiService`、provider registry、mock provider。
- 新增 AI command registry。
- 新增 AI 设置数据结构。
- 新增 CredentialService。

### 14.2 编辑器与当前文档 AI

- AI 设置页。
- AI 面板基础 UI。
- 选区 AI 命令。
- 预置命令管理和自定义命令编辑器。
- 当前文档总结和问答。
- 流式输出。
- 复制、插入、替换、追加。
- E2E mock 测试。

### 14.3 工作区问答与来源引用

- 基于 FTS、反链、标签和向量索引的混合召回。
- 来源引用展示。
- 来源跳转。
- 推荐相关笔记、标签、双链。

### 14.4 审核式变更

- AI 生成文件变更计划。
- Markdown diff 预览。
- 用户逐项批准。
- 写入历史快照和冲突处理。

### 14.5 语义索引、本地模型和附件理解

- chunk/embedding 表。
- 本地 embedding 支持。
- 混合检索。
- 可重建 AI 索引。
- PDF、图片 OCR、音频转写。
- 附件摘要写回 Markdown。

## 15. 开放问题

1. 内置 provider 是否包含 OpenAI、Anthropic、Gemini 的专用配置模板，还是全部通过 OpenAI-compatible 入口配置？
2. API Key 是否必须使用系统钥匙串，还是 Electron `safeStorage` 足够？
3. AI 面板放在右侧面板，还是新增活动栏主视图？
4. 选区 AI 是否需要浮动菜单，还是只接命令面板、右键菜单和工具栏？
5. 工作区问答是否允许读取未打开文件的全文，默认开关如何命名？
6. 本地会话历史是否默认保存？若保存，应放全局还是工作区？
7. 插件 AI provider 与内置 provider 的排序、权限展示和错误隔离如何设计？

## 16. 推荐结论

Nolia AI 最终产品应一次性按完整 AI 工作台定义：

1. 自研轻量 AI 基础层。
2. 内置 OpenAI-compatible、Ollama、OpenAI、Anthropic、Gemini 和插件 provider。
3. 同时覆盖编辑增强、当前文档问答、工作区问答、语义索引、附件理解和审核式 Agent。
4. 所有上下文透明展示。
5. 所有写入由用户显式触发。

这条路径能把 AI 变成 Nolia 的核心生产力能力，同时不破坏当前本地优先和 Markdown 源文件可控的核心价值。
