import type { MnemonicDB } from '../store/database.js';
import type { SearchResult } from '../types.js';

export class VectorSearch {
  constructor(private db: MnemonicDB) {}

  /** Search by embedding (cosine similarity) */
  search(
    embedding: number[],
    options: {
      collection?: string[];
      limit?: number;
      minScore?: number;
    } = {}
  ): SearchResult[] {
    const limit = options.limit ?? 20;
    const minScore = options.minScore ?? 0;

    // Check if vector table exists
    if (!this.db.hasVectorIndex()) return [];

    const collectionFilter = options.collection?.length
      ? options.collection.map((c) => `AND d.collection = '${c.replace(/'/g, "''")}'`).join(' ')
      : '';

    // Format embedding for vec0 query
    const embeddingStr = `[${embedding.join(',')}]`;

    const sql = `
      SELECT d.docid, d.collection, d.path, d.full_path, d.title, d.tags,
             v.distance, c.heading, c.pos, d.modified_at
      FROM vectors_vec v
      JOIN vectors v2 ON v.hash = v2.hash
      JOIN chunks c ON c.docid = v2.hash AND c.seq = 0
      JOIN documents d ON d.docid = v2.hash
      WHERE v.embedding MATCH ? ${collectionFilter}
        AND v.distance <= ${1 - minScore}
      ORDER BY v.distance
      LIMIT ?
    `;

    try {
      const rows = this.db.db.prepare(sql).all(embeddingStr, limit) as Array<{
        docid: string;
        collection: string;
        path: string;
        full_path: string;
        title: string;
        tags: string | null;
        distance: number;
        heading: string;
        pos: number;
        modified_at: string | null;
      }>;

      return rows.map((r) => ({
        docid: r.docid,
        collection: r.collection,
        path: `mne://${r.collection}/${r.path}`,
        fullPath: r.full_path,
        title: r.title,
        score: 1 / (1 + r.distance), // Convert distance to similarity score
        snippet: '',
        context: [],
        tags: r.tags ? JSON.parse(r.tags) : [],
        line: r.pos,
        heading: r.heading,
        modifiedAt: r.modified_at ?? '',
      }));
    } catch {
      return [];
    }
  }

  /** Store embeddings in the vector index */
  storeVectors(vectors: Array<{ hash: string; embedding: number[] }>): void {
    const insertVec = this.db.db.prepare(
      'INSERT OR REPLACE INTO vectors (hash, embedding) VALUES (?, ?)'
    );
    const insertVec0 = this.db.db.prepare(
      'INSERT OR REPLACE INTO vectors_vec (hash, embedding) VALUES (?, ?)'
    );

    const tx = this.db.db.transaction(() => {
      for (const v of vectors) {
        const blob = Buffer.from(new Float32Array(v.embedding).buffer);
        insertVec.run(v.hash, blob);
        insertVec0.run(v.hash, JSON.stringify(v.embedding));
      }
    });

    tx();
  }

  /** Delete vectors for a document */
  deleteVectors(hash: string): void {
    this.db.db.prepare('DELETE FROM vectors WHERE hash = ?').run(hash);
    // vec0 cascades deletion automatically
  }
}
