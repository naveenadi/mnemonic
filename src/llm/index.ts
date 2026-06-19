export interface LLMBackend {
  /** Generate embeddings for text (returns normalized vectors) */
  embed(texts: string[]): Promise<number[][]>;

  /** Rerank documents by relevance to query */
  rerank(query: string, documents: string[]): Promise<number[]>;

  /** Generate query expansions */
  expandQuery(query: string, intent?: string): Promise<string[]>;

  /** Generate HyDE document passage */
  generateHyde(query: string, intent?: string): Promise<string>;

  /** Get embedding dimension */
  embeddingDim(): number;

  /** Close/release resources */
  close(): Promise<void>;
}

/** Normalize a vector to unit length */
export function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (mag === 0) return v;
  return v.map((x) => x / mag);
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
