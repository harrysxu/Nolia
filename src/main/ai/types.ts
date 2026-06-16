import { z } from "zod";

import type {
  AiClientContext,
  AiErrorCode,
  AiPatchProposal,
  AiProviderProfile,
  AiProviderId,
  AiRunEvent,
  AiSettings,
  AiSourceRef,
  AiUsage
} from "../../shared/ai";
import type { DiagnosticsService } from "../services/diagnosticsService";
import type { FileSystemService } from "../services/fileSystemService";
import type { SettingsService } from "../services/settingsService";
import type { SemanticIndexService } from "../services/semanticIndexService";
import type { WorkspaceService } from "../services/workspaceService";
import type { AiSettingsService } from "./aiSettingsService";

export interface AiResolvedSettings extends AiSettings, AiProviderProfile {
  apiKey?: string;
}

export interface AiProviderCapabilities {
  streaming: boolean;
  nativeToolCalling: boolean;
  structuredOutput: boolean;
  localOnly: boolean;
  modelListing: boolean;
  usage: "tokens" | "ollama-metrics" | "none";
}

export interface AiProviderTestResultInternal {
  ok: boolean;
  providerId: AiProviderId;
  model?: string;
  message: string;
  localOnly: boolean;
  errorCode?: AiErrorCode;
}

export interface AiModelDescriptorInternal {
  id: string;
  label?: string;
  details?: string;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: Array<{ callId: string; toolName: string; input: unknown }>;
  toolCallId?: string;
  toolName?: string;
}

export interface AiProviderTool {
  name: string;
  description: string;
  parameters: unknown;
}

export interface AiProviderChatRequest {
  messages: AiChatMessage[];
  tools: AiProviderTool[];
  settings: AiResolvedSettings;
}

export type AiProviderEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; callId: string; toolName: string; input: unknown }
  | { type: "usage"; usage: AiUsage }
  | { type: "done" };

export interface AiProvider {
  id: AiProviderId;
  label: string;
  capabilities: AiProviderCapabilities;
  testConnection(settings: AiResolvedSettings, signal?: AbortSignal): Promise<AiProviderTestResultInternal>;
  listModels?(settings: AiResolvedSettings, signal?: AbortSignal): Promise<AiModelDescriptorInternal[]>;
  streamChat(request: AiProviderChatRequest, signal: AbortSignal): AsyncIterable<AiProviderEvent>;
}

export interface AiAllowedScopes {
  includeCurrentNote: boolean;
  includeSelection: boolean;
  allowWorkspaceSearch: boolean;
  allowReadSearchResults: boolean;
  allowWorkspaceRead: boolean;
  allowWorkspaceOperations: boolean;
}

export interface AiRunInput {
  runId: string;
  instruction: string;
  entryPoint: string;
  actionId?: string;
  conversation?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  settings: AiResolvedSettings;
  clientContext: AiClientContext;
  allowedScopes: AiAllowedScopes;
  allowTools: boolean;
  patchFallback: boolean;
  maxToolRounds: number;
  signal: AbortSignal;
}

export interface AiToolContext {
  runId: string;
  workspaceId?: string;
  clientContext: AiClientContext;
  allowedScopes: AiAllowedScopes;
  services: AiRuntimeServices;
  signal: AbortSignal;
  searchResultPaths: Set<string>;
}

export interface AiRuntimeServices {
  workspaces: WorkspaceService;
  files: FileSystemService;
  settings: SettingsService;
  aiSettings?: AiSettingsService;
  diagnostics: DiagnosticsService;
  semanticIndex?: SemanticIndexService;
}

export interface AiTool<TInput = unknown, TResult = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TResult>;
  permissions: Array<"current-note" | "workspace-search" | "read-note" | "workspace-read" | "workspace-proposal" | "proposal" | "tags">;
  mutability: "read" | "proposal";
  maxCallsPerRun: number;
  run(input: TInput, context: AiToolContext): Promise<TResult>;
}

export type AiToolPermission = AiTool["permissions"][number];

export interface AiToolResultEnvelope {
  result: unknown;
  summary: string;
  sourceRefs?: AiSourceRef[];
  proposal?: AiPatchProposal;
}

export interface AiRunEmitter {
  emit(event: AiRunEvent): void;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly code: AiErrorCode
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
