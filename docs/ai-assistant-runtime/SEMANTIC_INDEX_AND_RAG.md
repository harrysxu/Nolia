# Semantic Index and RAG Design

更新日期：2026-06-16

本文记录 Nolia AI 的语义索引、RAG 和全文检索策略。当前实现是人工配置 embedding、手动创建/更新索引，并在不可用时降级全文检索。

## 设计原则

1. 文件是唯一真相。
   - Markdown 和文本文件内容是 source of truth。
   - FTS、metadata、semantic chunks、embeddings 都是派生缓存。

2. RAG 只用于召回，不直接作为事实来源。
   - embedding chunk 可能过期、截断或召回错误。
   - Agent 回答前必须读取实际文件摘录做验证。

3. 全文检索不能被替代。
   - 精确路径、标题、标签、代码、配置项、术语搜索更适合全文检索。
   - 语义检索用于自然语言意图、模糊问题和跨文档总结。

4. 索引更新由用户控制。
   - 当前不自动创建语义索引。
   - 用户必须配置 embedding 模型并手动更新或清空重建。

5. 不可用时降级，而不是失败。
   - embedding 未配置、索引未创建、索引 stale、embedding 调用失败时使用全文检索。
   - 降级原因应出现在 tool result 中。

## 当前能力

### 设置项

AI 设置页包含 `语义索引` 区域：

- `启用语义检索`
- `Embedding 服务商`
- `Embedding 地址`
- `Embedding 模型`
- `Embedding API key`，仅 OpenAI-compatible 显示
- `测试 embedding`
- `更新语义索引`
- `清空并重建`
- `刷新状态`
- 文件数、分块数、过期数、进度和错误状态

### 支持 Provider

Embedding 支持：

- OpenAI-compatible embeddings endpoint。
- Ollama native embedding endpoint。

注意：

- 聊天模型不等于 embedding 模型。
- Ollama 需要模型和服务端明确支持 embeddings。
- 本地 `qwen3.5:latest` 已验证可用于聊天，但不能假定支持 embeddings。

### 存储

语义索引存储在 workspace SQLite：

- `workspace_settings`
  - 保存 `ai.semanticIndex` 元数据。
- `semantic_chunks`
  - 保存 path/file/chunk/provider/model/dimension/embedding JSON。

每个 chunk 包含：

- `pathRel`
- `title`
- `fileSha256`
- `chunkIndex`
- `chunkHash`
- `content`
- `embedding`
- `providerId`
- `model`
- `dimension`
- `updatedAt`

### Chunk 策略

当前策略：

- 目标 chunk 大小约 1400 字符。
- overlap 约 180 字符。
- 按段落优先切分。
- 超大段落按字符窗口切分。
- embedding batch size 为 12。

这些参数在 `src/main/services/semanticIndexService.ts`。

## 当前检索流程

工具：`searchNotes`

执行顺序：

1. 读取当前 workspace runtime。
2. 读取 embedding settings。
3. 查询 semantic index status。
4. 如果状态是 `ready`：
   - 为 query 调用 embedding。
   - 从 `semantic_chunks` 做 cosine similarity。
   - 如果有结果，返回 `mode: semantic`。
5. 如果 semantic 不可用或无可用结果：
   - 调用现有全文检索。
   - 返回 `mode: full-text` 和 `fallbackReason`。

返回结果只包含标题、路径和片段。工具描述要求模型：

- 搜索结果只是召回提示。
- 需要事实回答时必须继续调用 `readNote` 读取相关命中文档。

## 状态语义

`AiSemanticIndexState`：

- `not_configured`
  - 未启用 embedding 或没有模型。
- `not_created`
  - 已配置但还没有创建索引。
- `ready`
  - 当前 provider/model 下索引可用。
- `updating`
  - 正在更新。
- `stale`
  - 已有索引，但文件或 provider/model 状态不一致。
- `failed`
  - 上次创建/更新失败。

当前 UI 已展示状态和错误。后续应继续加强 stale 的精确判定。

