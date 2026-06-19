import { createHash } from 'node:crypto';
import type { MnemonicDB } from './database.js';
import type {
  DocumentRecord,
  DocumentResult,
  DocumentNotFound,
  CollectionConfig,
  ContextEntry,
  LinkEntry,
  SearchResult,
} from '../types.js';

/** Generate 6-char docid from content hash */
export function docid(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 6);
}

/** Generate full content hash */
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Extract title from content (first heading or filename) */
export function extractTitle(content: string, fallback: string): string {
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  return fallback.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
}

/** Parse frontmatter from markdown content */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
} {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { frontmatter: null, body: content };
  try {
    const { parse } = require('yaml');
    const fm = parse(fmMatch[1]) as Record<string, unknown>;
    return { frontmatter: fm, body: fmMatch[2] };
  } catch {
    return { frontmatter: null, body: content };
  }
}

/** Extract tags from frontmatter and inline #tags */
export function extractTags(
  frontmatter: Record<string, unknown> | null,
  content: string
): string[] {
  const tags = new Set<string>();

  // From frontmatter
  if (frontmatter?.tags) {
    if (Array.isArray(frontmatter.tags)) {
      frontmatter.tags.forEach((t) => tags.add(String(t)));
    } else if (typeof frontmatter.tags === 'string') {
      tags.add(frontmatter.tags);
    }
  }

  // Inline #tags (not in code blocks)
  const codeBlock = /```[\s\S]*?```/g;
  const cleaned = content.replace(codeBlock, '');
  const tagPattern = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let match;
  while ((match = tagPattern.exec(cleaned)) !== null) {
    tags.add(match[1]);
  }

  return [...tags].sort();
}

export class DocumentStore {
  constructor(private db: MnemonicDB) {}

