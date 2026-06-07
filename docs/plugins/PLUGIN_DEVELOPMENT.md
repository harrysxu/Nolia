# Nolia 插件指南

Nolia 的内置能力和外部插件都走扩展注册机制。外部插件只能从全局插件目录加载，默认禁用，用户必须在设置中接受权限并手动启用。

## 安装与启用

插件目录：

```text
macOS:   ~/Library/Application Support/Nolia/plugins/<pluginId>/
Windows: %APPDATA%\Nolia\plugins\<pluginId>\
Linux:   ~/.config/Nolia/plugins/<pluginId>/
```

最小结构：

```text
local.demo/
  plugin.json
  index.js
```

安装后打开「设置 -> 插件管理」，点击「重新加载」，接受权限，再启用插件。权限变化后需要重新接受，否则插件不会运行。开启外部插件安全模式时，外部插件会被禁用。

## plugin.json

```json
{
  "id": "local.demo",
  "name": "本地示例插件",
  "version": "1.0.0",
  "apiVersion": 2,
  "renderer": "index.js",
  "activationEvents": ["onStartup"],
  "permissions": ["ui:contribute", "workspace:file:read", "workspace:file:write"],
  "contributes": {
    "commands": [
      { "id": "local.demo.hello", "title": "示例命令" }
    ],
    "fileEditors": [
      {
        "id": "local.demo.jsonEditor",
        "title": "JSON 编辑器",
        "extensions": [".json"],
        "priority": 500
      }
    ]
  }
}
```

约束：

- `id` 必须全局唯一。
- 贡献点 ID 必须以插件 ID 开头，例如 `local.demo.jsonEditor`。
- `renderer` 必须是插件目录内的相对路径。
- `apiVersion` 当前为 `2`。
- 不要依赖远程脚本；依赖、worker、字体和 wasm 应随插件一起打包。

## 运行时入口

`renderer` 指向 ESM 模块，导出 `activate(context)`：

```js
export function activate(context) {
  context.api.ui.registerCommand("local.demo.hello", () => {
    console.log("Hello from plugin");
  });

  context.api.ui.registerFileEditor("local.demo.jsonEditor", (file) => {
    const root = document.createElement("div");
    const textarea = document.createElement("textarea");
    textarea.value = file.initialText;
    textarea.addEventListener("input", () => file.updateText(textarea.value));
    root.append(textarea);
    return root;
  });
}
```

外部插件不能直接访问 Node.js 或 Electron，只能使用 `context.api`。

## 文件编辑器 API

文本文件：

- `file.initialText`
- `file.readText()`
- `file.updateText(content)`
- `file.save(content?)`
- `file.writeText(content)`

二进制文件：

- `file.initialBytes`
- `file.readBinary()`
- `file.updateBinary(data)`
- `file.saveBinary(data?)`
- `file.writeBinary(data)`
- `file.url`

保存时宿主会使用打开文件时的 `baseHash` 做冲突检测，并创建历史快照。默认启用自动保存，编辑器插件通常只需要在内容变化时调用 `updateText()` 或 `updateBinary()`。

## PDF 与二进制编辑器

PDF 编辑器可声明 `.pdf` 的 `fileEditors`，用 `file.url` 或 `file.readBinary()` 渲染文件，用 `file.updateBinary()` 和 `file.saveBinary()` 写回修改后的字节。PDF.js worker 已允许从插件协议加载；真实插件应把 `pdfjs-dist`、worker、字体、wasm 等资源打包到插件目录。

## 权限

常用权限：

- `ui:contribute`：注册命令、侧边栏、文件编辑器、文件预览器等 UI。
- `workspace:file:read`：读取工作区文件。
- `workspace:file:write`：写入工作区文件。
- `workspace:read`：包含工作区文件读取能力。
- `workspace:write`：包含工作区文件写入、创建、删除能力。
- `network:request`：允许网络请求。
- `network:request:<host>`：只允许访问指定 host。

## 示例与调试

保留的本地示例：

- `examples/plugins/local.jsonEditor`：JSON 文件编辑器示例，也被 E2E 测试覆盖。

调试建议：

- 插件加载失败不会影响 App 启动，错误会进入诊断日志。
- 在「设置 -> 插件管理」查看 manifest 错误、运行时错误和权限状态。
- 修改插件代码后点击「重新加载」或重启应用。
- 先从最小插件验证加载链路，再引入复杂依赖。
