import type { AiGeneratedResult, AiModel } from "../../../../shared/ai";
import type { AiProviderAdapter, AiProviderEmbedRequest, AiProviderEmbedResponse, AiProviderGenerateRequest } from "./types";

export class MockAiProvider implements AiProviderAdapter {
  readonly type = "mock" as const;

  async test(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "Mock provider is ready." };
  }

  async listModels(request: AiProviderGenerateRequest): Promise<AiModel[]> {
    return [
      { id: "mock-fast", label: "Mock Fast", providerId: request.provider.id },
      { id: "mock-creative", label: "Mock Creative", providerId: request.provider.id }
    ];
  }

  async generate(request: AiProviderGenerateRequest): Promise<AiGeneratedResult> {
    if (request.signal?.aborted) {
      throw new DOMException("AI request cancelled", "AbortError");
    }
    const contextLines = request.contextText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8);
    const summary = contextLines.length ? contextLines.map((line) => `- ${line.slice(0, 160)}`).join("\n") : "- 未提供上下文。";
    const prompt = request.userPrompt.trim() || "请基于上下文给出帮助。";
    return {
      requestId: request.requestId,
      text: [
        "这是 Mock AI 生成的结果，可用于验证 Nolia 的 AI 链路。",
        "",
        `请求：${prompt}`,
        "",
        "上下文摘要：",
        summary,
        "",
        "后续接入 OpenAI-compatible 或 Ollama provider 后，这里会替换为真实模型输出。"
      ].join("\n"),
      citations: request.citations
    };
  }

  async embed(request: AiProviderEmbedRequest): Promise<AiProviderEmbedResponse> {
    if (request.signal?.aborted) {
      throw new DOMException("AI request cancelled", "AbortError");
    }
    return {
      embeddings: request.texts.map((text) => deterministicEmbedding(text)),
      model: request.model ?? "mock-embedding"
    };
  }
}

function deterministicEmbedding(text: string): number[] {
  const vector = new Array<number>(64).fill(0);
  const terms = text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  for (const term of terms) {
    let hash = 2166136261;
    for (let index = 0; index < term.length; index += 1) {
      hash ^= term.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const bucket = Math.abs(hash) % vector.length;
    vector[bucket] += 1 + Math.min(term.length, 12) / 12;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
}
