# Nolia 完整发布验收报告

- 日期：2026-07-11
- 分支：`codex/nolia-upgrade`
- 平台：macOS，Universal unsigned build
- 结论：本轮约定范围内通过，可以进入 macOS 人工试用。

## 1. 验收结果

| 门禁 | 结果 | 数量或说明 |
| --- | --- | --- |
| TypeScript strict typecheck | 通过 | 0 error |
| ESLint | 通过 | 0 error |
| Vitest | 通过 | 139 passed，4 个性能用例默认跳过 |
| Playwright E2E | 通过 | 114 passed |
| 真实安装包验收 | 通过 | 24 checks |
| 性能预算 | 通过 | 6/6 |
| Production build | 通过 | preload 运行时依赖门禁通过 |
| macOS Universal package | 通过 | DMG、ZIP、App 已生成 |
| 安装一致性 | 通过 | 安装 App 与构建 App 的 `app.asar` SHA-256 一致 |
| 差异格式检查 | 通过 | `git diff --check` 无错误 |

完整浏览器回归覆盖 1440x900、1320x860、1100x760、900x700、780x520，并包含核心流程无障碍扫描。

## 2. 真实安装包功能覆盖

测试从打包后的 `app.asar` 启动独立 Electron 实例，使用独立 user data、临时工作区和临时密钥存储；结束后清理，不访问或修改用户真实笔记。

1. 普通目录探测、初始化和工作区恢复。
2. watcher 外部创建事件、索引状态和工作区健康。
3. 文件树、Markdown 解析、原子保存、过期 base hash 冲突和历史快照。
4. 属性写回、标签统计、标签重命名预览和事务应用。
5. wikilink/Markdown link 重命名预览、引用更新、反向链接和局部图。
6. 精确搜索、混合搜索、保存搜索、搜索页面最新请求胜出。
7. 草稿和多文档会话持久化。
8. 创建、移动、重命名和移入废纸篓。
9. 30 文档批量创建，10 文档修改，10 文档移动，10 文档删除，并验证树、历史和索引搜索。
10. PNG 附件导入、二进制读取/写入和二进制冲突。
11. 工作区外 Markdown 读取、保存和冲突保护。
12. Markdown、HTML、PDF 三种导出及产物内容校验。
13. 主题、编辑模式和 Daily Note 路径设置落盘及 renderer 重载。
14. Plugin API v3 授权、session、RPC、路径逃逸拒绝。
15. 插件公网 allowlist 请求成功，loopback/private network 请求拒绝。
16. AI Provider 模型列表、密钥隔离存储和连通性。
17. 真实流式聊天、当前笔记上下文。
18. 真实 AI 总结、翻译、提取任务、解释和润色。
19. AI 工作区搜索工具调用、来源事件和结果引用。
20. 单文档 inline proposal、显式审批、持久事务和撤销。
21. 真实三操作多文件 proposal、按 operation 部分审批、依赖联动和撤销。
22. 真实 embedding 建索引和 hybrid search。

AI 验收使用硅基流动的 `Qwen/Qwen2.5-14B-Instruct` 和 `BAAI/bge-m3`。API key 未写入仓库、日志或报告，隔离测试目录已清理。

## 3. 性能结果

| 指标 | 实测 | 预算 | 结果 |
| --- | ---: | ---: | --- |
| 10,000 个物理文件的文件树 snapshot | 117.93 ms | < 2,000 ms | 通过 |
| watcher 外部创建 patch | 264 ms | < 500 ms | 通过 |
| 100,000 字符编辑事务 p95 | 0.01 ms | < 16 ms | 通过 |
| 10,000 文档 FTS 查询 | 3.10 ms | < 150 ms | 通过 |
| 局部关系图查询 | 0.26 ms | < 300 ms | 通过 |
| AI 十文件事务应用 | 18.93 ms | < 2,000 ms | 通过 |

10,000 文档测试数据写入索引耗时 1,919.26 ms。该值是造数和索引准备信息，不属于已锁定的六项发布预算。

原始报告：

- `test-results/installed-app-acceptance.json`
- `test-results/performance-acceptance.json`
- `test-results/watcher-performance.json`
- `playwright-report/`

## 4. 本轮发现并修复

### 大工作区 watcher 文件描述符占用

旧实现使用 chokidar 递归监听，在约 2,700 个文件的工作区为大量文件保持独立描述符，最终使系统无法创建新的 watcher。实现已改为 Electron/Node 的单个递归目录 watcher，保留 250ms 合并、索引和 create/change/delete patch 语义。安装包实测 patch 延迟 264ms。

### 验收基础设施假阳性

最初的 10,000 文档造数为每个文档建立关系，导致准备阶段出现 O(n²) 开销；测试已改成 10,000 文档 FTS 数据加 60 个关系节点。性能报告现在要求六个预算指标全部存在且通过，避免缺失指标被错误标记为成功。

## 5. 未覆盖和后续边界

以下内容不计入本次 macOS 通过结论：

- Windows、Linux 打包与安装，按约定留到对应系统测试。
- Apple 签名、公证、Gatekeeper 首次下载链路；本次是 unsigned 包。
- 云同步、多人协作、插件市场、移动端、Notion 数据库、Canvas 和全局关系图，均不在目标版本范围。
- 系统原生文件选择器的所有权限组合、打印机硬件和第三方默认应用兼容矩阵。
- 第三方 AI 服务的长期可用性、限流和模型输出确定性；应用侧错误、取消、超时和重试路径已由自动化覆盖。

## 6. 复现命令

```bash
npm run typecheck
npm run lint
npm test
npx playwright test --workers=4
npm run test:performance
npm run test:watcher-performance
npm run package:unsigned
```

真实 AI 安装包验收需要在进程环境提供 `SILICONFLOW_API_KEY`，不要把密钥写入命令历史、仓库或报告。
