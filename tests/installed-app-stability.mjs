import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { _electron as electron } from "playwright";

import { closeElectronApplication } from "./helpers/closeElectronApplication.mjs";

const execFileAsync = promisify(execFile);
const mode = process.env.NOLIA_STABILITY_MODE;
if (mode !== "stress" && mode !== "normal") throw new Error("NOLIA_STABILITY_MODE must be stress or normal");

const durationMs = Number(process.env.NOLIA_STABILITY_DURATION_MS ?? 30 * 60_000);
const sampleIntervalMs = Number(process.env.NOLIA_STABILITY_SAMPLE_INTERVAL_MS ?? 60_000);
const electronPath = process.env.NOLIA_TEST_ELECTRON_PATH ?? path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const packagedAppPath = process.env.NOLIA_TEST_APP_PATH ?? path.resolve("release/mac-universal-current/Nolia.app/Contents/Resources/app.asar");
const encryptedSecretSource = process.env.NOLIA_STABILITY_SECRET_SOURCE;
const reportPath = path.resolve(process.env.NOLIA_STABILITY_REPORT_PATH ?? `test-results/installed-app-${mode}-30m.json`);
const root = await mkdtemp(path.join(os.tmpdir(), `nolia-${mode}-30m-`));
const userData = path.join(root, "user-data");
const workspaceRoot = path.join(root, "workspace");
const externalRoot = path.join(root, "external");
const samples = [];
const rendererErrors = [];
const lifecycleEvents = [];
const aiFailures = [];
const counters = { cycles: 0, watcherEvents: 0, saves: 0, searches: 0, graphs: 0, uiEdits: 0, navigations: 0, pluginCalls: 0, aiAttempts: 0, aiRuns: 0, externalReads: 0 };
let application;
let child;
let page;
let startedAt;
let workloadEndedAt;
let health;
let processExited = false;
let shutdownStarted = false;
let aiCredentialAvailable = false;

