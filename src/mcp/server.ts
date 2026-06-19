import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MnemonicDB } from '../store/database.js';
import { DocumentStore } from '../store/documents.js';
import { CollectionStore } from '../store/collections.js';
import { SearchPipeline } from '../search/pipeline.js';
import { detectLLMBackend } from '../llm/factory.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { LLMBackend, SearchResult, SearchOptions } from '../types.js';

interface McpContext {
  dbPath: string;
  db?: MnemonicDB;
  docs?: DocumentStore;
  collections?: CollectionStore;
  pipeline?: SearchPipeline;
  llm?: LLMBackend;
}

let mcpCtx: McpContext = { dbPath: '' };

export async function startMcpServer(dbPath: string, args: string[]): Promise<void> {
  mcpCtx.dbPath = dbPath;

  const httpPort = getArg(args, '--http') ? parseInt(getArg(args, '--port') ?? '8181', 10) : null;
  const daemon = hasArg(args, '--daemon');

  // Initialize database
  const db = new MnemonicDB(dbPath);
  db.init();
  await db.loadVectors();

  const docs = new DocumentStore(db);
  const collections = new CollectionStore(db);
  const pipeline = new SearchPipeline(db);

  mcpCtx.db = db;
  mcpCtx.docs = docs;
  mcpCtx.collections = collections;
  mcpCtx.pipeline = pipeline;

  // Try to initialize LLM (non-blocking — will use available backend)
  try {
    const { backend } = await detectLLMBackend();
    mcpCtx.llm = backend;
    pipeline.setLLM(backend);
  } catch {
    // No LLM available, search will fall back to BM25 only
  }

  const server = new Server(
    {
      name: 'mnemonic',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'query',
        description: `Hybrid search with typed sub-queries (lex/vec/hyde) combined via RRF + reranking.
Each search is a typed sub-query. Use 'lex' for exact keyword/BM25 search, 'vec' for semantic vector search,
and 'hyde' for hypothetical document embedding search. The first search gets 2x weight.

Parameters:
- searches: Array of { type: 'lex'|'vec'|'hyde', query: string } — the sub-queries to run. At least 1 required.
- intent: Optional disambiguation context that helps steer ranking away from nearby-but-wrong concepts.
- collections: Optional array of collection names to filter (OR). Defaults to all included collections.
- limit: Max results (default 10).
- minScore: Minimum relevance 0-1 (default 0).
- candidateLimit: Max candidates to rerank (default 40).
- rerank: Whether to run LLM reranking (default true).
- decay: Apply time decay (default false).
- boostLinks: Apply link boost (default false).`,
        inputSchema: {
          type: 'object',
          properties: {
            searches: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['lex', 'vec', 'hyde'] },
                  query: { type: 'string' },
                },
                required: ['type', 'query'],
              },
              minItems: 1,
              maxItems: 10,
            },
            intent: { type: 'string' },
            collections: {
              type: 'array',
              items: { type: 'string' },
            },
            limit: { type: 'number', default: 10 },
            minScore: { type: 'number', default: 0 },
            candidateLimit: { type: 'number', default: 40 },
            rerank: { type: 'boolean', default: true },
            decay: { type: 'boolean', default: false },
            boostLinks: { type: 'boolean', default: false },
          },
          required: ['searches'],
        },
      },
      {
        name: 'get',
        description: `Retrieve a document by path or docid (with fuzzy matching suggestions).
Supports :from:count suffix for line ranges (e.g. #abc123:50:40).

Parameters:
- file: Path, docid (#abc123), or path:from:count (e.g. #abc123:120:40).
- fromLine: Start line (1-indexed); overrides the :from suffix.
- maxLines: Limit returned lines.
- lineNumbers: Prefix lines with numbers (default true).`,
        inputSchema: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Path, docid (#abc123), or path:from:count' },
            fromLine: { type: 'number', description: 'Start line (1-indexed)' },
            maxLines: { type: 'number', description: 'Limit returned lines' },
            lineNumbers: { type: 'boolean', default: true },
          },
          required: ['file'],
        },
      },
      {
        name: 'multi_get',
        description: `Batch retrieve documents by glob pattern or comma-separated list.
Supports docids (#abc123) in comma-separated lists.

Parameters:
- pattern: Glob pattern or comma-separated list of paths/docids.
- maxBytes: Skip files larger than N (default 10240).
- maxLines: Limit lines per file.
- lineNumbers: Prefix lines with numbers (default true).`,
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern or comma-separated list' },
            maxBytes: { type: 'number', default: 10240 },
            maxLines: { type: 'number', default: 100 },
            lineNumbers: { type: 'boolean', default: true },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'status',
        description: 'Index health and collection info. Returns collection stats, document counts, vector status, and link graph info.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'query':
          return handleQuery(args);
        case 'get':
          return handleGet(args);
        case 'multi_get':
          return handleMultiGet(args);
        case 'status':
          return handleStatus();
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });

  if (httpPort) {
    // HTTP transport using Node's built-in http module
    const http = await import('node:http');
    const url = await import('node:url');

    const httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (parsedUrl.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        return;
      }

      if (parsedUrl.pathname === '/mcp' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: string) => (body += chunk));
        req.on('end', async () => {
          try {
            const jsonBody = JSON.parse(body);
            const result = await (server as any).request(jsonBody, {} as any);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    httpServer.listen(httpPort, () => {
      console.log(`MCP server running on http://localhost:${httpPort}`);
    });

    if (daemon) {
      // Write PID file
      const pidDir = join(homedir(), '.cache', 'mnemonic');
      mkdirSync(pidDir, { recursive: true });
      writeFileSync(join(pidDir, 'mcp.pid'), String(process.pid));
    }
  } else {
    // Stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// Command handlers
async function handleQuery(args: any) {
  if (!mcpCtx.pipeline) throw new Error('Search pipeline not initialized');

  const { searches, intent, collections, limit, minScore, candidateLimit, rerank, decay, boostLinks } = args || {};

  if (!searches || !Array.isArray(searches) || searches.length === 0) {
    throw new Error('At least one search query is required');
  }

  const options: SearchOptions = {
    queries: searches.map((s: any) => ({
      type: s.type as 'lex' | 'vec' | 'hyde',
      query: s.query,
    })),
    intent,
    collection: collections,
    limit: limit ?? 10,
    minScore: minScore ?? 0,
    candidateLimit: candidateLimit ?? 40,
    rerank: rerank !== false && !!mcpCtx.llm,
    expand: false, // Already have explicit queries
    hyde: false,
    decay: decay ?? false,
    boostLinks: boostLinks ?? false,
  };

  const results = await mcpCtx.pipeline.search(options);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(results, null, 2),
      },
    ],
  };
}

