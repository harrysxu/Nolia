# Nolia AI Test Handoff

更新日期：2026-06-16

本文用于换位置继续测试。它记录如何启动开发环境、配置模型、验证 AI 设置页、验证 Ollama、运行自动化测试和检查日志。

## 目标

后续测试需要确认：

- AI 设置页不会因为旧配置缺字段而白屏。
- Provider、模型、API key、Ollama、本地权限、工作区读取和写入 proposal 可用。
- 出错时必须显示明确错误，不允许无响应或静默失败。
- 语义索引可以手动配置、更新和降级。
- 所有 AI 写入必须能确认、记录历史和撤销。

## 开发环境启动

建议使用独立 userData，避免污染真实用户配置：

```sh
NOLIA_DISABLE_SINGLE_INSTANCE_LOCK=1 \
NOLIA_USER_DATA_DIR=/tmp/nolia-ai-sdk-userdata \
npm run dev > /tmp/nolia-ai-sdk-dev.log 2>&1
```

开发窗口来自当前仓库的 Electron runtime：

```text
./node_modules/electron/dist/Electron.app
```

注意机器上可能同时有旧安装包。做 UI 验证时必须确认操作的是开发版 Electron，而不是历史安装的 Nolia.app。

## 推荐测试模型

### Ollama 聊天

已验证可用：

```text
qwen3.5:latest
```

推荐设置：

```text
Provider: Ollama
API mode: Chat Completions
Base URL: http://localhost:11434/v1
Model: qwen3.5:latest
API key: 不需要
```

基础检查：

```sh
ollama list
curl http://localhost:11434/v1/models
```

### Ollama embedding

不要默认把 `qwen3.5:latest` 当 embedding 模型。此前本机返回过：

```text
This server does not support embeddings. Start it with --embeddings
```

如果要测试语义索引，需要配置明确支持 embedding 的模型或启动支持 embeddings 的 Ollama 服务。

### OpenAI-compatible

推荐设置：

```text
Provider: OpenAI-compatible
API mode: Chat Completions
Base URL: https://.../v1
Model: 服务返回的模型 ID
API key: 设置页输入并保存
```

不要把真实 API key 写入文档、日志或截图。

## UI 手动验证流程

### 1. AI 设置页旧配置兼容

目的：确认点击设置里的 AI 不会消失。

步骤：

1. 启动开发版 Electron。
2. 打开或创建一个测试工作区。
3. 点击左侧 `设置`。
4. 点击 `AI` tab。
5. 观察应显示：
   - `模型管理`
   - `模型列表`
   - `语义索引`
   - `上下文与安全`

失败判断：

- 整个页面空白。
- 设置弹窗消失。
- 日志出现 `Cannot read properties of undefined (reading 'providerId')`。

修复后预期：

- 旧 settings 缺少 `embedding` 时，仍使用默认 Ollama embedding 设置显示。
- 如果设置子页异常，弹窗里应显示 `设置页面加载失败`，而不是全页面白屏。

### 2. Ollama Provider

步骤：

1. 打开 `设置 -> AI`。
2. 确认或新增 Ollama 模型。
3. 设置：
   - Base URL: `http://localhost:11434/v1`
   - API mode: `Chat Completions`
   - Model: `qwen3.5:latest`
4. 点击 `测试连接`。
5. 点击 `刷新模型`。
6. 发送一条聊天消息。

预期：

- API key 输入对 Ollama 隐藏或提示不需要。
- `测试连接` 返回成功。
- 模型列表包含 `qwen3.5:latest`。
- AI 侧边栏有正常回复。

### 3. 当前文档权限错误

步骤：

1. 关闭 `允许发送当前笔记正文`。
2. 在 AI 侧边栏输入：`总结当前文档`。

预期：

- 不发起模型请求。
- 显示明确错误：
  - 当前请求需要读取当前笔记正文。
  - AI 设置未允许发送当前笔记正文。
  - 错误代码为 `tool_permission_denied`。

### 4. 工作区读取

步骤：

1. 开启：
   - `允许搜索笔记`
   - `允许读取搜索命中笔记摘录`
   - `允许读取整个工作区`
2. 发送：`读取当前工作区中的内容，总结一下告诉我`

预期：

