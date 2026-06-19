import type { LLMBackend } from './index.js';

export type LLMProvider = 'ollama' | 'node-llama-cpp';

/** Create an LLM backend based on configuration */
export async function createLLMBackend(
  provider: LLMProvider = 'ollama',
  options: Record<string, unknown> = {}
): Promise<LLMBackend> {
  switch (provider) {
    case 'node-llama-cpp': {
      const { NodeLlamaBackend } = await import('./node-llama-cpp.js');
      return new NodeLlamaBackend(options);
    }
    case 'ollama':
    default: {
      const { OllamaBackend } = await import('./ollama.js');
      return new OllamaBackend(options);
    }
  }
}

/** Detect the best available LLM backend */
export async function detectLLMBackend(
  options: Record<string, unknown> = {}
): Promise<{ backend: LLMBackend; provider: LLMProvider; name: string }> {
  // Try node-llama-cpp first
  try {
    const { NodeLlamaBackend } = await import('./node-llama-cpp.js');
    const backend = new NodeLlamaBackend(options);
    // Quick test: try embedding a short string
    await backend.embed(['test']);
    return { backend, provider: 'node-llama-cpp', name: 'node-llama-cpp (local GGUF)' };
  } catch {
    // node-llama-cpp not available, fall back to Ollama
  }

  // Try Ollama
  try {
    const { OllamaBackend } = await import('./ollama.js');
    const backend = new OllamaBackend(options);
    // Quick test
    await backend.embed(['test']);
    return { backend, provider: 'ollama', name: 'Ollama' };
  } catch {
    throw new Error(
      'No LLM backend available. Install node-llama-cpp or ensure Ollama is running.'
    );
  }
}

/** Check if Ollama is running */
export async function checkOllama(url?: string): Promise<boolean> {
  try {
    const res = await fetch(`${url ?? 'http://localhost:11434'}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Check if node-llama-cpp is available */
export async function checkNodeLlamaCpp(): Promise<boolean> {
  try {
    await import('node-llama-cpp');
    return true;
  } catch {
    return false;
  }
}
