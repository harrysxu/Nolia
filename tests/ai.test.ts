import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  BUILTIN_AI_COMMANDS,
  DEFAULT_AI_SETTINGS,
  type AiChangePlanApplyRequest,
  type AiChangePlanOperation,
  type AiCommandDefinition
} from "../src/shared/ai";
import { WORKSPACE_META_DIR } from "../src/shared/constants";
import { sha256Text } from "../src/main/utils/hash";
import { AiChangePlanService } from "../src/main/services/ai/aiChangePlanService";
import { AiCommandService } from "../src/main/services/ai/aiCommandService";
import { AiContextService } from "../src/main/services/ai/aiContextService";
import { AiIndexService } from "../src/main/services/ai/aiIndexService";
import { AiProviderRegistry } from "../src/main/services/ai/aiProviderRegistry";
import { SettingsService } from "../src/main/services/settingsService";
import { AiService } from "../src/main/services/ai/aiService";
import { CredentialService } from "../src/main/services/ai/credentialService";
import type { DiagnosticsService } from "../src/main/services/diagnosticsService";
import type { FileSystemService } from "../src/main/services/fileSystemService";
import type { WorkspaceService } from "../src/main/services/workspaceService";

describe("AI services", () => {
  it("merges built-in and custom commands from settings", async () => {
    const root = await makeTempDir();
    try {
      const settings = new SettingsService(root);
      await settings.init();
      const customCommand: AiCommandDefinition = {
        id: "user.extract.todos",
        source: "user",
        name: "提取待办",
        enabled: true,
        order: 5,
        scopes: ["document"],
        promptTemplate: "提取待办事项。",
        defaultContext: { includeCurrentDocument: true },
        defaultApplyMode: "answer",
        ui: { commandPalette: true, editorToolbar: false, contextMenu: false, aiPanel: true }
      };
      await settings.setSetting("ai", {
        ...DEFAULT_AI_SETTINGS,
        commands: {
          [customCommand.id]: customCommand
        }
      });

      const commands = await new AiCommandService(settings).listCommands();

      expect(commands.map((command) => command.id)).toContain(BUILTIN_AI_COMMANDS[0].id);
      expect(commands.map((command) => command.id)).toContain("ai.translate.en");
      expect(commands.map((command) => command.id)).toContain("ai.propose.change-plan");
      expect(commands.map((command) => command.id)).toContain(customCommand.id);
      expect(commands[0].id).toBe(customCommand.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("loads workspace AI commands from .nolia/ai/commands.json", async () => {
    const root = await makeTempDir();
    try {
      await mkdir(path.join(root, WORKSPACE_META_DIR, "ai"), { recursive: true });
      await writeFile(path.join(root, WORKSPACE_META_DIR, "ai", "commands.json"), JSON.stringify({
        commands: [{
          id: "workspace.extract.decisions",
          name: "提取决策",
          promptTemplate: "提取当前工作区中的关键决策。",
          order: 3
        }]
      }), "utf8");
      const settings = new SettingsService(root);
      await settings.init();
      const workspaces = {
        requireWorkspace: () => ({
          info: { workspaceId: "ws_commands", rootPath: root }
        })
      } as unknown as WorkspaceService;

      const commands = await new AiCommandService(settings, workspaces).listCommands("ws_commands");

      const command = commands.find((item) => item.id === "workspace.extract.decisions");
      expect(command).toMatchObject({
        id: "workspace.extract.decisions",
        source: "workspace",
        name: "提取决策",
        enabled: true
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds visible current-document context and respects privacy settings", async () => {
    const context = new AiContextService({} as WorkspaceService, new AiIndexService());
    const preview = await context.preview({
      prompt: "总结",
      scope: "document",
      editor: {
        pathRel: "notes/today.md",
        title: "Today",
        sourceText: "# Today\n\nA local note.",
        scope: "document"
      }
    }, DEFAULT_AI_SETTINGS);

    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({ kind: "current-document", pathRel: "notes/today.md" });

    const privatePreview = await context.preview({
      prompt: "总结",
      scope: "document",
      editor: {
        pathRel: "notes/today.md",
        title: "Today",
        sourceText: "# Today\n\nA local note.",
        scope: "document"
      }
    }, {
      ...DEFAULT_AI_SETTINGS,
      privacy: {
        ...DEFAULT_AI_SETTINGS.privacy,
        allowCurrentDocumentContext: false
      }
    });

    expect(privatePreview.items).toHaveLength(0);
    expect(privatePreview.warnings.join("\n")).toContain("当前文档上下文");
  });

  it("clips preview context to the configured character budget", async () => {
    const context = new AiContextService({} as WorkspaceService, new AiIndexService());
    const sourceText = `# Long Note\n\n${"budget-control ".repeat(120)}`;

    const preview = await context.preview({
      prompt: "总结",
      scope: "document",
      editor: {
        pathRel: "notes/long.md",
        title: "Long Note",
        sourceText,
        scope: "document"
      }
    }, {
      ...DEFAULT_AI_SETTINGS,
      privacy: {
        ...DEFAULT_AI_SETTINGS.privacy,
        maxContextChars: 1_000
      }
    });

    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].excerpt.length).toBeLessThanOrEqual(1_000);
    expect(preview.estimatedInputChars).toBeLessThanOrEqual(1_000 + "总结".length);
    expect(preview.warnings.join("\n")).toContain("1000 字符预算");
  });

  it("keeps web search out of context even when requested", async () => {
    const context = new AiContextService({} as WorkspaceService, new AiIndexService());

    const preview = await context.preview({
      prompt: "查找外部信息",
      scope: "document",
      includeWebSearch: true,
      editor: {
        pathRel: "notes/today.md",
        title: "Today",
        sourceText: "# Today\n\nA local note.",
        scope: "document"
      }
    }, {
      ...DEFAULT_AI_SETTINGS,
      privacy: {
        ...DEFAULT_AI_SETTINGS.privacy,
        allowNetworkSearch: true
      }
    });

    expect(preview.items.some((item) => item.kind === "web")).toBe(false);
    expect(preview.warnings.join("\n")).toContain("当前版本不支持联网搜索");
  });

  it("builds and searches the local AI workspace index", async () => {
    const root = await makeTempDir();
    try {
      await mkdir(path.join(root, "notes"), { recursive: true });
      await writeFile(path.join(root, "notes", "rag.md"), "# RAG Design\n\nHybrid retrieval uses local chunks and full text search.", "utf8");
      await writeFile(path.join(root, "notes", "daily.md"), "# Daily\n\nUnrelated meeting notes.", "utf8");
      const index = new AiIndexService();

      const status = await index.rebuildWorkspace("ws_test", root);
      const results = await index.search("ws_test", root, "hybrid retrieval", { limit: 3 });

      expect(status.status).toBe("ready");
      expect(status.chunkCount).toBeGreaterThan(0);
      expect(results[0]).toMatchObject({ pathRel: "notes/rag.md" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("indexes searchable text resources alongside Markdown", async () => {
    const root = await makeTempDir();
    try {
      await mkdir(path.join(root, "data"), { recursive: true });
      await writeFile(path.join(root, "data", "reference.txt"), "Nolia text resource indexing includes quasar-token references.", "utf8");
      const index = new AiIndexService();

      const status = await index.rebuildWorkspace("ws_text", root, { includeMarkdown: true, includeTextResources: true });
      const results = await index.search("ws_text", root, "quasar-token", { limit: 3 });

      expect(status.status).toBe("ready");
      expect(results[0]).toMatchObject({ pathRel: "data/reference.txt" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses AI index results in workspace context before falling back to FTS", async () => {
    const root = await makeTempDir();
    try {
      await mkdir(path.join(root, "docs"), { recursive: true });
      await writeFile(path.join(root, "docs", "architecture.md"), "# Architecture\n\nAI context retrieval should cite indexed chunks.", "utf8");
      const index = new AiIndexService();
      await index.rebuildWorkspace("ws_context", root);
      const workspaces = {
        requireWorkspace: () => ({
          info: { workspaceId: "ws_context", rootPath: root },
          db: {
            search: () => ({ items: [] }),
            getBacklinks: () => ({ linked: [] })
          }
        })
      } as unknown as WorkspaceService;
      const context = new AiContextService(workspaces, index);

      const preview = await context.preview({
        workspaceId: "ws_context",
        prompt: "AI context retrieval",
        scope: "workspace",
        editor: {
          pathRel: "docs/current.md",
          title: "Current",
          sourceText: "# Current\n\nQuestion",
          scope: "workspace"
        }
      }, {
        ...DEFAULT_AI_SETTINGS,
        privacy: {
          ...DEFAULT_AI_SETTINGS.privacy,
          allowWorkspaceContext: true
        },
        index: {
          ...DEFAULT_AI_SETTINGS.index,
          enabled: true
        }
      });

      expect(preview.items.some((item) => item.id.startsWith("ai-index:") && item.pathRel === "docs/architecture.md")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("generates deterministic mock provider output with citations", async () => {
    const registry = new AiProviderRegistry();
    const result = await registry.generate({
      requestId: "req-1",
      provider: DEFAULT_AI_SETTINGS.providers.mock,
      model: "mock-fast",
      systemPrompt: "system",
      userPrompt: "总结本文",
      contextText: "文件：notes/today.md\n# Today\nA local note.",
      citations: [{ contextItemId: "current-document", pathRel: "notes/today.md" }]
    });

    expect(result.requestId).toBe("req-1");
    expect(result.text).toContain("Mock AI");
    expect(result.citations[0].pathRel).toBe("notes/today.md");
  });

  it("detects change-plan base hash conflicts during apply", async () => {
    const original = "# Plan\n\nOld content.\n";
    const changed = "# Plan\n\nChanged elsewhere.\n";
    const files = new Map<string, string>([["notes/plan.md", changed]]);
    const service = new AiChangePlanService(
      {
        requireWorkspace: () => ({ info: { workspaceId: "ws_plan", rootPath: "/tmp/ws" } })
      } as unknown as WorkspaceService,
      {
        readFile: async ({ pathRel }: { pathRel: string }) => {
          const content = files.get(pathRel);
          if (content === undefined) {
            throw new Error("missing");
          }
          return {
            content,
            sha256: sha256Text(content),
            stat: { size: content.length, mtimeMs: 1, birthtimeMs: 1 },
            encoding: "utf-8" as const
          };
        },
        writeAtomic: async () => ({ status: "saved" as const })
      } as unknown as FileSystemService
    );
    const operation: AiChangePlanOperation = {
      id: "change-1",
      action: "modify",
      pathRel: "notes/plan.md",
      content: "# Plan\n\nNew content.\n",
      after: "# Plan\n\nNew content.\n",
      baseHash: sha256Text(original),
      status: "pending"
    };

    const result = await service.apply({
      workspaceId: "ws_plan",
      plan: {
        planId: "plan-1",
        sourceText: "",
        operations: [operation],
        warnings: []
      }
    } satisfies AiChangePlanApplyRequest);

    expect(result.operations[0]).toMatchObject({
      id: "change-1",
      status: "conflict"
    });
    expect(result.operations[0].message).toContain("文件已变化");
  });

  it("returns explicit attachment extractor provider warnings for images", async () => {
    const userData = await makeTempDir();
    const workspaceRoot = await makeTempDir();
    try {
      const settings = new SettingsService(userData);
      await settings.init();
      await settings.setSetting("ai", {
        ...DEFAULT_AI_SETTINGS,
        privacy: {
          ...DEFAULT_AI_SETTINGS.privacy,
          allowAttachmentContext: true,
          allowCloudAttachmentProcessing: false
        },
        extractors: {
          ...DEFAULT_AI_SETTINGS.extractors,
          imageProviderId: "mock"
        }
      });
      await writeFile(path.join(workspaceRoot, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const service = new AiService(
        settings,
        { list: () => [], getSecret: () => undefined } as unknown as CredentialService,
        {
          requireWorkspace: () => ({ info: { workspaceId: "ws_attach", rootPath: workspaceRoot } })
        } as unknown as WorkspaceService,
        {} as FileSystemService,
        {} as DiagnosticsService
      );

      const response = await service.extractAttachment({ workspaceId: "ws_attach", pathRel: "image.png" });

      expect(response).toMatchObject({ kind: "image", providerId: "mock", cloudProcessed: false });
      expect(response.warnings.join("\n")).toContain("云端附件处理未开启");
    } finally {
      await rm(userData, { recursive: true, force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});

async function makeTempDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nolia-ai-test-"));
  await mkdir(root, { recursive: true });
  return root;
}
