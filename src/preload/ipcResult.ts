export interface PreloadIpcError {
  code: string;
  message: string;
  operationId: string;
  retryable: boolean;
}

export type PreloadIpcResult =
  | { ok: true; data: unknown }
  | { ok: false; error: PreloadIpcError };

export function isPreloadIpcResult(value: unknown): value is PreloadIpcResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { ok?: unknown; data?: unknown; error?: unknown };
  if (candidate.ok === true) {
    return "data" in candidate;
  }
  if (candidate.ok !== false || !candidate.error || typeof candidate.error !== "object") {
    return false;
  }
  const error = candidate.error as Partial<PreloadIpcError>;
  return typeof error.code === "string"
    && typeof error.message === "string"
    && typeof error.operationId === "string"
    && typeof error.retryable === "boolean";
}
