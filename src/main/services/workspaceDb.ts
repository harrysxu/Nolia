import { rename, readFile, writeFile } from "node:fs/promises";
import initSqlJs from "sql.js";
import type { SqlJsStatic, SqlValue } from "sql.js";

import type {
  BacklinkItem,
  BacklinksResponse,
  FileHistoryEntry,
  FileKind,
  ParsedDocument,
  SearchResultItem,
  SearchQueryResponse
} from "../../shared/types";
import type { AiEmbeddingSettings, AiProviderId, AiSemanticIndexStatus } from "../../shared/ai";
import type { SearchQueryRequest } from "../../shared/ipc";
import { basenameWithoutExt } from "../utils/filePaths";

type Db = InstanceType<SqlJsStatic["Database"]>;

interface FileIndexEntry {
  pathRel: string;
  name: string;
  ext: string;
  kind: FileKind;
  size: number;
  mtimeMs: number;
  ctimeMs?: number;
  sha256?: string;
}

export interface SemanticChunkRecord {
  pathRel: string;
  title: string;
  fileSha256: string;
  chunkIndex: number;
  chunkHash: string;
  content: string;
  embedding: number[];
  providerId: AiProviderId;
  model: string;
  dimension: number;
  updatedAt: number;
}

export interface SemanticSearchResultItem extends SearchResultItem {
  mode: "semantic";
  chunkIndex: number;
  chunkHash: string;
}

export interface SemanticIndexMetadata {
  enabled: boolean;
  providerId?: AiProviderId;
  model?: string;
  baseUrl?: string;
  apiMode?: string;
  updatedAt?: number;
  error?: string;
}

const SEMANTIC_INDEX_KEY = "ai.semanticIndex";

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

export class WorkspaceDb {
  private indexVersion = 0;
  private ftsEnabled = true;
  private dirty = false;
  private saveTimer?: NodeJS.Timeout;
  private savePromise?: Promise<void>;

  private constructor(
    private readonly dbPath: string,
    private readonly db: Db
  ) {}

