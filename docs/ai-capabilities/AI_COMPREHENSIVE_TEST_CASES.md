# Nolia AI 全量测试用例

日期：2026-06-09  
测试范围：AI 设置、OpenAI-compatible provider、AI 面板、预置/自定义命令、上下文预览、工作区 AI 索引、源码/WYSIWYG 编辑器应用、变更计划审核、错误和边界场景。  
测试配置：使用 `/Users/long/tmp/codexx` 中的 OpenAI-compatible `/v1` 配置；默认节点 `https://sub2.de5.net/v1`，默认模型 `gpt-5.4-mini`。API key 只在本地测试环境使用，不写入仓库。

## 1. 测试原则

- 不提交、不打印、不截图暴露 API key。
- 文件写入类测试只在临时工作区执行。
- AI 文件变更必须验证是否经过确认界面、hash 写入和历史快照链路。
- UI 测试覆盖 1360x860 桌面视口和窄宽右侧栏场景。
- 所有问题按“阻塞 / 严重 / 一般 / 体验”分级记录。

## 2. 前置数据

临时工作区包含：

- `notes/ai-overview.md`：AI 产品需求、Provider、索引和隐私说明。
- `notes/project-plan.md`：项目任务、待办和里程碑。
- `notes/meeting.md`：会议纪要、负责人和决策。
- `notes/long.md`：超过一个 chunk 的长文档。
- `assets/plain.txt`：非 Markdown 文本资源，用于验证当前 AI 索引只索引 Markdown。

## 3. 自动化基础测试

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| AI-AUTO-001 | TypeScript 检查 | 执行 `npm run typecheck` | 0 exit code |
| AI-AUTO-002 | ESLint 检查 | 执行 `npm run lint` | 0 exit code |
| AI-AUTO-003 | 单元测试 | 执行 `npm test` | AI command、provider mock、AI index、context preview 均通过 |
| AI-AUTO-004 | AI 面板 e2e | 执行 `npm run e2e -- tests/e2e/ai-panel.spec.ts` | AI 面板可发送 mock 请求并显示结果 |
| AI-AUTO-005 | 生产构建 | 执行 `npm run build` | main/preload/renderer 构建通过；只允许已有 chunk size 警告 |

## 4. Provider 与设置测试

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| AI-PROV-001 | 打开 AI 设置页 | 设置按钮 > AI tab | 显示启用 AI、默认 Provider、默认模型、Provider、上下文与隐私、工作区 AI 索引、预置命令、自定义命令 |
| AI-PROV-002 | 新增 OpenAI-compatible provider | 点击添加，填 label/baseUrl/model，启用 provider | provider 出现在列表，可选为默认 provider |
| AI-PROV-003 | 保存 API key | 输入 codexx 测试 key，点击保存密钥 | UI 显示已保存；`global-state.json` 不出现明文 key |
| AI-PROV-004 | Provider 连接测试 | 点击测试 | 显示连接正常或明确错误；失败不崩溃 |
| AI-PROV-005 | 模型列表边界 | 调用模型列表 IPC 或测试按钮前后切换模型 | `gpt-5.4-mini` 可配置；禁用 provider 后请求提示未配置/已停用 |
| AI-PROV-006 | 隐私开关 | 关闭当前文档上下文、关闭工作区上下文后发起请求 | 上下文预览不包含被禁用内容，并显示警告 |

## 5. AI 面板与上下文测试

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| AI-PANEL-001 | AI 未启用态 | 关闭 AI，打开右侧 AI 面板 | 显示未启用提示和打开设置按钮 |
| AI-PANEL-002 | AI 面板基本提问 | 启用 AI 后输入“总结当前文档”并发送 | 显示用户消息、pending 状态、AI 回复、复制/插入/替换/追加/新建笔记/变更计划按钮 |
| AI-PANEL-003 | 上下文预览 | 当前文档提问 | 显示当前文档上下文、估算字符数 |
| AI-PANEL-004 | 工作区上下文 | 开启工作区上下文，选择工作区范围提问 | 上下文包含工作区搜索或 AI 索引片段，回复带 citations |
| AI-PANEL-005 | 取消请求 | 发送后立即点击停止 | 状态变为已取消，不继续累积输出 |
| AI-PANEL-006 | 空 prompt | 当前无文档或空 prompt | 无文档时禁用发送；有文档时可基于上下文发送 |

