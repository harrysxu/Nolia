# Nolia macOS 完整验收报告

- 日期：2026-07-12
- 分支：`codex/nolia-upgrade`
- 环境：macOS 26.5.1 (25F80)，arm64
- 结论：**允许 macOS 试用；暂不满足正式发布条件。**

## 1. 最终结果

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| TypeScript strict | 通过 | 0 error |
| ESLint | 通过 | 0 error |
| Vitest | 通过 | 154 passed，4 skipped |
| Playwright E2E | 通过 | 114/114 |
| Production build / preload | 通过 | preload bundle 依赖检查通过 |
| 安装版核心验收 | 通过 | 25/25 |
| 真实 AI | 通过 | DeepSeek-V3.2、Qwen3.5-9B、Qwen3-Embedding-8B |
| 六项性能预算 | 通过 | 6/6 |
| 安装版 watcher | 通过 | 255ms；最后独立复测 254ms，预算 500ms |
| universal App | 通过 | `x86_64 arm64`，当前 Apple Silicon 可启动 |
| 安装一致性 | 通过 | 构建 App 与 `/Applications/Nolia.app` 的 app.asar 哈希一致 |
| 30 分钟高频压力 | 未通过 | 两次运行分别在 6 分 49 秒和 3 分 13 秒被自动化页面关闭中断，未形成连续 30 分钟证据 |
| 30 分钟正常使用 | 通过 | 30 分 1.9 秒，339 循环，三次真实 AI 全部成功，无错误、崩溃或残留进程 |
| DMG/ZIP 重生成 | 阻塞 | GitHub Electron x64 下载地址连续两次 ETIMEDOUT |
| 签名/公证/Gatekeeper | 阻塞 | 无 Developer ID 与公证凭据 |

## 2. 本轮发现并修复

1. **非 UTF-8 外部文件可被 main 直接覆盖。** 现在保存边界再次检测编码并返回 `readonly`，原始 bytes 保持不变。
2. **AI 多文件失败可能错误标记为已回滚。** 历史快照去重时可能没有 snapshot ID；事务现在持久化 `beforeContent`，回滚和撤销都有可靠基线，并区分 `rolled_back` 与 `rollback_failed`。
3. **AI 只校验第一份文件的 base hash。** proposal 现在为每个 operation 固化基线，审批前一次性校验全部选中文件；任何文件变化都会在零写入状态拒绝。
4. **AI 执行顺序依赖模型输出。** runtime 现在强制目录、移动、写入顺序，自动补选 DAG 依赖，并拒绝空选择、未知 operation、缺失依赖和超过 20 operations。
5. **AI 撤销会覆盖后续用户修改。** 撤销前校验 after hash；不匹配时返回 precondition failure，用户内容保持不变。
6. **Plugin RPC 可重放，网络边界不完整。** 已拒绝重复 requestId、IPv4-mapped IPv6、link-local/CGNAT/benchmark/multicast 地址、URL 内嵌凭据和超过 5MB 的流式响应；敏感 header 继续过滤。
7. **sql.js 与 global state 直接覆盖原文件。** 现在先写临时文件再原子 rename；失败保留旧文件，数据库 dirty 状态保持可重试。
8. **安装验收进程不会稳定退出。** 验收脚本增加 graceful quit、超时和隔离进程清理，watcher 脚本不再成功后挂起。
9. **备用模型验收误传只读字段。** 脚本现在从 public settings 显式构造可写 provider，避免把 `hasApiKey` 回传严格 schema。
10. **重复索引长文会频繁导出整个 sql.js 数据库。** 未变化的 watcher 事件不再写库，派生索引变更改为 5 秒合并 flush，工作区关闭时仍强制落盘。
11. **正常使用测试被外部模型单次超时提前终止。** AI 超时现在主动取消悬挂任务并继续测试，最多五次尝试且必须至少三次成功；失败原因独立落盘。
12. **单文件检查器收起后编辑区不回填，文件身份重复。** 单文件壳层改为编辑区/拖拽条/检查器三列，收起时后两列归零；标签栏保留文件身份，工具栏不再重复文件名，并为 macOS 窗口按钮预留空间。

## 3. 安装版覆盖

