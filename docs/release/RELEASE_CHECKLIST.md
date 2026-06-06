# 发布检查清单

最终验收对象必须是重新打包并安装后的 App，而不是开发模式窗口。历史 QA 记录和专项测试计划已合并到本清单，发布时以本文为准。

## 1. 版本与文档

- [ ] 更新 `package.json` 版本号。
- [ ] 更新 [CHANGELOG.md](CHANGELOG.md)。
- [ ] 确认应用名称、Bundle ID、图标和文件关联。
- [ ] 复核 [隐私声明](../legal/PRIVACY.md)、[使用条款](../legal/TERMS.md)、[第三方声明](../legal/THIRD_PARTY_NOTICES.md)。
- [ ] 确认帮助菜单可打开中文 `docs/README.md` 和英文 `docs/en-US/README.md`。

## 2. 自动化检查

```sh
npm run typecheck
npm run lint
npm test
npm run e2e
npm run build
```

要求类型检查、lint、单元测试、E2E 和生产构建全部通过。若只改局部 UI，可先运行相关 E2E，再在发布前跑全量。

## 3. macOS 打包

正式发布需要 Developer ID 签名和 Apple notarization。发布身份、notary profile 和环境变量见 [macOS 签名与公证指南](MACOS_SIGNING_NOTARIZATION.md)。

```sh
export CSC_NAME="Your Name (YOURTEAMID)"
export NOTARIZE_KEYCHAIN_PROFILE="your-notary-profile"
export NOTARIZE_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

npm run verify:release
npm run build
```

正式三架构包：

```sh
npx electron-builder --mac --arm64 --publish never
npx electron-builder --mac --x64 --publish never
npx electron-builder --mac --universal --publish never
```

本地 unsigned 验证包：

```sh
npm run package:unsigned
```

如果 universal signing 阶段卡住，按 [Universal 构建异常处理](MACOS_SIGNING_NOTARIZATION.md#universal-构建异常处理) 处理。

## 4. 产物校验

```sh
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Nolia.app"
codesign --verify --deep --strict --verbose=2 "release/mac/Nolia.app"
codesign --verify --deep --strict --verbose=2 "release/mac-universal/Nolia.app"

spctl --assess --type execute -vv "release/mac-arm64/Nolia.app"
spctl --assess --type execute -vv "release/mac/Nolia.app"
spctl --assess --type execute -vv "release/mac-universal/Nolia.app"

xcrun stapler validate "release/mac-arm64/Nolia.app"
xcrun stapler validate "release/mac/Nolia.app"
xcrun stapler validate "release/mac-universal/Nolia.app"

hdiutil verify "release/Nolia-0.1.0-arm64.dmg"
hdiutil verify "release/Nolia-0.1.0.dmg"
hdiutil verify "release/Nolia-0.1.0-universal.dmg"

unzip -tq "release/Nolia-0.1.0-arm64-mac.zip"
unzip -tq "release/Nolia-0.1.0-mac.zip"
unzip -tq "release/Nolia-0.1.0-universal-mac.zip"
```

`spctl` 必须显示 `source=Notarized Developer ID`。分别记录 arm64、x64 和 universal 的 DMG/ZIP 体积。确认安装包内包含 `docs/`，并且没有打入 `test-results/`、`coverage/`、`output/` 等临时目录。

## 5. 安装版冒烟测试

1. 备份全局状态：

```sh
cp "$HOME/Library/Application Support/Nolia/global-state.json" "/tmp/nolia-global-state.backup.json"
```

2. 创建临时工作区：

```sh
mktemp -d /tmp/nolia-release-test-XXXXXX
```

3. 安装到 `/Applications/Nolia.app` 并启动。

验收项：

- [ ] 首次启动显示首页；有最近工作区时可恢复或重新选择。
- [ ] 打开/创建工作区，新建、重命名、删除和移动文件正常。
- [ ] 退出并重启后，工作区和最近文档状态正确。
- [ ] Markdown 编辑、源码、分屏模式可切换。
- [ ] 标题、加粗、斜体、删除线、列表、链接、图片、表格、公式、脚注、代码块和 Mermaid 可编辑。
- [ ] 复杂 Markdown 语法选中后可编辑原始源码，失焦后重新渲染，不产生重复转义。
- [ ] 表格行列调整、对齐、单元格选中和源码编辑正常。
- [ ] JSON 编辑器可校验、格式化、压缩、排序键。
- [ ] 文本编辑器按后缀识别语言，不误显示 Markdown 工具栏。
- [ ] 图片、PDF、音频、视频、压缩包、未知文件预览正常。
- [ ] 搜索可命中中文和英文。
- [ ] 最近、收藏、反向链接页面可打开。
- [ ] 设置页主题、字体、宽度、专注模式和插件管理正常。

## 6. 国际化与界面验收

语言矩阵：

- [ ] `zh-CN`
- [ ] `zh-TW`
- [ ] `en-US`
- [ ] `ja-JP`
- [ ] `ko-KR`
- [ ] 跟随系统

窗口尺寸：

- [ ] 1320 x 860
- [ ] 1100 x 760
- [ ] 900 x 700

主题：

- [ ] 浅色
- [ ] 深色
- [ ] 纸张
- [ ] 技术文档

重点检查：

- [ ] 活动栏、侧边栏、编辑区、右侧面板和状态栏不重叠。
- [ ] 设置弹窗尺寸稳定。
- [ ] 搜索面板、CodeMirror 搜索面板和资源工具栏可读。
- [ ] Markdown 工具栏按钮有 tooltip 或 `aria-label`。
- [ ] 弹窗、上下文菜单和表格选择器层级正确。
- [ ] 用户内容、文件名和路径不被错误翻译。

## 7. 发布后

- [ ] 上传 arm64 包。
- [ ] 上传 x64 包。
- [ ] 如保留 universal 包，明确说明体积更大。
- [ ] 发布更新日志。
- [ ] 保留校验记录和测试报告。