try {
  await prepareFixtures();
  application = await electron.launch({
    executablePath: electronPath,
    args: [packagedAppPath],
    env: {
      ...process.env,
      SILICONFLOW_API_KEY: "",
      NOLIA_USER_DATA_DIR: userData,
      NOLIA_DISABLE_SINGLE_INSTANCE_LOCK: "1"
    }
  });
  child = application.process();
  child.once("exit", (code, signal) => recordLifecycle("electron-process-exit", { code, signal, expected: shutdownStarted }));
  application.on("window", (windowPage) => {
    recordLifecycle("window-opened", { url: windowPage.url() });
    attachPageDiagnostics(windowPage);
  });
  page = await application.firstWindow();
  attachPageDiagnostics(page);
  page.on("pageerror", (error) => rendererErrors.push({ kind: "pageerror", message: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") rendererErrors.push({ kind: "console", message: message.text() });
  });
  await page.waitForFunction(() => Boolean(window.nolia));
  const workspace = await page.evaluate(async ({ workspacePath }) => {
    const created = await window.nolia.workspace.create({ path: workspacePath });
    await window.nolia.settings.set({ key: "editorMode", value: "source" });
    await window.nolia.workspace.writeSession?.({
      workspaceId: created.workspaceId,
      session: {
        workspaceId: created.workspaceId,
        activePathRel: "Worklog.md",
        documents: [{ pathRel: "Worklog.md", mode: "source", cursor: 0, scrollTop: 0, lastActiveAt: Date.now() }],
        recentlyClosed: [],
        sidebarView: "files",
        inspectorView: "outline",
        updatedAt: Date.now()
      }
    });
    return created;
  }, { workspacePath: workspaceRoot });
  await page.reload({ waitUntil: "domcontentloaded" });
  const navigation = page.getByRole("navigation", { name: "工作区导航" });
  await navigation.waitFor();
  await page.evaluate(({ workspaceId }) => {
    window.__noliaStabilityWatcherEvents = 0;
    window.nolia.events.onWorkspaceIndexed?.((event) => {
      if (event.workspaceId === workspaceId && event.pathRel === "Watcher.md") window.__noliaStabilityWatcherEvents += 1;
    });
  }, { workspaceId: workspace.workspaceId });
  if (mode === "normal") aiCredentialAvailable = await configureNormalUse(page, workspace.workspaceId);
  let stressBaseHash = mode === "stress"
    ? await page.evaluate(({ workspaceId }) => window.nolia.file.read({ workspaceId, pathRel: "Long.md" }).then((file) => file.sha256), { workspaceId: workspace.workspaceId })
    : undefined;

  startedAt = Date.now();
  const deadline = startedAt + durationMs;
  let nextSampleAt = startedAt;
  while (Date.now() < deadline) {
    counters.cycles += 1;
    if (mode === "stress") {
      stressBaseHash = await runStressCycle(page, workspace.workspaceId, counters.cycles, navigation, stressBaseHash);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    } else {
      await runNormalCycle(page, workspace.workspaceId, counters.cycles, navigation);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    if (Date.now() >= nextSampleAt) {
      const sample = await sampleProcessTree(child.pid, Date.now() - startedAt);
      samples.push(sample);
      nextSampleAt += sampleIntervalMs;
      console.log(`${mode} ${Math.floor(sample.elapsedMs / 60_000)}m: cycles=${counters.cycles}, rss=${sample.rssMb}MB, fds=${sample.fileDescriptors}, cpu=${sample.cpuPercent}%`);
    }
  }

  workloadEndedAt = Date.now();
  counters.watcherEvents = await page.evaluate(() => window.__noliaStabilityWatcherEvents ?? 0);
  health = await page.evaluate(({ workspaceId }) => window.nolia.workspace.health?.({ workspaceId }), { workspaceId: workspace.workspaceId });
  samples.push(await sampleProcessTree(child.pid, Date.now() - startedAt));
  shutdownStarted = true;
  await closeElectronApplication(application);
  application = undefined;
  await new Promise((resolve) => setTimeout(resolve, 750));
  processExited = !(await processExists(child.pid));
  const actualDurationMs = workloadEndedAt - startedAt;
  const assessment = assess({ mode, requestedDurationMs: durationMs, actualDurationMs, samples, rendererErrors, counters, health, processExited, aiCredentialAvailable });

  await writeReport({
    generatedAt: new Date().toISOString(),
    mode,
    requestedDurationMs: durationMs,
    actualDurationMs,
    counters,
    samples,
    rendererErrors,
    lifecycleEvents,
    aiFailures,
    aiCredentialAvailable,
    health: health ? { watcher: health.watcher, index: health.index, database: health.database } : undefined,
    processExited,
    ...assessment
  });
  assert.equal(assessment.passed, true, assessment.reasons.join("; "));
  console.log(`${mode} stability passed: ${counters.cycles} cycles.`);
  console.log(`Report: ${reportPath}`);
} catch (error) {
  workloadEndedAt ??= Date.now();
  if (child?.pid && await processExists(child.pid)) {
    try {
      samples.push(await sampleProcessTree(child.pid, startedAt ? workloadEndedAt - startedAt : 0));
    } catch {
      // Preserve the original failure when the process tree already disappeared.
    }
  }
  const failure = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "UnknownError", message: String(error) };
  await writeReport({
    generatedAt: new Date().toISOString(),
    mode,
    requestedDurationMs: durationMs,
    actualDurationMs: startedAt ? workloadEndedAt - startedAt : 0,
    counters,
    samples,
    rendererErrors,
    lifecycleEvents,
    aiFailures,
    aiCredentialAvailable,
    health: health ? { watcher: health.watcher, index: health.index, database: health.database } : undefined,
    processExited,
    passed: false,
    reasons: [failure.message],
    failure
  });
  throw error;
} finally {
  shutdownStarted = true;
  await closeElectronApplication(application);
  await rm(root, { recursive: true, force: true });
}

function attachPageDiagnostics(targetPage) {
  if (targetPage.__noliaStabilityDiagnosticsAttached) return;
  targetPage.__noliaStabilityDiagnosticsAttached = true;
  targetPage.on("close", () => recordLifecycle("page-close", { url: targetPage.url(), expected: shutdownStarted }));
  targetPage.on("crash", () => recordLifecycle("page-crash", { url: targetPage.url(), expected: false }));
}

function recordLifecycle(event, details = {}) {
  lifecycleEvents.push({
    at: new Date().toISOString(),
    elapsedMs: startedAt ? Date.now() - startedAt : undefined,
    event,
    ...details
  });
}

async function writeReport(report) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function prepareFixtures() {
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(externalRoot, { recursive: true });
  await mkdir(path.join(userData, "plugins", "local.jsonEditor"), { recursive: true });
  if (encryptedSecretSource) {
    await cp(encryptedSecretSource, path.join(userData, "ai-secrets.json"));
  }
  await cp(path.resolve("examples/plugins/local.jsonEditor"), path.join(userData, "plugins", "local.jsonEditor"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "Worklog.md"), "---\ntags: [stability, worklog]\n---\n# Worklog\n\nNormal editing baseline.\n");
  await writeFile(path.join(workspaceRoot, "Long.md"), `${"Nolia long document stability line.\n".repeat(3_200)}\n`);
  await writeFile(path.join(workspaceRoot, "Watcher.md"), "# Watcher\n");
  await writeFile(path.join(workspaceRoot, "data.json"), "{\"status\":\"ready\"}\n");
  await writeFile(path.join(externalRoot, "External.md"), "# External\n\nExternal stability fixture.\n");
  const count = mode === "stress" ? 100 : 20;
  for (let index = 0; index < count; index += 1) {
    const id = String(index).padStart(3, "0");
    await writeFile(path.join(workspaceRoot, `Note-${id}.md`), `---\ntags: [stability, item-${id}]\n---\n# Note ${id}\n\nstability-seed-${index}\n\nSee [[Worklog]].\n`);
  }
}

async function configureNormalUse(page, workspaceId) {
  return page.evaluate(async ({ workspaceId, apiKey }) => {
    await window.nolia.plugins.acceptPermissions({ pluginId: "local.jsonEditor" });
    await window.nolia.plugins.setEnabled({ pluginId: "local.jsonEditor", enabled: true });
    const provider = { id: "stability-provider", name: "SiliconFlow", providerId: "openai-compatible", model: "Qwen/Qwen3.5-9B", baseUrl: "https://api.siliconflow.cn/v1", apiMode: "chat-completions", disabled: false };
    let settings = await window.nolia.ai.setSettings({ settings: { enabled: true, defaultProviderId: provider.id, providers: [provider], allowCurrentNoteContent: true, allowWorkspaceSearch: true, allowReadSearchResults: true, allowWorkspaceRead: true, allowWorkspaceOperations: false } });
    if (apiKey) {
      await window.nolia.ai.setApiKey({ providerProfileId: provider.id, apiKey });
      settings = await window.nolia.ai.getSettings();
    }
    await window.nolia.file.read({ workspaceId, pathRel: "Worklog.md" });
    return settings.hasApiKey;
  }, { workspaceId, apiKey: process.env.SILICONFLOW_API_KEY ?? "" });
}

async function runStressCycle(page, workspaceId, cycle, navigation, baseHash) {
  await writeFile(path.join(workspaceRoot, "Watcher.md"), `# Watcher\n\nstress-${cycle % 2}\n`);
  const nextHash = await page.evaluate(async ({ workspaceId, cycle, baseHash }) => {
    const content = `${"Nolia long document stability line.\n".repeat(3_200)}\nCycle ${cycle}\n`;
    const saved = await window.nolia.file.writeAtomic({ workspaceId, pathRel: "Long.md", content, baseHash, createSnapshot: false });
    if (saved.status !== "saved") throw new Error(`Stress save failed: ${saved.status}`);
    const search = await window.nolia.search.query({ workspaceId, query: `stability-seed-${cycle % 100}`, limit: 20 });
    if (!search.items.length) throw new Error("Stress search returned no results");
    await window.nolia.workspace.listTags({ workspaceId });
    if (cycle % 10 === 0) await window.nolia.graph.getLocal?.({ workspaceId, pathRel: "Worklog.md", depth: 2, limit: 60 });
    return saved.sha256;
  }, { workspaceId, cycle, baseHash });
  counters.saves += 1;
  counters.searches += 1;
  if (cycle % 10 === 0) counters.graphs += 1;
  if (cycle % 20 === 0 && process.env.NOLIA_STABILITY_ENABLE_STRESS_NAVIGATION === "1") {
    await navigation.getByRole("button", { name: "发现" }).click();
    await navigation.getByRole("button", { name: "文件", exact: true }).click();
    counters.navigations += 2;
  }
  return nextHash;
}

async function runNormalCycle(page, workspaceId, cycle, navigation) {
  const action = (cycle - 1) % 8;
  if (action === 0) {
    await navigation.getByRole("button", { name: "文件", exact: true }).click();
    const editor = page.locator(".source-editor .cm-content");
    if (await editor.isVisible()) {
      await editor.click();
      await page.keyboard.press("Meta+End");
      await page.keyboard.type(`\nNormal-use-${cycle}`);
      counters.uiEdits += 1;
    }
  } else if (action === 1) {
    const result = await page.evaluate(({ workspaceId, cycle }) => window.nolia.search.query({ workspaceId, query: `stability-seed-${cycle % 20}`, limit: 20 }), { workspaceId, cycle });
    if (!result.items.length) throw new Error("Normal-use search returned no results");
    counters.searches += 1;
  } else if (action === 2) {
    await page.evaluate(({ workspaceId }) => window.nolia.graph.getLocal?.({ workspaceId, pathRel: "Worklog.md", depth: 2, limit: 60 }), { workspaceId });
    counters.graphs += 1;
  } else if (action === 3) {
    await navigation.getByRole("button", { name: "发现" }).click();
    await navigation.getByRole("button", { name: "文件", exact: true }).click();
    counters.navigations += 2;
  } else if (action === 4) {
    const response = await page.evaluate((filePath) => window.nolia.externalFile.read({ filePath }), path.join(externalRoot, "External.md"));
    if (!response.content.includes("External stability fixture")) throw new Error("External file read was incomplete");
    counters.externalReads += 1;
  } else if (action === 5) {
    await page.evaluate(async ({ workspaceId, cycle }) => {
      const session = await window.nolia.plugins.openSession({ pluginId: "local.jsonEditor" });
      const response = await window.nolia.plugins.request({ version: 3, sessionId: session.sessionId, requestId: `normal-${cycle}`, method: "workspace.readText", payload: { workspaceId, pathRel: "data.json" } });
      await window.nolia.plugins.closeSession({ sessionId: session.sessionId });
      if (!response.ok) throw new Error(response.error.message);
    }, { workspaceId, cycle });
    counters.pluginCalls += 1;
  } else if (action === 6) {
    const current = await page.evaluate(({ workspaceId }) => window.nolia.file.read({ workspaceId, pathRel: "Worklog.md" }), { workspaceId });
    const result = await page.evaluate(({ workspaceId, current, cycle }) => window.nolia.file.writeAtomic({ workspaceId, pathRel: "Worklog.md", content: `${current.content.replace(/\nNormal-save-\d+\n?$/, "")}\nNormal-save-${cycle}\n`, baseHash: current.sha256, createSnapshot: false }), { workspaceId, current, cycle });
    if (result.status !== "saved") throw new Error(`Normal-use save failed: ${result.status}`);
    counters.saves += 1;
  } else {
    await page.evaluate(({ workspaceId }) => Promise.all([window.nolia.workspace.listTags({ workspaceId }), window.nolia.workspace.health?.({ workspaceId })]), { workspaceId });
  }

  const elapsedMs = startedAt ? Date.now() - startedAt : 0;
  const requiredAiRuns = durationMs < 60_000 ? 1 : 3;
  const aiMilestones = durationMs < 60_000 ? [0] : [0, durationMs / 3, durationMs * 2 / 3, durationMs * 0.8, durationMs * 0.9];
  if (aiCredentialAvailable && counters.aiRuns < requiredAiRuns && counters.aiAttempts < aiMilestones.length && elapsedMs >= aiMilestones[counters.aiAttempts]) {
    counters.aiAttempts += 1;
    try {
      const run = await runAi(page, {
        entryPoint: "chat",
        instruction: `只回复 NORMAL_USE_OK_${counters.aiRuns + 1}，不要调用工具。`,
        clientContext: { workspaceId },
        options: { allowTools: false }
      });
      if (run.terminal.type !== "done" || !run.text.trim()) throw new Error("Normal-use AI run did not complete");
      counters.aiRuns += 1;
    } catch (error) {
      aiFailures.push({
        attempt: counters.aiAttempts,
        elapsedMs: Date.now() - (startedAt ?? Date.now()),
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

async function runAi(page, request) {
  return page.evaluate(async (runRequest) => new Promise(async (resolve, reject) => {
    const chunks = [];
    let runId;
    const timeout = setTimeout(() => {
      unsubscribe();
      if (runId) void window.nolia.ai.cancelRun({ runId });
      reject(new Error("Normal-use AI timeout"));
    }, 180_000);
    const unsubscribe = window.nolia.ai.onRunEvent((event) => {
      if (!runId || event.runId !== runId) return;
      if (event.type === "text-delta") chunks.push(event.text);
      if (event.type === "error" || event.type === "cancelled" || event.type === "done") {
        clearTimeout(timeout);
        unsubscribe();
        if (event.type === "error") reject(new Error(`${event.code}: ${event.message}`));
        else resolve({ text: chunks.join(""), terminal: event });
      }
    });
    try {
      runId = (await window.nolia.ai.startRun(runRequest)).runId;
    } catch (error) {
      clearTimeout(timeout);
      unsubscribe();
      reject(error);
    }
  }), request);
}

async function sampleProcessTree(rootPid, elapsedMs) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss=,%cpu=,command="], { maxBuffer: 10 * 1024 * 1024 });
  const processes = stdout.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[3]), cpu: Number(match[4]), command: match[5] }] : [];
  });
  const pids = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (pids.has(process.ppid) && !pids.has(process.pid)) { pids.add(process.pid); changed = true; }
    }
  }
  const tree = processes.filter((process) => pids.has(process.pid));
  const byProcessType = Object.fromEntries(["main", "renderer", "gpu", "utility", "other"].map((type) => [type, 0]));
  for (const process of tree) {
    const type = process.pid === rootPid ? "main" : process.command.includes("--type=renderer") ? "renderer" : process.command.includes("--type=gpu-process") ? "gpu" : process.command.includes("--type=utility") ? "utility" : "other";
    byProcessType[type] += Math.round(process.rssKb / 1024);
  }
  let fileDescriptors = 0;
  for (const pid of pids) {
    try {
      const result = await execFileAsync("lsof", ["-p", String(pid), "-Fn"], { maxBuffer: 20 * 1024 * 1024 });
      fileDescriptors += result.stdout.split("\n").filter((line) => line.startsWith("f")).length;
    } catch {
      // Helper processes may exit between snapshots.
    }
  }
  return {
    elapsedMs,
    processCount: tree.length,
    rssMb: Math.round(tree.reduce((sum, process) => sum + process.rssKb, 0) / 1024),
    cpuPercent: Number(tree.reduce((sum, process) => sum + process.cpu, 0).toFixed(1)),
    fileDescriptors,
    rssByProcessTypeMb: byProcessType
  };
}

