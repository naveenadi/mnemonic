import type { CliContext } from '../context-factory.js';
import type { DocumentResult } from '../../types.js';
import { CliError } from '../errors.js';

export function handleGet(
  ctx: CliContext,
  params: { identifier: string; fromLine?: number; maxLines?: number; lineNumbers: boolean }
): { meta: DocumentResult; body: string; totalLines: number } {
  if (!params.identifier) {
    throw new CliError('Usage: mne get <path|#docid> [--no-line-numbers] [--full-path] [--json]');
  }

  const doc = ctx.docs.getBody(params.identifier, {
    fromLine: params.fromLine,
    maxLines: params.maxLines,
  });

  if ('error' in doc) {
    const similar = (doc as any).similarFiles;
    let msg = doc.error;
    if (similar?.length > 0) {
      msg += `\nSimilar files: ${similar.join(', ')}`;
    }
    throw new CliError(msg);
  }

  const meta = ctx.docs.get(params.identifier) as DocumentResult;
  if ('error' in meta) {
    throw new CliError(meta.error as string);
  }

  return { meta, body: doc.content, totalLines: doc.totalLines };
}

export function handleMultiGet(
  ctx: CliContext,
  params: { pattern: string; maxLines: number; lineNumbers: boolean }
): string {
  if (!params.pattern) {
    throw new CliError('Usage: mne multi-get <pattern|#docid1,#docid2> [-l <lines>] [--json]');
  }

  const ids = params.pattern.includes(',')
    ? params.pattern.split(',').map((s) => s.trim())
    : undefined;

  if (!ids) return '';

  let out = '';
  for (const id of ids) {
    const doc = ctx.docs.getBody(id, { maxLines: params.maxLines });
    if ('error' in doc) {
      out += `# ${id}: ${doc.error}\n`;
      continue;
    }
    const meta = ctx.docs.get(id) as DocumentResult;
    if (!('error' in meta)) {
      out += `# ${meta.path}  #${meta.docid}\n---\n`;
      if (params.lineNumbers) {
        doc.content.split('\n').forEach((line, i) => {
          out += `${i + 1}: ${line}\n`;
        });
      } else {
        out += doc.content;
      }
      out += '\n\n';
    }
  }
  return out;
}

export function handleLs(ctx: CliContext, collection?: string): string[] {
  if (!collection) {
    return ctx.collections.list().map((c) => `${c.name}/  (${c.docCount} files)`);
  }

  // Remove mne:// prefix if present
  const cleanName = collection.replace(/^mne:\/\//, '');
  const [baseCol, ...subPath] = cleanName.split('/');
  const filterPath = subPath.join('/');

  const docs = ctx.db.db
    .prepare('SELECT path FROM documents WHERE collection = ? AND path LIKE ? ORDER BY path')
    .all(baseCol, `${filterPath}%`) as Array<{ path: string }>;

  return docs.map((d) => d.path);
}
