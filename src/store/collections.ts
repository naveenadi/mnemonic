import type { MnemonicDB } from './database.js';
import type { CollectionConfig, CollectionInfo } from '../types.js';

export class CollectionStore {
  constructor(private db: MnemonicDB) {}

  /** Add or update a collection */
  upsert(name: string, config: CollectionConfig): void {
    const existing = this.db.db
      .prepare('SELECT name FROM collections WHERE name = ?')
      .get(name);

    if (existing) {
      this.db.db
        .prepare(
          `UPDATE collections SET path = ?, glob_pattern = ?, ignore_pattern = ?,
           include_by_default = ?, update_cmd = ?, last_modified = datetime('now')
           WHERE name = ?`
        )
        .run(
          config.path,
          config.pattern ?? '**/*.md',
          config.ignore?.join('\n') ?? null,
          config.includeByDefault !== false ? 1 : 0,
          config.updateCommand ?? null,
          name
        );
    } else {
      this.db.db
        .prepare(
          `INSERT INTO collections (name, path, glob_pattern, ignore_pattern, include_by_default, update_cmd)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          name,
          config.path,
          config.pattern ?? '**/*.md',
          config.ignore?.join('\n') ?? null,
          config.includeByDefault !== false ? 1 : 0,
          config.updateCommand ?? null
        );
    }
  }

  /** Remove a collection */
  remove(name: string): void {
    this.db.db.prepare('DELETE FROM collections WHERE name = ?').run(name);
  }

  /** Get a collection by name */
  get(name: string): CollectionInfo | undefined {
    const row = this.db.db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM documents WHERE collection = c.name) as doc_count,
                (SELECT COUNT(*) FROM documents WHERE collection = c.name AND docid IN
                  (SELECT DISTINCT docid FROM chunks)) as active_count,
                (SELECT COUNT(*) FROM contexts WHERE collection = c.name) as context_count
         FROM collections c WHERE c.name = ?`
      )
      .get(name) as Record<string, unknown> | undefined;

    if (!row) return undefined;

    return {
      name: row.name as string,
      path: row.path as string,
      globPattern: row.glob_pattern as string,
      docCount: Number(row.doc_count),
      activeCount: Number(row.active_count),
      lastModified: (row.last_modified as string) ?? '',
      includeByDefault: row.include_by_default === 1,
      contextCount: Number(row.context_count),
    };
  }

  /** List all collections */
  list(): CollectionInfo[] {
    const rows = this.db.db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM documents WHERE collection = c.name) as doc_count,
                (SELECT COUNT(*) FROM documents WHERE collection = c.name AND docid IN
                  (SELECT DISTINCT docid FROM chunks)) as active_count,
                (SELECT COUNT(*) FROM contexts WHERE collection = c.name) as context_count
         FROM collections c ORDER BY c.name`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      name: r.name as string,
      path: r.path as string,
      globPattern: r.glob_pattern as string,
      docCount: Number(r.doc_count),
      activeCount: Number(r.active_count),
      lastModified: (r.last_modified as string) ?? '',
      includeByDefault: r.include_by_default === 1,
      contextCount: Number(r.context_count),
    }));
  }

  /** Rename a collection */
  rename(oldName: string, newName: string): void {
    this.db.db
      .prepare('UPDATE collections SET name = ? WHERE name = ?')
      .run(newName, oldName);
  }

  /** Set includeByDefault */
  setInclude(name: string, include: boolean): void {
    this.db.db
      .prepare('UPDATE collections SET include_by_default = ? WHERE name = ?')
      .run(include ? 1 : 0, name);
  }

  /** Set update command */
  setUpdateCmd(name: string, cmd: string | null): void {
    this.db.db
      .prepare('UPDATE collections SET update_cmd = ?, last_modified = datetime(\'now\') WHERE name = ?')
      .run(cmd, name);
  }

  /** Get names of collections included by default */
  getDefaultNames(): string[] {
    const rows = this.db.db
      .prepare('SELECT name FROM collections WHERE include_by_default = 1 ORDER BY name')
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }
}
