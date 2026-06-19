import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { MnemonicDB, loadConfig } from '../store/database.js';
import { DocumentStore, docid } from '../store/documents.js';
import { CollectionStore } from '../store/collections.js';
import { SearchPipeline } from '../search/pipeline.js';
import { chunkMarkdown } from '../chunker/index.js';
import { detectLLMBackend, checkOllama } from '../llm/factory.js';
import type { LLMBackend, SearchResult } from '../types.js';

const DEFAULT_DB = join(homedir(), '.cache', 'mnemonic', 'index.sqlite');
const DEFAULT_CONFIG = join(homedir(), '.config', 'mnemonic', 'config.yml');

interface CliContext {
  db: MnemonicDB;
  docs: DocumentStore;
  collections: CollectionStore;
  pipeline: SearchPipeline;
  llm?: LLMBackend;
  verbose: boolean;
}

export async function main(args: string[]) {
  const [command, ...rest] = args;

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  const verbose = args.includes('--verbose') || args.includes('-v');
  const dbPath = resolve(getArg(args, '--db') ?? DEFAULT_DB);

  try {
    switch (command) {
      case 'init':
        return cmdInit(rest, dbPath);
      case 'collection':
        return cmdCollection(rest, dbPath, verbose);
      case 'add':
        return cmdAdd(rest, dbPath, verbose);
      case 'index':
      case 'update':
        return cmdIndex(rest, dbPath, verbose);
      case 'embed':
        return cmdEmbed(rest, dbPath, verbose);
      case 'search':
        return cmdSearch(rest, dbPath, verbose);
      case 'vsearch':
        return cmdVectorSearch(rest, dbPath, verbose);
      case 'query':
        return cmdQuery(rest, dbPath, verbose);
      case 'get':
        return cmdGet(rest, dbPath);
      case 'multi-get':
        return cmdMultiGet(rest, dbPath);
      case 'ls':
        return cmdLs(rest, dbPath);
      case 'status':
        return cmdStatus(dbPath);
      case 'doctor':
        return cmdDoctor();
      case 'context':
        return cmdContext(rest, dbPath);
      case 'tag':
        return cmdTag(rest, dbPath);
      case 'links':
        return cmdLinks(rest, dbPath);
      case 'backlinks':
        return cmdBacklinks(rest, dbPath);
      case 'orphans':
        return cmdOrphans(dbPath);
      case 'mcp':
        return cmdMcp(rest, dbPath);
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } finally {
    // LLM cleanup happens in process exit
  }
}

function printHelp() {
  console.log(`
mnemonic — on-device hybrid search for markdown knowledge bases

Usage: mne <command> [options]

Commands:
  init                     Initialize a new index
  collection add <dir>     Add a collection
  collection list          List collections
  collection remove <n>    Remove a collection
  add <dir>                Quick-add a collection from directory
  index                    Index all collections
  embed                    Generate vector embeddings
  search <query>           BM25 full-text search
  vsearch <query>          Vector semantic search
  query <query>            Hybrid search (BM25 + vector + reranking)
  get <path|#docid>        Retrieve a document
  multi-get <pattern>      Batch retrieve documents
  ls [collection]          List files in a collection
  status                   Show index status
  doctor                   Diagnostic checks
  context add <path> <txt> Add context metadata
  context list             List contexts
  tag <#docid> <tag>       Add a tag
  links <#docid>           Show outgoing links
  backlinks <#docid>       Show incoming links
  orphans                  Find orphan documents
  mcp                      Start MCP server

Options:
  --db <path>              Database path (default: ~/.cache/mnemonic/index.sqlite)
  -c, --collection <name>  Filter by collection
  -n <num>                 Number of results (default: 10)
  --full                   Show full document content
  --json                   JSON output
  --no-rerank              Skip LLM reranking
  -v, --verbose            Verbose output
`);
}

// ─── Command Implementations ────────────────────────────────────────

function getArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx < args.length - 1) return args[idx + 1];
  return undefined;
}

