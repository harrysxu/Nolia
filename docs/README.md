# Nolia 文档入口

Nolia 是一款跨平台本地优先 Markdown 知识工作台，基于 Electron、React、Vite 和 TypeScript 构建，面向 macOS、Windows 和 Linux 桌面环境。

## 用户文档

- [使用手册](user/USER_MANUAL.md)：快速开始、安装、工作区、格式、Markdown、快捷键、备份和故障排查。

## 插件文档

- [插件指南](plugins/PLUGIN_DEVELOPMENT.md)：安装、启用、权限、开发 API、文件编辑器和示例。

## AI Assistant Runtime

- [AI 文档入口](ai-assistant-runtime/README.md)：AI Assistant、Agent Runtime、权限、安全、当前实现和历史规划。
- [AI 文档总览](ai-assistant-runtime/DOCUMENTATION_SUMMARY.md)：汇总所有 AI 文档、当前事实来源和后续测试入口。
- [当前实现说明](ai-assistant-runtime/CURRENT_IMPLEMENTATION.md)：当前代码中的 Vercel AI SDK Core runtime、Provider、工具、权限、写入和语义索引。
- [测试交接](ai-assistant-runtime/TEST_HANDOFF.md)：换位置继续测试时的启动、配置、验证和日志检查流程。
- [语义索引与 RAG](ai-assistant-runtime/SEMANTIC_INDEX_AND_RAG.md)：手动 embedding 索引、全文检索降级和回答前数据校验策略。
- [GitHub 提交说明](ai-assistant-runtime/GITHUB_SUBMISSION_NOTES.md)：提交远端前的敏感信息检查、生成物排除和 PR 描述。

## 法律与声明

- [隐私声明](legal/PRIVACY.md)
- [使用条款](legal/TERMS.md)
- [第三方软件声明](legal/THIRD_PARTY_NOTICES.md)
- [项目许可](legal/LICENSE.md)

## 发布与研发

- [更新日志](release/CHANGELOG.md)
- [发布检查清单](release/RELEASE_CHECKLIST.md)
- [macOS 签名与公证指南](release/MACOS_SIGNING_NOTARIZATION.md)
- [QA 测试文档](qa/README.md)
- [代码结构地图](architecture/CODEBASE_MAP.md)
- [贡献指南](../CONTRIBUTING.md)
- [安全政策](../SECURITY.md)
- [English documentation](en-US/README.md)

## 开发

```sh
npm install
npm run dev
```

常用检查：

```sh
npm run typecheck
npm run lint
npm test
npm run e2e
npm run build
```

打包命令：

```sh
npm run package:unsigned
npm run package:win
npm run package:linux
```

macOS 正式发布要求 Developer ID 签名和 notarization。`npm run package` 会先校验 macOS 发布凭证；Windows 和 Linux 发布校验见 [发布检查清单](release/RELEASE_CHECKLIST.md)。
