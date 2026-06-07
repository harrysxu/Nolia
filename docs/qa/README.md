# QA 文档

本目录维护 Nolia 的测试基线和桌面验收清单。发布前以 `release/RELEASE_CHECKLIST.md` 作为最终放行清单，以本目录文档作为详细测试矩阵。

## 文档索引

- [全量回归测试用例](COMPREHENSIVE_TEST_PLAN.md)：覆盖启动、工作区、文件树、Markdown、资源编辑、搜索、设置、插件、菜单、系统集成和异常边界。
- [Computer Use 桌面验收清单](COMPUTER_USE_DESKTOP_CHECKLIST.md)：安装版或打包版 App 的桌面执行矩阵。

## 执行要求

- 自动化基线：`npm run typecheck`、`npm run lint`、`npm test`、`npm run e2e`、`npm run build`。
- 桌面验收对象：优先使用当前系统重新打包并安装后的 Nolia；也可补充验证 `release/*unpacked*` 目录。
- 数据保护：桌面验收前备份当前系统的 Nolia 全局应用数据目录，只在临时工作区或真实工作区副本中操作。
- 证据管理：截图、视频、临时工作区、测试报告和打包产物不提交到 Git；只提交稳定的测试计划、清单和必要的长期文档。

