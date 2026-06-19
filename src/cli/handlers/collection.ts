import { resolve } from 'node:path';
import type { CliContext } from '../context-factory.js';
import type { CollectionInfo } from '../../types.js';
import { CliError } from '../errors.js';

export function handleCollectionList(ctx: CliContext): CollectionInfo[] {
  return ctx.collections.list();
}

export function handleCollectionShow(ctx: CliContext, name: string): CollectionInfo {
  const c = ctx.collections.get(name);
  if (!c) throw new CliError(`Collection not found: ${name}`);
  return c;
}

export function handleCollectionAdd(
  ctx: CliContext,
  params: { name: string; path: string; mask?: string; excluded?: boolean }
): string {
  ctx.collections.upsert(params.name, {
    path: resolve(params.path),
    name: params.name,
    pattern: params.mask ?? '**/*.md',
    includeByDefault: !params.excluded,
  });
  return `Added collection: ${params.name}`;
}

export function handleCollectionRemove(ctx: CliContext, name: string): string {
  ctx.collections.remove(name);
  return `Removed collection: ${name}`;
}

export function handleCollectionRename(ctx: CliContext, oldName: string, newName: string): string {
  ctx.collections.rename(oldName, newName);
  return `Renamed: ${oldName} → ${newName}`;
}

export function handleCollectionInclude(ctx: CliContext, name: string): string {
  ctx.collections.setInclude(name, true);
  return `Collection ${name} is now included by default`;
}

export function handleCollectionExclude(ctx: CliContext, name: string): string {
  ctx.collections.setInclude(name, false);
  return `Collection ${name} is now excluded by default`;
}
