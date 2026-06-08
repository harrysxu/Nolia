const { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, chmodSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const APPIMAGE_TOOLS_RELEASE = "appimage@1.0.2";
const APPIMAGE_TOOLS_FILE = "appimage-tools-runtime-20251108.tar.gz";
const APPIMAGE_TOOLS_SHA256 = "a784a8c26331ec2e945c23d6bdb14af5c9df27f5939825d84b8709c61dc81eb0";
const DEFAULT_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/";
const APPIMAGE_UTIL_PATH = resolve("node_modules/app-builder-lib/out/targets/appimage/appImageUtil.js");
const APPIMAGE_RUN_ORIGINAL = 'exec "$BIN"';
const APPIMAGE_RUN_PATCHED = 'ELECTRON_DISABLE_SANDBOX="\\${ELECTRON_DISABLE_SANDBOX:-1}" exec "$BIN"';

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

async function main() {
  const forwardedArgs = process.argv.slice(2);
  const env = { ...process.env };

  if (!hasEnv(env, "ELECTRON_BUILDER_BINARIES_MIRROR")) {
    env.ELECTRON_BUILDER_BINARIES_MIRROR = DEFAULT_BUILDER_BINARIES_MIRROR;
  }

  if (!forwardedArgs.includes("--dir")) {
    env.APPIMAGE_TOOLS_PATH = await prepareAppImageTools();
  }

  const restoreAppImageUtil = forwardedArgs.includes("--dir") ? undefined : patchAppImageLauncher();
  const result = runElectronBuilder(forwardedArgs, env, restoreAppImageUtil);

  process.exit(result.status ?? 1);
}

function runElectronBuilder(forwardedArgs, env, restoreAppImageUtil) {
  try {
    return spawnSync(
      "electron-builder",
      ["--linux", ...forwardedArgs, "--publish", "never", "-c.toolsets.appimage=1.0.2", "-c.compression=normal"],
      {
        cwd: process.cwd(),
        env,
        shell: true,
        stdio: "inherit"
      }
    );
  } finally {
    restoreAppImageUtil?.();
  }
}

async function prepareAppImageTools() {
  const { downloadArtifact } = require("app-builder-lib/out/binDownload");
  const artifactPath = await downloadArtifact({
    releaseName: APPIMAGE_TOOLS_RELEASE,
    filenameWithExt: APPIMAGE_TOOLS_FILE,
    checksums: {
      [APPIMAGE_TOOLS_FILE]: APPIMAGE_TOOLS_SHA256
    },
    githubOrgRepo: "electron-userland/electron-builder-binaries"
  });

  const hostPlatform = process.platform;
  const hostArch = mapArch(process.arch);
  if (hostPlatform !== "linux") {
    return artifactPath;
  }

  const hostToolDir = join(artifactPath, hostPlatform, hostArch);
  const wrapperDir = mkdtempSync(join(tmpdir(), "nolia-appimage-tools-"));

  writeToolWrapper(wrapperDir, "mksquashfs", join(hostToolDir, "mksquashfs"));
  writeToolWrapper(wrapperDir, "desktop-file-validate", join(hostToolDir, "desktop-file-validate"));
  symlinkSync(join(artifactPath, "runtimes"), join(wrapperDir, "runtimes"), "dir");
  symlinkSync(join(artifactPath, "lib"), join(wrapperDir, "lib"), "dir");

  return wrapperDir;
}

function writeToolWrapper(wrapperDir, name, target) {
  const wrapperPath = join(wrapperDir, name);
  const targetPath = resolve(target);
  writeFileSync(
    wrapperPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "unset LD_LIBRARY_PATH",
      `exec ${shellQuote(targetPath)} "$@"`,
      ""
    ].join("\n")
  );
  chmodSync(wrapperPath, 0o755);
}

function mapArch(arch) {
  switch (arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    case "arm":
      return "arm32";
    case "ia32":
      return "ia32";
    default:
      return arch;
  }
}

function hasEnv(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function patchAppImageLauncher() {
  if (!existsSync(APPIMAGE_UTIL_PATH)) {
    throw new Error(`Cannot find electron-builder AppImage utility at ${APPIMAGE_UTIL_PATH}`);
  }

  const original = readFileSync(APPIMAGE_UTIL_PATH, "utf8");
  if (original.includes(APPIMAGE_RUN_PATCHED)) {
    return undefined;
  }

  if (!original.includes(APPIMAGE_RUN_ORIGINAL)) {
    throw new Error("Cannot patch electron-builder AppRun template: expected executable line was not found.");
  }

  writeFileSync(APPIMAGE_UTIL_PATH, original.replaceAll(APPIMAGE_RUN_ORIGINAL, APPIMAGE_RUN_PATCHED));
  return () => {
    writeFileSync(APPIMAGE_UTIL_PATH, original);
  };
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
