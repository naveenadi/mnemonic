import type { CliContext } from '../context-factory.js';
import type { SearchResult, ExpandedQuery, SearchOptions } from '../../types.js';
import { CliError } from '../errors.js';

export function handleSearch(
  ctx: CliContext,
  params: { query: string; collection?: string; limit: number }
): SearchResult[] {
  if (!params.query) throw new CliError('Usage: mne search <query> [-n <num>] [-c <collection>] [--json]');

  return ctx.pipeline.searchLex(params.query, {
    collection: params.collection ? [params.collection] : undefined,
    limit: params.limit,
  });
}

export async function handleVectorSearch(
  ctx: CliContext,
  params: { query: string; collection?: string; limit: number }
): Promise<SearchResult[]> {
  if (!params.query) throw new CliError('Usage: mne vsearch <query> [-n <num>] [-c <collection>] [--json]');

  if (!ctx.llm) throw new CliError('No LLM backend available.');

  await ctx.db.loadVectors();
  ctx.pipeline.setLLM(ctx.llm);

  return ctx.pipeline.searchVector(params.query, {
    collection: params.collection ? [params.collection] : undefined,
    limit: params.limit,
  });
}

export async function handleQuery(
  ctx: CliContext,
  params: {
    query?: string;
    queries?: ExpandedQuery[];
    intent?: string;
    collection?: string;
    limit: number;
    noRerank: boolean;
    explain: boolean;
  }
): Promise<SearchResult[]> {
  if (!params.query && !params.queries) {
    throw new CliError(
      'Usage: mne query <query> [-n <num>] [-c <collection>] [--json] [--no-rerank]\n' +
      '  Or: mne query with structured fields: intent: ..., lex: ..., vec: ..., hyde: ...'
    );
  }

  if (ctx.llm) ctx.pipeline.setLLM(ctx.llm);
  await ctx.db.loadVectors();

  return ctx.pipeline.search({
    query: params.query,
    queries: params.queries,
    intent: params.intent,
    collection: params.collection ? [params.collection] : undefined,
    limit: params.limit,
    rerank: !params.noRerank && !!ctx.llm,
    expand: true,
    hyde: true,
    explain: params.explain,
  });
}