## 回答前的数据校验

推荐规则：

1. 当前打开文档
   - 使用 renderer 传入的实时 `sourceText`。
   - 不依赖 FTS 或 semantic index。

2. 搜索结果
   - 先用 `searchNotes` 召回。
   - 再用 `readNote` 读取命中文档摘录。
   - 回答中引用 path。

3. 整个工作区问题
   - 如果允许 workspace read，可以用 `listWorkspaceFiles` / `readWorkspaceFile` / `workspace_read_many_files` 获取实际内容。
   - 不要只根据 semantic snippets 下结论。

4. 过期索引
   - 如果 semantic 状态不是 ready，直接全文检索。
   - 如果 semantic ready 但召回后文件 hash 不一致，后续应丢弃旧 chunk 并读取最新文件。

## Hybrid Retrieval 建议

当前实现是 semantic ready 优先，失败后 full-text fallback。后续建议升级为 Hybrid Retrieval：

1. BM25/FTS 召回 top N。
2. Semantic 召回 top N。
3. 合并去重。
4. 根据以下因素 rerank：
   - 关键词命中。
   - embedding similarity。
   - 文件标题和路径匹配。
   - 最近修改时间。
   - 当前打开/最近打开文件加权。
5. top K 再读取实际文件摘录。
6. 模型基于摘录回答并列出来源。

适用策略：

- 精确查询：FTS 权重更高。
- 开放总结：semantic 权重更高。
- 当前文档：直接读取当前文档。
- 代码/配置/命令：FTS 或直接读文件优先。

## 手动重建设计

当前已有：

- `更新语义索引`
- `清空并重建`

建议继续拆分为：

### 更新索引

行为：

- 不删除所有 chunks。
- 对每个文档检查 `fileSha256`。
- 未变化文件复用旧 chunks。
- 变化文件重新切 chunk 和 embedding。

适合：

- 用户日常手动刷新。
- 少量文件变化。

### 清空并重建

行为：

- 删除当前 provider/model 对应 semantic chunks。
- 重新扫描所有可索引 Markdown 文档。
- 重新生成所有 embeddings。

适合：

- embedding 模型变更。
- chunk 策略变更。
- 索引损坏。
- 用户怀疑召回错误。

## 修改后的索引一致性

当前要求是人工控制，不自动创建/更新 semantic index。推荐策略：

1. 文件保存后，FTS 和文档 metadata 继续按现有机制更新。
2. Semantic index 不强制自动更新。
3. UI 应显示语义索引可能 stale。
4. AI 查询时如果 semantic 不 ready 或 stale，降级全文检索。
5. 用户可点击更新或清空重建。

后续可做增量自动标记：

- 保存文档时记录 semantic stale path。
- 不自动调用 embedding。
- 只提示用户索引过期。

## 错误处理

必须明确显示：

- 缺 embedding 模型。
- API key 缺失。
- provider unreachable。
- provider auth failed。
- Ollama 不支持 embeddings。
- embedding 接口返回无效向量。
- semantic index failed。

不应出现：

- 点击按钮无反应。
- 请求超时但输入框一直锁住。
- 只在日志里报错，UI 不显示。

## 测试覆盖

单元测试：

- `tests/semanticIndexService.test.ts`
  - 手动创建 semantic chunks。
  - 更新时复用未变化文件。
  - 未配置 embedding 时不创建索引。
- `tests/aiRuntime.test.ts`
  - `searchNotes` 在 semantic 未配置时 fallback 到全文检索。

E2E：

- `AI settings configures semantic index manually`
  - 打开设置。
  - 启用语义检索。
  - 填写 embedding 模型。
  - 测试 embedding。
  - 更新索引。
  - 状态变为可用。

## 提交前检查

如果改动语义索引/RAG，至少运行：

```sh
npm run typecheck
npm test
npx playwright test tests/e2e/ai-assistant.spec.ts -g "semantic index"
```

涉及 UI 或 IPC 时再运行：

```sh
npm run lint
npm run e2e
npm run build
```