function hasArg(args: string[], ...names: string[]): boolean {
  return names.some((n) => args.includes(n));
}

function createContext(dbPath: string, verbose: boolean): CliContext {
  const db = new MnemonicDB(dbPath);
  db.init();
  const docs = new DocumentStore(db);
  const collections = new CollectionStore(db);
  const pipeline = new SearchPipeline(db);
  return { db, docs, collections, pipeline, verbose };
}

async function getLLM(verbose: boolean): Promise<LLMBackend | undefined> {
  try {
    const { backend } = await detectLLMBackend();
    if (verbose) console.error('Using LLM backend');
    return backend;
  } catch {
    if (verbose) console.error('No LLM backend available');
    return undefined;
  }
}

function cmdInit(_args: string[], dbPath: string) {
  const dir = resolve(homedir(), '.cache', 'mnemonic');
  mkdirSync(dir, { recursive: true });

  const db = new MnemonicDB(dbPath);
  db.init();
  console.log(`Initialized index at: ${dbPath}`);
  db.close();
}

async function cmdCollection(args: string[], dbPath: string, verbose: boolean) {
  const ctx = createContext(dbPath, verbose);
  const sub = args[0];

  switch (sub) {
    case 'add': {
      const path = args[1];
      const name = getArg(args, '--name') ?? args[2];
      if (!path || !name) {
        console.error('Usage: mne collection add <path> --name <name>');
        process.exit(1);
      }
      ctx.collections.upsert(name, {
        path: resolve(path),
        name,
        pattern: getArg(args, '--mask') ?? '**/*.md',
        includeByDefault: !hasArg(args, '--excluded'),
      });
      console.log(`Added collection: ${name}`);
      break;
    }
    case 'list': {
      const cols = ctx.collections.list();
      if (cols.length === 0) {
        console.log('No collections. Use "mne collection add <path> --name <name>"');
        return;
      }
      for (const c of cols) {
        console.log(
          `${c.name}  (${c.docCount} docs, ${c.activeCount} embedded)  ${c.includeByDefault ? '[default]' : '[excluded]'}`
        );
        console.log(`  path: ${c.path}`);
        console.log(`  pattern: ${c.globPattern}`);
      }
      break;
    }
    case 'remove': {
      const name = args[1];
      if (!name) {
        console.error('Usage: mne collection remove <name>');
        process.exit(1);
      }
      ctx.collections.remove(name);
      console.log(`Removed collection: ${name}`);
      break;
    }
    case 'show': {
      const name = args[1];
      if (!name) {
        console.error('Usage: mne collection show <name>');
        process.exit(1);
      }
      const c = ctx.collections.get(name);
      if (!c) {
        console.error(`Collection not found: ${name}`);
        process.exit(1);
      }
      console.log(`Name: ${c.name}`);
      console.log(`Path: ${c.path}`);
      console.log(`Pattern: ${c.globPattern}`);
      console.log(`Docs: ${c.docCount}`);
      console.log(`Embedded: ${c.activeCount}`);
      console.log(`Included: ${c.includeByDefault ? 'yes' : 'no'}`);
      console.log(`Contexts: ${c.contextCount}`);
      break;
    }
    case 'rename': {
      const [oldName, newName] = args.slice(1);
      if (!oldName || !newName) {
        console.error('Usage: mne collection rename <old> <new>');
        process.exit(1);
      }
      ctx.collections.rename(oldName, newName);
      console.log(`Renamed: ${oldName} → ${newName}`);
      break;
    }
    case 'include': {
      const name = args[1];
      if (!name) { console.error('Usage: mne collection include <name>'); process.exit(1); }
      ctx.collections.setInclude(name, true);
      console.log(`Collection ${name} is now included by default`);
      break;
    }
    case 'exclude': {
      const name = args[1];
      if (!name) { console.error('Usage: mne collection exclude <name>'); process.exit(1); }
      ctx.collections.setInclude(name, false);
      console.log(`Collection ${name} is now excluded by default`);
      break;
    }
    default:
      console.error('Usage: mne collection <add|list|remove|show|rename|include|exclude> ...');
  }

  ctx.db.close();
}

