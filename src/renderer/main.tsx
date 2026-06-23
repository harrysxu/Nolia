import React from "react";
import ReactDOM from "react-dom/client";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";

import { App } from "./App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {hasNoliaBridge() ? <App /> : <BridgeUnavailableScreen />}
  </React.StrictMode>
);

function hasNoliaBridge(): boolean {
  const candidate = (window as Window & { nolia?: unknown }).nolia;
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const nolia = candidate as {
    workspace?: { bootstrap?: unknown };
    events?: { onAppCommand?: unknown; onExternalFileOpen?: unknown };
  };
  return typeof nolia.workspace?.bootstrap === "function" && typeof nolia.events?.onAppCommand === "function" && typeof nolia.events?.onExternalFileOpen === "function";
}

function BridgeUnavailableScreen() {
  const locale = navigator.language.toLowerCase();
  const isChinese = locale === "zh" || locale.startsWith("zh-");
  const copy = isChinese
    ? {
        eyebrow: "桌面运行环境未连接",
        title: "请通过 Nolia 桌面应用打开",
        body: "当前页面缺少 Electron preload 提供的安全桥接，文件系统、工作区和 IPC 能力不可用。",
        hint: "开发时请使用 npm run dev 启动桌面应用。"
      }
    : {
        eyebrow: "Desktop runtime unavailable",
        title: "Open Nolia in the desktop app",
        body: "This page is missing the secure Electron preload bridge, so filesystem, workspace, and IPC APIs are unavailable.",
        hint: "During development, start the desktop app with npm run dev."
      };

  return (
    <main className="bridge-unavailable-screen" aria-label="Nolia">
      <section className="bridge-unavailable-content" aria-labelledby="bridge-unavailable-title">
        <span>{copy.eyebrow}</span>
        <h1 id="bridge-unavailable-title">{copy.title}</h1>
        <p>{copy.body}</p>
        <code>{copy.hint}</code>
      </section>
    </main>
  );
}
