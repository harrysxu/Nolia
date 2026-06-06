import { readFile, writeFile } from "node:fs/promises";
import initSqlJs from "sql.js";
import type { SqlJsStatic, SqlValue } from "sql.js";

import type {
  BacklinkItem,
  BacklinksResponse,
  FileKind,
  ParsedDocument,
  SearchQueryResponse
} from "../../shared/types";
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

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

export class WorkspaceDb {
  private indexVersion = 0;
  private ftsEnabled = true;

  private constructor(
    private readonly dbPath: string,
    private readonly db: Db
  ) {}

  static async open(dbPath: string): Promise<WorkspaceDb> {
    const SQL = await getSqlJs();
    let db: Db;
    try {
      const bytes = await readFile(dbPath);
      db = new SQL.Database(bytes);
    } catch {
      db = new SQL.Database();
    }

    const workspaceDb = new WorkspaceDb(dbPath, db);
    workspaceDb.ensureSchema();
    await workspaceDb.save();
    return workspaceDb;
  }

  close(): void {
    this.db.close();
  }

  async save(): Promise<void> {
    const bytes = this.db.export();
    await writeFile(this.dbPath, Buffer.from(bytes));
  }

  markAllFilesDeleted(): void {
    this.db.run("UPDATE files SET deleted = 1");
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
      this.refreshTagCounts();
      this.indexVersion += 1;
    });
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

function matchesFilters(pathRel: string, tagFilter: string | undefined, pathFilter: string | undefined, db: WorkspaceDb): boolean {
  if (pathFilter && !pathRel.toLowerCase().includes(pathFilter.toLowerCase())) {
    return false;
  }
  if (tagFilter) {
    return db.getTagsForPath(pathRel).includes(tagFilter);
  }
  return true;
}
