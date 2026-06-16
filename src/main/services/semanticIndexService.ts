import type { AiEmbeddingSettings, AiSemanticIndexStatus } from "../../shared/ai";
import { sha256Text } from "../utils/hash";
import { AiEmbeddingService, type ResolvedAiEmbeddingSettings } from "../ai/embeddingService";
import { AiProviderError } from "../ai/types";
import { WorkspaceDb, type SemanticChunkRecord } from "./workspaceDb";

interface SemanticIndexRunOptions {
  reset?: boolean;
  onProgress?: (status: AiSemanticIndexStatus) => void;
  signal?: AbortSignal;
}

const CHUNK_TARGET_CHARS = 1_400;
const CHUNK_OVERLAP_CHARS = 180;
const EMBEDDING_BATCH_SIZE = 12;

export class SemanticIndexService {
  constructor(private readonly embeddings = new AiEmbeddingService()) {}

  status(db: WorkspaceDb, settings: AiEmbeddingSettings): AiSemanticIndexStatus {
    return db.semanticIndexStatus(settings);
  }

  async update(db: WorkspaceDb, settings: ResolvedAiEmbeddingSettings, options: SemanticIndexRunOptions = {}): Promise<AiSemanticIndexStatus> {
    if (!settings.enabled || !settings.model.trim()) {
      return db.semanticIndexStatus(settings);
    }
    if (options.reset) {
      db.clearSemanticIndex(settings);
      await db.save();
    }

    const documents = db.listSemanticIndexableDocuments();
    let processed = 0;
    const emit = (phase: NonNullable<AiSemanticIndexStatus["progress"]>["phase"], pathRel?: string) => {
      const status = db.semanticIndexStatus(settings, {
        phase,
        current: processed,
        total: documents.length,
        pathRel
      });
      options.onProgress?.(status);
      return status;
    };

    emit("scanning");
    try {
      for (const document of documents) {
        throwIfAborted(options.signal);
        if (db.hasCurrentSemanticChunks(document.pathRel, document.sha256, settings.providerId, settings.model)) {
          processed += 1;
          emit("scanning", document.pathRel);
          continue;
        }
        const chunkTexts = chunkDocument(document.plainText || document.title || document.pathRel);
        const chunkEmbeddings: number[][] = [];
        for (let index = 0; index < chunkTexts.length; index += EMBEDDING_BATCH_SIZE) {
          throwIfAborted(options.signal);
          emit("embedding", document.pathRel);
          const batch = chunkTexts.slice(index, index + EMBEDDING_BATCH_SIZE);
          chunkEmbeddings.push(...(await this.embeddings.embedMany(settings, batch, options.signal)));
        }
        const now = Date.now();
        const chunks: SemanticChunkRecord[] = chunkTexts.map((content, index) => ({
          pathRel: document.pathRel,
          title: document.title,
          fileSha256: document.sha256,
          chunkIndex: index,
          chunkHash: sha256Text(`${document.sha256}:${index}:${content}`),
          content,
          embedding: chunkEmbeddings[index] ?? [],
          providerId: settings.providerId,
          model: settings.model,
          dimension: chunkEmbeddings[index]?.length ?? 0,
          updatedAt: now
        })).filter((chunk) => chunk.embedding.length > 0);
        db.replaceSemanticChunks(document.pathRel, chunks);
        processed += 1;
        emit("saving", document.pathRel);
      }
      db.setSemanticIndexMetadata({
        enabled: true,
        providerId: settings.providerId,
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiMode: settings.apiMode,
        updatedAt: Date.now()
      });
      await db.save();
      const status = db.semanticIndexStatus(settings);
      options.onProgress?.(status);
      return status;
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      db.setSemanticIndexMetadata({
        enabled: true,
        providerId: settings.providerId,
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiMode: settings.apiMode,
        updatedAt: db.getSemanticIndexMetadata()?.updatedAt,
        error: message
      });
      await db.save();
      throw error instanceof AiProviderError ? error : new AiProviderError(message, "provider_bad_request");
    }
  }
}

function chunkDocument(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (!current) {
      current = paragraph;
      continue;
    }
    if (`${current}\n\n${paragraph}`.length <= CHUNK_TARGET_CHARS) {
      current = `${current}\n\n${paragraph}`;
      continue;
    }
    chunks.push(current);
    current = paragraph;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks.flatMap(splitOversizedChunk);
}

function splitOversizedChunk(value: string): string[] {
  if (value.length <= CHUNK_TARGET_CHARS * 1.4) {
    return [value];
  }
  const result: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    const end = Math.min(value.length, offset + CHUNK_TARGET_CHARS);
    result.push(value.slice(offset, end).trim());
    if (end >= value.length) {
      break;
    }
    offset = Math.max(offset + 1, end - CHUNK_OVERLAP_CHARS);
  }
  return result.filter(Boolean);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Semantic indexing was cancelled");
  }
}
