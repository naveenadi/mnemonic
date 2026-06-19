import type {
  SearchResult,
  CollectionInfo,
  LinkEntry,
  ContextEntry,
  DocumentResult,
} from '../types.js';
import type { ParsedCommand } from './arg-parser.js';

// ─── Help ───────────────────────────────────────────────────────────

export function formatHelp(): string {
  return `
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
  --version                Show version number
`;
}

// ─── Search Results ─────────────────────────────────────────────────

export function formatSearchResults(results: SearchResult[], format: 'cli' | 'json'): string {
  if (results.length === 0) return 'No results found.\n';

  if (format === 'json') {
    return JSON.stringify(results, null, 2) + '\n';
  }

  let out = '';
  for (const r of results) {
    const scorePct = Math.round(r.score * 100);
    out += `${r.path}  #${r.docid}\n`;
    out += `Title: ${r.title}\n`;
    if (r.context.length > 0) {
      out += `Context: ${r.context.join(' > ')}\n`;
    }
    if (r.tags.length > 0) {
      out += `Tags: ${r.tags.join(', ')}\n`;
    }
    out += `Score: ${scorePct}%\n`;
    if (r.snippet) {
      out += `\n${r.snippet}\n`;
    }
    if (r.modifiedAt) {
      out += `Modified: ${r.modifiedAt}\n`;
    }
    out += '\n';
  }
  return out;
}

// ─── Status ─────────────────────────────────────────────────────────

/** Data passed to formatStatus */
export interface StatusInfo {
  dbPath: string;
  collectionCount: number;
  documentCount: number;
  chunkCount: number;
  hasVectors: boolean;
  linkCount: number;
  tagCount: number;
  contextCount: number;
  dbSizeKB: number;
  collections: CollectionInfo[];
}

export function formatStatus(info: StatusInfo, _format: 'cli' | 'json'): string {
  if (_format === 'json') {
    return JSON.stringify(info, null, 2) + '\n';
  }

  let out = '';
  out += `Index: ${info.dbPath}\n`;
  out += `Collections: ${info.collectionCount}\n`;
  out += `Documents: ${info.documentCount}\n`;
  out += `Chunks: ${info.chunkCount}\n`;
  out += `Vectors: ${info.hasVectors ? 'yes' : 'no'}\n`;
  out += `Links: ${info.linkCount}\n`;
  out += `Tags: ${info.tagCount}\n`;
  out += `Contexts: ${info.contextCount}\n`;
  out += `DB Size: ${info.dbSizeKB} KB\n\n`;
  out += 'Collections:\n';
  for (const c of info.collections) {
    out += `  ${c.name}  (${c.docCount} docs, ${c.activeCount} embedded)\n`;
  }
  return out;
}

// ─── Collection ─────────────────────────────────────────────────────

export function formatCollectionList(collections: CollectionInfo[]): string {
  if (collections.length === 0) {
    return 'No collections. Use "mne collection add <path> --name <name>"\n';
  }
  let out = '';
  for (const c of collections) {
    const flag = c.includeByDefault ? '[default]' : '[excluded]';
    out += `${c.name}  (${c.docCount} docs, ${c.activeCount} embedded)  ${flag}\n`;
    out += `  path: ${c.path}\n`;
    out += `  pattern: ${c.globPattern}\n`;
  }
  return out;
}

export function formatCollectionShow(c: CollectionInfo): string {
  let out = '';
  out += `Name: ${c.name}\n`;
  out += `Path: ${c.path}\n`;
  out += `Pattern: ${c.globPattern}\n`;
  out += `Docs: ${c.docCount}\n`;
  out += `Embedded: ${c.activeCount}\n`;
  out += `Included: ${c.includeByDefault ? 'yes' : 'no'}\n`;
  out += `Contexts: ${c.contextCount}\n`;
  return out;
}

// ─── Document (get) ─────────────────────────────────────────────────

export function formatDocument(
  meta: DocumentResult,
  body: string,
  totalLines: number,
  opts: { lineNumbers: boolean; fromLine?: number; fullPath: boolean }
): string {
  const path = opts.fullPath ? meta.fullPath : `mne://${meta.collection}/${meta.path}`;
  let out = `${path}  #${meta.docid}\n---\n`;

  if (opts.lineNumbers) {
    const start = opts.fromLine ?? 1;
    body.split('\n').forEach((line, i) => {
      out += `${start + i}: ${line}\n`;
    });
  } else {
    out += body;
  }
  return out;
}

// ─── Context ────────────────────────────────────────────────────────

export function formatContextList(contexts: ContextEntry[]): string {
  let out = '';
  for (const c of contexts) {
    const path = c.collection ? `mne://${c.collection}/${c.path}` : c.path;
    out += `${path}: ${c.context}\n`;
  }
  return out;
}

