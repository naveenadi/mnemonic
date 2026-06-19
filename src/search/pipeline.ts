import type { MnemonicDB } from '../store/database.js';
import { DocumentStore } from '../store/documents.js';
import type { LLMBackend, SearchOptions, SearchResult, ExpandedQuery } from '../types.js';
import { FTSSearch } from './fts.js';
import { VectorSearch } from './vector.js';
import { fuseResults, blendWithRerank } from './fusion.js';

export class SearchPipeline {
  private fts: FTSSearch;
  private vector: VectorSearch;
  private docs: DocumentStore;

  constructor(
    private db: MnemonicDB,
    private llm?: LLMBackend
  ) {
    this.fts = new FTSSearch(db);
    this.vector = new VectorSearch(db);
    this.docs = new DocumentStore(db);
  }

  /** Set LLM backend after construction */
  setLLM(llm: LLMBackend): void {
    this.llm = llm;
  }

  /** Main search entry point */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    const { query, queries, intent, collection, limit, minScore, rerank } = options;
    const expand = options.expand ?? true;
    const useHyde = options.hyde ?? true;
    const limitNum = limit ?? 10;
    const candidateLimit = options.candidateLimit ?? 40;

    // Resolve collection filter
    const collectionFilter = collection
      ? (Array.isArray(collection) ? collection : [collection])
      : undefined;

    // If no filter, use default collections
    const collections = collectionFilter ?? this.getDefaultCollections();

    // Determine which queries to run
    let expandedQueries: ExpandedQuery[] = queries ?? [];

    if (!queries && query) {
      // Auto-expand query
      if (expand && this.llm) {
        const expansions = await this.llm.expandQuery(query, intent);
        expandedQueries = [
          { type: 'lex', query },
          { type: 'vec', query },
          ...expansions.map((q) => ({ type: 'vec' as const, query: q })),
        ];
      } else {
        expandedQueries = [
          { type: 'lex', query },
          { type: 'vec', query },
        ];
      }

      // Add HyDE if enabled
      if (useHyde && this.llm) {
        const hydeDoc = await this.llm.generateHyde(query, intent);
        if (hydeDoc && hydeDoc !== query) {
          expandedQueries.push({ type: 'hyde', query: hydeDoc });
        }
      }
    }

    // Run all sub-queries against FTS and vector backends
    const lists: Array<{
      results: SearchResult[];
      source: 'fts' | 'vector' | 'hyde';
      queryType: 'original' | 'expanded' | 'hyde';
      query: string;
      weight: number;
    }> = [];

    for (const eq of expandedQueries) {
      let isOriginal = false;
      if (!queries && eq.query === query && eq.type !== 'hyde') {
        isOriginal = true;
      }

      const weight = isOriginal ? 2 : 1;
      const queryType = eq.type === 'hyde' ? 'hyde' : (isOriginal ? 'original' : 'expanded');
      const source = eq.type === 'lex' ? 'fts' : eq.type === 'hyde' ? 'hyde' : 'vector';

      if (eq.type === 'lex') {
        const results = this.fts.search(eq.query, {
          collection: collections,
          limit: candidateLimit,
          minScore,
        });
        lists.push({ results, source: 'fts', queryType: queryType as any, query: eq.query, weight });
      } else if (eq.type === 'vec' && this.llm) {
        try {
          const [embedding] = await this.llm.embed([eq.query]);
          const results = this.vector.search(embedding, {
            collection: collections,
            limit: candidateLimit,
            minScore,
          });
          lists.push({ results, source: 'vector', queryType: queryType as any, query: eq.query, weight });
        } catch {
          // Embedding failed, skip
        }
      } else if (eq.type === 'hyde' && this.llm) {
        try {
          const [embedding] = await this.llm.embed([eq.query]);
          const results = this.vector.search(embedding, {
            collection: collections,
            limit: candidateLimit,
            minScore,
          });
          lists.push({ results, source: 'hyde', queryType: 'hyde', query: eq.query, weight });
        } catch {
          // HyDE embedding failed, skip
        }
      }
    }

