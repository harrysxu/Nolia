import { randomUUID } from "node:crypto";

import type { AiPatchProposal } from "../../shared/ai";
import { sha256Text } from "../utils/hash";
import { AiProviderError, type AiRunInput } from "./types";

export function createFallbackProposal(input: AiRunInput, generatedText: string): AiPatchProposal | undefined {
  const document = input.clientContext.activeDocument;
  const text = cleanGeneratedMarkdown(generatedText);
  if (!document || !input.clientContext.workspaceId || !text) {
    return undefined;
  }
  return {
    id: randomUUID(),
    runId: input.runId,
    workspaceId: input.clientContext.workspaceId,
    pathRel: document.pathRel,
    title: document.parsedTitle || document.title,
    summary: "Generated document update",
    sourceSnapshotHash: sha256Text(document.sourceText),
    baseHash: document.baseHash,
    operations: [
      {
        type: "replaceDocument",
        beforeText: document.sourceText,
        afterText: text
      }
    ]
  };
}

export function summarizeToolInput(input: unknown): string {
  try {
    return JSON.stringify(input).slice(0, 240);
  } catch {
    return String(input).slice(0, 240);
  }
}

export function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new AiProviderError("AI run was aborted", "run_cancelled");
}

function cleanGeneratedMarkdown(value: string): string {
  return value
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
