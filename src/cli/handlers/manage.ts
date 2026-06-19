import { resolve, relative, dirname } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import type { CliContext } from '../context-factory.js';
import { resolveLLM } from '../context-factory.js';
import { chunkMarkdown } from '../../chunker/index.js';
import { CliError } from '../errors.js';

/** Indexing progress info */
export interface IndexResult {
  indexed: number;
  updated: number;
  unchanged: number;
}

/** Embedding progress info */
export interface EmbedResult {
  embedded: number;
  skipped: number;
  failed: number;
}

export function handleInit(ctx: CliContext): string {
  // DB is already initialized by createContext
  return `Initialized index at: ${ctx.db.getPath()}`;
}

export function handleAdd(
  ctx: CliContext,
  params: { path: string; name: string; mask?: string }
): string {
  ctx.collections.upsert(params.name, {
    path: resolve(params.path),
    name: params.name,
    pattern: params.mask ?? '**/*.md',
  });
  return `Added collection: ${params.name} → ${resolve(params.path)}`;
}

export async function handleIndex(
  ctx: CliContext,
  params: { collection?: string }
): Promise<{ collection: string; result: IndexResult }[]> {
  const fastglob = (await import('fast-glob')).default;

  const collections = params.collection
    ? ctx.collections.list().filter((c) => c.name === params.collection)
    : ctx.collections.list();

  if (collections.length === 0) {
    throw new CliError('No collections to index. Use "mne collection add" first.');
  }

  const results: { collection: string; result: IndexResult }[] = [];

  for (const col of collections) {
    if (ctx.verbose) process.stderr.write(`Indexing ${col.name}...\n`);
    const storedIgnore = ctx.db.db.prepare('SELECT ignore_pattern FROM collections WHERE name = ?').get(col.name) as { ignore_pattern: string | null } | undefined;
    const collectionIgnores = storedIgnore?.ignore_pattern ? storedIgnore.ignore_pattern.split('\n').filter(Boolean) : [];
    const ignorePatterns = ['.git/**', 'node_modules/**', '**/node_modules/**', ...collectionIgnores];

    const files = await fastglob(col.globPattern || '**/*.md', {
      cwd: col.path,
      absolute: true,
      ignore: ignorePatterns,
    });

    let indexed = 0, updated = 0, unchanged = 0;

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf-8');
        const relPath = relative(col.path, file);
        const result = ctx.docs.upsert(col.name, relPath, file, content);

        if (result.isNew) indexed++;
        else if (result.needsEmbed) updated++;
        else unchanged++;

        if (ctx.verbose && (indexed + updated) % 50 === 0) {
          process.stderr.write(`  ${indexed + updated} files processed...\n`);
        }
      } catch (err) {
        if (ctx.verbose) process.stderr.write(`  Error indexing ${file}: ${(err as Error).message}\n`);
      }
    }

    results.push({ collection: col.name, result: { indexed, updated, unchanged } });
  }

  return results;
}

export async function handleEmbed(
  ctx: CliContext,
  params: { collection?: string; force: boolean }
): Promise<EmbedResult> {
  const llm = await resolveLLM(ctx.verbose);
  if (!llm) throw new CliError('No LLM backend available. Install node-llama-cpp or start Ollama.');

  await ctx.db.loadVectors();
  const dim = llm.embeddingDim();
  ctx.db.createVectorTable(dim);

  const docs = params.collection
    ? ctx.db.db.prepare('SELECT docid, collection, path, content, checksum, title FROM documents WHERE collection = ?').all(params.collection) as any[]
    : ctx.db.db.prepare('SELECT docid, collection, path, content, checksum, title FROM documents').all() as any[];

  let embedded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];

    if (!params.force) {
      const existing = ctx.db.db.prepare('SELECT 1 FROM vectors WHERE hash = ?').get(doc.docid);
      if (existing) { skipped++; continue; }
    }

    const chunks = chunkMarkdown(doc.content, doc.docid);
    const texts = chunks.map((c) => `${doc.title} | ${c.content}`);

    try {
      const embeddings = await llm.embed(texts);
      ctx.db.db.transaction(() => {
        for (const chunk of chunks) {
          ctx.db.db.prepare(
            'INSERT OR REPLACE INTO chunks (docid, seq, pos, content, heading, checksum) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(chunk.hash, chunk.seq, chunk.pos, chunk.content, chunk.heading, doc.checksum);
        }
      })();

      const { VectorSearch } = await import('../../search/vector.js');
      const vs = new VectorSearch(ctx.db);
      vs.storeVectors(embeddings.map((emb: number[], idx: number) => ({
        hash: chunks[idx].hash,
        embedding: emb,
      })));

      embedded++;
    } catch (err) {
      failed++;
      if (ctx.verbose) process.stderr.write(`  Error embedding ${doc.docid}: ${(err as Error).message}\n`);
    }

    if (ctx.verbose && (i + 1) % 10 === 0) {
      process.stderr.write(`  Embedding ${i + 1}/${docs.length}...\n`);
    }
  }

  await llm.close();
  return { embedded, skipped, failed };
}
