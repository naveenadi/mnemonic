import type { MnemonicDB } from '../store/database.js';
import type { SearchResult } from '../types.js';

export class FTSSearch {
  constructor(private db: MnemonicDB) {}

  /** BM25 search via FTS5 */
  search(
    query: string,
    options: {
      collection?: string[];
      limit?: number;
      minScore?: number;
    } = {}
  ): SearchResult[] {
    const limit = options.limit ?? 20;
    const minScore = options.minScore ?? 0;

    // FTS5 syntax: clean the query
    const cleanQuery = this.cleanQuery(query);
    if (!cleanQuery) return [];

    const collectionFilter = options.collection?.length
      ? options.collection.map((c) => `AND d.collection = '${c.replace(/'/g, "''")}'`).join(' ')
      : '';

    const sql = `
      SELECT d.docid, d.collection, d.path, d.full_path, d.title, d.tags,
             fts.rank as bm25_score,
             snippet(documents_fts, 0, '<mark>', '</mark>', '...', 32) as snippet,
             d.modified_at
      FROM documents_fts fts
      JOIN documents d ON d.id = fts.rowid
      WHERE documents_fts MATCH ? ${collectionFilter}
      ORDER BY rank
      LIMIT ?
    `;

    try {
      const rows = this.db.db.prepare(sql).all(cleanQuery, limit) as Array<{
        docid: string;
        collection: string;
        path: string;
        full_path: string;
        title: string;
        tags: string | null;
        bm25_score: number;
        snippet: string;
        modified_at: string | null;
      }>;

      return rows
        .filter((r) => {
          const score = Math.abs(r.bm25_score);
          return score >= minScore;
        })
        .map((r) => ({
          docid: r.docid,
          collection: r.collection,
          path: `mne://${r.collection}/${r.path}`,
          fullPath: r.full_path,
          title: r.title,
          score: Math.abs(r.bm25_score),
          snippet: r.snippet.replace(/<mark>/g, '**').replace(/<\/mark>/g, '**'),
          context: [],
          tags: r.tags ? JSON.parse(r.tags) : [],
          line: 1,
          heading: '',
          modifiedAt: r.modified_at ?? '',
        }));
    } catch {
      // FTS5 query syntax error — fall back to LIKE search
      return this.fallbackSearch(cleanQuery, options);
    }
  }

  /** Fallback to LIKE-based search when FTS5 syntax fails */
  private fallbackSearch(
    query: string,
    options: {
      collection?: string[];
      limit?: number;
      minScore?: number;
    }
  ): SearchResult[] {
    const limit = options.limit ?? 20;
    const terms = query
      .replace(/["*()]/g, '')
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) return [];

    const likeClauses = terms.map(() => '(d.title LIKE ? OR d.content LIKE ?)').join(' AND ');
    const params = terms.flatMap((t) => [`%${t}%`, `%${t}%`]);

    const collectionFilter = options.collection?.length
      ? options.collection.map((c) => `AND d.collection = '${c.replace(/'/g, "''")}'`).join(' ')
      : '';

    const sql = `
      SELECT d.docid, d.collection, d.path, d.full_path, d.title, d.tags,
             d.content, d.modified_at
      FROM documents d
      WHERE ${likeClauses} ${collectionFilter}
      ORDER BY d.size DESC
      LIMIT ?
    `;

    const rows = this.db.db.prepare(sql).all(...params, limit) as Array<{
      docid: string;
      collection: string;
      path: string;
      full_path: string;
      title: string;
      tags: string | null;
      content: string;
      modified_at: string | null;
    }>;

    return rows.map((r) => ({
      docid: r.docid,
      collection: r.collection,
      path: `mne://${r.collection}/${r.path}`,
      fullPath: r.full_path,
      title: r.title,
      score: 0.5, // uniform score for LIKE results
      snippet: r.content.slice(0, 200).replace(/\n/g, ' '),
      context: [],
      tags: r.tags ? JSON.parse(r.tags) : [],
      line: 1,
      heading: '',
      modifiedAt: r.modified_at ?? '',
    }));
  }

  /** Clean a query for FTS5 syntax */
  private cleanQuery(query: string): string {
    // If already FTS5 syntax (has quotes, operators), keep as-is
    if (/["*()OR AND NEAR]/.test(query)) return query;

    // Convert to FTS5: escape special chars, wrap phrases in quotes
    return query
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => {
        if (/^[a-zA-Z0-9_-]+$/.test(term)) return term;
        return `"${term.replace(/"/g, '')}"`;
      })
      .join(' ');
  }
}
