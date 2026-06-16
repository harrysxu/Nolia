# AI Runtime GitHub Submission Notes

更新日期：2026-06-16

本文用于提交 GitHub 远端前的整理和自查。

## 本次 AI 相关文档位置

AI 文档统一放在：

```text
docs/ai-assistant-runtime/
```

当前建议提交的核心文档：

- `README.md`
- `DOCUMENTATION_SUMMARY.md`
- `CURRENT_IMPLEMENTATION.md`
- `TEST_HANDOFF.md`
- `SEMANTIC_INDEX_AND_RAG.md`
- `GITHUB_SUBMISSION_NOTES.md`
- `V1_REQUIREMENTS.md`
- `V1_TECHNICAL_DESIGN.md`
- `V1_UI_UX_DESIGN.md`
- `V1_UI_UX_REVIEW.md`
- `V1_COMPREHENSIVE_TEST_REPORT.md`
- `V1_DEVELOPMENT_PROGRESS.md`

## 当前实现相关代码范围

主要新增或修改：

- `src/shared/ai.ts`
- `src/shared/channels.ts`
- `src/shared/ipc.ts`
- `src/shared/constants.ts`
- `src/shared/i18n.ts`
- `src/preload/index.ts`
- `src/main/index.ts`
- `src/main/ipc.ts`
- `src/main/ai/`
- `src/main/services/workspaceDb.ts`
- `src/main/services/semanticIndexService.ts`
- `src/main/services/fileSystemService.ts`
- `src/main/services/historyService.ts`
- `src/main/services/settingsService.ts`
- `src/renderer/ai/`
- `src/renderer/App.tsx`
- `src/renderer/styles/global.css`
- editor component AI snapshot / history / rendering changes
- AI and history related tests

依赖相关：

- `package.json`
- `package-lock.json`

测试配置：

- `playwright.config.ts`

## 提交前必须检查

### 1. 敏感信息

确认没有提交：

- API key。
- 私有 OpenAI-compatible Base URL。
- 真实用户 workspace 内容。
- 临时 userData 目录。
- 本地日志。
- 截图中含密钥或私有 URL。

建议命令：

```sh
git diff -- docs src tests package.json package-lock.json playwright.config.ts
rg -n "sk-|api[_-]?key|Authorization|Bearer|localhost:[0-9]+/v1|nolia-ai-sdk-userdata" docs src tests package.json playwright.config.ts
```

说明：

- `localhost:11434` 是 Ollama 默认地址，可以保留。
- 文档可以描述私有 Base URL 不记录，但不要写真实地址。

### 2. 生成物

不要提交：

- `dist/`
- `release/`
- `test-results/`
- `coverage/`
- `playwright-report/`
- `output/`
- `node_modules/`
- `.DS_Store`

当前 `docs/.DS_Store` 和 `docs/en-US/.DS_Store` 是已有文件，需要决定是否保留或移除。若不打算提交系统文件，建议单独清理。

### 3. 测试

最近一次已通过：

```text
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
```

结果：

```text
Vitest: 14 files / 91 tests passed
Playwright: 87 tests passed
Build: passed
```

提交前如有新改动，至少重跑：

```sh
npm run typecheck
npm run lint
npm test
```

如果动了 UI、IPC、AI runtime、文件系统或历史版本：

```sh
npm run e2e
npm run build
```

## 建议 PR 描述

```md
## Problem

Nolia needs a local-first AI Assistant runtime with explicit provider configuration, workspace-safe tools, visible errors, and confirmed writes.

## Summary

- Added AI shared contracts, IPC, preload APIs, settings service, provider registry, and Vercel AI SDK Core based agent runtime.
- Added OpenAI-compatible and Ollama provider support, including model listing and connection tests.
- Added AI sidebar, model management UI, API key reveal flow, conversation history control, workspace permissions, patch proposals, and visible error states.
- Added persisted AI tasks with proposal approval, write transactions, history snapshots, and undo support.
- Added whole-workspace read tools behind explicit permissions.
- Added manually controlled semantic index with embedding settings, update/reset actions, and full-text fallback.
- Added AI runtime documentation under docs/ai-assistant-runtime.
- Added unit and E2E coverage for AI runtime, task persistence, semantic index, UI settings, errors, and patch workflows.

## Validation

- npm run typecheck
- npm run lint
- npm test
- npm run build
- npm run e2e
```

## 提交拆分建议

如果需要拆成多个 commit：

1. `docs: add AI assistant runtime documentation`
2. `shared: add AI settings and IPC contracts`
3. `main: add AI runtime providers tools and tasks`
4. `renderer: add AI sidebar settings and patch UI`
5. `main: add semantic index service`
6. `tests: add AI runtime and e2e coverage`

如果提交为一个大 commit，建议：

```text
ai: add local-first assistant runtime
```

## 后续测试重点

提交后继续测试：

- 真实 OpenAI-compatible provider。
- 本地 Ollama `qwen3.5:latest` 聊天。
- 专用 embedding 模型创建语义索引。
- 大工作区索引耗时和失败恢复。
- 历史版本恢复是否避免重复生成历史文件。
- 工作区读取权限关闭时的错误提示。
- 窄屏下 patch proposal 操作是否可点击。
- 长回复、Mermaid、Markdown 渲染是否稳定。