async function cmdAdd(args: string[], dbPath: string, verbose: boolean) {
  const ctx = createContext(dbPath, verbose);
  const path = args[0];
  const name = getArg(args, '--name') ?? (path ? relative(process.cwd(), path) || 'default' : 'default');

  if (!path) {
    console.error('Usage: mne add <path> [--name <name>]');
    process.exit(1);
  }

  ctx.collections.upsert(name, {
    path: resolve(path),
    name,
    pattern: getArg(args, '--mask') ?? '**/*.md',
  });
  console.log(`Added collection: ${name} → ${resolve(path)}`);
  ctx.db.close();
}

async function cmdIndex(args: string[], dbPath: string, verbose: boolean) {
  const ctx = createContext(dbPath, verbose);
  const fastglob = (await import('fast-glob')).default;

  const colFilter = getArg(args, '--collection') ?? getArg(args, '-c');
  const collections = colFilter
    ? ctx.collections.list().filter((c) => c.name === colFilter)
    : ctx.collections.list();

  if (collections.length === 0) {
    console.error('No collections to index. Use "mne collection add" first.');
    process.exit(1);
  }

  for (const col of collections) {
    console.log(`Indexing ${col.name}...`);
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

        if (verbose && (indexed + updated) % 50 === 0) {
          console.error(`  ${indexed + updated} files processed...`);
        }
      } catch (err) {
        if (verbose) console.error(`  Error indexing ${file}:`, (err as Error).message);
      }
    }

    console.log(`  ${indexed} new, ${updated} updated, ${unchanged} unchanged`);
  }

  ctx.db.close();
}

async function cmdEmbed(args: string[], dbPath: string, verbose: boolean) {
  const llm = await getLLM(verbose);
  if (!llm) {
    console.error('No LLM backend available. Install node-llama-cpp or start Ollama.');
    process.exit(1);
  }

  const ctx = createContext(dbPath, verbose);
  await ctx.db.loadVectors();
  const dim = llm.embeddingDim();
  ctx.db.createVectorTable(dim);

  const colFilter = getArg(args, '--collection') ?? getArg(args, '-c');
  const force = hasArg(args, '--force', '-f');

  const docs = colFilter
    ? ctx.db.db.prepare('SELECT docid, collection, path, content, checksum, title FROM documents WHERE collection = ?').all(colFilter) as any[]
    : ctx.db.db.prepare('SELECT docid, collection, path, content, checksum, title FROM documents').all() as any[];

  let embedded = 0, skipped = 0, failed = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];

    // Check if already embedded
    if (!force) {
      const existing = ctx.db.db.prepare('SELECT 1 FROM vectors WHERE hash = ?').get(doc.docid);
      if (existing) {
        skipped++;
        continue;
      }
    }

    const chunks = chunkMarkdown(doc.content, doc.docid);
    const texts = chunks.map((c) => `${doc.title} | ${c.content}`);

    try {
      const embeddings = await llm.embed(texts);
      ctx.db.db.transaction(() => {
        // Store chunks
        for (const chunk of chunks) {
          ctx.db.db.prepare(
            'INSERT OR REPLACE INTO chunks (docid, seq, pos, content, heading, checksum) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(chunk.hash, chunk.seq, chunk.pos, chunk.content, chunk.heading, doc.checksum);
        }
      })();

      // Store vectors
      const vectors = embeddings.map((emb, idx) => ({
        hash: chunks[idx].hash,
        embedding: emb,
      }));
      const vs = new (await import('../search/vector.js')).VectorSearch(ctx.db);
      vs.storeVectors(vectors);

      embedded++;
    } catch (err) {
      failed++;
      if (verbose) console.error(`  Error embedding ${doc.docid}:`, (err as Error).message);
    }

    if (verbose && (i + 1) % 10 === 0) {
      console.error(`  Embedding ${i + 1}/${docs.length}...`);
    }
  }

  console.log(`Embedded: ${embedded}, skipped: ${skipped}, failed: ${failed}`);
  await llm.close();
  ctx.db.close();
}