  static async open(dbPath: string): Promise<WorkspaceDb> {
    const SQL = await getSqlJs();
    let db = await openSqlDatabase(SQL, dbPath);
    let workspaceDb = new WorkspaceDb(dbPath, db);
    try {
      workspaceDb.ensureSchema();
      return workspaceDb;
    } catch (error) {
      db.close();
      if (!isRecoverableSqliteCorruption(error)) {
        throw error;
      }
    }

    await backupCorruptDatabase(dbPath);
    db = new SQL.Database();
    workspaceDb = new WorkspaceDb(dbPath, db);
    workspaceDb.ensureSchema();
    await workspaceDb.save();
    return workspaceDb;
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.db.close();
  }

  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    return this.flush({ force: true });
  }

  scheduleSave(delayMs = 1500): void {
    this.dirty = true;
    if (this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flush();
    }, delayMs);
  }

  async flush(options: { force?: boolean } = {}): Promise<void> {
    if (options.force) {
      this.dirty = true;
    }
    if (this.savePromise) {
      await this.savePromise;
      if (!this.dirty) {
        return;
      }
    }
    this.savePromise = this.writeToDisk();
    try {
      await this.savePromise;
    } finally {
      this.savePromise = undefined;
    }
  }

  private async writeToDisk(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    const bytes = this.db.export();
    await writeFile(this.dbPath, Buffer.from(bytes));
  }

  markAllFilesDeleted(): void {
    this.db.run("UPDATE files SET deleted = 1");
  }

  markMissingFilesDeleted(currentPaths: Set<string>): void {
    const rows = this.all("SELECT path_rel AS pathRel FROM files WHERE deleted = 0");
    for (const row of rows) {
      const pathRel = readString(row.pathRel);
      if (!currentPaths.has(pathRel)) {
        this.removeFile(pathRel);
      }
    }
  }

  shouldIndexFile(entry: FileIndexEntry): boolean {
    const row = this.first(
      `SELECT size, mtime_ms AS mtimeMs, sha256, deleted
       FROM files
       WHERE path_rel = ?`,
      [entry.pathRel]
    );
    if (!row || readNumber(row.deleted) !== 0) {
      return true;
    }
    if (readNumber(row.size) !== entry.size || readNumber(row.mtimeMs) !== entry.mtimeMs) {
      return true;
    }
    if (entry.kind === "markdown" && entry.sha256 && readString(row.sha256) !== entry.sha256) {
      return true;
    }
    return false;
  }

  upsertFile(entry: FileIndexEntry): number {
    this.db.run(
      `INSERT INTO files (path_rel, name, ext, kind, size, mtime_ms, ctime_ms, sha256, deleted, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(path_rel) DO UPDATE SET
         name = excluded.name,
         ext = excluded.ext,
         kind = excluded.kind,
         size = excluded.size,
         mtime_ms = excluded.mtime_ms,
         ctime_ms = excluded.ctime_ms,
         sha256 = excluded.sha256,
         deleted = 0,
         indexed_at = excluded.indexed_at`,
      [
        entry.pathRel,
        entry.name,
        entry.ext,
        entry.kind,
        entry.size,
        entry.mtimeMs,
        entry.ctimeMs ?? null,
        entry.sha256 ?? null,
        Date.now()
      ]
    );
    return this.getFileId(entry.pathRel) ?? 0;
  }

  upsertDocument(entry: FileIndexEntry, parsed: ParsedDocument): number {
    this.transaction(() => {
      const fileId = this.upsertFile(entry);
      this.db.run(
        `INSERT INTO documents
          (file_id, title, frontmatter_json, headings_json, plain_text, word_count, line_count, parse_status, diagnostics_json, parse_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(file_id) DO UPDATE SET
          title = excluded.title,
          frontmatter_json = excluded.frontmatter_json,
          headings_json = excluded.headings_json,
          plain_text = excluded.plain_text,
          word_count = excluded.word_count,
          line_count = excluded.line_count,
          parse_status = excluded.parse_status,
          diagnostics_json = excluded.diagnostics_json,
          parse_version = excluded.parse_version,
          updated_at = excluded.updated_at`,
        [
          fileId,
          parsed.title,
          JSON.stringify(parsed.frontmatter),
          JSON.stringify(parsed.headings),
          parsed.plainText,
          parsed.wordCount,
          parsed.lineCount,
          parsed.diagnostics.some((item) => item.severity === "error") ? "error" : parsed.diagnostics.length ? "warning" : "ok",
          JSON.stringify(parsed.diagnostics),
          Date.now()
        ]
      );
      this.replaceTags(fileId, parsed.tags);
      this.replaceWikiLinks(fileId, parsed);
      this.replaceMarkdownLinks(fileId, parsed);
      this.replaceAttachmentRefs(fileId, parsed);
      this.replaceFts(fileId, entry.pathRel, parsed);
      this.indexVersion += 1;
    });

    return this.getFileId(entry.pathRel) ?? 0;
  }

  removeFile(pathRel: string): void {
    const fileId = this.getFileId(pathRel);
    if (!fileId) {
      return;
    }
    this.transaction(() => {
      this.db.run("UPDATE files SET deleted = 1 WHERE id = ?", [fileId]);
      this.db.run("DELETE FROM document_tags WHERE file_id = ?", [fileId]);
      this.db.run("DELETE FROM wikilinks WHERE from_file_id = ?", [fileId]);
      this.db.run("DELETE FROM markdown_links WHERE from_file_id = ?", [fileId]);
      this.db.run("DELETE FROM attachment_refs WHERE file_id = ?", [fileId]);
      if (this.ftsEnabled) {
        this.db.run("DELETE FROM document_fts WHERE file_id = ?", [fileId]);
      } else {
        this.db.run("DELETE FROM document_search WHERE file_id = ?", [fileId]);
      }
      this.db.run("DELETE FROM semantic_chunks WHERE file_id = ?", [fileId]);
      this.refreshTagCounts();
      this.indexVersion += 1;
    });
  }

  listSemanticIndexableDocuments(): Array<{ pathRel: string; title: string; plainText: string; sha256: string; updatedAt: number }> {
    return this.all(
      `SELECT f.path_rel AS pathRel, COALESCE(d.title, f.name) AS title, COALESCE(d.plain_text, '') AS plainText, COALESCE(f.sha256, '') AS sha256, d.updated_at AS updatedAt
       FROM documents d
       JOIN files f ON f.id = d.file_id
       WHERE f.deleted = 0 AND f.kind = 'markdown'
       ORDER BY f.path_rel`
    ).map((row) => ({
      pathRel: readString(row.pathRel),
      title: readString(row.title),
      plainText: readString(row.plainText),
      sha256: readString(row.sha256),
      updatedAt: readNumber(row.updatedAt)
    }));
  }

  countSemanticIndexableDocuments(): number {
    return readNumber(this.first("SELECT COUNT(*) AS count FROM files WHERE deleted = 0 AND kind = 'markdown'")?.count);
  }

  getSemanticIndexMetadata(): SemanticIndexMetadata | undefined {
    const row = this.first("SELECT value_json AS valueJson FROM workspace_settings WHERE key = ?", [SEMANTIC_INDEX_KEY]);
    if (!row) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(readString(row.valueJson)) as Partial<SemanticIndexMetadata>;
      return {
        enabled: Boolean(parsed.enabled),
        providerId: parsed.providerId === "openai-compatible" || parsed.providerId === "ollama" ? parsed.providerId : undefined,
        model: typeof parsed.model === "string" ? parsed.model : undefined,
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
        apiMode: typeof parsed.apiMode === "string" ? parsed.apiMode : undefined,
        updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : undefined,
        error: typeof parsed.error === "string" ? parsed.error : undefined
      };
    } catch {
      return undefined;
    }
  }

  setSemanticIndexMetadata(metadata: SemanticIndexMetadata): void {
    this.db.run(
      `INSERT INTO workspace_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [SEMANTIC_INDEX_KEY, JSON.stringify(metadata), Date.now()]
    );
  }

  clearSemanticIndex(settings?: AiEmbeddingSettings): void {
    this.transaction(() => {
      this.db.run("DELETE FROM semantic_chunks");
      this.setSemanticIndexMetadata({
        enabled: Boolean(settings?.enabled),
        providerId: settings?.providerId,
        model: settings?.model,
        baseUrl: settings?.baseUrl,
        apiMode: settings?.apiMode,
        updatedAt: undefined
      });
    });
  }

  replaceSemanticChunks(pathRel: string, chunks: SemanticChunkRecord[]): void {
    const fileId = this.getFileId(pathRel);
    if (!fileId) {
      return;
    }
    this.transaction(() => {
      this.db.run("DELETE FROM semantic_chunks WHERE file_id = ?", [fileId]);
      for (const chunk of chunks) {
        this.db.run(
          `INSERT INTO semantic_chunks
            (file_id, chunk_index, chunk_hash, file_sha256, title, content, embedding_json, provider_id, model, dimension, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fileId,
            chunk.chunkIndex,
            chunk.chunkHash,
            chunk.fileSha256,
            chunk.title,
            chunk.content,
            JSON.stringify(chunk.embedding),
            chunk.providerId,
            chunk.model,
            chunk.dimension,
            chunk.updatedAt
          ]
        );
      }
    });
  }

  hasCurrentSemanticChunks(pathRel: string, fileSha256: string, providerId: AiProviderId, model: string): boolean {
    const row = this.first(
      `SELECT COUNT(*) AS count
       FROM semantic_chunks c
       JOIN files f ON f.id = c.file_id
       WHERE f.deleted = 0 AND f.path_rel = ? AND c.file_sha256 = ? AND c.provider_id = ? AND c.model = ?`,
      [pathRel, fileSha256, providerId, model]
    );
    return readNumber(row?.count) > 0;
  }

  semanticIndexStatus(settings: AiEmbeddingSettings, progress?: AiSemanticIndexStatus["progress"], transientError?: string, options: { fast?: boolean } = {}): AiSemanticIndexStatus {
    const metadata = this.getSemanticIndexMetadata();
    const totalFiles = readNumber(this.first("SELECT COUNT(*) AS count FROM files WHERE deleted = 0 AND kind = 'markdown'")?.count);
    const metadataMatches = metadata?.providerId === settings.providerId && metadata.model === settings.model && metadata.baseUrl === settings.baseUrl && metadata.apiMode === settings.apiMode;
    const error = transientError ?? (metadataMatches ? metadata?.error : undefined);
    if (options.fast) {
      const state = progress
        ? "updating"
        : !settings.enabled || !settings.model.trim()
          ? "not_configured"
          : error
            ? "failed"
            : metadata?.updatedAt && !metadataMatches
              ? "stale"
              : metadata?.updatedAt
                ? "ready"
                : "not_created";
      return {
        state,
        enabled: Boolean(settings.enabled),
        providerId: settings.providerId,
        model: settings.model,
        updatedAt: metadata?.updatedAt,
        totalFiles,
        indexedFiles: state === "ready" ? totalFiles : 0,
        staleFiles: state === "ready" ? 0 : totalFiles,
        chunkCount: 0,
        progress,
        error
      };
    }
    const chunkCount = readNumber(this.first(
      `SELECT COUNT(*) AS count
       FROM semantic_chunks c
       JOIN files f ON f.id = c.file_id
       WHERE f.deleted = 0
         AND f.kind = 'markdown'
         AND c.provider_id = ?
         AND c.model = ?
         AND c.file_sha256 = COALESCE(f.sha256, '')`,
      [settings.providerId, settings.model]
    )?.count);
    const indexedFiles = readNumber(this.first(
      `SELECT COUNT(DISTINCT f.id) AS count
       FROM files f
       JOIN semantic_chunks c ON c.file_id = f.id
       WHERE f.deleted = 0
          AND f.kind = 'markdown'
          AND c.provider_id = ?
          AND c.model = ?
          AND c.file_sha256 = COALESCE(f.sha256, '')`,
      [settings.providerId, settings.model]
    )?.count);
    const staleFiles = Math.max(0, totalFiles - indexedFiles);
    let state: AiSemanticIndexStatus["state"];
    if (progress) {
      state = "updating";
    } else if (!settings.enabled || !settings.model.trim()) {
      state = "not_configured";
    } else if (error) {
      state = "failed";
    } else if (metadata?.updatedAt && !metadataMatches) {
      state = "stale";
    } else if (metadata?.updatedAt && staleFiles > 0) {
      state = "stale";
    } else if (!chunkCount || !metadata?.updatedAt) {
      state = "not_created";
    } else {
      state = "ready";
    }
    return {
      state,
      enabled: Boolean(settings.enabled),
      providerId: settings.providerId,
      model: settings.model,
      updatedAt: metadata?.updatedAt,
      totalFiles,
      indexedFiles,
      staleFiles,
      chunkCount,
      progress,
      message: statusMessageFor(state, staleFiles),
      error
    };
  }

  semanticSearch(queryEmbedding: number[], settings: AiEmbeddingSettings, limit = 8): SemanticSearchResultItem[] {
    const rows = this.all(
      `SELECT f.path_rel AS pathRel, COALESCE(c.title, d.title, f.name) AS title, c.content AS content,
              c.embedding_json AS embeddingJson, c.chunk_index AS chunkIndex, c.chunk_hash AS chunkHash
       FROM semantic_chunks c
       JOIN files f ON f.id = c.file_id
       LEFT JOIN documents d ON d.file_id = f.id
       WHERE f.deleted = 0
         AND c.file_sha256 = COALESCE(f.sha256, '')
         AND c.provider_id = ?
         AND c.model = ?`,
      [settings.providerId, settings.model]
    );
    return rows
      .map((row) => {
        const embedding = parseEmbedding(readString(row.embeddingJson));
        return {
          pathRel: readString(row.pathRel),
          title: readString(row.title),
          score: cosineSimilarity(queryEmbedding, embedding),
          snippets: [readString(row.content).slice(0, 500)],
          mode: "semantic" as const,
          chunkIndex: readNumber(row.chunkIndex),
          chunkHash: readString(row.chunkHash)
        };
      })
      .filter((item) => Number.isFinite(item.score) && item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(20, limit)));
  }

  touchRecentFile(pathRel: string, editorMode?: string): void {
    const fileId = this.getFileId(pathRel);
    if (!fileId) {
      return;
    }
    this.db.run(
      `INSERT INTO recent_files (file_id, opened_at, cursor_json, editor_mode)
       VALUES (?, ?, NULL, ?)
       ON CONFLICT(file_id) DO UPDATE SET opened_at = excluded.opened_at, editor_mode = excluded.editor_mode`,
      [fileId, Date.now(), editorMode ?? null]
    );
  }

  listRecentFiles(limit = 20): Array<{ pathRel: string; title: string; openedAt: number }> {
    return this.all(
      `SELECT f.path_rel AS pathRel, COALESCE(d.title, f.name) AS title, r.opened_at AS openedAt
       FROM recent_files r
       JOIN files f ON f.id = r.file_id
       LEFT JOIN documents d ON d.file_id = f.id
       WHERE f.deleted = 0
       ORDER BY r.opened_at DESC
       LIMIT ?`,
      [limit]
    ).map((row) => ({
      pathRel: readString(row.pathRel),
      title: readString(row.title),
      openedAt: readNumber(row.openedAt)
    }));
  }

  search(request: SearchQueryRequest): SearchQueryResponse {
    const limit = request.limit ?? 40;
    const offset = request.offset ?? 0;
    const query = request.query.trim();
    if (!query) {
      const items = this.listRecentFiles(limit).map((item, index) => ({
        pathRel: item.pathRel,
        title: item.title,
        score: index,
        snippets: []
      }));
      return { items, indexVersion: this.indexVersion, isPartial: false };
    }

    const pathFilter = request.filters?.path;
    const tagFilter = request.filters?.tag?.toLowerCase();
    const ftsQuery = buildFtsQuery(query);

    try {
      if (this.ftsEnabled) {
        const rows = this.all(
          `SELECT file_id, path, title, snippet(document_fts, 4, '<mark>', '</mark>', ' ... ', 12) AS snippet,
                  bm25(document_fts) AS rank
           FROM document_fts
           WHERE document_fts MATCH ?
           ORDER BY rank
           LIMIT ? OFFSET ?`,
          [ftsQuery, limit, offset]
        );

        const items = rows
          .map((row) => ({
            pathRel: readString(row.path),
            title: readString(row.title),
            score: Math.abs(readNumber(row.rank)),
            snippets: [readString(row.snippet)].filter(Boolean)
          }))
          .filter((item) => matchesFilters(item.pathRel, tagFilter, pathFilter, this));
        return { items, indexVersion: this.indexVersion, isPartial: false };
      }
    } catch {
      this.ftsEnabled = false;
    }

    const like = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
    const rows = this.all(
      `SELECT f.path_rel AS pathRel, COALESCE(d.title, f.name) AS title, d.plain_text AS plainText
       FROM documents d
       JOIN files f ON f.id = d.file_id
       WHERE f.deleted = 0 AND (d.title LIKE ? ESCAPE '\\' OR d.plain_text LIKE ? ESCAPE '\\' OR f.path_rel LIKE ? ESCAPE '\\')
       ORDER BY d.updated_at DESC
       LIMIT ? OFFSET ?`,
      [like, like, like, limit, offset]
    );

    const items = rows
      .map((row) => ({
        pathRel: readString(row.pathRel),
        title: readString(row.title),
        score: 0,
        snippets: [buildSnippet(readString(row.plainText), query)].filter(Boolean)
      }))
      .filter((item) => matchesFilters(item.pathRel, tagFilter, pathFilter, this));

    return { items, indexVersion: this.indexVersion, isPartial: false };
  }

  listTags(): Array<{ name: string; displayName: string; count: number }> {
    return this.all("SELECT name, display_name AS displayName, count FROM tags WHERE count > 0 ORDER BY display_name")
      .map((row) => ({
        name: readString(row.name),
        displayName: readString(row.displayName),
        count: readNumber(row.count)
      }));
  }

  getBacklinks(pathRel: string, includeUnlinkedMentions = false): BacklinksResponse {
    const targetFileId = this.getFileId(pathRel);
    const targetTitle = this.getDocumentTitle(pathRel);
    const targetStem = basenameWithoutExt(pathRel);
    const targetPathStem = pathRel.replace(/\.[^.]+$/, "");
    const keys = uniqueLower([pathRel, targetPathStem, targetStem, targetTitle]);

    const linked: BacklinkItem[] = [];
    if (targetFileId) {
      const wikiRows = this.all(
        `SELECT f.path_rel AS pathRel, COALESCE(d.title, f.name) AS title, w.line AS line, w.target_text AS targetText
         FROM wikilinks w
         JOIN files f ON f.id = w.from_file_id
         LEFT JOIN documents d ON d.file_id = f.id
         WHERE f.deleted = 0
           AND f.id != ?
           AND (w.resolved_file_id = ? OR lower(w.target_text) IN (${keys.map(() => "?").join(",")}))
         ORDER BY f.path_rel, w.line`,
        [targetFileId, targetFileId, ...keys]
      );
      linked.push(
        ...wikiRows.map((row) => ({
          pathRel: readString(row.pathRel),
          title: readString(row.title),
          line: readNumber(row.line),
          context: `[[${readString(row.targetText)}]]`
        }))
      );

      const markdownRows = this.all(
        `SELECT f.path_rel AS pathRel, COALESCE(d.title, f.name) AS title, m.line AS line, m.href AS href
         FROM markdown_links m
         JOIN files f ON f.id = m.from_file_id
         LEFT JOIN documents d ON d.file_id = f.id
         WHERE f.deleted = 0
           AND f.id != ?
           AND (m.resolved_file_id = ? OR lower(m.href) IN (${keys.map(() => "?").join(",")}))
         ORDER BY f.path_rel, m.line`,
        [targetFileId, targetFileId, ...keys]
      );
      linked.push(
        ...markdownRows.map((row) => ({
          pathRel: readString(row.pathRel),
          title: readString(row.title),
          line: readNumber(row.line),
          context: readString(row.href)
        }))
      );
    }

    const unlinked = includeUnlinkedMentions ? this.findUnlinkedMentions(pathRel, targetTitle || targetStem, linked) : [];
    return { linked, unlinked };
  }

  addSnapshot(pathRel: string, snapshotPath: string, sha256: string, reason: string, size: number): void {
    const fileId = this.getFileId(pathRel);
    if (!fileId) {
      return;
    }
    this.db.run(
      `INSERT INTO snapshots (file_id, snapshot_path, sha256, reason, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fileId, snapshotPath, sha256, reason, size, Date.now()]
    );
  }

  listSnapshots(pathRel: string, limit = 50): FileHistoryEntry[] {
    const fileId = this.getFileId(pathRel);
    if (!fileId) {
      return [];
    }
    return this.all(
      `SELECT s.id, f.path_rel AS pathRel, s.snapshot_path AS snapshotPath, s.sha256, s.reason, s.size, s.created_at AS createdAt
       FROM snapshots s
       JOIN files f ON f.id = s.file_id
       WHERE s.file_id = ?
       ORDER BY s.created_at DESC
       LIMIT ?`,
      [fileId, limit]
    ).map(snapshotEntryFromRow);
  }

  getSnapshot(snapshotId: number): FileHistoryEntry | undefined {
    const row = this.first(
      `SELECT s.id, f.path_rel AS pathRel, s.snapshot_path AS snapshotPath, s.sha256, s.reason, s.size, s.created_at AS createdAt
       FROM snapshots s
       JOIN files f ON f.id = s.file_id
       WHERE s.id = ? AND f.deleted = 0`,
      [snapshotId]
    );
    return row ? snapshotEntryFromRow(row) : undefined;
  }

  getFileId(pathRel: string): number | undefined {
    const row = this.first("SELECT id FROM files WHERE path_rel = ? AND deleted = 0", [pathRel]);
    const value = readNumber(row?.id);
    return value > 0 ? value : undefined;
  }

  getIndexVersion(): number {
    return this.indexVersion;
  }

  private ensureSchema(): void {
    this.db.run(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path_rel TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        ext TEXT,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        mtime_ms INTEGER NOT NULL,
        ctime_ms INTEGER,
        sha256 TEXT,
        inode TEXT,
        deleted INTEGER NOT NULL DEFAULT 0,
        indexed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS documents (
        file_id INTEGER PRIMARY KEY,
        title TEXT,
        frontmatter_json TEXT,
        headings_json TEXT,
        plain_text TEXT,
        word_count INTEGER NOT NULL DEFAULT 0,
        line_count INTEGER NOT NULL DEFAULT 0,
        parse_status TEXT NOT NULL DEFAULT 'ok',
        diagnostics_json TEXT,
        parse_version INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS document_tags (
        file_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        line INTEGER,
        UNIQUE(file_id, tag_id, source)
      );

      CREATE TABLE IF NOT EXISTS wikilinks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_file_id INTEGER NOT NULL,
        target_text TEXT NOT NULL,
        target_heading TEXT,
        resolved_file_id INTEGER,
        line INTEGER,
        col INTEGER
      );

      CREATE TABLE IF NOT EXISTS markdown_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_file_id INTEGER NOT NULL,
        href TEXT NOT NULL,
        title TEXT,
        resolved_file_id INTEGER,
        line INTEGER
      );

      CREATE TABLE IF NOT EXISTS attachment_refs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        ref_path TEXT NOT NULL,
        asset_file_id INTEGER,
        kind TEXT NOT NULL,
        exists_flag INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        snapshot_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        reason TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recent_files (
        file_id INTEGER PRIMARY KEY,
        opened_at INTEGER NOT NULL,
        cursor_json TEXT,
        editor_mode TEXT
      );

      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS semantic_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_hash TEXT NOT NULL,
        file_sha256 TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(file_id, provider_id, model, chunk_index)
      );

      CREATE TABLE IF NOT EXISTS code_run_trust (
        scope TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        trusted INTEGER NOT NULL,
        granted_at INTEGER NOT NULL,
        expires_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS document_search (
        file_id INTEGER PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT,
        tags TEXT,
        body TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
      CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime_ms DESC);
      CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(deleted);
      CREATE INDEX IF NOT EXISTS idx_document_tags_tag_id ON document_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_wikilinks_from ON wikilinks(from_file_id);
      CREATE INDEX IF NOT EXISTS idx_wikilinks_target_text ON wikilinks(target_text);
      CREATE INDEX IF NOT EXISTS idx_markdown_links_from ON markdown_links(from_file_id);
      CREATE INDEX IF NOT EXISTS idx_attachment_refs_file_id ON attachment_refs(file_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_file_created ON snapshots(file_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_semantic_chunks_lookup ON semantic_chunks(provider_id, model, file_sha256);
      CREATE INDEX IF NOT EXISTS idx_semantic_chunks_file ON semantic_chunks(file_id);
    `);

    try {
      this.db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
          file_id UNINDEXED,
          path,
          title,
          tags,
          body,
          tokenize = 'unicode61'
        );
      `);
      this.ftsEnabled = true;
    } catch {
      this.ftsEnabled = false;
    }
  }

  private replaceTags(fileId: number, tags: string[]): void {
    this.db.run("DELETE FROM document_tags WHERE file_id = ?", [fileId]);
    for (const tag of tags) {
      this.db.run(
        `INSERT INTO tags (name, display_name, count)
         VALUES (?, ?, 0)
         ON CONFLICT(name) DO UPDATE SET display_name = excluded.display_name`,
        [tag.toLowerCase(), tag]
      );
      const tagId = readNumber(this.first("SELECT id FROM tags WHERE name = ?", [tag.toLowerCase()])?.id);
      if (tagId) {
        this.db.run(
          `INSERT OR IGNORE INTO document_tags (file_id, tag_id, source, line)
           VALUES (?, ?, 'inline', NULL)`,
          [fileId, tagId]
        );
      }
    }
    this.refreshTagCounts();
  }

  private replaceWikiLinks(fileId: number, parsed: ParsedDocument): void {
    this.db.run("DELETE FROM wikilinks WHERE from_file_id = ?", [fileId]);
    for (const link of parsed.wikilinks) {
      const resolved = this.resolveWikiTarget(link.targetText);
      this.db.run(
        `INSERT INTO wikilinks (from_file_id, target_text, target_heading, resolved_file_id, line, col)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [fileId, link.targetText, link.targetHeading ?? null, resolved ?? null, link.line, link.col]
      );
    }
  }

  private replaceMarkdownLinks(fileId: number, parsed: ParsedDocument): void {
    this.db.run("DELETE FROM markdown_links WHERE from_file_id = ?", [fileId]);
    for (const link of parsed.links) {
      this.db.run(
        `INSERT INTO markdown_links (from_file_id, href, title, resolved_file_id, line)
         VALUES (?, ?, ?, ?, ?)`,
        [fileId, link.href, link.title ?? null, this.resolveMarkdownTarget(link.href) ?? null, link.line]
      );
    }
  }

  private replaceAttachmentRefs(fileId: number, parsed: ParsedDocument): void {
    this.db.run("DELETE FROM attachment_refs WHERE file_id = ?", [fileId]);
    for (const attachment of parsed.attachments) {
      this.db.run(
        `INSERT INTO attachment_refs (file_id, ref_path, asset_file_id, kind, exists_flag)
         VALUES (?, ?, NULL, ?, 1)`,
        [fileId, attachment.refPath, attachment.kind]
      );
    }
  }

  private replaceFts(fileId: number, pathRel: string, parsed: ParsedDocument): void {
    const tags = parsed.tags.join(" ");
    if (this.ftsEnabled) {
      this.db.run("DELETE FROM document_fts WHERE file_id = ?", [fileId]);
      this.db.run("INSERT INTO document_fts (file_id, path, title, tags, body) VALUES (?, ?, ?, ?, ?)", [
        fileId,
        pathRel,
        parsed.title,
        tags,
        parsed.plainText
      ]);
      return;
    }
    this.db.run(
      `INSERT INTO document_search (file_id, path, title, tags, body)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(file_id) DO UPDATE SET path = excluded.path, title = excluded.title, tags = excluded.tags, body = excluded.body`,
      [fileId, pathRel, parsed.title, tags, parsed.plainText]
    );
  }

  private refreshTagCounts(): void {
    this.db.run("UPDATE tags SET count = (SELECT COUNT(*) FROM document_tags WHERE document_tags.tag_id = tags.id)");
  }

  private resolveWikiTarget(target: string): number | undefined {
    const key = target.trim().toLowerCase();
    if (!key) {
      return undefined;
    }
    const rows = this.all(
      `SELECT f.id AS id, f.path_rel AS pathRel, COALESCE(d.title, f.name) AS title
       FROM files f
       LEFT JOIN documents d ON d.file_id = f.id
       WHERE f.deleted = 0 AND f.kind = 'markdown'`
    );
    const match = rows.find((row) => {
      const pathRel = readString(row.pathRel).toLowerCase();
      const stem = basenameWithoutExt(pathRel).toLowerCase();
      const title = readString(row.title).toLowerCase();
      return key === pathRel || key === stem || key === title || key === pathRel.replace(/\.[^.]+$/, "");
    });
    return match ? readNumber(match.id) : undefined;
  }

  private resolveMarkdownTarget(href: string): number | undefined {
    const clean = href.split(/[?#]/)[0].replace(/^\.?\//, "").toLowerCase();
    if (!clean) {
      return undefined;
    }
    const row = this.first("SELECT id FROM files WHERE lower(path_rel) = ? AND deleted = 0", [clean]);
    return readNumber(row?.id) || undefined;
  }

  private getDocumentTitle(pathRel: string): string {
    const row = this.first(
      `SELECT COALESCE(d.title, f.name) AS title
       FROM files f
       LEFT JOIN documents d ON d.file_id = f.id
       WHERE f.path_rel = ? AND f.deleted = 0`,
      [pathRel]
    );
    return readString(row?.title);
  }

  getTagsForPath(pathRel: string): string[] {
    return this.all(
      `SELECT t.name AS name
       FROM document_tags dt
       JOIN tags t ON t.id = dt.tag_id
       JOIN files f ON f.id = dt.file_id
       WHERE f.path_rel = ? AND f.deleted = 0`,
      [pathRel]
    ).map((row) => readString(row.name));
  }

  private findUnlinkedMentions(pathRel: string, query: string, linked: BacklinkItem[]): BacklinkItem[] {
    if (!query.trim()) {
      return [];
    }
    const linkedPaths = new Set(linked.map((item) => item.pathRel));
    const like = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
    return this.all(
      `SELECT f.path_rel AS pathRel, COALESCE(d.title, f.name) AS title, d.plain_text AS plainText
       FROM documents d
       JOIN files f ON f.id = d.file_id
       WHERE f.deleted = 0 AND f.path_rel != ? AND d.plain_text LIKE ? ESCAPE '\\'
       LIMIT 30`,
      [pathRel, like]
    )
      .map((row) => ({
        pathRel: readString(row.pathRel),
        title: readString(row.title),
        line: 1,
        context: buildSnippet(readString(row.plainText), query)
      }))
      .filter((item) => !linkedPaths.has(item.pathRel));
  }

  private transaction(fn: () => void): void {
    this.db.run("BEGIN");
    try {
      fn();
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }

  private first(sql: string, params: SqlValue[] = []): Record<string, unknown> | undefined {
    return this.all(sql, params)[0];
  }

  private all(sql: string, params: SqlValue[] = []): Array<Record<string, unknown>> {
    const statement = this.db.prepare(sql);
    const rows: Array<Record<string, unknown>> = [];
    try {
      statement.bind(params);
      while (statement.step()) {
        rows.push(statement.getAsObject() as Record<string, unknown>);
      }
    } finally {
      statement.free();
    }
    return rows;
  }
}

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    const bytes = await readFile(require.resolve("sql.js/dist/sql-wasm.wasm"));
    const wasmBinary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    sqlJsPromise = initSqlJs({ wasmBinary });
  }
  return sqlJsPromise;
}

