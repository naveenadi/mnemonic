import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CollectionConfig, StoreOptions } from '../types.js';

/** SQLite schema: all tables and indices */
const SCHEMA = `
-- Collections: indexed directories with name and glob patterns
CREATE TABLE IF NOT EXISTS collections (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  glob_pattern TEXT NOT NULL DEFAULT '**/*.md',
  ignore_pattern TEXT,
  include_by_default INTEGER NOT NULL DEFAULT 1,
  update_cmd TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_modified TEXT
);

-- Documents: files with content hash, title, path, metadata
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  docid TEXT NOT NULL UNIQUE,
  collection TEXT NOT NULL,
  path TEXT NOT NULL,
  full_path TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  checksum TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  frontmatter TEXT,
  tags TEXT,
  modified_at TEXT,
  FOREIGN KEY (collection) REFERENCES collections(name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_docs_collection ON documents(collection);
CREATE INDEX IF NOT EXISTS idx_docs_path ON documents(collection, path);

-- FTS5 full-text index
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  content,
  heading,
  content=documents,
  content_rowid=id,
  tokenize='porter unicode61'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, content, heading)
  VALUES (new.id, new.title, new.content, COALESCE(
    (SELECT heading FROM chunks WHERE docid = new.docid AND seq = 0 LIMIT 1),
    new.title
  ));
END;

CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content, heading)
  VALUES ('delete', old.id, old.title, old.content, '');
END;

CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content, heading)
  VALUES ('delete', old.id, old.title, old.content, '');
  INSERT INTO documents_fts(rowid, title, content, heading)
  VALUES (new.id, new.title, new.content, COALESCE(
    (SELECT heading FROM chunks WHERE docid = new.docid AND seq = 0 LIMIT 1),
    new.title
  ));
END;

-- Chunks: document splits for embedding
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  docid TEXT NOT NULL,
  seq INTEGER NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  checksum TEXT NOT NULL,
  FOREIGN KEY (docid) REFERENCES documents(docid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_docid ON chunks(docid);

-- Context: hierarchical metadata tree
CREATE TABLE IF NOT EXISTS contexts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT,
  path TEXT NOT NULL,
  context TEXT NOT NULL,
  UNIQUE(collection, path)
);

-- Links: wikilink graph
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_docid TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_docid TEXT,
  target_path TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'wikilink',
  FOREIGN KEY (source_docid) REFERENCES documents(docid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_docid);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_docid);
CREATE INDEX IF NOT EXISTS idx_links_target_path ON links(target_path);

-- Tags: manual + frontmatter
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  docid TEXT NOT NULL,
  tag TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE(docid, tag, source),
  FOREIGN KEY (docid) REFERENCES documents(docid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tags_docid ON tags(docid);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

-- LLM cache
CREATE TABLE IF NOT EXISTS llm_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

-- Global settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class MnemonicDB {
  public db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  /** Initialize schema */
  init(): void {
    this.db.exec(SCHEMA);
  }

  /** Load sqlite-vec extension */
  async loadVectors(): Promise<void> {
    try {
      const sqliteVec = await import('sqlite-vec');
      sqliteVec.load(this.db);
    } catch {
      // sqlite-vec not available, vector search disabled
    }
  }

  /** Check if vector index exists */
  hasVectorIndex(): boolean {
    try {
      this.db.prepare("SELECT 1 FROM vectors_vec LIMIT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  /** Create vector table with given dimension */
  createVectorTable(dim: number): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL UNIQUE,
        embedding BLOB NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS vectors_vec USING vec0(
        hash TEXT PRIMARY KEY,
        embedding float[${dim}]
      );
    `);
  }

  /** Close database */
  close(): void {
    this.db.close();
  }

  /** Get database file path */
  getPath(): string {
    return this.dbPath;
  }
}

/** Load collection config from YAML or inline options */
export function loadConfig(options: StoreOptions): Record<string, CollectionConfig> {
  if (options.config?.collections) {
    return options.config.collections;
  }

  if (options.configPath && existsSync(options.configPath)) {
    const content = readFileSync(options.configPath, 'utf-8');
    const parsed = parseYaml(content) as Record<string, unknown>;
    if (parsed.collections && typeof parsed.collections === 'object') {
      return parsed.collections as Record<string, CollectionConfig>;
    }
  }

  return {};
}
