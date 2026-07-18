# Nolia Plugin API v3 指南

Nolia 将外部插件视为不可信代码。正式版本只执行 Plugin API v3；v1/v2 插件仅用于发现、状态展示和迁移诊断，不能启用或运行。

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
  index.html
  plugin.js
```

安装后进入「设置 -> 插件管理」，重新加载目录、检查 manifest 诊断、接受权限并启用。manifest 权限变化后必须重新确认。

## Manifest v3

```json
{
  "id": "local.demo",
  "name": "本地示例插件",
  "version": "1.0.0",
  "apiVersion": 3,
  "entrypoints": { "ui": "index.html" },
  "activationEvents": ["onStartup"],
  "permissions": [
    "ui:contribute",
    "workspace:file:read",
    "workspace:file:write",
    "network:request:api.example.com"
  ],
  "contributes": {
    "commands": [{ "id": "local.demo.hello", "title": "示例命令" }],
    "fileEditors": [{ "id": "local.demo.editor", "title": "示例编辑器", "extensions": [".demo"] }]
  }
}
```

约束：

- `id` 必须全局唯一，贡献点 ID 必须使用该 ID 作为前缀。
- `apiVersion` 必须为 `3`，入口必须使用 `entrypoints.ui`；`renderer` 是 v2 字段。
- UI、命令和编辑器贡献必须是声明式数据，不能向宿主注入函数、ReactNode、HTMLElement 或模块。
- 入口必须位于插件目录内；绝对路径、`..`、符号链接逃逸会被拒绝。
- 不要依赖远程脚本，依赖、worker、字体和 wasm 应随插件一起打包。

共享 Zod schema 位于 `src/shared/plugins.ts` 的 `PluginManifestV3Schema`。示例见 `examples/plugins/local.jsonEditor`。

## 隔离运行时

插件 UI 加载在 `nolia-plugin:` 独立 origin 的 iframe 中，sandbox 固定为 `allow-scripts`。插件 frame：

- 不加载 Electron preload，也没有 `window.nolia`。
- 不能访问宿主 DOM、`parent` 或 `top`。
- 不允许 same-origin、表单、弹窗和顶层导航。
- 初始化时只接收宿主传入的一条 `MessagePort`。

宿主生成不可伪造的 `sessionId`。RPC 请求必须包含：

```ts
interface PluginRpcRequest {
  version: 3;
  sessionId: string;
  requestId: string;
  method: "workspace.readText" | "workspace.writeText" | "network.request";
  payload: unknown;
}
```

插件自己声明的 `pluginId` 不参与鉴权。会话过期、frame 关闭或工作区关闭后，原 MessagePort 和 session 都不能继续使用。

## 初始化示例

```js
let port;

window.addEventListener("message", (event) => {
  if (event.data?.type !== "nolia-plugin-init" || !event.ports[0]) return;
  port = event.ports[0];
  port.start();
});

function request(method, payload) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const listener = (event) => {
      if (event.data?.requestId !== requestId) return;
      port.removeEventListener("message", listener);
      event.data.ok ? resolve(event.data.result) : reject(new Error(event.data.error.message));
    };
    port.addEventListener("message", listener);
    port.postMessage({ version: 3, requestId, method, payload });
  });
}
```

frame 不应把 `sessionId` 或 `pluginId` 放入请求；宿主会根据绑定的会话补全身份。

## 文件能力

- `workspace.readText` 需要 `workspace:file:read` 或 `workspace:read`。
- `workspace.writeText` 需要 `workspace:file:write` 或 `workspace:write`，并携带打开时的 `baseHash`。
- main process 同时检查工作区身份、写权限、规范化路径、realpath 和 symlink。
- 写入使用冲突检测和历史快照；只读工作区不能写入。

示例请求：

```js
await request("workspace.readText", { workspaceId, pathRel: "notes/demo.md" });
await request("workspace.writeText", { workspaceId, pathRel: "notes/demo.md", content, baseHash });
```

## 网络代理

插件不能直接使用宿主凭据。`network.request` 只允许 HTTP/HTTPS，并在初始请求和每次 redirect 上重新校验 host 权限与解析后的地址。

默认限制：

- host 必须由 `network:request:<完整主机名>` 或宽泛网络权限授权。
- 阻止 loopback、私网、link-local、`.local`、文件协议和凭据转发。
- 最长 30 秒、最多 5 次跳转、响应最多 5 MB。
- 过滤 `Cookie`、`Authorization`、`Proxy-Authorization`、`Host`、`Origin` 和 `Referer`。

## v2 迁移

| v2 | v3 |
| --- | --- |
| `apiVersion: 2` | `apiVersion: 3` |
| `renderer: "index.js"` | `entrypoints.ui: "index.html"` |
| renderer 动态 import | 隔离 iframe |
| `activate(context)` | MessagePort RPC |
| 注入函数/DOM | 声明式 contributes |
| renderer 直接文件 API | main capability broker |

迁移后先检查 manifest 诊断，再逐项申请最小权限。v2 插件即使此前已启用，也不会在目标版本执行。

## 调试

- frame 加载、RPC、崩溃或超时只影响当前插件容器。
- 重复运行失败会禁用插件并保留诊断信息。
- 在设置中检查 API 版本、权限 hash、入口路径和运行错误。
- 插件网络请求失败时先检查完整 host allowlist、重定向目标和私网限制。