25 项安装版检查覆盖：工作区探测/初始化、watcher、树/解析/保存/冲突/历史、属性和标签事务、链接重命名、局部图、精确与保存搜索、草稿/会话、批量 30 文档操作、附件与二进制冲突、外部 Markdown、三种导出、设置落盘、Plugin v3 RPC/公网 allowlist/私网拒绝、健康检查，以及真实 AI 全流程。

真实 AI 已验证：

- `deepseek-ai/DeepSeek-V3.2`：流式聊天、当前笔记、选区操作、工具调用、单文件 proposal/审批/撤销、多文件部分审批。
- `Qwen/Qwen3.5-9B`：备用聊天模型兼容。
- `Qwen/Qwen3-Embedding-8B`：embedding 建索引和 hybrid search。

API Key 只用于隔离测试进程；报告只记录模型 ID，不记录 key、用户正文或敏感 header。

## 4. 性能结果

| 指标 | 实测 | 预算 | 结果 |
| --- | ---: | ---: | --- |
| 10,000 文件树 snapshot | 121.83ms | <2,000ms | 通过 |
| watcher patch | 255ms | <500ms | 通过 |
| 100,000 字符编辑事务 p95 | 0.01ms | <16ms | 通过 |
| 10,000 文档 FTS | 3.50ms | <150ms | 通过 |
| 局部图查询 | 0.32ms | <300ms | 通过 |
| AI 十文件事务 | 30.69ms | <2,000ms | 通过 |

10,000 文档索引造数耗时 1,887.54ms，仅作为准备阶段信息，不属于六项预算。

## 4.1 30 分钟正常使用

- 实际持续：1,801,961ms。
- 循环：339；保存 42；搜索 43；局部图 43；UI 编辑 43；导航 84；Plugin v3 42；外部文件读取 42。
- 真实 AI：`Qwen/Qwen3.5-9B` 尝试 3 次、成功 3 次、失败 0 次。
- 资源中位数：RSS 706MB → 636MB；文件描述符 246 → 261；进程数 4 → 4。
- 结束状态：watcher、index、database 均 `ready`；renderer error 0；Electron exit code 0；无残留主进程。

## 5. 安装与产物

- 已干净重装 `/Applications/Nolia.app`。
- 架构：`x86_64 arm64`。
- 四种关联：`.md`、`.markdown`、`.mdown`、`.mkd`。
- app.asar SHA-256：`415632f48cbec62e217224aa8d279489de2cdedc23e6d3f526d7c13c0e47ece2`。
- ad-hoc `codesign --verify --deep --strict` 通过。
- 当前 package:unsigned 两次被 Electron x64 下载源 `20.205.243.166:443` 超时阻断。为继续 macOS 试用验收，使用先前已生成且验证为 universal 的 App 外壳，重新打入本轮 production `dist + package.json`，再签名、校验和安装。没有把旧业务代码混入 app.asar。

## 6. 未覆盖风险

- 30 分钟正常使用已通过；30 分钟高频压力仍未形成连续通过证据，不再要求 8 小时以上长稳。
- Windows/Linux 按约定在对应系统后测。
- Intel 仅验证二进制架构，未做真实 Intel Mac 启动。
- Developer ID 签名、公证、stapler 和 Gatekeeper 未执行。
- 本轮未重生成 DMG/ZIP；网络恢复后必须重新打包并比较 app.asar 哈希。
- Computer Use 能识别 Nolia 进程，但读取 Electron Accessibility Tree 超时；VoiceOver 人工验收未完成。
- Finder 四扩展、批量 open-file、Dock、睡眠唤醒、多显示器仍需完整人工实机回归。
- 全量旧 schema fixture、覆盖升级失败回退和真实磁盘满故障注入未完成。

## 7. 证据位置

- [216 条执行台账](../qa/MACOS_TEST_LEDGER_2026-07-12.md)
- `test-results/installed-app-acceptance.json`
- `test-results/performance-acceptance.json`
- `test-results/watcher-performance.json`
- `test-results/installed-app-normal-30m.json`
- `playwright-report/`

综合以上证据，本版本可以交给 macOS 用户进行受控试用；在未覆盖风险闭环前，不应作为正式签名发行版本发布。
