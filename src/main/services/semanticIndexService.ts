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
const EMBEDDING_BATCH_SIZE = 4;
const SEMANTIC_INDEX_SAVE_INTERVAL = 10;
const MAX_REPORTED_SKIPPED_FILES = 5;

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
    let changedSinceSave = 0;
    const skippedFiles: Array<{ pathRel: string; message: string }> = [];
    const emit = (phase: NonNullable<AiSemanticIndexStatus["progress"]>["phase"], pathRel?: string) => {
      const status = db.semanticIndexStatus(settings, {
        phase,
        current: processed,
        total: documents.length,
        pathRel
      }, undefined, { fast: true });
      options.onProgress?.(status);
      return status;
    };

    db.setSemanticIndexMetadata({
      enabled: true,
      providerId: settings.providerId,
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiMode: settings.apiMode,
      updatedAt: db.getSemanticIndexMetadata()?.updatedAt
    });
    db.scheduleSave();
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
          try {
            chunkEmbeddings.push(...(await this.embeddings.embedMany(settings, batch, options.signal)));
          } catch (error) {
            if (options.signal?.aborted) {
              throw error;
            }
            skippedFiles.push({ pathRel: document.pathRel, message: errorMessage(error) });
            db.replaceSemanticChunks(document.pathRel, []);
            processed += 1;
            changedSinceSave += 1;
            emit("saving", document.pathRel);
            break;
          }
        }
        if (chunkEmbeddings.length !== chunkTexts.length) {
          if (changedSinceSave >= SEMANTIC_INDEX_SAVE_INTERVAL) {
            changedSinceSave = 0;
            await db.save();
          }
          continue;
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
        changedSinceSave += 1;
        emit("saving", document.pathRel);
        if (changedSinceSave >= SEMANTIC_INDEX_SAVE_INTERVAL) {
          changedSinceSave = 0;
          await db.save();
        }
      }
      db.setSemanticIndexMetadata({
        enabled: true,
        providerId: settings.providerId,
        model: settings.model,
        baseUrl: settings.baseUrl,
        apiMode: settings.apiMode,
        updatedAt: Date.now(),
        error: skippedFiles.length ? skippedFilesSummary(skippedFiles) : undefined
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

function skippedFilesSummary(skippedFiles: Array<{ pathRel: string; message: string }>): string {
  const shown = skippedFiles
    .slice(0, MAX_REPORTED_SKIPPED_FILES)
    .map((item) => `${item.pathRel}: ${item.message}`)
    .join("\n");
  const suffix = skippedFiles.length > MAX_REPORTED_SKIPPED_FILES ? `\n还有 ${skippedFiles.length - MAX_REPORTED_SKIPPED_FILES} 个文件未索引。` : "";
  return `语义索引已跳过 ${skippedFiles.length} 个失败文件，其余文件已继续处理。\n${shown}${suffix}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