  /** Add or update a document */
  upsert(
    collection: string,
    relPath: string,
    fullPath: string,
    content: string
  ): { docid: string; isNew: boolean; needsEmbed: boolean } {
    const hash = contentHash(content);
    const id = docid(content);
    const title = extractTitle(content, relPath);
    const { frontmatter } = parseFrontmatter(content);
    const tags = extractTags(frontmatter, content);
    const fmJson = frontmatter ? JSON.stringify(frontmatter) : null;
    const tagsJson = JSON.stringify(tags);

    const existing = this.db.db
      .prepare('SELECT checksum FROM documents WHERE docid = ?')
      .get(id) as { checksum: string } | undefined;

    if (existing && existing.checksum === hash) {
      return { docid: id, isNew: false, needsEmbed: false };
    }

    if (existing) {
      // Update existing
      this.db.db
        .prepare(
          `UPDATE documents SET content = ?, checksum = ?, size = ?, title = ?,
           frontmatter = ?, tags = ?, indexed_at = datetime('now') WHERE docid = ?`
        )
        .run(content, hash, content.length, title, fmJson, tagsJson, id);
    } else {
      // Insert new
      this.db.db
        .prepare(
          `INSERT INTO documents (docid, collection, path, full_path, title, content, checksum, size, frontmatter, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, collection, relPath, fullPath, title, content, hash, content.length, fmJson, tagsJson);
    }

    // Upsert tags
    if (existing) {
      this.db.db.prepare('DELETE FROM tags WHERE docid = ? AND source = ?').run(id, 'frontmatter');
    }
    for (const tag of tags) {
      this.db.db
        .prepare('INSERT OR IGNORE INTO tags (docid, tag, source) VALUES (?, ?, ?)')
        .run(id, tag, 'frontmatter');
    }

    // Extract and store links
    this.storeLinks(id, relPath, content);

    return { docid: id, isNew: !existing, needsEmbed: true };
  }

  /** Extract wikilinks and markdown links from content */
  private storeLinks(docid: string, relPath: string, content: string): void {
    // Clear existing links for this doc
    this.db.db.prepare('DELETE FROM links WHERE source_docid = ?').run(docid);

    const links: Array<{ target: string; type: 'wikilink' | 'markdown' | 'autolink' }> = [];

    // Wikilinks: [[target]] or [[target|display]]
    const wikilinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = wikilinkPattern.exec(content)) !== null) {
      links.push({ target: match[1].trim(), type: 'wikilink' });
    }

    // Markdown links: [text](target) (only local .md links)
    const mdLinkPattern = /\[[^\]]*\]\(([^)]+\.md[^)]*)\)/g;
    while ((match = mdLinkPattern.exec(content)) !== null) {
      links.push({ target: match[1], type: 'markdown' });
    }

    const stmt = this.db.db.prepare(
      'INSERT INTO links (source_docid, source_path, target_docid, target_path, link_type) VALUES (?, ?, ?, ?, ?)'
    );

    for (const link of links) {
      // Try to resolve target docid
      const targetDoc = this.db.db
        .prepare('SELECT docid FROM documents WHERE path LIKE ? OR path LIKE ?')
        .get(`%${link.target}%`, `%/link.target.md`) as { docid: string } | undefined;

      stmt.run(docid, relPath, targetDoc?.docid ?? null, link.target, link.type);
    }
  }

  /** Remove a document and its related data */
  remove(docid: string): void {
    this.db.db.prepare('DELETE FROM tags WHERE docid = ?').run(docid);
    this.db.db.prepare('DELETE FROM links WHERE source_docid = ?').run(docid);
    this.db.db.prepare('DELETE FROM chunks WHERE docid = ?').run(docid);
    this.db.db.prepare('DELETE FROM documents WHERE docid = ?').run(docid);
  }

  /** Remove all documents in a collection */
  removeCollection(name: string): void {
    const docs = this.db.db
      .prepare('SELECT docid FROM documents WHERE collection = ?')
      .all(name) as Array<{ docid: string }>;
    for (const d of docs) {
      this.remove(d.docid);
    }
    this.db.db.prepare('DELETE FROM collections WHERE name = ?').run(name);
  }

  /** Get a document by path or docid */
  get(identifier: string): DocumentResult | DocumentNotFound {
    const isDocid = identifier.startsWith('#') || /^[a-f0-9]{6}$/i.test(identifier);
    const cleanId = identifier.replace(/^#/, '');

    let doc: DocumentRecord | undefined;
    if (isDocid) {
      doc = this.db.db
        .prepare('SELECT * FROM documents WHERE docid = ?')
        .get(cleanId) as DocumentRecord | undefined;
    } else {
      doc = this.db.db
        .prepare('SELECT * FROM documents WHERE path LIKE ? OR full_path LIKE ?')
        .get(`%${identifier}%`, `%${identifier}%`) as DocumentRecord | undefined;
    }

    if (!doc) {
      // Find similar files
      const similar = this.db.db
        .prepare("SELECT path FROM documents WHERE path LIKE ? LIMIT 5")
        .all(`%${identifier.slice(0, 3)}%`) as Array<{ path: string }>;

      return {
        error: `Document not found: ${identifier}`,
        similarFiles: similar.map((s) => s.path),
      };
    }

    const tags = doc.tags ? JSON.parse(doc.tags) : [];
    const frontmatter = doc.frontmatter ? JSON.parse(doc.frontmatter) : undefined;

    return {
      docid: doc.docid,
      path: doc.path,
      fullPath: (doc as any).full_path,
      collection: doc.collection,
      title: doc.title,
      tags,
      frontmatter,
      body: doc.content,
      totalLines: doc.content.split('\n').length,
    };
  }

  /** Get document body with line range */
  getBody(
    identifier: string,
    options?: { fromLine?: number; maxLines?: number }
  ): { content: string; totalLines: number } | DocumentNotFound {
    const doc = this.get(identifier);
    if ('error' in doc) return doc;

    const lines = doc.body.split('\n');
    const start = (options?.fromLine ?? 1) - 1;
    const end = options?.maxLines ? start + options.maxLines : lines.length;
    const slice = lines.slice(start, end).join('\n');

    return { content: slice, totalLines: lines.length };
  }

  /** Add context entry */
  addContext(collection: string | null, path: string, context: string): void {
    this.db.db
      .prepare(
        'INSERT OR REPLACE INTO contexts (collection, path, context) VALUES (?, ?, ?)'
      )
      .run(collection, path, context);
  }

  /** List all contexts */
  listContexts(): ContextEntry[] {
    return this.db.db
      .prepare('SELECT collection, path, context FROM contexts ORDER BY path')
      .all() as ContextEntry[];
  }

  /** Remove a context */
  removeContext(collection: string | null, path: string): void {
    this.db.db
      .prepare('DELETE FROM contexts WHERE collection = ? AND path = ?')
      .run(collection, path);
  }

  /** Get context chain for a document (hierarchical) */
  getContextChain(collection: string, relPath: string): string[] {
    const contexts: string[] = [];

    // Match contexts by path prefix, from most specific to least
    const all = this.db.db
      .prepare(
        `SELECT path, context FROM contexts
         WHERE (collection = ? OR collection IS NULL)
         ORDER BY length(path) DESC`
      )
      .all(collection) as Array<{ path: string; context: string }>;

    for (const ctx of all) {
      if (relPath.startsWith(ctx.path) || ctx.path === '/') {
        contexts.push(ctx.context);
      }
    }

    return contexts;
  }

  /** Add a manual tag */
  addTag(docid: string, tag: string): void {
    this.db.db
      .prepare('INSERT OR IGNORE INTO tags (docid, tag, source) VALUES (?, ?, ?)')
      .run(docid, tag, 'manual');
  }

  /** Remove a manual tag */
  removeTag(docid: string, tag: string): void {
    this.db.db
      .prepare('DELETE FROM tags WHERE docid = ? AND tag = ? AND source = ?')
      .run(docid, tag, 'manual');
  }

  /** Get all tags */
  getAllTags(): Array<{ tag: string; count: number }> {
    return this.db.db
      .prepare('SELECT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY count DESC')
      .all() as Array<{ tag: string; count: number }>;
  }

  /** Get backlinks to a document */
  getBacklinks(docid: string): LinkEntry[] {
    return this.db.db
      .prepare(
        `SELECT source_docid as sourceDocid, source_path as sourcePath,
                target_docid as targetDocid, target_path as targetPath,
                link_type as linkType
         FROM links WHERE target_docid = ? OR target_path LIKE ?`
      )
      .all(docid, `%${docid}%`) as LinkEntry[];
  }

  /** Get outgoing links from a document */
  getLinks(docid: string): LinkEntry[] {
    return this.db.db
      .prepare(
        `SELECT source_docid as sourceDocid, source_path as sourcePath,
                target_docid as targetDocid, target_path as targetPath,
                link_type as linkType
         FROM links WHERE source_docid = ?`
      )
      .all(docid) as LinkEntry[];
  }

  /** Find orphan documents (no incoming or outgoing links) */
  getOrphans(): Array<{ docid: string; path: string }> {
    return this.db.db
      .prepare(
        `SELECT docid, path FROM documents WHERE docid NOT IN (
          SELECT DISTINCT source_docid FROM links
          UNION
          SELECT DISTINCT target_docid FROM links WHERE target_docid IS NOT NULL
        ) ORDER BY path`
      )
      .all() as Array<{ docid: string; path: string }>;
  }
}
