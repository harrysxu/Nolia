# macOS 签名与公证指南

本文记录 Nolia 发布 macOS 正式包时需要保留的信息和操作步骤。不要在仓库、聊天记录或文档中保存 Apple ID 密码、App 专用密码、`.p12` 私钥文件或本机 notary 凭证。

## 发布身份配置

```text
Apple ID: your-apple-id@example.com
Team ID: YOURTEAMID
Bundle ID: com.nolia.app
Signing identity: Developer ID Application: Your Name (YOURTEAMID)
CSC_NAME: Your Name (YOURTEAMID)
Notary profile: your-notary-profile
Notary keychain: ~/Library/Keychains/login.keychain-db
```

## 本机已保存的内容

- 登录钥匙串包含 `Developer ID Application` 证书和对应私钥。正式签名依赖这对证书和私钥。
- `notarytool` 公证凭证应保存到本机钥匙串 profile。
- Apple 下载的 `.cer` 证书文件可备份，但它不包含私钥。
- CSR 请求文件在证书创建后可删除或归档。

换电脑打包时，不能只复制 `.cer`。需要从钥匙串导出包含私钥的 `.p12`，设置强密码后安全保存和导入。

## 验证发布环境

```sh
security find-identity -v -p codesigning | rg "Developer ID Application"
```

应该能看到：

```text
Developer ID Application: Your Name (YOURTEAMID)
```

验证项目发布环境：

```sh
cd /Users/long/workspace/xxl_note

export CSC_NAME="Your Name (YOURTEAMID)"
export NOTARIZE_KEYCHAIN_PROFILE="your-notary-profile"
export NOTARIZE_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

npm run verify:release
```

## 重新配置公证凭证

如果 App 专用密码泄露、被撤销或更换，先在 Apple 账号后台重新生成 App 专用密码，然后执行：

```sh
xcrun notarytool store-credentials "your-notary-profile" \
  --keychain "$HOME/Library/Keychains/login.keychain-db" \
  --apple-id "your-apple-id@example.com" \
  --team-id "YOURTEAMID" \
  --password "新的App专用密码"
```

成功后只需要继续使用 profile 名，不要保存密码明文。

## 正式打包

每次打开新终端后先设置环境变量：

```sh
cd /Users/long/workspace/xxl_note

export CSC_NAME="Your Name (YOURTEAMID)"
export NOTARIZE_KEYCHAIN_PROFILE="your-notary-profile"
export NOTARIZE_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
```

发布前检查：

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

生成三种签名和公证后的正式 macOS 包：

```sh
npm run verify:release
npm run build

npx electron-builder --mac --arm64 --publish never
npx electron-builder --mac --x64 --publish never
npx electron-builder --mac --universal --publish never
```

主要发布产物：

```text
release/Nolia-0.1.0-arm64.dmg
release/Nolia-0.1.0-arm64-mac.zip
release/Nolia-0.1.0.dmg
release/Nolia-0.1.0-mac.zip
release/Nolia-0.1.0-universal.dmg
release/Nolia-0.1.0-universal-mac.zip
```

当前已验证的 0.1.0 正式包：

```text
arm64:     Nolia-0.1.0-arm64.dmg 143M, Nolia-0.1.0-arm64-mac.zip 152M
x64:       Nolia-0.1.0.dmg 149M, Nolia-0.1.0-mac.zip 168M
universal: Nolia-0.1.0-universal.dmg 227M, Nolia-0.1.0-universal-mac.zip 254M
```

本地验证包使用 `npm run package:unsigned`，不要把 unsigned 包作为正式发布包。

## Universal 构建异常处理

如果 `npx electron-builder --mac --universal --publish never` 在 signing 阶段长时间卡住，且只生成了未签名的 `release/mac-universal/Nolia.app`，不要直接发布该产物。

已验证的临时处理方式：

1. 分别生成未签名的 x64 和 arm64 dir 包。
2. 使用 `@electron/universal` 合并成 `release/mac-universal/Nolia.app`。
3. 使用 `@electron/osx-sign` 对 universal app 签名，identity 使用 `Developer ID Application: Your Name (YOURTEAMID)`，keychain 使用 `~/Library/Keychains/login.keychain-db`。
4. 使用 `@electron/notarize` 和本机 notary profile 提交公证。
5. 使用 `ditto -c -k --sequesterRsrc --keepParent Nolia.app` 生成 ZIP。
6. 使用 `npx electron-builder --mac dmg --universal --prepackaged release/mac-universal --publish never` 生成 DMG。

不要直接合并已经签名的 `release/mac` 和 `release/mac-arm64`。已签名 app 的 `Contents/CodeResources` 会因架构不同而不一致，`@electron/universal` 会拒绝合并。

## 产物校验

```sh
codesign --verify --deep --strict --verbose=2 release/mac-arm64/Nolia.app
codesign --verify --deep --strict --verbose=2 release/mac/Nolia.app
codesign --verify --deep --strict --verbose=2 release/mac-universal/Nolia.app

spctl --assess --type execute -vv release/mac-arm64/Nolia.app
spctl --assess --type execute -vv release/mac/Nolia.app
spctl --assess --type execute -vv release/mac-universal/Nolia.app

xcrun stapler validate release/mac-arm64/Nolia.app
xcrun stapler validate release/mac/Nolia.app
xcrun stapler validate release/mac-universal/Nolia.app

hdiutil verify release/Nolia-0.1.0-arm64.dmg
hdiutil verify release/Nolia-0.1.0.dmg
hdiutil verify release/Nolia-0.1.0-universal.dmg

unzip -tq release/Nolia-0.1.0-arm64-mac.zip
unzip -tq release/Nolia-0.1.0-mac.zip
unzip -tq release/Nolia-0.1.0-universal-mac.zip
```

验证结果必须包含 `source=Notarized Developer ID`。架构检查命令：

```sh
lipo -archs release/mac-arm64/Nolia.app/Contents/MacOS/Nolia
lipo -archs release/mac/Nolia.app/Contents/MacOS/Nolia
lipo -archs release/mac-universal/Nolia.app/Contents/MacOS/Nolia
```

期望结果分别为 `arm64`、`x86_64`、`x86_64 arm64`。

撤销或更换 App 专用密码不会影响已经签名并公证成功的旧包，只会影响之后再次提交公证。
