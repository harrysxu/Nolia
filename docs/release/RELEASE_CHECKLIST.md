# 发布检查清单

最终验收对象必须是重新打包并安装后的 App，而不是开发模式窗口。发布放行以本文为准；详细测试矩阵和桌面验收清单见 [QA 文档](../qa/README.md)。

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

## 4. Windows 打包

Windows 发布包包含 NSIS 安装器和 zip。当前默认不做代码签名，发布前如需签名，应补充证书配置并重新验证 SmartScreen 行为。

```sh
npm run package:win
```

本地目录包验证：

```sh
npm run package:win:dir
```

验收重点：

- [ ] 安装器显示 Nolia 名称和图标。
- [ ] 开始菜单、桌面快捷方式和任务栏图标为 Nolia 图标。
- [ ] 安装后可打开工作区、新建目录、新建文件、打开系统文件选择器。
- [ ] Windows 菜单 Undo/Redo、复制粘贴、导出和资源“在资源管理器中显示”正常。

## 5. Linux 打包

Linux 发布包包含 AppImage 和 deb。

```sh
npm run package:linux
```

本地目录包验证：

```sh
npm run package:linux:dir
```

验收重点：

- [ ] AppImage 可执行并显示 Nolia 图标。
- [ ] deb 安装后菜单项、图标和应用名称正确。
- [ ] 打开工作区、文件系统对话框、系统文件管理器定位和资源预览正常。

## 6. 产物校验

发布包命名统一为 `Nolia-版本-系统-架构.扩展名`，例如 `Nolia-1.0.0-mac-arm64.dmg`、`Nolia-1.0.0-win-x64.exe`、`Nolia-1.0.0-linux-arm64.AppImage`。

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

hdiutil verify "release/Nolia-1.0.0-mac-arm64.dmg"
hdiutil verify "release/Nolia-1.0.0-mac-x64.dmg"
hdiutil verify "release/Nolia-1.0.0-mac-universal.dmg"

unzip -tq "release/Nolia-1.0.0-mac-arm64.zip"
unzip -tq "release/Nolia-1.0.0-mac-x64.zip"
unzip -tq "release/Nolia-1.0.0-mac-universal.zip"
```

Windows 产物校验：

```powershell
Get-ChildItem release -Filter "*.exe"
Get-ChildItem release -Filter "*.zip"
```

Linux 产物校验：

```sh
ls -lh release/*.AppImage release/*.deb
```

`spctl` 必须显示 `source=Notarized Developer ID`。分别记录 macOS arm64、x64、universal，Windows installer/zip，Linux AppImage/deb 的体积。确认安装包内包含 `docs/`，并且没有打入 `test-results/`、`coverage/`、`output/` 等临时目录。

## 7. 安装版冒烟测试

1. 备份全局状态：

```sh
# macOS
cp "$HOME/Library/Application Support/Nolia/global-state.json" "/tmp/nolia-global-state.backup.json"

# Windows PowerShell
Copy-Item "$env:APPDATA\Nolia\global-state.json" "$env:TEMP\nolia-global-state.backup.json" -ErrorAction SilentlyContinue

# Linux
cp "$HOME/.config/Nolia/global-state.json" "/tmp/nolia-global-state.backup.json"
```

2. 创建临时工作区：

```sh
# macOS/Linux
mktemp -d /tmp/nolia-release-test-XXXXXX

# Windows PowerShell
New-Item -ItemType Directory -Path "$env:TEMP\nolia-release-test"
```

3. 安装或启动当前系统的发布包。

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

## 8. 国际化与界面验收

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

## 9. 发布后

- [ ] 上传 macOS arm64/x64 包。
- [ ] 如保留 macOS universal 包，明确说明体积更大。
- [ ] 上传 Windows 安装器和 zip。
- [ ] 上传 Linux AppImage 和 deb。
- [ ] 发布更新日志。
- [ ] 保留校验记录和测试报告。
