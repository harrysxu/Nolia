import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_META_DIR } from "../../../shared/constants";
import { parseMarkdown } from "../../../shared/markdown";
import type { AiIndexError, AiIndexStatus } from "../../../shared/ai";
import { isAlwaysIgnoredWorkspacePath, isMarkdownPath, normalizePathRel, toWorkspaceRelative } from "../../utils/filePaths";
import { sha256Text } from "../../utils/hash";

export interface AiIndexChunk {
  id: string;
  pathRel: string;
  title: string;
  heading?: string;
  tags?: string[];
  startLine: number;
  endLine: number;
  text: string;
  charCount: number;
  sha256: string;
}

export interface AiIndexEmbeddingProfile {
  providerId: string;
  model?: string;
  profileHash: string;
}

export interface AiIndexEmbeddingEntry {
  chunkId: string;
  sha256: string;
  vector: number[];
}

export interface AiIndexSearchResult extends AiIndexChunk {
  score: number;
  keywordScore: number;
  vectorScore?: number;
}

interface AiIndexFile {
  version: 1;
  workspaceId: string;
  updatedAt: number;
  chunks: AiIndexChunk[];
}

interface AiEmbeddingFile {
  version: 1;
  workspaceId: string;
  updatedAt: number;
  profile: AiIndexEmbeddingProfile;
  embeddings: AiIndexEmbeddingEntry[];
}

export interface AiIndexRebuildOptions {
  includeMarkdown?: boolean;
  includeTextResources?: boolean;
  excludeGlobs?: string[];
  excludeExtensions?: string[];
  excludeTags?: string[];
  embeddingProfile?: AiIndexEmbeddingProfile;
  embed?: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
  signal?: AbortSignal;
}

export interface AiIndexSearchOptions {
  pathPrefix?: string;
  limit?: number;
  embeddingProfile?: AiIndexEmbeddingProfile;
  embedQuery?: (query: string) => Promise<number[]>;
}

const AI_INDEX_DIR = "ai";
const AI_INDEX_FILE = "index.json";
const AI_EMBEDDINGS_DIR = "embeddings";
const MAX_CHUNK_CHARS = 1_600;
const CHUNK_OVERLAP_LINES = 2;
const MAX_INDEXED_FILE_BYTES = 1_500_000;
const EMBEDDING_BATCH_SIZE = 24;
const TEXT_RESOURCE_EXTENSIONS = new Set([".txt", ".csv", ".json", ".yaml", ".yml", ".toml", ".xml", ".html", ".htm", ".log"]);

export class AiIndexService {
  private readonly statuses = new Map<string, AiIndexStatus>();

  getStatus(workspaceId: string): AiIndexStatus {
    return this.statuses.get(workspaceId) ?? { status: "idle", progress: 0, message: "AI index has not been built." };
  }

  async rebuildWorkspace(workspaceId: string, rootPath: string, options: AiIndexRebuildOptions = {}): Promise<AiIndexStatus> {
    const errors: AiIndexError[] = [];
    try {
      const signal = options.signal;
      this.setStatus(workspaceId, { status: "indexing", progress: 0, message: "Building AI index.", errors });
      const indexableFiles = options.includeMarkdown === false && options.includeTextResources === false
        ? []
        : await collectIndexableFiles(rootPath, {
            includeMarkdown: options.includeMarkdown !== false,
            includeTextResources: options.includeTextResources !== false,
            excludeGlobs: options.excludeGlobs ?? [],
            excludeExtensions: options.excludeExtensions ?? [],
            signal
          });
      const chunks: AiIndexChunk[] = [];
      for (const [index, absolutePath] of indexableFiles.entries()) {
        throwIfAborted(signal);
        const pathRel = normalizePathRel(toWorkspaceRelative(rootPath, absolutePath));
        try {
          const content = await readFile(absolutePath, "utf8");
          const nextChunks = isMarkdownPath(absolutePath) ? chunkMarkdown(pathRel, content) : chunkTextResource(pathRel, content);
          chunks.push(...nextChunks.filter((chunk) => !hasExcludedTag(chunk.tags, options.excludeTags ?? [])));
        } catch (error) {
          errors.push({ pathRel, message: error instanceof Error ? error.message : String(error), at: Date.now() });
        }
        this.setStatus(workspaceId, {
          status: "indexing",
          progress: indexableFiles.length === 0 ? 1 : (index + 1) / indexableFiles.length,
          chunkCount: chunks.length,
          message: `Indexed ${index + 1}/${indexableFiles.length} files.`,
          errors
        });
      }
      const updatedAt = Date.now();
      await writeIndex(rootPath, {
        version: 1,
        workspaceId,
        updatedAt,
        chunks
      });
      let embeddingChunkCount: number | undefined;
      if (options.embeddingProfile && options.embed && chunks.length > 0) {
        embeddingChunkCount = await this.writeEmbeddings(workspaceId, rootPath, chunks, options.embeddingProfile, options.embed, signal, errors);
      }
      const status: AiIndexStatus = {
        status: "ready",
        progress: 1,
        chunkCount: chunks.length,
        embeddingChunkCount,
        embeddingProfileHash: options.embeddingProfile?.profileHash,
        updatedAt,
        errors,
        message: errors.length ? `AI index is ready with ${errors.length} warning(s).` : "AI index is ready."
      };
      this.setStatus(workspaceId, status);
      return status;
    } catch (error) {
      const cancelled = isAbortError(error);
      const status: AiIndexStatus = {
        status: cancelled ? "paused" : "error",
        paused: cancelled,
        progress: this.getStatus(workspaceId).progress,
        chunkCount: this.getStatus(workspaceId).chunkCount,
        embeddingChunkCount: this.getStatus(workspaceId).embeddingChunkCount,
        embeddingProfileHash: this.getStatus(workspaceId).embeddingProfileHash,
        errors,
        message: cancelled ? "AI indexing was cancelled." : error instanceof Error ? error.message : String(error)
      };
      this.setStatus(workspaceId, status);
      throw error;
    }
  }

