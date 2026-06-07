const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const electronBuilderCache = join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache", "winCodeSign");
const legacyRceditDir = findLegacyRceditDir(electronBuilderCache);

if (legacyRceditDir && !process.env.ELECTRON_BUILDER_RCEDIT_PATH) {
  process.env.ELECTRON_BUILDER_RCEDIT_PATH = legacyRceditDir;
}

process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";

const result = spawnSync("electron-builder", ["--win", ...process.argv.slice(2), "--publish", "never"], {
  cwd: process.cwd(),
  env: process.env,
  shell: true,
  stdio: "inherit"
});

process.exit(result.status ?? 1);

function findLegacyRceditDir(cacheDir) {
  if (!cacheDir || !existsSync(cacheDir)) {
    return undefined;
  }

  for (const entry of readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = join(cacheDir, entry.name);
    if (existsSync(join(candidate, "rcedit-x64.exe")) && existsSync(join(candidate, "rcedit-ia32.exe"))) {
      return candidate;
    }
  }

  return undefined;
}