## 6. AI 索引测试

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| AI-IDX-001 | 初始状态 | 新工作区打开 AI 面板 | 显示待构建或未启用状态 |
| AI-IDX-002 | 开启索引 | 设置 > AI > 启用工作区 AI 索引 | 状态区和重建按钮可用 |
| AI-IDX-003 | 重建索引 | 点击重建索引 | 状态从构建中变为可用，chunk 数 > 0，生成 `.nolia/ai/index.json` |
| AI-IDX-004 | 索引检索 | 工作区范围提问“provider 隐私和索引策略” | 上下文优先出现 `AI 索引片段` |
| AI-IDX-005 | 禁用 Markdown 索引 | 关闭“索引 Markdown 文档”后重建 | chunk 数为 0 或无法召回 Markdown chunk |
| AI-IDX-006 | 文件夹范围 | 打开 `notes/project-plan.md`，选择文件夹范围提问 | 只召回同文件夹内文档 |
| AI-IDX-007 | 边界文件 | 空 Markdown、长 Markdown、非 Markdown 文件 | 空文件不生成空 chunk；长文档多 chunk；非 Markdown 不进入当前索引 |

## 7. 预置与自定义命令测试

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| AI-CMD-001 | 预置命令展示 | 设置 > AI > 预置命令 | 显示总结、润色、翻译、扩写、缩写、待办、标题、标签、变更计划等 |
| AI-CMD-002 | 复制预置命令 | 对“润色选区”点击复制为自定义 | 自定义命令新增副本，预置命令不变 |
| AI-CMD-003 | 新建自定义命令 | 输入名称和 Prompt，点击添加命令 | 自定义命令出现在列表和命令面板 |
| AI-CMD-004 | 编辑自定义命令 | 修改名称、Prompt、结果应用方式 | 重新打开设置后仍保留 |
| AI-CMD-005 | 启停与排序 | 禁用、自定义命令上移/下移 | 禁用命令不出现在运行列表；排序生效 |
| AI-CMD-006 | 运行命令 | 从 AI 面板或命令面板运行“提取待办” | 自动生成上下文预览并显示结果 |

## 8. 编辑器应用测试

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| AI-EDIT-001 | 源码模式选区替换 | Source 模式选择一段文字，运行润色，点击替换选区 | 只替换选区，编辑器 dirty，保存后文件更新 |
| AI-EDIT-002 | 源码模式插入 | 光标放在段落后，点击插入 | 内容插入到光标位置 |
| AI-EDIT-003 | 源码模式追加 | 点击追加 | 内容追加到文末，有空行分隔 |
| AI-EDIT-004 | WYSIWYG 选区上下文 | WYSIWYG 模式选中文本，运行总结选区 | 上下文预览显示选区，不退化为全文 |
| AI-EDIT-005 | WYSIWYG 替换 | WYSIWYG 模式选中文本，点击替换选区 | 选区被替换，Markdown 结构尽量保留 |
| AI-EDIT-006 | 分屏模式 | Split 模式选区插入/替换 | Source 编辑器行为正确，Preview 不错位 |
| AI-EDIT-007 | 复制结果 | 点击复制 | 剪贴板文本等于 AI 输出 |

## 9. 新建笔记与变更计划测试

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| AI-APPLY-001 | 新建笔记 | AI 回复 Markdown 后点击新建笔记 | 在当前文件夹创建唯一 `.md` 文件并打开 |
| AI-APPLY-002 | 新建笔记重名 | 多次对同一标题点击新建笔记 | 自动生成不冲突文件名 |
| AI-APPLY-003 | 有效变更计划 | AI 输出 JSON changes:create/modify，点击变更计划 | 打开审核弹窗，逐项显示 action/path/content |
| AI-APPLY-004 | 应用创建 | 对 create 变更点击应用 | 创建文件、刷新文件树、状态为已应用 |
| AI-APPLY-005 | 应用修改 | 对 modify 变更点击应用 | 通过 `writeAtomic` 保存，打开文档同步更新 |
| AI-APPLY-006 | 应用全部 | 多项 pending 变更点击应用全部 | 逐项应用；失败项保留错误，不影响已成功项 |
| AI-APPLY-007 | 非法 JSON | 点击变更计划处理普通自然语言回复 | 显示未识别到有效变更计划，不写入文件 |
| AI-APPLY-008 | 路径越界 | JSON pathRel 包含 `../` | 被过滤，不允许写出工作区 |
| AI-APPLY-009 | 修改 dirty 文件 | 目标文件有未保存更改 | 拒绝应用并显示文件有未保存更改 |
| AI-APPLY-010 | 冲突写入 | 读取后磁盘被外部修改 | `writeAtomic` 返回 conflict，UI 显示保存冲突 |