async function cmdSearch(args: string[], dbPath: string, verbose: boolean) {
  const ctx = createContext(dbPath, verbose);
  const query = args.join(' ').replace(/ --\S+/g, '').trim();
  const collection = getArg(args, '-c') ?? getArg(args, '--collection');
  const limit = parseInt(getArg(args, '-n') ?? '10', 10);
  const jsonOut = hasArg(args, '--json');

  if (!query) {
    console.error('Usage: mne search <query> [-n <num>] [-c <collection>] [--json]');
    process.exit(1);
  }

  const results = ctx.pipeline.searchLex(query, {
    collection: collection ? [collection] : undefined,
    limit,
  });

  printResults(results, { json: jsonOut });
  ctx.db.close();
}

async function cmdVectorSearch(args: string[], dbPath: string, verbose: boolean) {
  const llm = await getLLM(verbose);
  if (!llm) {
    console.error('No LLM backend available.');
    process.exit(1);
  }

  const ctx = createContext(dbPath, verbose);
  const query = args.join(' ').replace(/ --\S+/g, '').trim();
  const collection = getArg(args, '-c') ?? getArg(args, '--collection');
  const limit = parseInt(getArg(args, '-n') ?? '10', 10);
  const jsonOut = hasArg(args, '--json');

  if (!query) {
    console.error('Usage: mne vsearch <query> [-n <num>] [-c <collection>] [--json]');
    process.exit(1);
  }

  await ctx.db.loadVectors();
  ctx.pipeline.setLLM(llm);
  const results = await ctx.pipeline.searchVector(query, {
    collection: collection ? [collection] : undefined,
    limit,
  });

  printResults(results, { json: jsonOut });
  await llm.close();
  ctx.db.close();
}

async function cmdQuery(args: string[], dbPath: string, verbose: boolean) {
  const llm = await getLLM(verbose);
  const ctx = createContext(dbPath, verbose);

  // Parse structured query fields: intent:, lex:, vec:, hyde:
  let query = args.join(' ');
  const collection = getArg(args, '-c') ?? getArg(args, '--collection');
  const limit = parseInt(getArg(args, '-n') ?? '10', 10);
  const jsonOut = hasArg(args, '--json');
  const noRerank = hasArg(args, '--no-rerank');
  const explain = hasArg(args, '--explain');

  let intent: string | undefined;
  let parsedQueries: Array<{ type: 'lex' | 'vec' | 'hyde'; query: string }> | undefined;

  // Parse structured fields if present
  const intentMatch = query.match(/intent:\s*((?:.|\n)*?)(?=\n\w+:|$)/);
  const lexMatch = query.match(/\blex:\s*(.+?)(?=\n\s*(?:vec|hyde|intent):|$)/);
  const vecMatch = query.match(/\bvec:\s*(.+?)(?=\n\s*(?:lex|hyde|intent):|$)/);
  const hydeMatch = query.match(/\bhyde:\s*(.+?)(?=\n\s*(?:lex|vec|intent):|$)/);

  if (lexMatch || vecMatch || hydeMatch) {
    intent = intentMatch?.[1]?.trim();
    parsedQueries = [];
    if (lexMatch) parsedQueries.push({ type: 'lex', query: lexMatch[1].trim() });
    if (vecMatch) parsedQueries.push({ type: 'vec', query: vecMatch[1].trim() });
    if (hydeMatch) parsedQueries.push({ type: 'hyde', query: hydeMatch[1].trim() });
    query = query.replace(/^(?:intent|lex|vec|hyde):.*$/gm, '').trim();
  }

  if (!query && !parsedQueries) {
    console.error('Usage: mne query <query> [-n <num>] [-c <collection>] [--json] [--no-rerank]');
    console.error("  Or: mne query with structured fields: intent: ..., lex: ..., vec: ..., hyde: ...");
    process.exit(1);
  }

  if (llm) ctx.pipeline.setLLM(llm);
  await ctx.db.loadVectors();

  const results = await ctx.pipeline.search({
    query: parsedQueries ? undefined : query,
    queries: parsedQueries,
    intent,
    collection: collection ? [collection] : undefined,
    limit,
    rerank: !noRerank && !!llm,
    expand: true,
    hyde: true,
    explain,
  });

  printResults(results, { json: jsonOut, explain });
  if (llm) await llm.close();
  ctx.db.close();
}