function assess(input) {
  const reasons = [];
  const first = medianWindow(input.samples.slice(0, 3));
  const last = medianWindow(input.samples.slice(-3));
  if (input.actualDurationMs < input.requestedDurationMs) reasons.push("Run ended before the requested duration");
  if (!input.processExited) reasons.push("Electron main process remained after shutdown");
  if (input.health?.watcher?.status !== "ready") reasons.push("Watcher health was not ready at the end");
  if (input.health?.database?.status !== "ready") reasons.push("Database health was not ready at the end");
  if (first && last && last.rssMb > Math.max(first.rssMb * 1.5, first.rssMb + 300)) reasons.push(`RSS grew from ${first.rssMb}MB to ${last.rssMb}MB`);
  if (first && last && last.fileDescriptors > first.fileDescriptors + 80) reasons.push(`File descriptors grew from ${first.fileDescriptors} to ${last.fileDescriptors}`);
  if (first && last && last.processCount > first.processCount + 3) reasons.push(`Process count grew from ${first.processCount} to ${last.processCount}`);
  const criticalErrors = input.rendererErrors.filter((error) => /unhandled|preload|renderer process crashed|out of memory/i.test(error.message));
  if (criticalErrors.length) reasons.push(`${criticalErrors.length} critical renderer errors were observed`);
  if (input.mode === "stress") {
    const minimumCycles = input.requestedDurationMs < 60_000 ? 3 : 10;
    if (input.counters.cycles < minimumCycles) reasons.push("Too few stress cycles completed");
    if (input.counters.watcherEvents < Math.floor(input.counters.cycles * 0.7)) reasons.push(`Watcher delivered only ${input.counters.watcherEvents}/${input.counters.cycles} events`);
  } else {
    for (const key of ["searches", "graphs", "uiEdits", "navigations", "pluginCalls", "externalReads"]) {
      if (input.counters[key] < 1) reasons.push(`Normal-use counter ${key} was not exercised`);
    }
    if (input.aiCredentialAvailable && input.counters.aiRuns < (input.requestedDurationMs < 60_000 ? 1 : 3)) reasons.push("Normal-use AI milestones were not completed");
    if (!input.aiCredentialAvailable) reasons.push("Normal-use AI credential was unavailable");
  }
  return { passed: reasons.length === 0, reasons, resourceComparison: { first, last } };
}

function medianWindow(values) {
  if (!values.length) return undefined;
  const median = (items) => [...items].sort((a, b) => a - b)[Math.floor(items.length / 2)];
  return {
    rssMb: median(values.map((value) => value.rssMb)),
    fileDescriptors: median(values.map((value) => value.fileDescriptors)),
    processCount: median(values.map((value) => value.processCount))
  };
}

async function processExists(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
