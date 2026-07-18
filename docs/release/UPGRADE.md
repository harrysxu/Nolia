# Nolia 目标版本升级与回退说明

本文面向从旧版升级到当前一次性交付目标版本的用户和发布维护者。

## 升级前

1. 备份重要工作区。
2. 退出正在运行的 Nolia。
3. 如使用同步盘或 Git 管理工作区，确认没有未同步或未提交的重要修改。
4. 如启用了外部插件，记录当前插件来源和权限。

Nolia 是本地优先应用，用户文档仍保存在用户选择的工作区中。升级应用本体不会主动迁移或删除工作区文件。

## 主要变化

- 新增工作区主页、显式目录初始化、只读工作区缓存、会话/Tab/草稿恢复和工作区健康页。
- 新增 Inbox 快速捕获、Daily Note、模板变量、属性检查器、标签筛选与事务重命名、双链标题补全和局部关系图。
- 搜索统一覆盖标题、正文、路径、标签、属性和任务项，混合模式不可用时明确降级。
- AI 默认进入持久任务工作台；多文件 proposal 支持部分审批、依赖联动、prepared/committed/rollback 状态和 after-hash 撤销检查。
- Plugin API v3 改为独立 origin sandbox iframe、MessagePort RPC、main capability broker 和受限网络代理。v2 不再执行。

- 版本号提升到 `1.0.0`。
- 新增 AI Assistant runtime，支持 OpenAI-compatible、OpenAI Responses 和 Ollama provider。
- AI API key 改为本地密钥服务保存，优先使用系统安全存储；系统安全存储不可用时使用本地降级存储。
- 新增语义索引和 RAG 检索入口。语义索引是派生数据，可以清空后重新生成。
- AI 写入操作改为 proposal/approval 流程，确认后写入前会创建历史版本，便于回滚。
- OpenAI-compatible Chat Completions 的 Base URL 在正式运行路径中会规范化到 `/v1` API root，避免连接测试通过但聊天空响应。
- 文档结构已整理，AI、QA、架构、发布和法律文档都有稳定入口。
- macOS、Windows、Linux 发布产物命名统一为 `Nolia-版本-系统-架构.扩展名`。

## 升级后检查

1. 启动 Nolia 并打开原有工作区。
2. 打开最近文档，确认 Markdown 编辑、源码、分屏预览正常。
3. 如果启用了 AI Assistant，进入设置页重新检查 provider、模型、Base URL 和 API key 状态。
4. 如果使用 OpenAI-compatible 服务，确认 Base URL 指向服务根地址或 `/v1` API root。
5. 如需要语义检索，手动创建或更新语义索引。
6. 检查外部插件是否仍处于预期状态；权限变更时需要重新确认。
7. 进行一次新建、保存、重启后恢复工作区的冒烟测试。
8. 打开「发现」，检查标签、保存搜索和精确/混合搜索。
9. 在源码编辑器键入 `[[`，检查标题补全和创建新笔记。
10. 外部插件必须迁移为 API v3；v2 只应显示迁移诊断且不能启用。

## 数据库迁移

- Markdown 文件始终是可移植正文来源。
- `.nolia/workspace.sqlite` 保存索引、历史引用、会话、草稿、保存搜索、属性/任务索引和 AI 任务事务。
- migration runner 在修改前创建原子备份并记录 schema version；迁移失败时恢复旧数据库和配置，工作区不能以半迁移状态打开。
- 旧 `.nolia/ai/tasks/*.json` 首次打开时导入数据库，原文件归档为只读备份。
- 全局旧设置会补齐并校验 Inbox、Daily 和 Templates 路径；不安全路径自动回退为默认值。

## 已知注意事项

- 语义索引、搜索索引、缓存和历史快照属于派生数据，不应手动拷贝到其他工作区作为唯一备份。
- 云端 AI provider 的请求可能包含用户输入、当前文档片段、检索结果、文件名或路径等上下文；请只配置可信的模型服务商或网关。
- `release/`、`dist/`、`test-results/`、`coverage/`、`docs/private/` 是本地生成或私有目录，不应提交到 Git。
- macOS 正式对外分发包必须使用 Developer ID 签名、公证，并验证 Gatekeeper 结果。

## 回退

如升级后需要回退应用版本：

1. 退出 Nolia。
2. 保留当前工作区副本和迁移前数据库备份。
3. 安装旧版本应用。
4. 使用升级前备份恢复 `.nolia`，或删除可重建的索引数据库后让兼容版本重新索引。
5. 不要让旧版本写入已由新版本修改、且未备份的 AI 事务、草稿或会话数据库。

不建议在没有备份的情况下反复用不同版本写入同一工作区。