function cmdGet(args: string[], dbPath: string) {
  const ctx = createContext(dbPath, false);
  const identifier = args[0];
  const jsonOut = hasArg(args, '--json');
  const noLineNumbers = hasArg(args, '--no-line-numbers');
  const fullPath = hasArg(args, '--full-path');

  if (!identifier) {
    console.error('Usage: mne get <path|#docid> [--no-line-numbers] [--full-path] [--json]');
    console.error('  Supports :from:count suffix: mne get #abc123:50:40');
    process.exit(1);
  }

  // Parse :from:count suffix
  let fromLine: number | undefined;
  let maxLines: number | undefined;
  const suffixMatch = identifier.match(/^(.+?):(\d+)(?::(\d+))?$/);
  let cleanId = identifier;

  if (suffixMatch) {
    cleanId = suffixMatch[1];
    fromLine = parseInt(suffixMatch[2], 10);
    maxLines = suffixMatch[3] ? parseInt(suffixMatch[3], 10) : undefined;
  }

  // Override from flags
  const flagFrom = getArg(args, '--from');
  const flagLines = getArg(args, '-l');
  if (flagFrom) fromLine = parseInt(flagFrom, 10);
  if (flagLines) maxLines = parseInt(flagLines, 10);

  const doc = ctx.docs.getBody(cleanId, { fromLine, maxLines });

  if ('error' in doc) {
    console.error(doc.error);
    if (doc.similarFiles.length > 0) {
      console.error('Similar files:', doc.similarFiles.join(', '));
    }
    process.exit(1);
  }

  const meta = ctx.docs.get(cleanId) as any;
  if ('error' in meta) {
    // Already handled
  }

  if (jsonOut) {
    console.log(JSON.stringify({ ...meta, content: doc.content, totalLines: doc.totalLines }, null, 2));
  } else {
    console.log(`mne://${meta?.collection}/${meta?.path}  #${meta?.docid}`);
    console.log('---');
    if (noLineNumbers) {
      console.log(doc.content);
    } else {
      const startLine = fromLine ?? 1;
      doc.content.split('\n').forEach((line: string, i: number) => {
        console.log(`${startLine + i}: ${line}`);
      });
    }
  }

  ctx.db.close();
}

function cmdMultiGet(args: string[], dbPath: string) {
  // Simplified: just runs get for comma-separated or glob patterns
  const ctx = createContext(dbPath, false);
  const pattern = args[0];
  const jsonOut = hasArg(args, '--json');
  const maxLines = parseInt(getArg(args, '-l') ?? '50', 10);
  const noLineNumbers = hasArg(args, '--no-line-numbers');

  if (!pattern) {
    console.error('Usage: mne multi-get <pattern|#docid1,#docid2> [-l <lines>] [--json]');
    process.exit(1);
  }

  // Comma-separated or glob?
  const ids = pattern.includes(',') ? pattern.split(',').map((s) => s.trim()) : undefined;

  if (ids) {
    for (const id of ids) {
      const doc = ctx.docs.getBody(id, { maxLines });
      if ('error' in doc) {
        console.error(`# ${id}: ${doc.error}`);
        continue;
      }
      const meta = ctx.docs.get(id) as any;
      if (!('error' in meta)) {
        console.log(`# ${meta.path}  #${meta.docid}`);
        console.log('---');
        console.log(noLineNumbers ? doc.content : doc.content.split('\n').map((l: string, i: number) => `${i + 1}: ${l}`).join('\n'));
        console.log();
      }
    }
  }

  ctx.db.close();
}