async function openSqlDatabase(SQL: SqlJsStatic, dbPath: string): Promise<Db> {
  let bytes: Buffer;
  try {
    bytes = await readFile(dbPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return new SQL.Database();
    }
    throw error;
  }

  try {
    return new SQL.Database(bytes);
  } catch (error) {
    if (!isRecoverableSqliteCorruption(error)) {
      throw error;
    }
  }

  await backupCorruptDatabase(dbPath);
  return new SQL.Database();
}

function isRecoverableSqliteCorruption(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database disk image is malformed|file is not a database|not a database|database malformed/i.test(message);
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

async function backupCorruptDatabase(dbPath: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? timestamp : `${timestamp}-${attempt}`;
    try {
      await rename(dbPath, `${dbPath}.corrupt-${suffix}`);
      return;
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "EEXIST") {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Unable to back up corrupted workspace database: ${dbPath}`);
}

function readString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

function readNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function snapshotEntryFromRow(row: Record<string, unknown>): FileHistoryEntry {
  return {
    id: readNumber(row.id),
    pathRel: readString(row.pathRel),
    snapshotPath: readString(row.snapshotPath),
    sha256: readString(row.sha256),
    reason: readString(row.reason),
    size: readNumber(row.size),
    createdAt: readNumber(row.createdAt)
  };
}

function uniqueLower(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function buildFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" AND ");
}

function buildSnippet(text: string, query: string): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) {
    return text.slice(0, 180);
  }
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + query.length + 90);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function parseEmbedding(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => (typeof item === "number" ? item : Number(item))).filter(Number.isFinite);
  } catch {
    return [];
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function statusMessageFor(state: AiSemanticIndexStatus["state"], staleFiles: number): string | undefined {
  if (state === "not_configured") {
    return "Embedding 模型尚未配置。";
  }
  if (state === "not_created") {
    return "语义索引尚未创建。";
  }
  if (state === "stale") {
    return staleFiles > 0 ? `语义索引有 ${staleFiles} 个文件需要更新。` : "语义索引配置已变化，需要重新更新。";
  }
  if (state === "ready") {
    return "语义索引可用。";
  }
  return undefined;
}

function matchesFilters(pathRel: string, tagFilter: string | undefined, pathFilter: string | undefined, db: WorkspaceDb): boolean {
  if (pathFilter && !pathRel.toLowerCase().includes(pathFilter.toLowerCase())) {
    return false;
  }
  if (tagFilter) {
    return db.getTagsForPath(pathRel).includes(tagFilter);
  }
  return true;
}
