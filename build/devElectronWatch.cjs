const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const mainFile = path.join(root, "dist", "main", "index.js");
const viteUrl = process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";
let electronProcess;
let restartTimer;
let lastMtime = 0;

function electronBin() {
  if (process.platform === "win32") {
    return path.join(root, "node_modules", "electron", "dist", "electron.exe");
  }
  const suffix = process.platform === "win32" ? "electron.cmd" : "electron";
  return path.join(root, "node_modules", ".bin", suffix);
}

function startElectron() {
  if (!fs.existsSync(mainFile)) {
    return;
  }
  const mtime = fs.statSync(mainFile).mtimeMs;
  lastMtime = mtime;
  electronProcess = spawn(electronBin(), ["."], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      NOLIA_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      VITE_DEV_SERVER_URL: viteUrl
    }
  });
  electronProcess.on("exit", () => {
    electronProcess = undefined;
  });
}

function restartElectron() {
  if (restartTimer) {
    clearTimeout(restartTimer);
  }
  restartTimer = setTimeout(() => {
    if (!electronProcess) {
      startElectron();
      return;
    }
    stopElectron(() => startElectron());
  }, 250);
}

function stopElectron(onStopped) {
  const processToStop = electronProcess;
  if (!processToStop) {
    onStopped();
    return;
  }
  let done = false;
  const finish = () => {
    if (done) {
      return;
    }
    done = true;
    onStopped();
  };
  processToStop.once("exit", finish);
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(processToStop.pid), "/T", "/F"], { stdio: "ignore" }).once("exit", finish);
  } else {
    processToStop.kill();
  }
}

function watchMain() {
  fs.watch(path.dirname(mainFile), { persistent: true }, (_event, filename) => {
    if (filename !== "index.js" || !fs.existsSync(mainFile)) {
      return;
    }
    const mtime = fs.statSync(mainFile).mtimeMs;
    if (mtime === lastMtime) {
      return;
    }
    lastMtime = mtime;
    restartElectron();
  });
}

process.on("SIGINT", () => {
  stopElectron(() => undefined);
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopElectron(() => undefined);
  process.exit(0);
});

startElectron();
watchMain();
