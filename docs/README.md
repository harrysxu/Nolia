# Nolia 文档入口

Nolia 是一款 macOS 本地优先 Markdown 知识工作台，基于 Electron、React、Vite 和 TypeScript 构建。

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

正式发布路径要求 Developer ID 签名和 notarization。`npm run package` 会先校验发布凭证；本地 unsigned 打包使用：

```sh
npm run package:unsigned
```