function cmdLs(args: string[], dbPath: string) {
  const ctx = createContext(dbPath, false);
  const colName = args[0];

  if (!colName) {
    const cols = ctx.collections.list();
    for (const c of cols) {
      console.log(`${c.name}/  (${c.docCount} files)`);
    }
    ctx.db.close();
    return;
  }

  // Remove mne:// prefix if present
  const cleanName = colName.replace(/^mne:\/\//, '');
  const [baseCol, ...subPath] = cleanName.split('/');
  const filterPath = subPath.join('/');

  const docs = ctx.db.db
    .prepare(
      'SELECT path FROM documents WHERE collection = ? AND path LIKE ? ORDER BY path'
    )
    .all(baseCol, `${filterPath}%`) as Array<{ path: string }>;

  for (const d of docs) {
    console.log(`  ${d.path}`);
  }

  ctx.db.close();
}

async function cmdStatus(dbPath: string) {
  const ctx = createContext(dbPath, false);
  await ctx.db.loadVectors();

  const docCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM documents').get() as any).c;
  const collectionCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM collections').get() as any).c;
  const chunkCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM chunks').get() as any).c;
  const hasVectors = ctx.db.hasVectorIndex();
  const linkCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM links').get() as any).c;
  const tagCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM tags').get() as any).c;
  const ctxCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM contexts').get() as any).c;

  const dbSize = existsSync(dbPath) ? Math.round(readFileSync(dbPath).length / 1024) : 0;

  console.log(`Index: ${dbPath}`);
  console.log(`Collections: ${collectionCount}`);
  console.log(`Documents: ${docCount}`);
  console.log(`Chunks: ${chunkCount}`);
  console.log(`Vectors: ${hasVectors ? 'yes' : 'no'}`);
  console.log(`Links: ${linkCount}`);
  console.log(`Tags: ${tagCount}`);
  console.log(`Contexts: ${ctxCount}`);
  console.log(`DB Size: ${dbSize} KB`);

  console.log('\nCollections:');
  const cols = ctx.collections.list();
  for (const c of cols) {
    console.log(`  ${c.name}  (${c.docCount} docs, ${c.activeCount} embedded)`);
  }

  ctx.db.close();
}

async function cmdDoctor() {
  console.log('mnemonic diagnostics\n');

  // Check DB
  const dbPath = DEFAULT_DB;
  if (existsSync(dbPath)) {
    const size = Math.round(readFileSync(dbPath).length / 1024);
    console.log(`✓ Database: ${dbPath} (${size} KB)`);
  } else {
    console.log('✗ Database: not found. Run "mne init" first.');
  }

  // Check config
  if (existsSync(DEFAULT_CONFIG)) {
    console.log(`✓ Config: ${DEFAULT_CONFIG}`);
  } else {
    console.log("○ Config: not found (using defaults)");
  }

  // Check Ollama
  const ollamaOk = await checkOllama();
  if (ollamaOk) {
    console.log('✓ Ollama: running');
  } else {
    console.log('○ Ollama: not detected. Install or start Ollama for local embeddings.');
  }

  // Check node-llama-cpp
  try {
    await import('node-llama-cpp');
    console.log('✓ node-llama-cpp: available');
  } catch {
    console.log('○ node-llama-cpp: not installed. Models will use Ollama.');
  }

  // Check models
  const cacheDir = join(homedir(), '.cache', 'mnemonic', 'models');
  if (existsSync(cacheDir)) {
    const models = readdirSyncSafe(cacheDir);
    console.log(`\nCached models: ${models.length > 0 ? models.join(', ') : 'none'}`);
  }
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function cmdContext(args: string[], dbPath: string) {
  const ctx = createContext(dbPath, false);
  const sub = args[0];

  switch (sub) {
    case 'add': {
      const path = args[1];
      const text = args.slice(2).join(' ');
      if (!path || !text) {
        console.error('Usage: mne context add <mne://path|/> <text>');
        process.exit(1);
      }
      // Parse mne://path
      const mneMatch = path.match(/^mne:\/\/([^/]+)\/(.*)/);
      if (mneMatch) {
        ctx.docs.addContext(mneMatch[1], mneMatch[2], text);
      } else if (path === '/') {
        ctx.docs.addContext(null, '/', text);
      } else {
        // Try to detect collection from cwd
        ctx.docs.addContext(null, path, text);
      }
      console.log(`Context added: ${path}`);
      break;
    }
    case 'list': {
      const contexts = ctx.docs.listContexts();
      for (const c of contexts) {
        const path = c.collection ? `mne://${c.collection}/${c.path}` : c.path;
        console.log(`${path}: ${c.context}`);
      }
      break;
    }
    case 'rm': {
      const path = args[1];
      if (!path) {
        console.error('Usage: mne context rm <path>');
        process.exit(1);
      }
      const mneMatch = path.match(/^mne:\/\/([^/]+)\/(.*)/);
      if (mneMatch) {
        ctx.docs.removeContext(mneMatch[1], mneMatch[2]);
      } else {
        ctx.docs.removeContext(null, path === '/' ? '/' : path);
      }
      console.log(`Context removed: ${path}`);
      break;
    }
    default:
      console.error('Usage: mne context <add|list|rm> ...');
  }

  ctx.db.close();
}

function cmdTag(args: string[], dbPath: string) {
  const ctx = createContext(dbPath, false);
  const docid = args[0]?.replace(/^#/, '');
  const tag = args[1];

  if (!docid || !tag) {
    console.error('Usage: mne tag <#docid> <tag>');
    process.exit(1);
  }

  ctx.docs.addTag(docid, tag);
  console.log(`Tag "${tag}" added to #${docid}`);
  ctx.db.close();
}

function cmdLinks(args: string[], dbPath: string) {
  const ctx = createContext(dbPath, false);
  const docid = args[0]?.replace(/^#/, '');

  if (!docid) {
    console.error('Usage: mne links <#docid>');
    process.exit(1);
  }

  const links = ctx.docs.getLinks(docid);
  for (const l of links) {
    console.log(`  → ${l.targetPath}  [${l.linkType}]`);
  }

  ctx.db.close();
}

function cmdBacklinks(args: string[], dbPath: string) {
  const ctx = createContext(dbPath, false);
  const docid = args[0]?.replace(/^#/, '');

  if (!docid) {
    console.error('Usage: mne backlinks <#docid>');
    process.exit(1);
  }

  const links = ctx.docs.getBacklinks(docid);
  for (const l of links) {
    console.log(`  ← ${l.sourcePath}  [${l.linkType}]`);
  }

  ctx.db.close();
}

function cmdOrphans(dbPath: string) {
  const ctx = createContext(dbPath, false);
  const orphans = ctx.docs.getOrphans();

  if (orphans.length === 0) {
    console.log('No orphan documents found.');
  } else {
    console.log(`Orphan documents (${orphans.length}):`);
    for (const o of orphans) {
      console.log(`  #${o.docid}  ${o.path}`);
    }
  }

  ctx.db.close();
}

async function cmdMcp(args: string[], dbPath: string) {
  const { startMcpServer } = await import('../mcp/server.js');
  await startMcpServer(dbPath, args);
}

// ─── Output Formatting ──────────────────────────────────────────────

function printResults(
  results: SearchResult[],
  options?: { json?: boolean; explain?: boolean }
) {
  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  if (options?.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const r of results) {
    const scorePct = Math.round(r.score * 100);
    const color = scorePct > 70 ? '' : scorePct > 40 ? '' : '';
    const reset = '';

    console.log(`${r.path}  #${r.docid}`);
    console.log(`Title: ${r.title}`);
    if (r.context.length > 0) {
      console.log(`Context: ${r.context.join(' > ')}`);
    }
    if (r.tags.length > 0) {
      console.log(`Tags: ${r.tags.join(', ')}`);
    }
    console.log(`Score: ${scorePct}%`);
    if (r.snippet) {
      console.log(`\n${r.snippet}\n`);
    }
    if (r.modifiedAt) {
      console.log(`Modified: ${r.modifiedAt}`);
    }
    console.log();
  }
}
