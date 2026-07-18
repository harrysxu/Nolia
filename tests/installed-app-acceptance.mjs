import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { closeElectronApplication } from "./helpers/closeElectronApplication.mjs";

const apiKey = process.env.SILICONFLOW_API_KEY;
if (!apiKey) {
  throw new Error("SILICONFLOW_API_KEY is required");
}
const primaryChatModel = process.env.NOLIA_TEST_PRIMARY_CHAT_MODEL ?? "deepseek-ai/DeepSeek-V3.2";
const fallbackChatModel = process.env.NOLIA_TEST_FALLBACK_CHAT_MODEL ?? "Qwen/Qwen3.5-9B";
const embeddingModel = process.env.NOLIA_TEST_EMBEDDING_MODEL ?? "Qwen/Qwen3-Embedding-8B";

const electronPath = process.env.NOLIA_TEST_ELECTRON_PATH ?? path.resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const packagedAppPath = process.env.NOLIA_TEST_APP_PATH ?? path.resolve("release/mac-universal/Nolia.app/Contents/Resources/app.asar");
const root = await mkdtemp(path.join(os.tmpdir(), "nolia-installed-acceptance-"));
const userData = path.join(root, "user-data");
const workspaceRoot = path.join(root, "workspace");
const externalRoot = path.join(root, "external");
const reportPath = path.resolve("test-results/installed-app-acceptance.json");
const performanceReportPath = path.resolve("test-results/performance-acceptance.json");
const checks = [];
const installedPerformanceMetrics = [];
let application;

