// ─── SDK Entry Point ────────────────────────────────────────────────

// Store
export { MnemonicDB, loadConfig } from './store/database.js';
export { DocumentStore, docid, contentHash, extractTitle, parseFrontmatter, extractTags } from './store/documents.js';
export { CollectionStore } from './store/collections.js';

// Chunker
export { chunkMarkdown, formatChunkForEmbedding } from './chunker/index.js';

// Search
export { SearchPipeline } from './search/pipeline.js';
export { FTSSearch } from './search/fts.js';
export { VectorSearch } from './search/vector.js';
export { fuseResults, blendWithRerank } from './search/fusion.js';

// LLM backends
export type { LLMBackend } from './llm/index.js';
export { createLLMBackend, detectLLMBackend, checkOllama, checkNodeLlamaCpp } from './llm/factory.js';
export { OllamaBackend } from './llm/ollama.js';

// Types
export type * from './types.js';