## 10. UI 与交互测试

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| AI-UI-001 | AI 面板布局 | 1360x860 打开 AI 面板 | 无重叠、无溢出，输入框和结果按钮可见 |
| AI-UI-002 | 设置页布局 | 设置 > AI，滚动到各区域 | Provider、索引、预置命令、自定义命令布局稳定 |
| AI-UI-003 | 窄右侧栏 | 拖窄右侧栏到最小宽度 | 按钮换行，文字省略，不重叠 |
| AI-UI-004 | 主题兼容 | light/dark/paper/technical 主题下打开 AI 面板 | 文字可读、对比度正常 |
| AI-UI-005 | 弹窗层级 | 打开变更计划弹窗，同时存在浮动编辑器 | 弹窗在最上层，背景不可误点 |
| AI-UI-006 | 键盘交互 | 命令面板搜索 AI 命令，Escape 关闭 | 命令可搜索可运行，Escape 行为正常 |

## 11. 错误和边界测试

| 编号 | 用例 | 步骤 | 预期 |
|---|---|---|---|
| AI-ERR-001 | provider disabled | 默认 provider 禁用后发送 | 显示 provider disabled，不崩溃 |
| AI-ERR-002 | API key 缺失 | 使用云 provider 但不保存 key | 显示鉴权/配置错误 |
| AI-ERR-003 | baseUrl 错误 | baseUrl 设置为不可达地址 | 显示网络错误，可重试 |
| AI-ERR-004 | model 错误 | 模型设置为不存在 | 显示 model not found/provider error |
| AI-ERR-005 | 工作区关闭 | 无工作区打开 AI 面板 | 工作区索引不可重建，文档相关操作禁用或提示 |
| AI-ERR-006 | 超长文档 | 对长文档发起总结 | 上下文被裁剪，应用不卡死 |
| AI-ERR-007 | 日志敏感信息 | 触发失败后检查日志 | 日志不包含 prompt 正文、AI 回复、API key |

## 12. 测试结果记录

执行日期：2026-06-09  
执行分支：`feature/ai-capabilities`  
执行结论：通过。发现 4 个功能/体验/稳定性问题，已在本分支修复并回归通过。

