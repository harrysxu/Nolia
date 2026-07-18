import { performance } from "node:perf_hooks";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EditorState } from "@codemirror/state";
import { afterAll, describe, expect, it } from "vitest";

import type { AiRunEvent } from "../src/shared/ai";
import { parseMarkdown } from "../src/shared/markdown";
import { AiTaskService } from "../src/main/ai/aiTaskService";
import { DiagnosticsService } from "../src/main/services/diagnosticsService";
import { FileSystemService } from "../src/main/services/fileSystemService";
import { HistoryService } from "../src/main/services/historyService";
import { SettingsService } from "../src/main/services/settingsService";
import { WorkspaceDb } from "../src/main/services/workspaceDb";
import { WorkspaceService } from "../src/main/services/workspaceService";

const enabled = process.env.NOLIA_PERFORMANCE_ACCEPTANCE === "1";
const performanceDescribe = enabled ? describe : describe.skip;
const reportPath = path.resolve("test-results/performance-acceptance.json");
const metrics: PerformanceMetric[] = [];

interface PerformanceMetric {
  name: string;
  durationMs: number;
  budgetMs?: number;
  passed: boolean;
  details?: Record<string, number | string>;
}

performanceDescribe("release performance acceptance", () => {
  it("builds a 10,000-file physical tree snapshot within 2 seconds", async () => {
    const root = await makeTempDir("nolia-tree-perf-");
    try {
      for (let directoryIndex = 0; directoryIndex < 100; directoryIndex += 1) {
        const directory = path.join(root, `section-${String(directoryIndex).padStart(3, "0")}`);
        await mkdir(directory, { recursive: true });
        await Promise.all(Array.from({ length: 100 }, (_, fileIndex) =>
          writeFile(path.join(directory, `note-${String(fileIndex).padStart(3, "0")}.md`), `# Note ${directoryIndex}-${fileIndex}\n`)
        ));
      }
      const workspaces = {
        requireWorkspace: () => ({ info: { rootPath: root, permissions: { readable: true, writable: true } } })
      } as unknown as WorkspaceService;
      const files = new FileSystemService(workspaces, new HistoryService());
      const startedAt = performance.now();
      const tree = await files.listTree({ workspaceId: "tree-perf", root: "", sortBy: "name", showHidden: false });
      const durationMs = performance.now() - startedAt;
      const count = flattenTree(tree.nodes).length;
      record("10,000-file tree snapshot", durationMs, 2_000, { nodes: count });
      expect(count).toBe(10_100);
      expect(durationMs).toBeLessThan(2_000);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("applies an editor transaction to 100,000 characters within 16 ms", () => {
    const state = EditorState.create({ doc: "x".repeat(100_000) });
    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now();
      const transaction = state.update({ changes: { from: 50_000, to: 50_000, insert: "y" } });
      samples.push(performance.now() - startedAt);
      expect(transaction.newDoc.length).toBe(100_001);
    }
    const durationMs = percentile(samples, 0.95);
    record("100,000-character editor transaction p95", durationMs, 16, { samples: samples.length });
    expect(durationMs).toBeLessThan(16);
  });

  it("searches 10,000 indexed documents and builds a local graph within budget", async () => {
    const root = await makeTempDir("nolia-db-perf-");
    const db = await WorkspaceDb.open(path.join(root, "workspace.sqlite"));
    try {
      const seedStartedAt = performance.now();
      for (let index = 0; index < 10_000; index += 1) {
        const pathRel = `Note-${String(index).padStart(5, "0")}.md`;
        const previous = `Note-${String(Math.max(0, index - 1)).padStart(5, "0")}`;
        const unique = index === 9_999 ? " ultrarareterm" : "";
        const relation = index >= 9_940 ? `\n\n[[${previous}]]` : "";
        const content = `# Note ${index}\n\nBenchmark corpus ${index}.${unique}${relation}\n`;
        db.upsertDocument({
          pathRel,
          name: path.basename(pathRel),
          ext: ".md",
          kind: "markdown",
          size: content.length,
          mtimeMs: index + 1,
          ctimeMs: index + 1,
          sha256: `perf-${index}`
        }, parseMarkdown(content, pathRel));
      }
      metrics.push({ name: "10,000-document index seed", durationMs: round(performance.now() - seedStartedAt), passed: true, details: { documents: 10_000 } });

      const searchStartedAt = performance.now();
      const search = db.search({ workspaceId: "db-perf", query: "ultrarareterm", limit: 20 });
      const searchMs = performance.now() - searchStartedAt;
      record("FTS query on 10,000 documents", searchMs, 150, { results: search.items.length });
      expect(search.items[0]?.pathRel).toBe("Note-09999.md");
      expect(searchMs).toBeLessThan(150);

      const graphStartedAt = performance.now();
      const graph = db.getLocalGraph("Note-09999.md", 2, 60);
      const graphMs = performance.now() - graphStartedAt;
      record("local graph query", graphMs, 300, { nodes: graph.nodes.length, edges: graph.edges.length });
      expect(graph.nodes.length).toBeGreaterThan(1);
      expect(graphMs).toBeLessThan(300);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("commits a ten-file AI transaction within 2 seconds", async () => {
    const userData = await makeTempDir("nolia-ai-perf-user-");
    const home = await makeTempDir("nolia-ai-perf-home-");
    const workspaceRoot = await makeTempDir("nolia-ai-perf-workspace-");
    let workspaces: WorkspaceService | undefined;
    try {
      for (let index = 0; index < 10; index += 1) {
        await writeFile(path.join(workspaceRoot, `Note-${index}.md`), `# Note ${index}\n\nOriginal.\n`);
      }
      const settings = new SettingsService(userData);
      await settings.init();
      await settings.setSetting("ai", {
        enabled: true,
        providers: [{ id: "perf", name: "Perf", providerId: "openai-compatible", model: "test", baseUrl: "https://example.test/v1", apiMode: "chat-completions" }],
        defaultProviderId: "perf",
        allowWorkspaceRead: true,
        allowWorkspaceOperations: true
      });
      const diagnostics = new DiagnosticsService(home);
      await diagnostics.init();
      workspaces = new WorkspaceService(settings, diagnostics);
      const workspace = await workspaces.createWorkspace({ path: workspaceRoot });
      expect(workspace).toBeDefined();
      const files = new FileSystemService(workspaces, new HistoryService());
      const events: AiRunEvent[] = [];
      const tasks = new AiTaskService({ startRun: () => ({ runId: "perf-run" }), cancelRun: () => ({ ok: true }) } as never, { workspaces, files, settings, diagnostics }, (event) => events.push(event));
      const started = await tasks.start({ entryPoint: "chat", instruction: "Update ten files", clientContext: { workspaceId: workspace!.workspaceId }, options: { allowWorkspaceRead: true, allowWorkspaceOperations: true } });
      await tasks.recordEvent({
        type: "patch-proposal",
        runId: started.runId,
        proposal: {
          id: "perf-proposal",
          runId: started.runId,
          workspaceId: workspace!.workspaceId,
          pathRel: "Note-0.md",
          title: "Ten-file update",
          summary: "Append benchmark markers",
          sourceSnapshotHash: "perf",
          baseHash: "perf",
          operations: Array.from({ length: 10 }, (_, index) => ({ type: "append" as const, pathRel: `Note-${index}.md`, afterText: `AI update ${index}` }))
        }
      });
      const waiting = await tasks.read({ taskId: started.taskId });
      expect(waiting?.pendingApprovalId).toBeTruthy();
      const applyStartedAt = performance.now();
      const applied = await tasks.approveProposal({ taskId: started.taskId, approvalId: waiting!.pendingApprovalId! });
      const durationMs = performance.now() - applyStartedAt;
      record("ten-file AI transaction", durationMs, 2_000, { operations: applied?.writes[0]?.operations.length ?? 0 });
      expect(applied?.writes[0]?.status).toBe("committed");
      expect(applied?.writes[0]?.operations).toHaveLength(10);
      expect(durationMs).toBeLessThan(2_000);
      await tasks.undoWrite({ taskId: started.taskId, transactionId: applied!.writes[0].id });
    } finally {
      await workspaces?.closeActiveWorkspace();
      await rm(userData, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }, 120_000);
});

afterAll(async () => {
  if (!enabled) return;
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    passed: metrics.filter((metric) => metric.budgetMs !== undefined).length === 5 && metrics.every((metric) => metric.passed),
    metrics
  }, null, 2)}\n`, "utf8");
});

function record(name: string, durationMs: number, budgetMs: number, details?: PerformanceMetric["details"]): void {
  metrics.push({ name, durationMs: round(durationMs), budgetMs, passed: durationMs < budgetMs, details });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function flattenTree(nodes: Array<{ children?: unknown[] }>): Array<{ children?: unknown[] }> {
  return nodes.flatMap((node) => [node, ...flattenTree((node.children ?? []) as Array<{ children?: unknown[] }>)]);
}

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}
