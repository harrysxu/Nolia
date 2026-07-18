import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { closeElectronApplication } from "./helpers/closeElectronApplication.mjs";

const electronPath = process.env.NOLIA_TEST_ELECTRON_PATH ?? path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const packagedAppPath = process.env.NOLIA_TEST_APP_PATH ?? path.resolve("release/mac-universal/Nolia.app/Contents/Resources/app.asar");
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
    args: [packagedAppPath],
    env: { ...process.env, NOLIA_USER_DATA_DIR: userData, NOLIA_DISABLE_SINGLE_INSTANCE_LOCK: "1" }
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => Boolean(window.nolia));
  const workspace = await page.evaluate((workspacePath) => window.nolia.workspace.create({ path: workspacePath }), workspaceRoot);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.nolia));
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
    5_000
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
  await rm(root, { recursive: true, force: true });
}

async function pollValue(read, accept, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}
