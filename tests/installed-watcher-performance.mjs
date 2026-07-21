import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { closeElectronApplication } from "./helpers/closeElectronApplication.mjs";

const electronPath = process.env.NOLIA_TEST_ELECTRON_PATH ?? path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const packagedAppPath = process.env.NOLIA_TEST_APP_PATH ?? path.resolve("release/mac-universal/Nolia.app/Contents/Resources/app.asar");
const launchArgs = process.env.NOLIA_TEST_PACKAGED_EXE === "1" ? [] : [packagedAppPath];
const root = await mkdtemp(path.join(os.tmpdir(), "nolia-watcher-acceptance-"));
const userData = path.join(root, "user-data");
const workspaceRoot = path.join(root, "workspace");
const reportPath = path.resolve("test-results/watcher-performance.json");
const performanceReportPath = path.resolve("test-results/performance-acceptance.json");
let application;

try {
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(path.join(workspaceRoot, "Initial.md"), "# Initial\n");
  application = await electron.launch({
    executablePath: electronPath,
    args: launchArgs,
    env: { ...process.env, NOLIA_USER_DATA_DIR: userData, NOLIA_DISABLE_SINGLE_INSTANCE_LOCK: "1" }
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => Boolean(window.nolia));
  const workspace = await page.evaluate((workspacePath) => window.nolia.workspace.create({ path: workspacePath }), workspaceRoot);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.nolia));
  await pollValue(
    () => page.evaluate(async ({ workspaceId }) => {
      const [bootstrap, health, tree] = await Promise.all([
        window.nolia.workspace.bootstrap(),
        window.nolia.workspace.health?.({ workspaceId }),
        window.nolia.file.listTree({ workspaceId, root: "", sortBy: "name", showHidden: false })
      ]);
      return {
        activeWorkspaceId: bootstrap.activeWorkspace?.workspaceId,
        watcherStatus: health?.watcher.status,
        databaseStatus: health?.database.status,
        hasInitialFile: tree.nodes.some((node) => node.pathRel === "Initial.md")
      };
    }, { workspaceId: workspace.workspaceId }),
    (value) => value.activeWorkspaceId === workspace.workspaceId && value.watcherStatus === "ready" && value.databaseStatus === "ready" && value.hasInitialFile,
    30_000
  );
  await page.evaluate(({ workspaceId }) => {
    window.__noliaWatcherPerformanceEvents = [];
    window.nolia.events.onWorkspaceIndexed?.((event) => {
      if (event.workspaceId === workspaceId) window.__noliaWatcherPerformanceEvents.push({ ...event, receivedAt: Date.now() });
    });
  }, { workspaceId: workspace.workspaceId });
  const startedAt = Date.now();
  await writeFile(path.join(workspaceRoot, "External.md"), "# External\n");
  const event = await pollValue(
    () => page.evaluate(() => window.__noliaWatcherPerformanceEvents.find((item) => item.pathRel === "External.md" && item.operation === "create")),
    Boolean,
    5_000,
    () => page.evaluate(() => window.__noliaWatcherPerformanceEvents)
  );
  const metric = { name: "watcher external create patch", durationMs: event.receivedAt - startedAt, budgetMs: 500 };
  const result = { ...metric, passed: metric.durationMs < metric.budgetMs };
  assert.equal(result.passed, true, `Watcher patch took ${result.durationMs}ms`);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const performanceReport = JSON.parse(await readFile(performanceReportPath, "utf8"));
  performanceReport.metrics = [...performanceReport.metrics.filter((item) => item.name !== result.name), result];
  performanceReport.passed = performanceReport.metrics.filter((item) => item.budgetMs !== undefined).length === 6 && performanceReport.metrics.every((item) => item.passed);
  await writeFile(performanceReportPath, `${JSON.stringify(performanceReport, null, 2)}\n`, "utf8");
  console.log(`Watcher performance passed: ${result.durationMs}ms.`);
} finally {
  await closeElectronApplication(application);
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function pollValue(read, accept, timeoutMs, readDiagnostics) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const diagnostics = readDiagnostics ? await readDiagnostics() : undefined;
  throw new Error(`Condition was not met within ${timeoutMs}ms${diagnostics === undefined ? "" : `: ${JSON.stringify(diagnostics)}`}`);
}