    if (lists.length === 0) return [];

    // RRF Fusion
    const { results: fused, ranked } = fuseResults(lists, {
      topRankBonus: true,
      candidateLimit,
    });

    if (fused.length === 0) return [];

    // LLM Reranking
    if (rerank !== false && this.llm && fused.length > 1) {
      try {
        const docs = fused.map((r) => r.snippet || r.title);
        const scores = await this.llm.rerank(query ?? '', docs);

        const rerankScores = new Map<string, number>();
        for (let i = 0; i < fused.length; i++) {
          rerankScores.set(fused[i].docid, scores[i] ?? 0);
        }

        const blended = blendWithRerank(ranked, rerankScores, limitNum);

        // Apply time decay and link boost
        return this.applyPostProcessors(blended, options);
      } catch {
        // Reranking failed, use fused results
      }
    }

    // Without reranking, use fused results directly
    const results = fused.slice(0, limitNum);
    return this.applyPostProcessors(results, options);
  }

  /** Apply time decay and link boost post-processors */
  private applyPostProcessors(
    results: SearchResult[],
    options: SearchOptions
  ): SearchResult[] {
    let processed = results;

    if (options.decay) {
      processed = this.applyTimeDecay(processed, options.decayHalfLifeDays ?? 30);
    }

    if (options.boostLinks) {
      processed = this.applyLinkBoost(processed);
    }

    // Add context
    processed = processed.map((r) => ({
      ...r,
      context: this.docs.getContextChain(r.collection, r.path.replace(`mne://${r.collection}/`, '')),
    }));

    return processed;
  }

  /** Apply exponential time decay based on modification date */
  private applyTimeDecay(
    results: SearchResult[],
    halfLifeDays: number
  ): SearchResult[] {
    const now = Date.now();
    const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;

    return results.map((r) => {
      let decayFactor = 1;

      if (r.modifiedAt) {
        const modified = new Date(r.modifiedAt).getTime();
        if (!isNaN(modified)) {
          const ageMs = now - modified;
          decayFactor = Math.pow(0.5, ageMs / halfLifeMs);
        }
      }

      return {
        ...r,
        score: r.score * (0.7 + 0.3 * decayFactor),
      };
    }).sort((a, b) => b.score - a.score);
  }

  /** Boost results that have more incoming links */
  private applyLinkBoost(results: SearchResult[]): SearchResult[] {
    const maxLinks = Math.max(
      1,
      ...results.map((r) => {
        const count = this.db.db
          .prepare('SELECT COUNT(*) as c FROM links WHERE target_docid = ?')
          .get(r.docid) as { c: number };
        return count.c;
      })
    );

    return results.map((r) => {
      const count = this.db.db
        .prepare('SELECT COUNT(*) as c FROM links WHERE target_docid = ?')
        .get(r.docid) as { c: number };
      const boost = 1 + 0.2 * (count.c / maxLinks);

      return {
        ...r,
        score: r.score * boost,
      };
    }).sort((a, b) => b.score - a.score);
  }

  /** Get default collection names */
  private getDefaultCollections(): string[] {
    const rows = this.db.db
      .prepare('SELECT name FROM collections WHERE include_by_default = 1')
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  /** BM25-only search (fast, no LLM) */
  searchLex(
    query: string,
    options?: { collection?: string[]; limit?: number; minScore?: number }
  ): SearchResult[] {
    return this.fts.search(query, options);
  }

  /** Vector-only search */
  async searchVector(
    query: string,
    options?: { collection?: string[]; limit?: number }
  ): Promise<SearchResult[]> {
    if (!this.llm) return [];

    try {
      const [embedding] = await this.llm.embed([query]);
      return this.vector.search(embedding, options);
    } catch {
      return [];
    }
  }
}
