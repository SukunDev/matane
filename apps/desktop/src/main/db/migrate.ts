import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { DatabaseConnection } from './client';

const KEPT_BACKUPS = 3;

function countAppliedMigrations(connection: DatabaseConnection): number {
  const table = connection.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) return 0;
  const row = connection.sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get() as {
    count: number;
  };
  return row.count;
}

function countBundledMigrations(migrationsFolder: string): number {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
    entries: unknown[];
  };
  return journal.entries.length;
}

function pruneBackups(backupDir: string): void {
  const backups = readdirSync(backupDir)
    .filter((name) => name.endsWith('.db'))
    .sort()
    .reverse();
  for (const stale of backups.slice(KEPT_BACKUPS)) rmSync(join(backupDir, stale));
}

/**
 * Applies pending migrations. When an existing database is about to change, a copy is taken
 * first so a broken migration never costs the user their library.
 */
export async function runMigrations(
  connection: DatabaseConnection,
  options: { migrationsFolder: string; backupDir: string },
): Promise<{ applied: number; backupPath: string | null }> {
  const applied = countAppliedMigrations(connection);
  const pending = countBundledMigrations(options.migrationsFolder) - applied;
  if (pending <= 0) return { applied: 0, backupPath: null };

  let backupPath: string | null = null;
  if (applied > 0) {
    mkdirSync(options.backupDir, { recursive: true });
    backupPath = join(options.backupDir, `data-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    await connection.sqlite.backup(backupPath);
    pruneBackups(options.backupDir);
  }

  migrate(connection.db, { migrationsFolder: options.migrationsFolder });
  return { applied: pending, backupPath };
}
