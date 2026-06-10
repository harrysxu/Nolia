# Nolia 文档入口

Nolia 是一款跨平台本地优先 Markdown 知识工作台，基于 Electron、React、Vite 和 TypeScript 构建，面向 macOS、Windows 和 Linux 桌面环境。

## 用户文档

- [使用手册](user/USER_MANUAL.md)：快速开始、安装、工作区、格式、Markdown、快捷键、备份和故障排查。

## 插件文档

- [插件指南](plugins/PLUGIN_DEVELOPMENT.md)：安装、启用、权限、开发 API、文件编辑器和示例。

## 法律与声明

- [隐私声明](legal/PRIVACY.md)
- [使用条款](legal/TERMS.md)
- [第三方软件声明](legal/THIRD_PARTY_NOTICES.md)
- [项目许可](legal/LICENSE.md)

## 发布与研发

- [更新日志](release/CHANGELOG.md)
- [发布检查清单](release/RELEASE_CHECKLIST.md)
- [macOS 签名与公证指南](release/MACOS_SIGNING_NOTARIZATION.md)
- [AI 化文档](ai-capabilities/README.md)
- [AI 化需求文档](ai-capabilities/AI_PRODUCT_REQUIREMENTS.md)
- [AI 技术方案](ai-capabilities/AI_TECHNICAL_DESIGN.md)
- [AI UI/UX 设计文档](ai-capabilities/AI_UI_UX_DESIGN.md)
- [AI 全量测试用例](ai-capabilities/AI_COMPREHENSIVE_TEST_CASES.md)
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
