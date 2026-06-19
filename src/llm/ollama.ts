import type { LLMBackend } from './index.js';
import { normalize } from './index.js';

export interface OllamaConfig {
  baseUrl?: string;
  embedModel?: string;
  rerankModel?: string;
  generateModel?: string;
}

const DEFAULT_CONFIG: Required<OllamaConfig> = {
  baseUrl: 'http://localhost:11434',
  embedModel: 'nomic-embed-text',
  rerankModel: '', // Ollama doesn't natively support reranking; will use scoring via generate
  generateModel: 'qwen2.5:1.5b',
};

interface OllamaEmbedResponse {
  embedding: number[];
}

interface OllamaGenerateResponse {
  response: string;
}

export class OllamaBackend implements LLMBackend {
  private config: Required<OllamaConfig>;

  constructor(config: OllamaConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async request<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.config.baseUrl}/api/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      const res = await this.request<OllamaEmbedResponse>('embeddings', {
        model: this.config.embedModel,
        prompt: text,
      });
      results.push(normalize(res.embedding));
    }

    return results;
  }

  async rerank(_query: string, documents: string[]): Promise<number[]> {
    // Ollama doesn't support native reranking. Use a scoring prompt.
    // For each doc, ask the model to rate relevance 0-10.
    const scores: number[] = [];

    for (const doc of documents) {
      const prompt = `On a scale of 0 to 10, how relevant is this document to the query? Reply with only a number between 0 and 10.\n\nQuery: ${_query.slice(0, 500)}\n\nDocument: ${doc.slice(0, 1000)}`;

      try {
        const res = await this.request<OllamaGenerateResponse>('generate', {
          model: this.config.generateModel,
          prompt,
          stream: false,
          options: { temperature: 0.1, max_tokens: 10 },
        });

        const num = parseFloat(res.response.trim());
        scores.push(isNaN(num) ? 0.5 : Math.max(0, Math.min(10, num)) / 10);
      } catch {
        scores.push(0.5);
      }
    }

    return scores;
  }

  async expandQuery(query: string, intent?: string): Promise<string[]> {
    const prompt = `Generate 2 alternative phrasings of the following search query to improve retrieval recall. Each should be a single search query. Return them as a numbered list.\n\nOriginal query: ${query}${intent ? `\n\nContext: ${intent}` : ''}\n\nAlternative queries:`;

    try {
      const res = await this.request<OllamaGenerateResponse>('generate', {
        model: this.config.generateModel,
        prompt,
        stream: false,
        options: { temperature: 0.7, max_tokens: 300 },
      });

      const lines = res.response
        .split('\n')
        .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
        .filter((l) => l.length > 10);

      return lines.slice(0, 2);
    } catch {
      return [query];
    }
  }

  async generateHyde(query: string, intent?: string): Promise<string> {
    const prompt = `Write a hypothetical document passage that would be the perfect answer to the following question. Write in a factual, informative style.\n\nQuestion: ${query}${intent ? `\n\nAdditional context: ${intent}` : ''}\n\nHypothetical passage:`;

    try {
      const res = await this.request<OllamaGenerateResponse>('generate', {
        model: this.config.generateModel,
        prompt,
        stream: false,
        options: { temperature: 0.5, max_tokens: 500 },
      });

      return res.response.trim();
    } catch {
      return query;
    }
  }

  embeddingDim(): number {
    // nomic-embed-text uses 768 dimensions
    return 768;
  }

  async close(): Promise<void> {
    // No-op for Ollama
  }
}
