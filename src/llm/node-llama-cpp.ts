import type { LLMBackend } from './index.js';
import { normalize } from './index.js';

export interface NodeLlamaConfig {
  /** Path to cache directory for model downloads */
  cachePath?: string;
  /** Override models (HF URIs) */
  embedModel?: string;
  rerankModel?: string;
  generateModel?: string;
  /** GPU backend: 'metal' | 'vulkan' | 'cuda' | 'auto' */
  gpu?: string;
  /** Force CPU mode */
  forceCpu?: boolean;
}

const DEFAULT_EMBED_MODEL =
  'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';
const DEFAULT_RERANK_MODEL =
  'hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf';
const DEFAULT_GENERATE_MODEL =
  'hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf';

export class NodeLlamaBackend implements LLMBackend {
  private config: NodeLlamaConfig;
  private embedModel: any = null;
  private rerankModel: any = null;
  private generateModel: any = null;
  private dim: number = 768;
  private initialized = false;

  constructor(config: NodeLlamaConfig = {}) {
    this.config = config;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const { getLlama } = await import('node-llama-cpp');
    const getLlamaFn: any = getLlama;
    const llama: any = await getLlamaFn({
      gpu: this.config.forceCpu ? 'disable' : (this.config.gpu ?? 'auto'),
    });

    // Load generate model (for query expansion, HyDE)
    try {
      this.generateModel = await llama.loadModel({
        modelPath: this.config.generateModel ?? DEFAULT_GENERATE_MODEL,
      });
    } catch {
      // Generate model is optional
    }

    // Load reranker model
    try {
      this.rerankModel = await llama.loadModel({
        modelPath: this.config.rerankModel ?? DEFAULT_RERANK_MODEL,
      });
    } catch {
      // Reranker is optional
    }

    // Load embed model
    try {
      const embed = await llama.loadModel({
        modelPath: this.config.embedModel ?? DEFAULT_EMBED_MODEL,
      });
      this.embedModel = embed;

      // Infer dimension from model
      this.dim = this.config.embedModel?.includes('0.6B') ? 896 : 768;
    } catch {
      throw new Error(
        'Failed to load embedding model. Ensure node-llama-cpp is installed and models can be downloaded.'
      );
    }

    this.initialized = true;
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.ensureInitialized();

    const llama: any = this.embedModel?.llama;
    if (!llama) return texts.map(() => new Array(this.dim).fill(0));

    const context = await llama.createEmbeddingContext({
      model: this.embedModel,
    });

    const results: number[][] = [];
    for (const text of texts) {
      const embedding = await context.getEmbedding(text);
      results.push(normalize([...embedding]));
    }

    context.dispose();
    return results;
  }

  async rerank(_query: string, documents: string[]): Promise<number[]> {
    await this.ensureInitialized();

    if (!this.rerankModel) {
      return documents.map(() => 0.5);
    }

    const llama: any = this.rerankModel?.llama;
    if (!llama) return documents.map(() => 0.5);

    const rankContext = await llama.createRankingContext({
      model: this.rerankModel,
    });

    const ranked = await rankContext.rankAndSort(
      documents.map((doc: string, idx: number) => ({
        text: doc,
        idx,
      })),
      _query
    );

    rankContext.dispose();

    // Map back to original order with scores
    const scores = new Array(documents.length).fill(0);
    const maxScore = ranked.length > 0 ? ranked[0].score : 1;

    for (const r of ranked) {
      const doc: any = r;
      scores[doc.idx ?? 0] = (doc.score ?? 0) / maxScore;
    }

    return scores;
  }

  async expandQuery(query: string, intent?: string): Promise<string[]> {
    await this.ensureInitialized();

    if (!this.generateModel) return [query];

    const llama: any = this.generateModel?.llama;
    if (!llama) return [query];

    const context = await llama.createChatContext({
      model: this.generateModel,
    });
    const session = context.getChatSession();

    const prompt = `Generate 2 alternative search queries for:\n\n${query}${intent ? `\n\nContext: ${intent}` : ''}\n\nAlternative queries (numbered list):`;

    const res = await session.prompt(prompt, { temperature: 0.7, maxTokens: 200 });
    context.dispose();

    const lines = (res as string)
      .split('\n')
      .map((l: string) => l.replace(/^\d+[.)]\s*/, '').trim())
      .filter((l: string) => l.length > 10);

    return lines.slice(0, 2).length > 0 ? lines.slice(0, 2) : [query];
  }

  async generateHyde(query: string, intent?: string): Promise<string> {
    await this.ensureInitialized();

    if (!this.generateModel) return query;

    const llama: any = this.generateModel?.llama;
    if (!llama) return query;

    const context = await llama.createChatContext({
      model: this.generateModel,
    });
    const session = context.getChatSession();

    const prompt = `Write a document passage that answers:\n\n${query}${intent ? `\n\nContext: ${intent}` : ''}\n\nPassage:`;

    const res = await session.prompt(prompt, { temperature: 0.5, maxTokens: 400 });
    context.dispose();

    return (res as string).trim();
  }

  embeddingDim(): number {
    return this.dim;
  }

  async close(): Promise<void> {
    // node-llama-cpp handles cleanup via GC
    this.embedModel = null;
    this.rerankModel = null;
    this.generateModel = null;
    this.initialized = false;
  }
}
