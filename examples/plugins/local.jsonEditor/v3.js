let port;
let workspaceId;
let baseHash = "new";
const pending = new Map();
const pathInput = document.querySelector("#path");
const editor = document.querySelector("#editor");
const status = document.querySelector("#status");

window.addEventListener("message", (event) => {
  if (event.data?.type !== "nolia-plugin-init" || event.data.version !== 3 || !event.ports[0]) return;
  port = event.ports[0];
  workspaceId = event.data.workspaceId;
  port.onmessage = ({ data }) => {
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    data.ok ? request.resolve(data.result) : request.reject(new Error(data.error?.message || "Plugin request failed"));
  };
  port.start();
  status.textContent = "已隔离连接";
});

document.querySelector("#load").addEventListener("click", async () => {
  try {
    if (!workspaceId) throw new Error("请先打开工作区");
    const result = await request("workspace.readText", { workspaceId, pathRel: pathInput.value });
    editor.value = result.content;
    baseHash = result.sha256;
    status.textContent = "已读取";
  } catch (error) { status.textContent = error.message; }
});

document.querySelector("#format").addEventListener("click", () => {
  try { editor.value = JSON.stringify(JSON.parse(editor.value), null, 2); status.textContent = "JSON 有效"; }
  catch (error) { status.textContent = error.message; }
});

document.querySelector("#save").addEventListener("click", async () => {
  try {
    JSON.parse(editor.value);
    const result = await request("workspace.writeText", { workspaceId, pathRel: pathInput.value, content: editor.value, baseHash });
    if (result.status !== "saved") throw new Error(result.status);
    baseHash = result.sha256;
    status.textContent = "已保存";
  } catch (error) { status.textContent = error.message; }
});

function request(method, payload) {
  if (!port) return Promise.reject(new Error("Plugin host is not connected"));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    port.postMessage({ version: 3, requestId, method, payload });
  });
}