- Agent 可以调用 `listWorkspaceFiles`、`readWorkspaceFile` 或搜索相关工具。
- 回复应基于实际文件摘录。
- 如果权限不足，应明确说明缺少哪个权限。

### 5. 工作区写入 proposal

步骤：

1. 开启：
   - `允许读取整个工作区`
   - `允许提出工作区操作`
2. 让 AI 创建或修改 Markdown 文档。
3. 查看修改建议卡片。
4. 点击确认。
5. 查看历史版本。
6. 执行撤销或恢复。

预期：

- AI 不会直接写入。
- 先显示 proposal。
- 确认后才写入文件。
- 写入前有历史版本。
- 撤销不会重复生成大量新历史文档。

### 6. 语义索引

步骤：

1. 打开 `设置 -> AI -> 语义索引`。
2. 开启 `启用语义检索`。
3. 配置 embedding provider、base URL、model。
4. 点击 `测试 embedding`。
5. 点击 `更新语义索引`。
6. 点击 `清空并重建`。

预期：

- 未配置模型时 `测试 embedding` 不可用或显示缺模型。
- embedding 服务不可用时显示明确错误。
- 成功后索引状态变为 `可用`。
- 文档数量、分块数量、过期数量可见。

## 自动化验证

提交前建议运行：

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
```

最近一次结果：

```text
npm run typecheck: passed
npm run lint: passed
npm test: 14 files / 91 tests passed
npm run build: passed
npm run e2e: 87 tests passed
```

AI 专项快速验证：

```sh
npx playwright test tests/e2e/ai-assistant.spec.ts
```

AI 设置旧配置回归：

```sh
npx playwright test tests/e2e/ai-assistant.spec.ts -g "AI settings opens with legacy public settings"
```

语义索引设置回归：

```sh
npx playwright test tests/e2e/ai-assistant.spec.ts -g "AI settings configures semantic index manually"
```

注意：不要并行启动多个独立 Playwright 命令，否则可能抢 `4273` 端口。一次只跑一个命令，或直接跑 `npm run e2e`。

## 日志检查

开发日志：

```sh
tail -n 240 /tmp/nolia-ai-sdk-dev.log
```

应用日志：

```sh
tail -n 240 "$HOME/Library/Logs/Nolia/nolia.log"
```

重点搜索：

```sh
rg "Unhandled|TypeError|Renderer console message|Cannot read|providerId|run_timeout|provider_empty_response|tool_failed" /tmp/nolia-ai-sdk-dev.log "$HOME/Library/Logs/Nolia/nolia.log"
```

旧问题标记：

```text
Cannot read properties of undefined (reading 'providerId')
AiSettingsPanel
```

如果在最新启动后再次出现，说明 AI public settings 归一化或设置页 fallback 又被绕过。

## 已验证的关键修复

### 设置页白屏

根因：

- 旧持久化 AI settings 没有 `embedding`。
- `AiSettingsPanel` 直接读 `settings.embedding.providerId`。

修复：

- `AiSettingsPanel` 使用 `normalizeAiEmbeddingSettings` 派生 fallback。
- `App.tsx` 对 `AiSettingsPublic` 做 `normalizeAiSettingsPublic`。
- 设置内容增加 `SettingsPanelErrorBoundary`。
- e2e 模拟旧 public settings 缺少 `embedding`。

### AI 无响应/空回复

修复点：

- UI watchdog 超时后释放输入框。
- 空回复显示 `provider_empty_response`。
- 只返回 reasoning/thinking 时提示关闭 thinking/reasoning 或换模型。
- task event race 已在 `AiTaskService` 中用 pending event buffer 处理。

### Ollama OpenAI-compatible

修复点：

- `providerId: ollama` 且 `apiMode !== ollama-native` 时走 OpenAI-compatible provider。
- 本地 Ollama OpenAI-compatible 模式不要求 API key。
- 测试连接和模型列表走 `/v1/chat/completions`、`/v1/models`。

## 交接注意

- 不要提交真实 API key、真实私有 Base URL 或本地测试 workspace 内容。
- 不要把临时 userData 目录内容提交。
- `docs/private/` 是私有发布资料，不要混入 AI 测试密钥。
- 如果要提交 GitHub，先确认 `git diff` 中没有密钥、绝对私有路径或真实用户文档内容。
- 当前 `docs/ai-assistant-runtime` 可以作为 AI 相关文档统一入口。