// ─── Links ──────────────────────────────────────────────────────────

export function formatLinks(links: LinkEntry[], direction: 'outgoing' | 'incoming'): string {
  const arrow = direction === 'outgoing' ? '→' : '←';
  let out = '';
  for (const l of links) {
    const target = direction === 'outgoing' ? l.targetPath : l.sourcePath;
    out += `  ${arrow} ${target}  [${l.linkType}]\n`;
  }
  return out;
}

// ─── Orphans ────────────────────────────────────────────────────────

export function formatOrphans(orphans: Array<{ docid: string; path: string }>): string {
  if (orphans.length === 0) return 'No orphan documents found.\n';
  let out = `Orphan documents (${orphans.length}):\n`;
  for (const o of orphans) {
    out += `  #${o.docid}  ${o.path}\n`;
  }
  return out;
}

// ─── Index progress ─────────────────────────────────────────────────

export function formatIndexProgress(indexed: number, updated: number, unchanged: number): string {
  return `  ${indexed} new, ${updated} updated, ${unchanged} unchanged\n`;
}

export function formatEmbedProgress(embedded: number, skipped: number, failed: number): string {
  return `Embedded: ${embedded}, skipped: ${skipped}, failed: ${failed}\n`;
}

// ─── Simple messages ────────────────────────────────────────────────

/** Format any simple string message (for side-effect commands) */
export function formatMessage(msg: string): string {
  return msg + '\n';
}

// ─── Doctor output ──────────────────────────────────────────────────

export interface DoctorInfo {
  dbFound: boolean;
  dbPath: string;
  dbSizeKB?: number;
  configFound: boolean;
  configPath: string;
  ollamaRunning: boolean;
  nodeLlamaAvailable: boolean;
  models: string[];
}

export function formatDoctor(info: DoctorInfo): string {
  let out = 'mnemonic diagnostics\n\n';

  if (info.dbFound) {
    out += `✓ Database: ${info.dbPath} (${info.dbSizeKB} KB)\n`;
  } else {
    out += '✗ Database: not found. Run "mne init" first.\n';
  }

  if (info.configFound) {
    out += `✓ Config: ${info.configPath}\n`;
  } else {
    out += '○ Config: not found (using defaults)\n';
  }

  if (info.ollamaRunning) {
    out += '✓ Ollama: running\n';
  } else {
    out += '○ Ollama: not detected. Install or start Ollama for local embeddings.\n';
  }

  if (info.nodeLlamaAvailable) {
    out += '✓ node-llama-cpp: available\n';
  } else {
    out += '○ node-llama-cpp: not installed. Models will use Ollama.\n';
  }

  if (info.models.length > 0) {
    out += `\nCached models: ${info.models.join(', ')}\n`;
  }

  return out;
}

// ─── LS output ──────────────────────────────────────────────────────

export function formatLsFiles(files: string[]): string {
  return files.map((f) => `  ${f}`).join('\n') + '\n';
}

// ─── Top-level router ───────────────────────────────────────────────

/** Format any handler result based on the parsed command */
export function formatResult(result: unknown, cmd: ParsedCommand): string {
  switch (cmd.command) {
    case 'search':
    case 'vsearch':
      return formatSearchResults(result as SearchResult[], cmd.format);

    case 'query':
      return formatSearchResults(result as SearchResult[], cmd.format);

    case 'collection': {
      if (cmd.sub === 'list') return formatCollectionList(result as CollectionInfo[]);
      if (cmd.sub === 'show') return formatCollectionShow(result as CollectionInfo);
      return formatMessage(result as string);
    }

    case 'status':
      return formatStatus(result as StatusInfo, cmd.format);

    case 'doctor':
      return formatDoctor(result as DoctorInfo);

    case 'get': {
      const r = result as { meta: DocumentResult; body: string; totalLines: number };
      if (cmd.format === 'json') {
        return JSON.stringify({ ...r.meta, content: r.body, totalLines: r.totalLines }, null, 2) + '\n';
      }
      return formatDocument(r.meta, r.body, r.totalLines, {
        lineNumbers: cmd.lineNumbers,
        fromLine: cmd.fromLine,
        fullPath: cmd.fullPath,
      });
    }

    case 'multi-get':
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2) + '\n';

    case 'ls':
      return formatLsFiles(result as string[]);

    case 'context': {
      if (cmd.sub === 'list') return formatContextList(result as ContextEntry[]);
      return formatMessage(result as string);
    }

    case 'links':
      return formatLinks(result as LinkEntry[], 'outgoing');

    case 'backlinks':
      return formatLinks(result as LinkEntry[], 'incoming');

    case 'orphans':
      return formatOrphans(result as Array<{ docid: string; path: string }>);

    default:
      return formatMessage(result as string);
  }
}
