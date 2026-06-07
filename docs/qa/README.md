# QA 文档

本目录维护 Nolia 的测试基线、桌面验收清单和最近一次验收记录。发布前以 `release/RELEASE_CHECKLIST.md` 作为最终放行清单，以本目录文档作为详细测试矩阵。

## 文档索引

- [全量回归测试用例](COMPREHENSIVE_TEST_PLAN.md)：覆盖启动、工作区、文件树、Markdown、资源编辑、搜索、设置、插件、菜单、系统集成和异常边界。
- [Computer Use 桌面验收清单](COMPUTER_USE_DESKTOP_CHECKLIST.md)：安装版或打包版 App 的桌面执行矩阵。
- [最近一次桌面验收报告](DESKTOP_TEST_REPORT.md)：2026-06-07 本地打包版验收记录。

## 执行要求

- 自动化基线：`npm run typecheck`、`npm run lint`、`npm test`、`npm run e2e`、`npm run build`。
- 桌面验收对象：优先使用安装版 `/Applications/Nolia.app` 或重新打包后的 `release/mac-universal/Nolia.app`。
- 数据保护：桌面验收前备份 `~/Library/Application Support/Nolia/global-state.json`，只在临时工作区或真实工作区副本中操作。
- 证据管理：截图、视频、临时工作区和测试产物不提交到 Git；只提交稳定的测试计划、清单和必要的报告摘要。