  async clearWorkspace(workspaceId: string, rootPath: string): Promise<AiIndexStatus> {
    await rm(indexDir(rootPath), { recursive: true, force: true });
    const status: AiIndexStatus = {
      status: "idle",
      progress: 0,
      chunkCount: 0,
      embeddingChunkCount: 0,
      message: "AI index has been cleared.",
      updatedAt: Date.now()
    };
    this.setStatus(workspaceId, status);
    return status;
  }

  pauseWorkspace(workspaceId: string): AiIndexStatus {
    const current = this.getStatus(workspaceId);
    const status: AiIndexStatus = {
      ...current,
      status: current.status === "indexing" ? "paused" : current.status,
      paused: true,
      message: "AI indexing pause requested."
    };
    this.setStatus(workspaceId, status);
    return status;
  }

  async search(workspaceId: string, rootPath: string, query: string, options: AiIndexSearchOptions = {}): Promise<AiIndexSearchResult[]> {
    const index = await readIndex(rootPath);
    if (!index || index.workspaceId !== workspaceId) {
      return [];
    }
    const queryTerms = tokenize(query);
    if (queryTerms.size === 0) {
      return [];
    }
    const prefix = options.pathPrefix ? normalizePathRel(options.pathPrefix) : undefined;
    const embeddings = options.embeddingProfile ? await readEmbeddingMap(rootPath, workspaceId, options.embeddingProfile) : undefined;
    const queryVector = embeddings && options.embedQuery ? await options.embedQuery(query).catch(() => undefined) : undefined;
    return index.chunks
      .filter((chunk) => !prefix || chunk.pathRel.startsWith(prefix ? `${prefix}/` : ""))
      .map((chunk) => {
        const keywordScore = scoreChunk(queryTerms, chunk);
        const vector = queryVector ? embeddings?.get(chunk.id) : undefined;
        const vectorScore = vector && queryVector ? cosineSimilarity(queryVector, vector) : undefined;
        return {
          ...chunk,
          keywordScore,
          vectorScore,
          score: keywordScore + Math.max(0, vectorScore ?? 0) * 6
        };
      })
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score || left.pathRel.localeCompare(right.pathRel))
      .slice(0, options.limit ?? 8);
  }

  private async writeEmbeddings(
    workspaceId: string,
    rootPath: string,
    chunks: AiIndexChunk[],
    profile: AiIndexEmbeddingProfile,
    embed: (texts: string[], signal?: AbortSignal) => Promise<number[][]>,
    signal: AbortSignal | undefined,
    errors: AiIndexError[]
  ): Promise<number> {
    const embeddings: AiIndexEmbeddingEntry[] = [];
    for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
      throwIfAborted(signal);
      const batch = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      try {
        const vectors = await embed(batch.map((chunk) => embeddingTextForChunk(chunk)), signal);
        batch.forEach((chunk, index) => {
          const vector = vectors[index];
          if (!Array.isArray(vector) || vector.length === 0) {
            errors.push({ pathRel: chunk.pathRel, message: "Embedding provider returned an empty vector.", at: Date.now() });
            return;
          }
          embeddings.push({ chunkId: chunk.id, sha256: chunk.sha256, vector: normalizeVector(vector) });
        });
      } catch (error) {
        errors.push({
          message: error instanceof Error ? error.message : String(error),
          at: Date.now()
        });
      }
      this.setStatus(workspaceId, {
        ...this.getStatus(workspaceId),
        status: "indexing",
        embeddingChunkCount: embeddings.length,
        embeddingProfileHash: profile.profileHash,
        message: `Embedded ${Math.min(offset + EMBEDDING_BATCH_SIZE, chunks.length)}/${chunks.length} chunks.`,
        errors
      });
    }
    await writeEmbeddingFile(rootPath, {
      version: 1,
      workspaceId,
      updatedAt: Date.now(),
      profile,
      embeddings
    });
    return embeddings.length;
  }

  private setStatus(workspaceId: string, status: AiIndexStatus): void {
    this.statuses.set(workspaceId, status);
  }
}