try {
  await prepareFixture();
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
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => Boolean(window.nolia));

  await check("workspace probe and initialization", async () => {
    const result = await page.evaluate(async (workspacePath) => {
      const probe = await window.nolia.workspace.probe?.({ path: workspacePath });
      const workspace = await window.nolia.workspace.create({ path: workspacePath });
      return { probe, workspace };
    }, workspaceRoot);
    assert.equal(result.probe?.status, "initializable");
    assert.equal(result.workspace?.permissions.writable, true);
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("navigation", { name: "工作区导航" }).waitFor();

  const workspace = await page.evaluate(() => window.nolia.workspace.bootstrap().then((value) => value.activeWorkspace));
  assert.ok(workspace?.workspaceId);
  const workspaceId = workspace.workspaceId;

  await check("watcher external create patch latency", async () => {
    await page.evaluate(({ workspaceId }) => {
      window.__noliaAcceptanceWatcherEvents = [];
      window.__noliaAcceptanceWatcherUnsubscribe?.();
      window.__noliaAcceptanceWatcherUnsubscribe = window.nolia.events.onWorkspaceIndexed?.((event) => {
        if (event.workspaceId === workspaceId) window.__noliaAcceptanceWatcherEvents.push({ ...event, receivedAt: Date.now() });
      });
    }, { workspaceId });
    const startedAt = Date.now();
    await writeFile(path.join(workspaceRoot, "Watcher-Latency.md"), "# Watcher latency\n\nExternal create.\n");
    const event = await pollValue(
      () => page.evaluate(() => window.__noliaAcceptanceWatcherEvents.find((item) => item.pathRel === "Watcher-Latency.md" && item.operation === "create")),
      Boolean,
      5_000
    );
    const durationMs = event.receivedAt - startedAt;
    installedPerformanceMetrics.push({ name: "watcher external create patch", durationMs, budgetMs: 500, passed: durationMs < 500 });
    assert.ok(durationMs < 500, `Watcher patch took ${durationMs}ms`);
  });

  await check("tree, parse, atomic save, conflict and history", async () => {
    const result = await page.evaluate(async ({ workspaceId }) => {
      const tree = await window.nolia.file.listTree({ workspaceId, root: "", sortBy: "name", showHidden: false });
      const file = await window.nolia.file.read({ workspaceId, pathRel: "Project.md" });
      const parsed = await window.nolia.document.parse({ workspaceId, pathRel: "Project.md", content: file.content });
      const saved = await window.nolia.file.writeAtomic({ workspaceId, pathRel: "Project.md", content: `${file.content}\nAcceptance save.\n`, baseHash: file.sha256, createSnapshot: true });
      const conflict = await window.nolia.file.writeAtomic({ workspaceId, pathRel: "Project.md", content: "stale", baseHash: file.sha256 });
      const history = await window.nolia.file.listHistory?.({ workspaceId, pathRel: "Project.md", limit: 20 });
      return { tree, parsed, saved, conflict, history };
    }, { workspaceId });
    assert.ok(result.tree.nodes.length >= 4);
    assert.equal(result.parsed.title, "Project Atlas");
    assert.equal(result.conflict.status, "conflict");
    assert.ok(result.history?.entries.length);
  });

  await check("properties, tags and transactional tag rename", async () => {
    const result = await page.evaluate(async ({ workspaceId }) => {
      const current = await window.nolia.file.read({ workspaceId, pathRel: "Project.md" });
      const property = await window.nolia.document.mutateProperty?.({ workspaceId, pathRel: "Project.md", baseHash: current.sha256, revision: 1, mutation: { type: "set", key: "status", value: "review" } });
      const tags = await window.nolia.workspace.listTags({ workspaceId });
      const preview = await window.nolia.workspace.previewTagRename?.({ workspaceId, sourceTag: "research", targetTag: "knowledge" });
      const applied = preview ? await window.nolia.workspace.applyTagRename?.({ workspaceId, sourceTag: preview.sourceTag, targetTag: preview.targetTag, expectedBaseHashes: Object.fromEntries(preview.changes.map((item) => [item.pathRel, item.baseHash])) }) : undefined;
      return { property, tags, preview, applied };
    }, { workspaceId });
    assert.equal(result.property?.parsed.frontmatter.status, "review");
    assert.ok(result.tags.some((tag) => tag.name === "research"));
    assert.ok((result.preview?.replacements ?? 0) >= 1);
    assert.ok((result.applied?.replacements ?? 0) >= 1);
  });

  await check("links, rename preview, graph and wikilink targets", async () => {
    const result = await page.evaluate(async ({ workspaceId }) => {
      const preview = await window.nolia.file.previewRename?.({ workspaceId, sourcePathRel: "Target.md", targetPathRel: "Knowledge/Target Renamed.md" });
      await window.nolia.file.create({ workspaceId, pathRel: "Knowledge", kind: "directory" });
      const renamed = await window.nolia.file.rename({ workspaceId, sourcePathRel: "Target.md", targetPathRel: "Knowledge/Target Renamed.md", updateReferences: true });
      const project = await window.nolia.file.read({ workspaceId, pathRel: "Project.md" });
      const targets = await window.nolia.workspace.listLinkTargets?.({ workspaceId });
      const graph = await window.nolia.graph.getLocal?.({ workspaceId, pathRel: "Project.md", depth: 2, limit: 60 });
      const backlinks = await window.nolia.graph.getBacklinks({ workspaceId, pathRel: "Knowledge/Target Renamed.md", includeUnlinkedMentions: true });
      return { preview, renamed, project, targets, graph, backlinks };
    }, { workspaceId });
    assert.ok((result.preview?.changes.length ?? 0) >= 1);
    assert.match(result.project.content, /Target Renamed/);
    assert.ok(result.targets?.some((item) => item.pathRel === "Knowledge/Target Renamed.md"));
    assert.ok((result.graph?.nodes.length ?? 0) >= 2);
    assert.ok(result.backlinks.linked.length >= 1);
  });

  await check("exact search, saved search and latest-result UI", async () => {
    await poll(async () => {
      const response = await page.evaluate(({ workspaceId }) => window.nolia.search.unified?.({ workspaceId, query: { text: "quantum lighthouse", mode: "exact", limit: 20 } }), { workspaceId });
      return Boolean(response?.items.some((item) => item.pathRel === "Project.md"));
    }, 15_000);
    const saved = await page.evaluate(async ({ workspaceId }) => {
      const now = Date.now();
      await window.nolia.search.save?.({ workspaceId, search: { id: "acceptance-search", name: "Quantum", query: { text: "quantum lighthouse", mode: "exact", limit: 20 }, createdAt: now, updatedAt: now } });
      return window.nolia.search.listSaved?.({ workspaceId });
    }, { workspaceId });
    assert.ok(saved?.some((item) => item.id === "acceptance-search"));
    await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "发现" }).click();
    const search = page.getByPlaceholder("搜索标题、正文、路径、标签或属性");
    await search.fill("quantum lighthouse");
    await page.getByRole("button", { name: "精确" }).click();
    await page.getByRole("option", { name: /Project Atlas/ }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
  });

  await check("draft and session persistence", async () => {
    const result = await page.evaluate(async ({ workspaceId }) => {
      const project = await window.nolia.file.read({ workspaceId, pathRel: "Project.md" });
      await window.nolia.document.writeDraft?.({ workspaceId, pathRel: "Project.md", content: `${project.content}\nDraft only`, baseHash: project.sha256, revision: 8 });
      const draft = await window.nolia.document.readDraft?.({ workspaceId, pathRel: "Project.md" });
      const session = { workspaceId, activePathRel: "Project.md", documents: [{ pathRel: "Project.md", mode: "source", cursor: 12, scrollTop: 20, lastActiveAt: Date.now() }], recentlyClosed: [], sidebarView: "discover", inspectorView: "properties", updatedAt: Date.now() };
      await window.nolia.workspace.writeSession?.({ workspaceId, session });
      const restored = await window.nolia.workspace.readSession?.({ workspaceId });
      await window.nolia.document.deleteDraft?.({ workspaceId, pathRel: "Project.md" });
      return { draft, restored };
    }, { workspaceId });
    assert.equal(result.draft?.revision, 8);
    assert.equal(result.restored?.activePathRel, "Project.md");
  });

  await check("create, move and trash filesystem operations", async () => {
    const result = await page.evaluate(async ({ workspaceId }) => {
      await window.nolia.file.create({ workspaceId, pathRel: "Scratch.md", kind: "file", content: "# Scratch" });
      await window.nolia.file.rename({ workspaceId, sourcePathRel: "Scratch.md", targetPathRel: "Knowledge/Scratch.md" });
      const moved = await window.nolia.file.read({ workspaceId, pathRel: "Knowledge/Scratch.md" });
      await window.nolia.file.trash({ workspaceId, pathRel: "Knowledge/Scratch.md" });
      return moved.content;
    }, { workspaceId });
    assert.equal(result, "# Scratch");
  });

  await check("batch create, modify, move, search and trash 30 documents", async () => {
    const result = await page.evaluate(async ({ workspaceId }) => {
      await window.nolia.file.create({ workspaceId, pathRel: "Bulk", kind: "directory" });
      for (let index = 0; index < 30; index += 1) {
        const id = String(index).padStart(2, "0");
        await window.nolia.file.create({
          workspaceId,
          pathRel: `Bulk/Note-${id}.md`,
          kind: "file",
          content: `---\ntags: [bulk, item-${id}]\n---\n# Bulk Note ${id}\n\nBULK-SEED-${id}\n`
        });
      }
      for (let index = 0; index < 10; index += 1) {
        const id = String(index).padStart(2, "0");
        const pathRel = `Bulk/Note-${id}.md`;
        const current = await window.nolia.file.read({ workspaceId, pathRel });
        const saved = await window.nolia.file.writeAtomic({
          workspaceId,
          pathRel,
          content: `${current.content}\nBULK-MODIFIED-${id}\n`,
          baseHash: current.sha256,
          createSnapshot: true
        });
        if (saved.status !== "saved") throw new Error(`${pathRel}: ${saved.status}`);
      }
      await window.nolia.file.create({ workspaceId, pathRel: "Bulk/Moved", kind: "directory" });
      for (let index = 10; index < 20; index += 1) {
        const id = String(index).padStart(2, "0");
        await window.nolia.file.rename({
          workspaceId,
          sourcePathRel: `Bulk/Note-${id}.md`,
          targetPathRel: `Bulk/Moved/Renamed-${id}.md`
        });
      }
      for (let index = 20; index < 30; index += 1) {
        const id = String(index).padStart(2, "0");
        await window.nolia.file.trash({ workspaceId, pathRel: `Bulk/Note-${id}.md` });
      }
      const tree = await window.nolia.file.listTree({ workspaceId, root: "Bulk", sortBy: "name", showHidden: false });
      const history = await window.nolia.file.listHistory?.({ workspaceId, pathRel: "Bulk/Note-00.md", limit: 10 });
      return { tree, history };
    }, { workspaceId });
    const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
    const paths = flatten(result.tree.nodes).map((node) => node.pathRel);
    assert.equal(paths.filter((value) => /Bulk\/(?:Note|Moved\/Renamed)-\d{2}\.md$/.test(value)).length, 20);
    assert.ok(paths.includes("Bulk/Note-00.md"));
    assert.ok(paths.includes("Bulk/Moved/Renamed-10.md"));
    assert.ok(result.history?.entries.length);
    await poll(async () => {
      const response = await page.evaluate(({ workspaceId }) => window.nolia.search.query({ workspaceId, query: "BULK-MODIFIED-09", limit: 20 }), { workspaceId });
      return response.items.some((item) => item.pathRel === "Bulk/Note-09.md");
    }, 15_000);
  });

  await check("attachment import and binary atomic conflict handling", async () => {
    const sourcePath = path.join(externalRoot, "acceptance.png");
    const result = await page.evaluate(async ({ workspaceId, sourcePath }) => {
      const imported = await window.nolia.attachment.import({ workspaceId, documentPathRel: "Project.md", source: { path: sourcePath }, strategy: "workspace_assets" });
      const binary = await window.nolia.file.readBinary?.({ workspaceId, pathRel: imported.assetPathRel });
      if (!binary || !window.nolia.file.writeBinaryAtomic) throw new Error("Binary API unavailable");
      const next = new Uint8Array(binary.data.byteLength + 1);
      next.set(new Uint8Array(binary.data));
      next[next.length - 1] = 1;
      const saved = await window.nolia.file.writeBinaryAtomic({ workspaceId, pathRel: imported.assetPathRel, data: next.buffer, baseHash: binary.sha256 });
      const conflict = await window.nolia.file.writeBinaryAtomic({ workspaceId, pathRel: imported.assetPathRel, data: new Uint8Array([1, 2, 3]).buffer, baseHash: binary.sha256 });
      return { imported, binaryLength: binary.data.byteLength, saved, conflict };
    }, { workspaceId, sourcePath });
    assert.equal(result.imported.mimeType, "image/png");
    assert.ok(result.binaryLength > 60);
    assert.equal(result.saved.status, "saved");
    assert.equal(result.conflict.status, "conflict");
  });

  await check("external Markdown read, write and stale-base conflict", async () => {
    const filePath = path.join(externalRoot, "Standalone.md");
    const result = await page.evaluate(async ({ filePath }) => {
      const first = await window.nolia.externalFile?.read({ filePath });
      if (!first) throw new Error("External file API unavailable");
      const saved = await window.nolia.externalFile?.writeAtomic({ filePath, content: `${first.content}\nExternal save.\n`, baseHash: first.sha256 });
      const conflict = await window.nolia.externalFile?.writeAtomic({ filePath, content: "stale", baseHash: first.sha256 });
      const reread = await window.nolia.externalFile?.read({ filePath });
      return { saved, conflict, reread };
    }, { filePath });
    assert.equal(result.saved?.status, "saved");
    assert.equal(result.conflict?.status, "conflict");
    assert.match(result.reread?.content ?? "", /External save/);
  });

  await check("Markdown, HTML and PDF export", async () => {
    const outputs = {
      markdown: path.join(externalRoot, "Project-export.md"),
      html: path.join(externalRoot, "Project-export.html"),
      pdf: path.join(externalRoot, "Project-export.pdf")
    };
    await application.evaluate(({ dialog }, outputPaths) => {
      dialog.showSaveDialog = async (...args) => {
        const options = args.at(-1) ?? {};
        const defaultPath = String(options.defaultPath ?? "");
        const format = defaultPath.endsWith(".html") ? "html" : defaultPath.endsWith(".pdf") ? "pdf" : "markdown";
        return { canceled: false, filePath: outputPaths[format] };
      };
    }, outputs);
    for (const format of ["markdown", "html", "pdf"]) {
      const exported = await page.evaluate(({ workspaceId, format }) => window.nolia.export.document({ workspaceId, pathRel: "Project.md", format }), { workspaceId, format });
      assert.equal(exported.status, "completed", exported.warnings.join("; "));
      assert.equal(exported.outputPath, outputs[format]);
    }
    assert.match(await readFile(outputs.markdown, "utf8"), /Project Atlas/);
    assert.match(await readFile(outputs.html, "utf8"), /<!doctype html>/i);
    assert.ok((await stat(outputs.pdf)).size > 1_000);
  });

  await check("settings disk persistence and renderer reload", async () => {
    const settings = await page.evaluate(async () => {
      await window.nolia.settings.set({ key: "theme", value: "technical" });
      await window.nolia.settings.set({ key: "editorMode", value: "split" });
      await window.nolia.settings.set({ key: "dailyNoteDirectory", value: "Journal/Daily" });
      return window.nolia.settings.get();
    });
    assert.equal(settings.theme, "technical");
    assert.equal(settings.editorMode, "split");
    assert.equal(settings.dailyNoteDirectory, "Journal/Daily");
    const persisted = JSON.parse(await readFile(path.join(userData, "global-state.json"), "utf8"));
    assert.equal(persisted.settings.theme, "technical");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(window.nolia));
    const reloaded = await page.evaluate(() => window.nolia.settings.get());
    assert.equal(reloaded.theme, "technical");
    assert.equal(reloaded.editorMode, "split");
  });

  await check("Plugin API v3 permissions, session and RPC boundary", async () => {
    const result = await page.evaluate(async ({ workspaceId }) => {
      let plugins = await window.nolia.plugins?.list();
      plugins = await window.nolia.plugins?.acceptPermissions({ pluginId: "local.jsonEditor" });
      plugins = await window.nolia.plugins?.setEnabled({ pluginId: "local.jsonEditor", enabled: true });
      const session = await window.nolia.plugins?.openSession?.({ pluginId: "local.jsonEditor" });
      const read = session ? await window.nolia.plugins?.request?.({ version: 3, sessionId: session.sessionId, requestId: "read-1", method: "workspace.readText", payload: { workspaceId, pathRel: "data.json" } }) : undefined;
      const denied = session ? await window.nolia.plugins?.request?.({ version: 3, sessionId: session.sessionId, requestId: "deny-1", method: "workspace.readText", payload: { workspaceId, pathRel: "../outside.md" } }) : undefined;
      if (session) await window.nolia.plugins?.closeSession?.({ sessionId: session.sessionId });
      return { plugins, session, read, denied };
    }, { workspaceId });
    assert.ok(result.plugins?.find((item) => item.pluginId === "local.jsonEditor")?.enabled);
    assert.ok(result.session?.frameUrl.startsWith("nolia-plugin://"));
    assert.equal(result.read?.ok, true);
    assert.equal(result.denied?.ok, false);
  });

  await check("Plugin API v3 network allowlist and private-network denial", async () => {
    const result = await page.evaluate(async () => {
      const session = await window.nolia.plugins?.openSession?.({ pluginId: "local.jsonEditor" });
      if (!session) throw new Error("Plugin session unavailable");
      const allowed = await window.nolia.plugins?.request?.({ version: 3, sessionId: session.sessionId, requestId: "network-public", method: "network.request", payload: { url: "https://example.com/", method: "GET" } });
      const denied = await window.nolia.plugins?.request?.({ version: 3, sessionId: session.sessionId, requestId: "network-private", method: "network.request", payload: { url: "http://127.0.0.1/", method: "GET" } });
      await window.nolia.plugins?.closeSession?.({ sessionId: session.sessionId });
      return { allowed, denied };
    });
    assert.equal(result.allowed?.ok, true, result.allowed?.error?.message);
    assert.equal(result.allowed?.result?.status, 200);
    assert.equal(result.denied?.ok, false);
    assert.equal(result.denied?.error?.code, "plugin_network_denied");
  });

  await check("workspace health", async () => {
    const health = await page.evaluate(({ workspaceId }) => window.nolia.workspace.health?.({ workspaceId }), { workspaceId });
    assert.equal(health?.database.status, "ready");
    assert.equal(health?.watcher.status, "ready");
  });

  const provider = { id: "siliconflow-acceptance", name: "SiliconFlow", providerId: "openai-compatible", model: primaryChatModel, baseUrl: "https://api.siliconflow.cn/v1", apiMode: "chat-completions", disabled: false };
  await check("SiliconFlow model listing, secret storage and connectivity", async () => {
    const result = await page.evaluate(async ({ provider, apiKey }) => {
      const current = await window.nolia.ai.getSettings();
      const settings = await window.nolia.ai.setSettings({ settings: { enabled: true, defaultProviderId: provider.id, providers: [provider], conversationHistoryTurns: 4, agentMaxSteps: 8, allowCurrentNoteContent: true, allowWorkspaceSearch: true, allowReadSearchResults: true, allowWorkspaceRead: true, allowWorkspaceOperations: true } });
      const secured = await window.nolia.ai.setApiKey({ providerProfileId: provider.id, apiKey });
      const models = await window.nolia.ai.listModels({ providerProfileId: provider.id });
      const test = await window.nolia.ai.testProvider({ providerProfileId: provider.id });
      return { current, settings: secured, modelCount: models.length, modelFound: models.some((item) => item.id === provider.model), test };
    }, { provider, apiKey });
    assert.ok(result.settings.hasApiKey);
    assert.ok(result.modelCount > 20);
    assert.equal(result.modelFound, true);
    assert.equal(result.test.ok, true, result.test.message);
  });

  await check("SiliconFlow streaming chat", async () => {
    const run = await runAi(page, {
      entryPoint: "chat",
      instruction: "只回复 NOLIA_AI_OK，不要添加其他文字。",
      clientContext: { workspaceId },
      options: { allowTools: false }
    });
    assert.ok(run.text.trim().length > 0);
    assert.equal(run.terminal.type, "done");
  });

  await check("SiliconFlow fallback-model compatibility", async () => {
    const changed = await page.evaluate(async ({ providerId, fallbackModel }) => {
      const current = await window.nolia.ai.getSettings();
      return window.nolia.ai.setSettings({
        settings: {
          providers: current.providers.map((item) => ({
            id: item.id,
            name: item.name,
            alias: item.alias,
            providerId: item.providerId,
            model: item.id === providerId ? fallbackModel : item.model,
            baseUrl: item.baseUrl,
            apiMode: item.apiMode,
            disabled: item.disabled
          }))
        }
      });
    }, { providerId: provider.id, fallbackModel: fallbackChatModel });
    assert.equal(changed.providers.find((item) => item.id === provider.id)?.model, fallbackChatModel);
    const run = await runAi(page, {
      entryPoint: "chat",
      instruction: "只回复 NOLIA_FALLBACK_OK，不要添加其他文字。",
      clientContext: { workspaceId },
      options: { allowTools: false }
    });
    assert.equal(run.terminal.type, "done");
    assert.ok(run.text.trim().length > 0);
    await page.evaluate(async ({ providerId, primaryModel }) => {
      const current = await window.nolia.ai.getSettings();
      await window.nolia.ai.setSettings({
        settings: {
          providers: current.providers.map((item) => ({
            id: item.id,
            name: item.name,
            alias: item.alias,
            providerId: item.providerId,
            model: item.id === providerId ? primaryModel : item.model,
            baseUrl: item.baseUrl,
            apiMode: item.apiMode,
            disabled: item.disabled
          }))
        }
      });
    }, { providerId: provider.id, primaryModel: primaryChatModel });
  });

  const project = await page.evaluate(({ workspaceId }) => window.nolia.file.read({ workspaceId, pathRel: "Project.md" }), { workspaceId });
  await check("SiliconFlow current-note context", async () => {
    const run = await runAi(page, {
      entryPoint: "chat",
      instruction: "根据当前笔记，只回答项目代号是什么。",
      clientContext: { workspaceId, activeDocument: { pathRel: "Project.md", title: "Project Atlas", mode: "source", sourceText: project.content, baseHash: project.sha256, dirty: false } },
      options: { allowTools: false, includeCurrentNote: true, requireCurrentNote: true }
    });
    assert.match(run.text, /ORBIT-42/i);
  });

  await check("SiliconFlow summarize, translate, task extraction and explain actions", async () => {
    const selectionText = "The quantum lighthouse guides orbital navigation and the team must verify telemetry tomorrow.";
    const activeDocument = { pathRel: "Project.md", title: "Project Atlas", mode: "source", sourceText: project.content, baseHash: project.sha256, dirty: false };
    const selection = { text: selectionText, range: { from: 0, to: selectionText.length }, source: "source" };
    const actions = [
      ["summarize", "总结选中文本，简洁输出。"],
      ["translate", "将选中文本翻译成中文。"],
      ["todo", "从选中文本提取 Markdown 待办事项。"],
      ["explain", "解释选中文本的含义和关键点。"]
    ];
    for (const [actionId, instruction] of actions) {
      const run = await runAi(page, {
        entryPoint: "selection-action",
        actionId,
        instruction,
        clientContext: { workspaceId, activeDocument, selection },
        options: { allowTools: false, includeCurrentNote: true, includeSelection: true }
      });
      assert.equal(run.terminal.type, "done");
      assert.ok(run.text.trim().length >= 4, `${actionId} returned empty output`);
    }
  });

  await check("SiliconFlow workspace search tool and source events", async () => {
    const run = await runAi(page, {
      entryPoint: "chat",
      instruction: "必须先使用 searchNotes 工具在工作区搜索精确短语 quantum lighthouse，然后只回答找到的笔记标题。",
      clientContext: { workspaceId },
      options: { allowTools: true, allowWorkspaceSearch: true, allowWorkspaceRead: true, maxToolRounds: 4 }
    });
    assert.equal(run.terminal.type, "done");
    assert.ok(run.toolCalls.some((event) => event.toolName === "searchNotes"));
    assert.ok(run.sources.some((event) => event.source.pathRel === "Project.md"));
    assert.match(run.text, /Project\s*Atlas/i);
  });

  await check("SiliconFlow selection action, approval, transaction and undo", async () => {
    const selectionText = "The quick brown fox jumps over the lazy dog.";
    const from = project.content.indexOf(selectionText);
    assert.ok(from >= 0);
    const started = await page.evaluate(async ({ workspaceId, project, selectionText, from }) => window.nolia.ai.startTask({
      title: "Polish selection",
      entryPoint: "selection-action",
      actionId: "polish",
      instruction: "润色选中文本，保持英文，表达更专业。",
      clientContext: { workspaceId, activeDocument: { pathRel: "Project.md", title: "Project Atlas", mode: "source", sourceText: project.content, baseHash: project.sha256, dirty: false }, selection: { text: selectionText, range: { from, to: from + selectionText.length }, source: "source" } },
      options: { allowTools: false, includeCurrentNote: true, includeSelection: true, allowDocumentPatch: true, patchFallback: true }
    }), { workspaceId, project, selectionText, from });
    const waiting = await pollValue(async () => page.evaluate(({ taskId }) => window.nolia.ai.readTask({ taskId }), { taskId: started.taskId }), (task) => task?.status === "waiting_approval" || task?.status === "failed", 90_000);
    assert.equal(waiting.status, "waiting_approval", waiting.lastError);
    assert.ok(waiting.pendingApprovalId);
    const beforeApply = await readFile(path.join(workspaceRoot, "Project.md"), "utf8");
    assert.equal(beforeApply, project.content);
    const applied = await page.evaluate(({ taskId, approvalId }) => window.nolia.ai.approveProposal({ taskId, approvalId }), { taskId: started.taskId, approvalId: waiting.pendingApprovalId });
    assert.equal(applied?.status, "completed");
    assert.ok(applied?.writes.length);
    const changed = await readFile(path.join(workspaceRoot, "Project.md"), "utf8");
    assert.notEqual(changed, beforeApply);
    const undone = await page.evaluate(({ taskId, transactionId }) => window.nolia.ai.undoWrite({ taskId, transactionId }), { taskId: started.taskId, transactionId: applied.writes[0].id });
    assert.ok(undone?.writes[0].undoneAt);
    assert.equal(await readFile(path.join(workspaceRoot, "Project.md"), "utf8"), beforeApply);
  });

  await check("SiliconFlow real multi-file partial approval and undo", async () => {
    const started = await page.evaluate(async ({ workspaceId }) => window.nolia.ai.startTask({
      title: "Multi-file proposal",
      entryPoint: "chat",
      instruction: "必须调用 proposeWorkspacePatch，一次提出且仅提出以下 3 个操作：1) 创建目录 AI-Acceptance；2) 创建 AI-Acceptance/One.md，内容为 # One；3) 创建 AI-Acceptance/Two.md，内容为 # Two。不要只描述计划。",
      clientContext: { workspaceId },
      options: { allowTools: true, allowWorkspaceRead: true, allowWorkspaceOperations: true, maxToolRounds: 5 }
    }), { workspaceId });
    const waiting = await pollValue(
      () => page.evaluate(({ taskId }) => window.nolia.ai.readTask({ taskId }), { taskId: started.taskId }),
      (task) => task?.status === "waiting_approval" || task?.status === "failed",
      120_000
    );
    assert.equal(waiting.status, "waiting_approval", waiting.lastError);
    const proposal = waiting.proposals.at(-1);
    assert.ok(proposal?.operations.length >= 3, "Model did not produce the required multi-file proposal");
    const selected = proposal.operations.find((operation) => operation.type === "createFile" && operation.pathRel.endsWith("Two.md"));
    assert.ok(selected?.id);
    const applied = await page.evaluate(({ taskId, approvalId, operationId }) => window.nolia.ai.approveProposal({ taskId, approvalId, selectedOperationIds: [operationId] }), {
      taskId: started.taskId,
      approvalId: waiting.pendingApprovalId,
      operationId: selected.id
    });
    assert.equal(applied?.status, "completed");
    const transaction = applied?.writes.at(-1);
    assert.ok(transaction);
    assert.ok(transaction.operations.length < proposal.operations.length);
    assert.match(await readFile(path.join(workspaceRoot, "AI-Acceptance", "Two.md"), "utf8"), /# Two/);
    await assert.rejects(readFile(path.join(workspaceRoot, "AI-Acceptance", "One.md"), "utf8"));
    const undone = await page.evaluate(({ taskId, transactionId }) => window.nolia.ai.undoWrite({ taskId, transactionId }), { taskId: started.taskId, transactionId: transaction.id });
    assert.ok(undone?.writes.at(-1)?.undoneAt);
    await assert.rejects(readFile(path.join(workspaceRoot, "AI-Acceptance", "Two.md"), "utf8"));
  });

  await check("SiliconFlow embedding index and hybrid search", async () => {
    const embeddingSettings = { enabled: true, providerId: "openai-compatible", model: embeddingModel, baseUrl: "https://api.siliconflow.cn/v1", apiMode: "openai-embeddings" };
    const started = await page.evaluate(async ({ workspaceId, apiKey, settings }) => {
      await window.nolia.ai.setSettings({ settings: { embedding: settings } });
      await window.nolia.ai.setApiKey({ providerProfileId: "embedding:openai-compatible", apiKey });
      const test = await window.nolia.ai.testEmbedding({ settings, apiKey });
      const indexed = test.ok ? await window.nolia.ai.updateSemanticIndex({ workspaceId, settings, apiKey }) : undefined;
      return { test, indexed };
    }, { workspaceId, apiKey, settings: embeddingSettings });
    assert.equal(started.test.ok, true, started.test.message);
    const status = await pollValue(
      () => page.evaluate(({ workspaceId, apiKey, settings }) => window.nolia.ai.semanticIndexStatus({ workspaceId, settings, apiKey }), { workspaceId, apiKey, settings: embeddingSettings }),
      (value) => value.state === "ready" || value.state === "failed",
      120_000
    );
    assert.equal(status.state, "ready", status.error);
    const search = await page.evaluate(({ workspaceId }) => window.nolia.search.unified?.({ workspaceId, query: { text: "orbital navigation beacon", mode: "hybrid", limit: 20 } }), { workspaceId });
    assert.equal(search?.semanticAvailable, true);
    assert.ok(search?.items.length);
  });

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    passed: checks.length,
    models: { primaryChatModel, fallbackChatModel, embeddingModel },
    checks,
    performanceMetrics: installedPerformanceMetrics
  }, null, 2)}\n`, "utf8");
  let performanceReport;
  try {
    performanceReport = JSON.parse(await readFile(performanceReportPath, "utf8"));
  } catch {
    performanceReport = { generatedAt: new Date().toISOString(), passed: false, metrics: [] };
  }
  performanceReport.metrics = [...performanceReport.metrics.filter((metric) => metric.name !== "watcher external create patch"), ...installedPerformanceMetrics];
  performanceReport.passed = performanceReport.metrics.filter((metric) => metric.budgetMs !== undefined).length === 6 && performanceReport.metrics.every((metric) => metric.passed);
  await writeFile(performanceReportPath, `${JSON.stringify(performanceReport, null, 2)}\n`, "utf8");
  console.log(`Installed app acceptance passed: ${checks.length} checks.`);
  console.log(`Report: ${reportPath}`);
} finally {
  await closeElectronApplication(application);
  await rm(root, { recursive: true, force: true });
}

async function prepareFixture() {
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(externalRoot, { recursive: true });
  await mkdir(path.join(userData, "plugins", "local.jsonEditor"), { recursive: true });
  await cp(path.resolve("examples/plugins/local.jsonEditor"), path.join(userData, "plugins", "local.jsonEditor"), { recursive: true });
  const pluginManifestPath = path.join(userData, "plugins", "local.jsonEditor", "plugin.json");
  const pluginManifest = JSON.parse(await readFile(pluginManifestPath, "utf8"));
  pluginManifest.permissions.push("network:request:example.com", "network:request:127.0.0.1");
  await writeFile(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(workspaceRoot, "Project.md"), [
    "---", "title: Project Atlas", "tags: [research, orbit]", "priority: 2", "---", "# Project Atlas", "", "Project code: ORBIT-42.", "The quantum lighthouse guides orbital navigation.", "The quick brown fox jumps over the lazy dog.", "", "See [[Target]] and [target](Target.md).", ""
  ].join("\n"));
  await writeFile(path.join(workspaceRoot, "Target.md"), "# Target\n\nRelated knowledge node.\n#research\n");
  await writeFile(path.join(workspaceRoot, "Daily.md"), "# Daily\n\n- [ ] Verify acceptance\n");
  await writeFile(path.join(workspaceRoot, "data.json"), "{\"ok\":true}\n");
  await writeFile(path.join(externalRoot, "Standalone.md"), "# Standalone\n\nExternal document.\n");
  await writeFile(path.join(externalRoot, "acceptance.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlM0AAAAASUVORK5CYII=", "base64"));
}

async function check(name, action) {
  const startedAt = Date.now();
  await action();
  checks.push({ name, durationMs: Date.now() - startedAt });
  console.log(`PASS ${name}`);
}

async function poll(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}

async function pollValue(read, accept, timeoutMs) {
  let value;
  await poll(async () => {
    value = await read();
    return accept(value);
  }, timeoutMs);
  return value;
}

async function runAi(page, request) {
  return page.evaluate(async (runRequest) => {
    const chunks = [];
    const toolCalls = [];
    const toolResults = [];
    const sources = [];
    const proposals = [];
    return new Promise(async (resolve, reject) => {
      let runId;
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("AI run timed out"));
      }, 90_000);
      const unsubscribe = window.nolia.ai.onRunEvent((event) => {
        if (!runId || event.runId !== runId) return;
        if (event.type === "text-delta") chunks.push(event.text);
        if (event.type === "tool-call") toolCalls.push(event);
        if (event.type === "tool-result") toolResults.push(event);
        if (event.type === "source-used") sources.push(event);
        if (event.type === "patch-proposal") proposals.push(event.proposal);
        if (event.type === "error" || event.type === "cancelled" || event.type === "done") {
          clearTimeout(timeout);
          unsubscribe();
          if (event.type === "error") reject(new Error(`${event.code}: ${event.message}`));
          else resolve({ text: chunks.join(""), terminal: event, toolCalls, toolResults, sources, proposals });
        }
      });
      try {
        const started = await window.nolia.ai.startRun(runRequest);
        runId = started.runId;
      } catch (error) {
        clearTimeout(timeout);
        unsubscribe();
        reject(error);
      }
    });
  }, request);
}
