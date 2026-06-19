import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CliContext } from '../context-factory.js';
import type { LinkEntry, ContextEntry } from '../../types.js';
import { checkOllama } from '../../llm/factory.js';
import type { StatusInfo, DoctorInfo } from '../output-formatter.js';
import { CliError } from '../errors.js';

const DEFAULT_DB = join(homedir(), '.cache', 'mnemonic', 'index.sqlite');
const DEFAULT_CONFIG = join(homedir(), '.config', 'mnemonic', 'config.yml');

export async function handleStatus(ctx: CliContext): Promise<StatusInfo> {
  await ctx.db.loadVectors();

  const docCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM documents').get() as any).c;
  const collectionCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM collections').get() as any).c;
  const chunkCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM chunks').get() as any).c;
  const hasVectors = ctx.db.hasVectorIndex();
  const linkCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM links').get() as any).c;
  const tagCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM tags').get() as any).c;
  const ctxCount = (ctx.db.db.prepare('SELECT COUNT(*) as c FROM contexts').get() as any).c;

  const dbSizeKB = existsSync(ctx.db.getPath())
    ? Math.round(readFileSync(ctx.db.getPath()).length / 1024)
    : 0;

  return {
    dbPath: ctx.db.getPath(),
    collectionCount,
    documentCount: docCount,
    chunkCount,
    hasVectors,
    linkCount,
    tagCount,
    contextCount: ctxCount,
    dbSizeKB,
    collections: ctx.collections.list(),
  };
}

export async function handleDoctor(): Promise<DoctorInfo> {
  const modelsDir = join(homedir(), '.cache', 'mnemonic', 'models');

  const dbFound = existsSync(DEFAULT_DB);
  const dbSizeKB = dbFound ? Math.round(readFileSync(DEFAULT_DB).length / 1024) : undefined;
  const configFound = existsSync(DEFAULT_CONFIG);
  const ollamaRunning = await checkOllama();

  let nodeLlamaAvailable = false;
  try {
    await import('node-llama-cpp');
    nodeLlamaAvailable = true;
  } catch {
    // not installed
  }

  let models: string[] = [];
  try {
    models = readdirSync(modelsDir);
  } catch {
    // no models dir
  }

  return {
    dbFound,
    dbPath: DEFAULT_DB,
    dbSizeKB,
    configFound,
    configPath: DEFAULT_CONFIG,
    ollamaRunning,
    nodeLlamaAvailable,
    models,
  };
}

// ─── Tags ───────────────────────────────────────────────────────────

export function handleAddTag(ctx: CliContext, docid: string, tag: string): string {
  if (!docid || !tag) throw new CliError('Usage: mne tag <#docid> <tag>');
  ctx.docs.addTag(docid, tag);
  return `Tag "${tag}" added to #${docid}`;
}

// ─── Links ──────────────────────────────────────────────────────────

export function handleLinks(ctx: CliContext, docid: string): LinkEntry[] {
  if (!docid) throw new CliError('Usage: mne links <#docid>');
  return ctx.docs.getLinks(docid);
}

export function handleBacklinks(ctx: CliContext, docid: string): LinkEntry[] {
  if (!docid) throw new CliError('Usage: mne backlinks <#docid>');
  return ctx.docs.getBacklinks(docid);
}

export function handleOrphans(ctx: CliContext): Array<{ docid: string; path: string }> {
  return ctx.docs.getOrphans();
}

// ─── Context ────────────────────────────────────────────────────────

export function handleContextAdd(ctx: CliContext, path: string, text: string): string {
  if (!path || !text) throw new CliError('Usage: mne context add <mne://path|/> <text>');

  const mneMatch = path.match(/^mne:\/\/([^/]+)\/(.*)/);
  if (mneMatch) {
    ctx.docs.addContext(mneMatch[1], mneMatch[2], text);
  } else if (path === '/') {
    ctx.docs.addContext(null, '/', text);
  } else {
    ctx.docs.addContext(null, path, text);
  }
  return `Context added: ${path}`;
}

export function handleContextList(ctx: CliContext): ContextEntry[] {
  return ctx.docs.listContexts();
}

export function handleContextRemove(ctx: CliContext, path: string): string {
  if (!path) throw new CliError('Usage: mne context rm <path>');

  const mneMatch = path.match(/^mne:\/\/([^/]+)\/(.*)/);
  if (mneMatch) {
    ctx.docs.removeContext(mneMatch[1], mneMatch[2]);
  } else {
    ctx.docs.removeContext(null, path === '/' ? '/' : path);
  }
  return `Context removed: ${path}`;
}
