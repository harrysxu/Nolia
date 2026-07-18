# Nolia 文档入口

Nolia 是一款跨平台本地优先 Markdown 知识工作台，基于 Electron、React、Vite 和 TypeScript 构建，面向 macOS、Windows 和 Linux 桌面环境。

## 用户文档

- [使用手册](user/USER_MANUAL.md)：快速开始、安装、工作区、格式、Markdown、快捷键、备份和故障排查。

## 插件文档

- [插件指南](plugins/PLUGIN_DEVELOPMENT.md)：安装、启用、权限、开发 API、文件编辑器和示例。

## AI Assistant

- [AI Runtime](ai-assistant-runtime/README.md)：Provider、Agent Runtime、权限、安全、语义索引、错误诊断和发布前 AI 测试。

## 产品规划

- [产品与技术升级方案](product/PRODUCT_UPGRADE_PLAN.md)：产品定位、现状分析、一次性交付范围和验收指标。
- [一次性升级技术设计](architecture/TECHNICAL_UPGRADE_DESIGN.md)：目标架构、领域模型、IPC、数据、安全、迁移、性能和测试设计。
- [一次性升级 UI/UX 规格](design/UI_UX_UPGRADE_SPEC.md)：信息架构、页面、交互、视觉系统、响应式、无障碍和视觉验收。

## 法律与声明

- [隐私声明](legal/PRIVACY.md)
- [使用条款](legal/TERMS.md)
- [第三方软件声明](legal/THIRD_PARTY_NOTICES.md)
- [项目许可](legal/LICENSE.md)

## 发布、测试与研发

- [更新日志](release/CHANGELOG.md)
- [升级说明](release/UPGRADE.md)
- [发布检查清单](release/RELEASE_CHECKLIST.md)
- [macOS 签名与公证指南](release/MACOS_SIGNING_NOTARIZATION.md)
- [QA 测试计划](qa/README.md)
- [代码结构地图](architecture/CODEBASE_MAP.md)
- [贡献指南](../CONTRIBUTING.md)
- [安全政策](../SECURITY.md)
- [行为准则](../CODE_OF_CONDUCT.md)
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