async function collectIndexableFiles(
  rootPath: string,
  options: { includeMarkdown: boolean; includeTextResources: boolean; excludeGlobs: string[]; excludeExtensions: string[]; signal?: AbortSignal }
): Promise<string[]> {
  const results: string[] = [];
  const excludeExtensions = new Set(options.excludeExtensions.map((ext) => normalizeExtension(ext)));
  async function walk(current: string): Promise<void> {
    throwIfAborted(options.signal);
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      throwIfAborted(options.signal);
      const absolutePath = path.join(current, entry.name);
      const pathRel = normalizePathRel(toWorkspaceRelative(rootPath, absolutePath));
      if (entry.name === ".DS_Store" || isAlwaysIgnoredWorkspacePath(pathRel) || matchesAnyGlob(pathRel, options.excludeGlobs)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (excludeExtensions.has(path.extname(absolutePath).toLowerCase())) {
        continue;
      }
      if (isIndexableTextPath(absolutePath, options)) {
        const entryStat = await stat(absolutePath);
        if (entryStat.size > MAX_INDEXED_FILE_BYTES) {
          continue;
        }
        results.push(absolutePath);
      }
    }
  }
  await walk(rootPath);
  return results;
}

function isIndexableTextPath(filePath: string, options: { includeMarkdown: boolean; includeTextResources: boolean }): boolean {
  if (options.includeMarkdown && isMarkdownPath(filePath)) {
    return true;
  }
  return options.includeTextResources && TEXT_RESOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function chunkMarkdown(pathRel: string, content: string): AiIndexChunk[] {
  const parsed = parseMarkdown(content, pathRel);
  const lines = content.split(/\r?\n/);
  const headingByLine = new Map(parsed.headings.map((heading) => [heading.line, heading.text]));
  const chunks: AiIndexChunk[] = [];
  let currentLines: string[] = [];
  let startLine = 1;
  let currentHeading: string | undefined;

  const flush = (endLine: number) => {
    const text = currentLines.join("\n").trim();
    if (!text) {
      currentLines = [];
      startLine = endLine + 1;
      return;
    }
    chunks.push({
      id: `${pathRel}:${startLine}-${endLine}:${sha256Text(text).slice(0, 10)}`,
      pathRel,
      title: parsed.title,
      heading: currentHeading,
      tags: parsed.tags,
      startLine,
      endLine,
      text,
      charCount: text.length,
      sha256: sha256Text(text)
    });
    const overlap = currentLines.slice(-CHUNK_OVERLAP_LINES);
    currentLines = overlap;
    startLine = Math.max(1, endLine - overlap.length + 1);
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const heading = headingByLine.get(lineNumber);
    if (heading && currentLines.join("\n").length > 0) {
      flush(lineNumber - 1);
      currentLines = [];
      startLine = lineNumber;
    }
    if (heading) {
      currentHeading = heading;
    }
    currentLines.push(line);
    if (currentLines.join("\n").length >= MAX_CHUNK_CHARS) {
      flush(lineNumber);
    }
  });
  flush(lines.length);
  return chunks;
}