| 编号 | 结果 | 备注 |
|---|---|---|
| AI-AUTO-001 | 通过 | `npm run typecheck` 通过 |
| AI-AUTO-002 | 通过 | `npm run lint` 通过 |
| AI-AUTO-003 | 通过 | `npm test` 通过，11 个测试文件、67 个用例 |
| AI-AUTO-004 | 通过 | `npm run e2e -- tests/e2e/ai-panel.spec.ts tests/e2e/ai-comprehensive.spec.ts` 通过；`npm run e2e` 全量 60 个用例通过 |
| AI-AUTO-005 | 通过 | `npm run build` 通过，仅保留已有 Vite chunk size 警告 |
| AI-PROV-001 ~ AI-PROV-006 | 通过 | 设置页、provider、隐私开关和错误路径通过 mock UI 与服务层测试覆盖 |
| AI-PANEL-001 ~ AI-PANEL-006 | 通过 | AI 面板提问、上下文预览、结果操作、空态和取消路径通过自动化与回归检查 |
| AI-IDX-001 ~ AI-IDX-007 | 通过 | 索引状态、重建、chunk 数和 Markdown 索引边界通过 mock IPC 与单元测试覆盖 |
| AI-CMD-001 ~ AI-CMD-006 | 通过 | 预置命令、复制为自定义、编辑、显示和运行链路通过 UI e2e 覆盖 |
| AI-EDIT-001 ~ AI-EDIT-007 | 通过 | Source/WYSIWYG/Split 的选区、插入、替换、追加和复制由现有编辑器回归与 AI 应用路径覆盖 |
| AI-APPLY-001 ~ AI-APPLY-010 | 通过 | 新建笔记、变更计划审核、create/modify/apply all、非法路径和冲突保护由服务层与 UI e2e 覆盖 |
| AI-UI-001 ~ AI-UI-006 | 通过 | 1360x860 主视口无可见溢出；变更计划弹窗截图已人工检查；禁用按钮样式已补强；真实桌面 modal 关闭按钮可访问性已回归 |
| AI-ERR-001 ~ AI-ERR-007 | 通过 | provider disabled、缺 key、错误 baseUrl/model、越界路径、超长上下文和敏感日志策略由单元/服务层测试覆盖 |
| REAL-PROV-001 | 通过 | 使用 `/Users/long/tmp/codexx` 的 OpenAI-compatible 配置完成真实 smoke：`/v1/models` 返回 17 个模型，默认模型存在，最小 chat 请求成功 |
| DESKTOP-001 | 通过 | 已按要求移除 `/Applications/Nolia.app`，解除单实例锁；源码 Electron 桌面实例完成真实 UI 测试 |
| DESKTOP-002 | 通过 | 真实桌面设置页确认 codexx provider、默认模型、密钥已保存占位、连接测试成功 |
| DESKTOP-003 | 通过 | 真实桌面重建 AI 索引成功，状态为可用，片段数 9 |
| DESKTOP-004 | 通过 | 真实桌面复制预置命令为自定义命令，并在 AI 面板可见 |
| DESKTOP-005 | 通过 | 真实桌面使用 codexx 发起 chat，请求返回 `NOLIA_REAL_AI_OK`，上下文预览显示当前文档 |
| DESKTOP-006 | 通过 | 真实桌面“新建笔记”创建 `AI-生成笔记.md` |
| DESKTOP-007 | 通过 | 真实桌面 AI 变更计划 create/modify 应用成功，文件写入临时工作区 |
| DESKTOP-008 | 通过 | 修复后 `role=button name=关闭` 命中实际弹窗关闭按钮，modal backdrop 不再干扰辅助技术/自动化 |

## 13. 本次发现并修复的问题

| 问题 | 影响 | 处理 |
|---|---|---|
| AI 面板只展示前 8 个命令，新增自定义命令可能不可见 | 自定义命令创建成功但用户无法在 AI 面板运行 | 已取消命令截断，确保启用命令可见 |
| 禁用按钮缺少清晰 disabled 视觉状态 | “应用全部”等按钮禁用后仍像可点击状态 | 已补充 primary/secondary/icon disabled 样式，并加入 e2e 断言 |
| modal 背景遮罩与真实关闭按钮同名 | 辅助技术/自动化按“关闭”查找时可能命中 backdrop，点击被弹窗内容拦截 | 已将 modal backdrop 从可访问按钮树中移除，保留鼠标点击关闭能力 |
| 强制终止测试 Electron 时测试 `global-state.json` 变成 0 字节 | 崩溃/强退期间如果正在写设置，可能损坏用户配置 | `SettingsService.persist()` 改为临时文件 + rename 原子写入，并补充单元测试 |

## 14. 真实桌面测试环境处理

- `/Applications/Nolia.app` 已按要求从应用目录移除，备份在 `/Users/long/tmp/nolia-uninstalled-20260609-233513/Nolia.app`。
- 测试期间真实 `~/Library/Application Support/Nolia` 已备份并临时替换为测试数据；测试结束后已恢复真实用户数据。
- 测试用户数据过程归档保留在 `/Users/long/tmp/nolia-ai-desktop-test/test-userdata-after-20260609-235331`；其中设置文件可能因修复前强制终止被截断，仅用于复盘，不作为可直接复用的数据集。
- 真实桌面截图曾在测试过程中生成并人工检查；后续全量 e2e 回归清理了 `test-results` 目录，因此不作为最终交付文件保留。

## 15. 后续复测建议

- 为真实桌面测试增加官方测试模式，例如 `NOLIA_USER_DATA_DIR` 或独立 app identity，避免以后再临时替换用户数据。
- 后续接入其他 provider 后，按 `AI-PROV-*` 与 `REAL-PROV-*` 增加 provider 矩阵测试。
