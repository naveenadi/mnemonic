import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

export default function (pi: ExtensionAPI) {
  const dbPath = join(homedir(), '.cache', 'mnemonic', 'index.sqlite');

  // Helper: load mnemonic modules from the installed global package
  async function loadMnemonic() {
    const mod = await import('@naveenadi/mnemonic');
    return mod;
  }

  // ─── Command: /mne ─────────────────────────────────────────────
  pi.registerCommand('mne', {
    description: 'Setup and configure mnemonic index. Runs interactive init, add collections, index, embed, and configure pi integration.',
    handler: async (args, ctx) => {
      const sub = args.trim().split(/\s+/)[0];

      if (sub === 'init') {
        await cmdInit(ctx);
      } else if (sub === 'add') {
        await cmdAdd(ctx, args.slice(3).trim());
      } else if (sub === 'status') {
        await cmdStatus(ctx);
      } else if (sub === 'help' || !sub) {
        ctx.ui.notify(
          '/mne init    — interactive setup (add collections, index, embed, configure pi)\n' +
          '/mne add <path>  — add a collection from a directory\n' +
          '/mne status  — show index health\n' +
          '/mne help    — this message',
          'info'
        );
      }
    },
  });

  async function cmdInit(ctx: any) {
    // 1. Check CLI installed
    const hasCli = (() => {
      try {
        execSync('which mne', { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    })();

    if (!hasCli) {
      const install = await ctx.ui.confirm(
        'mnemonic CLI not found',
        'Install via npm install -g @naveenadi/mnemonic?'
      );
      if (!install) {
        ctx.ui.notify('Aborted. Install manually: npm install -g @naveenadi/mnemonic', 'warning');
        return;
      }
      execSync('npm install -g @naveenadi/mnemonic', { stdio: 'inherit' });
      ctx.ui.notify('Installed mnemonic CLI', 'info');
    }

    // 2. Choose scope
    const scope = await ctx.ui.select(
      'Where should the index live?',
      ['global — ~/.cache/mnemonic/index.sqlite (all projects)', 'project — .mnemonic/index.sqlite (this repo only)']
    );

    if (!scope) {
      ctx.ui.notify('Aborted', 'warning');
      return;
    }

    const isProject = scope.startsWith('project');
    const indexDb = isProject
      ? join(ctx.cwd, '.mnemonic', 'index.sqlite')
      : join(homedir(), '.cache', 'mnemonic', 'index.sqlite');

    // 3. Init DB
    run(`mne${isProject ? ` --db "${indexDb}"` : ''} init`);
    ctx.ui.notify(isProject ? 'Initialized project index' : 'Initialized global index', 'info');

    // 4. Add collections — ask for directories
    const mneQuiet = isProject ? `--db "${indexDb}"` : '';

    while (true) {
      const dir = await ctx.ui.input(
        'Add a directory to index (e.g. ~/notes, ~/Documents) — leave empty when done',
        ''
      );
      if (!dir) break;

      const name = await ctx.ui.input(
        `Name for collection "${dir}" (e.g. notes, docs)`,
        relative(ctx.cwd, dir.replace(/^~/, homedir())).split('/')[0] || 'default'
      );
      if (!name) continue;

      const mask = await ctx.ui.input(
        `File pattern for "${name}" (default: **/*.md)`,
        '**/*.md'
      );

      run(`mne ${mneQuiet} collection add "${dir}" --name "${name}"${mask !== '**/*.md' ? ` --mask "${mask}"` : ''}`);
      ctx.ui.notify(`Added collection: ${name}`, 'info');
    }

    // 5. Index
    const doIndex = await ctx.ui.confirm('Index', 'Scan files and build the full-text index?');
    if (doIndex) {
      ctx.ui.setStatus('mne', 'Indexing files...');
      run(`mne ${mneQuiet} index`);
      ctx.ui.setStatus('mne', undefined);
      ctx.ui.notify('Index complete', 'info');
    }

    // 6. Embed
    const hasOllama = (() => {
      try {
        execSync('curl -s http://localhost:11434/api/tags -o /dev/null -w "%{http_code}"', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();

    if (hasOllama) {
      const doEmbed = await ctx.ui.confirm('Embeddings', 'Generate vector embeddings via Ollama? (improves semantic search quality)');
      if (doEmbed) {
        ctx.ui.setStatus('mne', 'Embedding documents...');
        run(`mne ${mneQuiet} embed`);
        ctx.ui.setStatus('mne', undefined);
        ctx.ui.notify('Embeddings complete', 'info');
      }
    } else {
      ctx.ui.notify('Ollama not detected. Run "mne embed" later for semantic search.', 'info');
    }

    // 7. Pi integration — configure MCP
    const setupMcp = await ctx.ui.confirm(
      'Pi MCP server',
      `Add mnemonic to ${isProject ? '.pi/mcp.json' : '~/.pi/agent/mcp.json'}?`
    );
    if (setupMcp) {
      const mcpPath = isProject
        ? join(ctx.cwd, '.pi', 'mcp.json')
        : join(homedir(), '.pi', 'agent', 'mcp.json');

      const mcpConfig: Record<string, any> = { mcpServers: {} };

      try {
        const { readFileSync, existsSync } = await import('node:fs');
        if (existsSync(mcpPath)) {
          const existing = JSON.parse(readFileSync(mcpPath, 'utf-8'));
          if (existing.mcpServers) mcpConfig.mcpServers = existing.mcpServers;
        }
      } catch {}

      mcpConfig.mcpServers['mnemonic'] = {
        command: 'mne',
        args: ['mcp'],
        lifecycle: 'keep-alive',
      };

      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(mcpPath.replace(/\/[^/]+$/, ''), { recursive: true });
      writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + '\n');
      ctx.ui.notify(`MCP server added to ${mcpPath}`, 'info');
    }

    // 8. Pi integration — copy skill
    const setupSkill = await ctx.ui.confirm(
      'Pi skill',
      `Install mnemonic skill for bash-based workflow (SKILL.md)?`
    );
    if (setupSkill) {
      const skillDir = isProject
        ? join(ctx.cwd, '.pi', 'skills', 'mnemonic')
        : join(homedir(), '.pi', 'agent', 'skills', 'mnemonic');

      const { writeFileSync, mkdirSync, readFileSync, existsSync } = await import('node:fs');
      mkdirSync(skillDir, { recursive: true });

      // Try to find the SKILL.md from the npm package
      const skillPaths = [
        join(homedir(), 'dev', 'mnemonic', 'SKILL.md'),  // dev checkout
        join(homedir(), 'dev', 'mnemonic', 'SKILL.md'),
      ];

      let skillContent = '';
      for (const p of skillPaths) {
        if (existsSync(p)) {
          skillContent = readFileSync(p, 'utf-8');
          break;
        }
      }

      if (skillContent) {
        writeFileSync(join(skillDir, 'SKILL.md'), skillContent);
        ctx.ui.notify(`Skill installed at ${skillDir}/SKILL.md`, 'info');
      } else {
        ctx.ui.notify('SKILL.md not found — copy manually from the mnemonic repo', 'warning');
      }
    }

    // 9. Done
    const { readFileSync, existsSync } = await import('node:fs');
    const dbSize = existsSync(indexDb) ? Math.round(readFileSync(indexDb).length / 1024) : 0;

    ctx.ui.notify(
      `mnemonic is ready!\n` +
      `  Index: ${indexDb} (${dbSize} KB)\n` +
      `  Type /mne status to check health\n` +
      `  Ask the LLM: "search my notes for..."`,
      'info'
    );
  }

  async function cmdAdd(ctx: any, dir: string) {
    if (!dir) {
      ctx.ui.notify('Usage: /mne add <path> [--name <name>]', 'warning');
      return;
    }
    const name = dir.replace(/^~/, homedir()).split('/').pop() || 'default';
    run(`mne collection add "${dir}" --name "${name}"`);
    ctx.ui.notify(`Added collection: ${name} → ${dir}`, 'info');
  }

  async function cmdStatus(ctx: any) {
    const { MnemonicDB, CollectionStore } = await loadMnemonic();
    const { existsSync, readFileSync } = await import('node:fs');
    const db = new MnemonicDB(dbPath);
    db.init();
    const collections = new CollectionStore(db);
    const cols = collections.list();
    const docCount = (db.db.prepare('SELECT COUNT(*) as c FROM documents').get() as any).c;
    const chunkCount = (db.db.prepare('SELECT COUNT(*) as c FROM chunks').get() as any).c;
    const hasVectors = db.hasVectorIndex();
    const dbSize = existsSync(dbPath) ? Math.round(readFileSync(dbPath).length / 1024) : 0;
    db.close();

    ctx.ui.notify(
      `mnemonic index\n` +
      `  Path: ${dbPath}\n` +
      `  Size: ${dbSize} KB\n` +
      `  Collections: ${cols.length}\n` +
        cols.map((c: any) => `    ${c.name}: ${c.docCount} docs, ${c.activeCount} embedded`).join('\n') +
      `\n  Documents: ${docCount}\n` +
      `  Chunks: ${chunkCount}\n` +
      `  Vectors: ${hasVectors ? 'yes' : 'no'}`,
      'info'
    );
  }

  function run(cmd: string) {
    try {
      execSync(cmd, { stdio: 'inherit', shell: true, timeout: 120_000 });
    } catch (err: any) {
      throw new Error(`Command failed: ${cmd}\n${err.stderr?.toString() || err.message}`);
    }
  }

  // ─── Tool: mnemonic_search ─────────────────────────────────────
  pi.registerTool({
    name: 'mnemonic_search',
    label: 'Mnemonic Search',
    description: 'Search indexed markdown knowledge bases with BM25 full-text search. Fast, no LLM needed.',
    promptSnippet: 'Search local markdown knowledge bases',
    promptGuidelines: [
      'Use mnemonic_search when you need to find information in the user\'s indexed markdown notes, docs, or wikis before resorting to web search.',
      'Use mnemonic_query for semantic/conceptual searches; prefer mnemonic_search when you know exact terms.',
    ],
    parameters: Type.Object({
      query: Type.String({ description: 'Search query (keywords or phrases)' }),
      collection: Type.Optional(Type.String({ description: 'Filter by collection name' })),
      limit: Type.Optional(Type.Number({ default: 10, description: 'Number of results' })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { query, collection, limit } = params;
      const { MnemonicDB, SearchPipeline } = await loadMnemonic();
      const db = new MnemonicDB(dbPath);
      db.init();
      const pipeline = new SearchPipeline(db);
      const results = pipeline.searchLex(query, {
        collection: collection ? [collection] : undefined,
        limit: limit ?? 10,
      });
      db.close();

      const text = results.length === 0
        ? 'No results found.'
        : results.map((r, i) =>
            `${i + 1}. ${r.path}  #${r.docid}\n   Title: ${r.title}\n   Score: ${Math.round(r.score * 100)}%\n   ${r.snippet || ''}`
          ).join('\n\n');

      return {
        content: [{ type: 'text', text }],
        details: { count: results.length, results },
      };
    },
  });

  // ─── Tool: mnemonic_query ─────────────────────────────────────
  pi.registerTool({
    name: 'mnemonic_query',
    label: 'Mnemonic Query',
    description: 'Hybrid semantic search over indexed markdown. Uses BM25 + vector search + optional LLM reranking for best quality. Use when the user asks conceptual questions or doesn\'t use exact keywords.',
    promptSnippet: 'Hybrid semantic search over markdown knowledge bases',
    promptGuidelines: [
      'Use mnemonic_query for conceptual or indirect questions where exact terms aren\'t known.',
      'Prefer mnemonic_query over mnemonic_search for most questions — it returns better results.',
      'Supply the intent parameter when the user\'s wording is ambiguous to disambiguate between nearby concepts.',
    ],
    parameters: Type.Object({
      query: Type.String({ description: 'Natural language search query' }),
      intent: Type.Optional(Type.String({ description: 'Disambiguation context. States what you want to find AND what to avoid.' })),
      collection: Type.Optional(Type.String({ description: 'Filter by collection name' })),
      limit: Type.Optional(Type.Number({ default: 10, description: 'Number of results' })),
      rerank: Type.Optional(Type.Boolean({ default: true, description: 'Run LLM reranking for better quality' })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { query, intent, collection, limit, rerank } = params;
      const { MnemonicDB, SearchPipeline, detectLLMBackend } = await loadMnemonic();
      const db = new MnemonicDB(dbPath);
      db.init();
      await db.loadVectors();
      const pipeline = new SearchPipeline(db);

      try {
        const { backend } = await detectLLMBackend();
        pipeline.setLLM(backend);
      } catch {}

      const results = await pipeline.search({
        query,
        intent,
        collection: collection ? [collection] : undefined,
        limit: limit ?? 10,
        rerank: rerank !== false,
        expand: true,
        hyde: true,
      });

      if ((pipeline as any).llm) {
        await (pipeline as any).llm.close();
      }
      db.close();

      const text = results.length === 0
        ? 'No results found.'
        : results.map((r, i) =>
            `${i + 1}. ${r.path}  #${r.docid}\n   Title: ${r.title}\n   Score: ${Math.round(r.score * 100)}%${r.context.length ? `\n   Context: ${r.context.join(' > ')}` : ''}${r.tags.length ? `\n   Tags: ${r.tags.join(', ')}` : ''}\n   ${r.snippet || ''}`
          ).join('\n\n');

      return {
        content: [{ type: 'text', text }],
        details: { count: results.length, results },
      };
    },
  });

  // ─── Tool: mnemonic_get ───────────────────────────────────────
  pi.registerTool({
    name: 'mnemonic_get',
    label: 'Mnemonic Get',
    description: 'Retrieve a full document from the mnemonic index by path or docid (#abc123). Supports line ranges with :from:count suffix.',
    promptSnippet: 'Retrieve a full indexed document',
    promptGuidelines: [
      'Use mnemonic_get after mnemonic_search or mnemonic_query to retrieve the full content of a matched document before answering.',
      'Use the :from:count suffix to read specific line ranges instead of fetching full documents.',
    ],
    parameters: Type.Object({
      file: Type.String({ description: 'Path, docid (#abc123), or path:from:count (e.g. #abc123:50:40)' }),
      maxLines: Type.Optional(Type.Number({ default: 100, description: 'Maximum lines to return' })),
      fromLine: Type.Optional(Type.Number({ description: 'Start line (1-indexed)' })),
      lineNumbers: Type.Optional(Type.Boolean({ default: true, description: 'Prefix lines with numbers' })),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { file, maxLines, fromLine, lineNumbers } = params;
      const { MnemonicDB, DocumentStore } = await loadMnemonic();
      const db = new MnemonicDB(dbPath);
      db.init();
      const docs = new DocumentStore(db);
      const result = docs.getBody(file, { fromLine, maxLines });

      if ('error' in result) {
        db.close();
        return {
          content: [{ type: 'text', text: `Document not found: ${file}${(result as any).similarFiles?.length ? `\nSimilar: ${(result as any).similarFiles.join(', ')}` : ''}` }],
          isError: true,
        };
      }

      const meta = docs.get(file) as any;
      db.close();
      let output = '';
      if (!('error' in meta)) {
        output += `mne://${meta.collection}/${meta.path}  #${meta.docid}\n---\n`;
      }
      if (lineNumbers !== false) {
        const start = fromLine ?? 1;
        result.content.split('\n').forEach((line, i) => {
          output += `${start + i}: ${line}\n`;
        });
      } else {
        output += result.content;
      }
      return {
        content: [{ type: 'text', text: output }],
        details: { totalLines: result.totalLines, docid: ('error' in meta) ? undefined : meta.docid },
      };
    },
  });

  // ─── Tool: mnemonic_status ─────────────────────────────────────
  pi.registerTool({
    name: 'mnemonic_status',
    label: 'Mnemonic Status',
    description: 'Show mnemonic index status: collections, document counts, vector status, and cache health.',
    promptSnippet: 'Show mnemonic knowledge base status',
    promptGuidelines: [
      'Use mnemonic_status at the start of a session to check what knowledge bases are available.',
    ],
    parameters: Type.Object({}),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { MnemonicDB, CollectionStore } = await loadMnemonic();
      const { existsSync, readFileSync } = await import('node:fs');
      const db = new MnemonicDB(dbPath);
      db.init();
      const collections = new CollectionStore(db);
      const cols = collections.list();
      const docCount = (db.db.prepare('SELECT COUNT(*) as c FROM documents').get() as any).c;
      const chunkCount = (db.db.prepare('SELECT COUNT(*) as c FROM chunks').get() as any).c;
      const linkCount = (db.db.prepare('SELECT COUNT(*) as c FROM links').get() as any).c;
      const hasVectors = db.hasVectorIndex();
      const dbSize = existsSync(dbPath) ? Math.round(readFileSync(dbPath).length / 1024) : 0;
      db.close();

      const text = [
        `Index: ${dbPath}`,
        `Size: ${dbSize} KB`,
        `Collections: ${cols.length}`,
        ...cols.map((c: any) => `  ${c.name}: ${c.docCount} docs, ${c.activeCount} embedded`),
        `Total documents: ${docCount}`,
        `Total chunks: ${chunkCount}`,
        `Links: ${linkCount}`,
        `Vectors: ${hasVectors ? 'yes' : 'no'}`,
      ].join('\n');

      return {
        content: [{ type: 'text', text }],
        details: { collections: cols, docCount, hasVectors },
      };
    },
  });
}
