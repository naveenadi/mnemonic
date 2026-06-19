// ─── Core Types ───────────────────────────────────────────────────────

/** Document metadata as stored in SQLite */
export interface DocumentRecord {
  id: number;
  docid: string; // 6-char content hash
  collection: string;
  path: string; // collection-relative path
  fullPath: string; // absolute filesystem path
  title: string;
  content: string;
  checksum: string; // full content hash
  size: number;
  createdAt: string; // file mtime
  indexedAt: string;
  frontmatter: string | null; // JSON blob
  tags: string | null; // JSON array
}

/** A chunk of a document, stored in the vectors index */
export interface ChunkRecord {
  hash: string; // document hash
  seq: number; // chunk sequence (0, 1, 2...)
  pos: number; // char position in original
  content: string;
  heading: string; // nearest heading context
}

/** Search result from any backend */
export interface SearchResult {
  docid: string;
  collection: string;
  path: string; // mne:// URI or relative path
  fullPath: string;
  title: string;
  score: number;
  snippet: string;
  context: string[]; // hierarchical context chain
  tags: string[];
  line: number;
  heading: string;
  modifiedAt: string;
  explain?: ScoreExplain;
}

export interface ScoreExplain {
  ftsScores: number[];
  vectorScores: number[];
  rerankScore?: number;
  rrf: {
    rank: number;
    weight: number;
    baseScore: number;
    topRankBonus: number;
    totalScore: number;
    contributions: Array<{
      source: 'fts' | 'vector' | 'hyde';
      queryType: 'original' | 'expanded' | 'hyde';
      query: string;
      rank: number;
      weight: number;
      backendScore: number;
      rrfContribution: number;
    }>;
  };
  decay?: number;
  linkBoost?: number;
}

/** Typed sub-query for structured search */
export interface ExpandedQuery {
  type: 'lex' | 'vec' | 'hyde';
  query: string;
}

/** Collection configuration */
export interface CollectionConfig {
  path: string;
  name: string;
  pattern?: string;
  ignore?: string[];
  includeByDefault?: boolean;
  updateCommand?: string;
}

/** Store configuration */
export interface StoreOptions {
  dbPath: string;
  config?: {
    collections?: Record<string, CollectionConfig>;
  };
  configPath?: string;
}

/** Search options */
export interface SearchOptions {
  query?: string;
  queries?: ExpandedQuery[];
  intent?: string;
  collection?: string | string[];
  limit?: number;
  minScore?: number;
  candidateLimit?: number;
  rerank?: boolean;
  expand?: boolean;
  hyde?: boolean;
  decay?: boolean;
  decayHalfLifeDays?: number;
  boostLinks?: boolean;
  explain?: boolean;
  fullContent?: boolean;
  format?: 'cli' | 'json' | 'md' | 'files';
}

/** Ingestion result */
export interface UpdateResult {
  collections: string[];
  indexed: number;
  updated: number;
  unchanged: number;
  removed: number;
  needsEmbedding: number;
}

/** Embedding progress */
export interface EmbedProgress {
  current: number;
  total: number;
  collection: string;
}

/** Embedding result */
export interface EmbedResult {
  embedded: number;
  skipped: number;
  failed: number;
}

/** Store status */
export interface IndexStatus {
  collections: CollectionInfo[];
  documentCount: number;
  chunkCount: number;
  vectorCount: number;
  linkCount: number;
  tagCount: number;
  dbSize: number;
  lastIndexed: string | null;
  mcpPid?: number;
}

export interface CollectionInfo {
  name: string;
  path: string;
  globPattern: string;
  docCount: number;
  activeCount: number;
  lastModified: string;
  includeByDefault: boolean;
  contextCount: number;
}

/** Context entry (hierarchical metadata) */
export interface ContextEntry {
  collection: string;
  path: string;
  context: string;
}

/** Link graph entry */
export interface LinkEntry {
  sourceDocid: string;
  sourcePath: string;
  targetDocid: string | null;
  targetPath: string;
  linkType: 'wikilink' | 'markdown' | 'autolink';
}

/** Document retrieval */
export interface DocumentResult {
  docid: string;
  path: string;
  fullPath: string;
  collection: string;
  title: string;
  tags: string[];
  frontmatter?: Record<string, unknown>;
  body: string;
  totalLines: number;
}

export interface DocumentNotFound {
  error: string;
  similarFiles: string[];
}

/** LLM backend interface */
export interface LLMBackend {
  /** Generate embeddings for text (returns normalized vectors) */
  embed(texts: string[]): Promise<number[][]>;

  /** Rerank documents by relevance to query */
  rerank(query: string, documents: string[]): Promise<number[]>;

  /** Generate query expansions */
  expandQuery(query: string, intent?: string): Promise<string[]>;

  /** Generate HyDE document */
  generateHyde(query: string, intent?: string): Promise<string>;

  /** Get embedding dimension */
  embeddingDim(): number;

  /** Close/release resources */
  close(): Promise<void>;
}
