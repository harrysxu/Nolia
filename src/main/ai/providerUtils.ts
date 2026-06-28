import type { AiErrorCode } from "../../shared/ai";
import { AiProviderError } from "./types";

export function joinUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/^\/+/, "");
  if (/\/v1$/i.test(normalizedBaseUrl) && normalizedPath.startsWith("v1/")) {
    return `${normalizedBaseUrl}/${normalizedPath.slice(3)}`;
  }
  return `${normalizedBaseUrl}/${normalizedPath}`;
}

export async function readErrorMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === "string") {
      return json.error;
    }
    return json.error?.message ?? json.message ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export function errorCodeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) {
    return "provider_auth_failed";
  }
  if (status === 429) {
    return "provider_rate_limited";
  }
  if (status >= 400 && status < 500) {
    return "provider_bad_request";
  }
  return "provider_unreachable";
}

export function parseJsonSafely(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export async function* parseSse(response: Response): AsyncIterable<unknown> {
  if (!response.body) {
    throw new AiProviderError("模型服务没有返回可读取的响应体。请检查 Provider 地址、代理或模型服务的流式输出配置。", "provider_empty_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDataFrame = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = findSseBoundary(buffer);
    while (boundary >= 0) {
      const chunk = buffer.slice(0, boundary);
      const boundaryLength = sseBoundaryLength(buffer, boundary);
      buffer = buffer.slice(boundary + boundaryLength);
      const lines = chunk.split(/\r?\n/).filter((line) => line.startsWith("data:"));
      for (const line of lines) {
        const data = line.replace(/^data:\s?/, "");
        if (data === "[DONE]") {
          return;
        }
        sawDataFrame = true;
        yield parseJsonSafely(data);
      }
      boundary = findSseBoundary(buffer);
    }
  }
  const trailingLines = buffer.split(/\r?\n/).filter((line) => line.startsWith("data:"));
  for (const line of trailingLines) {
    const data = line.replace(/^data:\s?/, "");
    if (data === "[DONE]") {
      return;
    }
    sawDataFrame = true;
    yield parseJsonSafely(data);
  }
  if (!sawDataFrame) {
    throw new AiProviderError("模型服务返回了空的流式响应，或响应不是 OpenAI SSE 格式。请确认模型、接口模式和 Base URL 配置正确。", "provider_empty_response");
  }
}

export async function* parseNdjson(response: Response): AsyncIterable<unknown> {
  if (!response.body) {
    throw new AiProviderError("模型服务没有返回可读取的响应体。请检查 Ollama 地址或模型服务状态。", "provider_empty_response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawLine = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        sawLine = true;
        yield parseJsonSafely(line);
      }
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) {
    sawLine = true;
    yield parseJsonSafely(buffer.trim());
  }
  if (!sawLine) {
    throw new AiProviderError("模型服务返回了空的流式响应，或响应不是 Ollama NDJSON 格式。请确认 Ollama 正在运行且模型可以生成内容。", "provider_empty_response");
  }
}

function findSseBoundary(buffer: string): number {
  const unixBoundary = buffer.indexOf("\n\n");
  const windowsBoundary = buffer.indexOf("\r\n\r\n");
  if (unixBoundary < 0) {
    return windowsBoundary;
  }
  if (windowsBoundary < 0) {
    return unixBoundary;
  }
  return Math.min(unixBoundary, windowsBoundary);
}

function sseBoundaryLength(buffer: string, index: number): number {
  return buffer.startsWith("\r\n\r\n", index) ? 4 : 2;
}