async function handleGet(args: any) {
  if (!mcpCtx.docs) throw new Error('Document store not initialized');

  const { file, fromLine, maxLines, lineNumbers } = args || {};
  if (!file) throw new Error('file parameter is required');

  const result = mcpCtx.docs.getBody(file, { fromLine, maxLines });

  if ('error' in result) {
    const similar = (result as any).similarFiles;
    return {
      content: [
        { type: 'text', text: `Document not found: ${file}` },
        ...(similar?.length > 0 ? [{ type: 'text', text: `Similar files: ${similar.join(', ')}` }] : []),
      ],
      isError: true,
    };
  }

  const meta = mcpCtx.docs.get(file) as any;
  let output = '';

  if (!('error' in meta)) {
    output += `mne://${meta.collection}/${meta.path}  #${meta.docid}\n---\n`;
  }

  if (lineNumbers !== false) {
    const start = fromLine ?? 1;
    result.content.split('\n').forEach((line: string, i: number) => {
      output += `${start + i}: ${line}\n`;
    });
  } else {
    output += result.content;
  }

  return {
    content: [{ type: 'text', text: output }],
  };
}

async function handleMultiGet(args: any) {
  if (!mcpCtx.docs) throw new Error('Document store not initialized');

  const { pattern, maxBytes, maxLines, lineNumbers } = args || {};
  if (!pattern) throw new Error('pattern parameter is required');

  const ids = pattern.includes(',') ? pattern.split(',').map((s: string) => s.trim()) : undefined;
  const output: string[] = [];

  if (ids) {
    for (const id of ids) {
      if (output.length > 10) break; // Safety limit
      const doc = mcpCtx.docs.getBody(id, { maxLines: maxLines ?? 50 });
      if ('error' in doc) {
        output.push(`# ${id}: Not found`);
        continue;
      }
      const meta = mcpCtx.docs.get(id) as any;
      if (!('error' in meta)) {
        output.push(`# ${meta.path}  #${meta.docid}`);
        output.push('---');
        if (lineNumbers !== false) {
          doc.content.split('\n').forEach((line: string, i: number) => {
            output.push(`${i + 1}: ${line}`);
          });
        } else {
          output.push(doc.content);
        }
        output.push('');
      }
    }
  }

  return {
    content: [{ type: 'text', text: output.join('\n') || 'No results' }],
  };
}

async function handleStatus() {
  if (!mcpCtx.db) throw new Error('Database not initialized');
  if (!mcpCtx.collections) throw new Error('Collection store not initialized');

  const cols = mcpCtx.collections.list();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            collections: cols,
            hasVectors: mcpCtx.db.hasVectorIndex(),
            hasLLM: !!mcpCtx.llm,
            llmType: mcpCtx.llm?.constructor.name ?? 'none',
          },
          null,
          2
        ),
      },
    ],
  };
}

// Helpers
function getArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx < args.length - 1) return args[idx + 1];
  return undefined;
}

function hasArg(args: string[], ...names: string[]): boolean {
  return names.some((n) => args.includes(n));
}