function chunkTextResource(pathRel: string, content: string): AiIndexChunk[] {
  const title = path.posix.basename(pathRel);
  const lines = content.split(/\r?\n/);
  const chunks: AiIndexChunk[] = [];
  let currentLines: string[] = [];
  let startLine = 1;

  const flush = (endLine: number) => {
    const text = currentLines.join("\n").trim();
    if (!text) {
      currentLines = [];
      startLine = endLine + 1;
      return;
    }
    chunks.push({
      id: `${pathRel}:${startLine}-${endLine}:${sha256Text(text).slice(0, 10)}`,
      pathRel,
      title,
      startLine,
      endLine,
      text,
      charCount: text.length,
      sha256: sha256Text(text)
    });
    const overlap = currentLines.slice(-CHUNK_OVERLAP_LINES);
    currentLines = overlap;
    startLine = Math.max(1, endLine - overlap.length + 1);
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    currentLines.push(line);
    if (currentLines.join("\n").length >= MAX_CHUNK_CHARS) {
      flush(lineNumber);
    }
  });
  flush(lines.length);
  return chunks;
}

async function readIndex(rootPath: string): Promise<AiIndexFile | undefined> {
  try {
    const raw = await readFile(indexPath(rootPath), "utf8");
    const parsed = JSON.parse(raw) as AiIndexFile;
    return parsed.version === 1 && Array.isArray(parsed.chunks) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function writeIndex(rootPath: string, index: AiIndexFile): Promise<void> {
  const filePath = indexPath(rootPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

async function writeEmbeddingFile(rootPath: string, file: AiEmbeddingFile): Promise<void> {
  const filePath = embeddingPath(rootPath, file.profile);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

async function readEmbeddingMap(rootPath: string, workspaceId: string, profile: AiIndexEmbeddingProfile): Promise<Map<string, number[]> | undefined> {
  try {
    const raw = await readFile(embeddingPath(rootPath, profile), "utf8");
    const parsed = JSON.parse(raw) as AiEmbeddingFile;
    if (parsed.version !== 1 || parsed.workspaceId !== workspaceId || parsed.profile.profileHash !== profile.profileHash) {
      return undefined;
    }
    return new Map(parsed.embeddings.map((entry) => [entry.chunkId, entry.vector]));
  } catch {
    return undefined;
  }
}

function indexPath(rootPath: string): string {
  return path.join(indexDir(rootPath), AI_INDEX_FILE);
}

function embeddingPath(rootPath: string, profile: AiIndexEmbeddingProfile): string {
  return path.join(indexDir(rootPath), AI_EMBEDDINGS_DIR, `${profile.profileHash}.json`);
}

function indexDir(rootPath: string): string {
  return path.join(rootPath, WORKSPACE_META_DIR, AI_INDEX_DIR);
}

function scoreChunk(queryTerms: Set<string>, chunk: AiIndexChunk): number {
  const textTerms = tokenize(`${chunk.title}\n${chunk.heading ?? ""}\n${chunk.tags?.join(" ") ?? ""}\n${chunk.text}`);
  let score = 0;
  for (const term of queryTerms) {
    if (textTerms.has(term)) {
      score += term.length > 2 ? 2 : 1;
    }
  }
  if (chunk.title && containsAny(chunk.title, queryTerms)) {
    score += 2;
  }
  if (chunk.heading && containsAny(chunk.heading, queryTerms)) {
    score += 1.5;
  }
  if (chunk.tags?.some((tag) => queryTerms.has(tag.toLocaleLowerCase()))) {
    score += 1.5;
  }
  return score;
}

function embeddingTextForChunk(chunk: AiIndexChunk): string {
  return [
    chunk.title ? `Title: ${chunk.title}` : "",
    chunk.heading ? `Heading: ${chunk.heading}` : "",
    chunk.tags?.length ? `Tags: ${chunk.tags.join(", ")}` : "",
    chunk.text
  ].filter(Boolean).join("\n");
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}_-]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2)
  );
}

function containsAny(value: string, terms: Set<string>): boolean {
  const normalized = value.toLocaleLowerCase();
  return [...terms].some((term) => normalized.includes(term));
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return vector;
  }
  return vector.map((value) => Number((value / magnitude).toFixed(8)));
}

function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (!leftMagnitude || !rightMagnitude) {
    return 0;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function hasExcludedTag(tags: string[] | undefined, excludedTags: string[]): boolean {
  if (!tags?.length || excludedTags.length === 0) {
    return false;
  }
  const normalized = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
  return excludedTags.some((tag) => normalized.has(tag.replace(/^#/, "").toLocaleLowerCase()));
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLocaleLowerCase();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function matchesAnyGlob(pathRel: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern).test(pathRel));
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePathRel(pattern.trim()).replace(/^\*\//, "**/");
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("AI indexing was cancelled", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
