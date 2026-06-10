import { readFile } from "node:fs/promises";
import path from "node:path";

import { AiCommandDefinitionSchema, BUILTIN_AI_COMMANDS, type AiCommandDefinition } from "../../../shared/ai";
import { WORKSPACE_META_DIR } from "../../../shared/constants";
import { SettingsService } from "../settingsService";
import type { DiagnosticsService } from "../diagnosticsService";
import type { PluginService } from "../pluginService";
import type { WorkspaceService } from "../workspaceService";

export class AiCommandService {
  constructor(
    private readonly settings: SettingsService,
    private readonly workspaces?: WorkspaceService,
    private readonly plugins?: PluginService,
    private readonly diagnostics?: DiagnosticsService
  ) {}

  async listCommands(workspaceId?: string): Promise<AiCommandDefinition[]> {
    const customCommands = Object.values(this.settings.getSettings().ai.commands);
    const workspaceCommands = workspaceId ? await this.listWorkspaceCommands(workspaceId) : [];
    const pluginCommands = this.plugins?.listAiCommands() ?? [];
    return [...BUILTIN_AI_COMMANDS, ...customCommands, ...workspaceCommands, ...pluginCommands]
      .filter((command) => command.enabled)
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  }

  async findCommand(commandId: string, workspaceId?: string): Promise<AiCommandDefinition | undefined> {
    return (await this.listCommands(workspaceId)).find((command) => command.id === commandId);
  }

  private async listWorkspaceCommands(workspaceId: string): Promise<AiCommandDefinition[]> {
    if (!this.workspaces) {
      return [];
    }
    let commandsPath: string;
    try {
      const workspace = this.workspaces.requireWorkspace(workspaceId);
      commandsPath = path.join(workspace.info.rootPath, WORKSPACE_META_DIR, "ai", "commands.json");
    } catch {
      return [];
    }
    try {
      const raw = await readFile(commandsPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "commands" in parsed
        ? (parsed as { commands?: unknown }).commands
        : parsed;
      if (!Array.isArray(source)) {
        return [];
      }
      return source.reduce<AiCommandDefinition[]>((commands, item, index) => {
        const candidate = item && typeof item === "object" && !Array.isArray(item)
          ? {
              order: 15_000 + index,
              enabled: true,
              scopes: ["selection", "document", "workspace"],
              defaultContext: { includeSelection: true, includeCurrentDocument: true },
              defaultApplyMode: "answer",
              ui: { commandPalette: true, editorToolbar: false, contextMenu: false, aiPanel: true },
              ...item,
              source: "workspace"
            }
          : item;
        const parsedCommand = AiCommandDefinitionSchema.safeParse(candidate);
        if (parsedCommand.success) {
          commands.push(parsedCommand.data);
        }
        return commands;
      }, []);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.diagnostics?.warn("Failed to read workspace AI commands", {
          workspaceId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
      return [];
    }
  }
}
