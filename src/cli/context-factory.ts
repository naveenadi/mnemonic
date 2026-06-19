import { MnemonicDB } from '../store/database.js';
import { DocumentStore } from '../store/documents.js';
import { CollectionStore } from '../store/collections.js';
import { SearchPipeline } from '../search/pipeline.js';
import { detectLLMBackend } from '../llm/factory.js';
import type { LLMBackend } from '../types.js';

/** Pre-initialized database + stores for command handlers */
export interface CliContext {
  db: MnemonicDB;
  docs: DocumentStore;
  collections: CollectionStore;
  pipeline: SearchPipeline;
  llm?: LLMBackend;
  verbose: boolean;
}

/** Create a ready-to-use CliContext from a database path */
export function createContext(dbPath: string, verbose: boolean): CliContext {
  const db = new MnemonicDB(dbPath);
  db.init();
  const docs = new DocumentStore(db);
  const collections = new CollectionStore(db);
  const pipeline = new SearchPipeline(db);
  return { db, docs, collections, pipeline, verbose };
}

/** Lazy LLM backend detection */
export async function resolveLLM(verbose: boolean): Promise<LLMBackend | undefined> {
  try {
    const { backend } = await detectLLMBackend();
    if (verbose) process.stderr.write('Using LLM backend\n');
    return backend;
  } catch {
    if (verbose) process.stderr.write('No LLM backend available\n');
    return undefined;
  }
}

/** Tear down a CliContext */
export function destroyContext(ctx: CliContext): void {
  ctx.db.close();
}
