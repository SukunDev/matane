import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../client';
import { runMigrations } from '../migrate';
import { SettingsRepository } from '../repositories/settings';

const migrationsFolder = resolve(__dirname, '../../../../drizzle');
const EXPECTED_TABLES = [
  'categories',
  'chapters',
  'downloads',
  'extension_prefs',
  'extension_repos',
  'extension_storage',
  'extensions',
  'history',
  'image_cache',
  'manga',
  'manga_categories',
  'manga_fts',
  'manga_tracks',
  'page_list_cache',
  'page_meta',
  'reading_sessions',
  'settings',
  'sources',
  'tracker_accounts',
  'tracker_queue',
];

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'matane-db-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('database migrations', () => {
  it('creates every table from docs/BRAINSTORM.md §7', async () => {
    const dir = tempDir();
    const connection = openDatabase(join(dir, 'data.db'));
    const result = await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });

    const tables = connection.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'manga_fts_%' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((row) => (row as { name: string }).name)
      .sort();
    expect(tables).toEqual(EXPECTED_TABLES);
    // A brand-new database has nothing worth backing up.
    expect(result.backupPath).toBeNull();
    connection.sqlite.close();
  });

  it('keeps manga_fts in sync with manga through triggers', async () => {
    const dir = tempDir();
    const connection = openDatabase(join(dir, 'data.db'));
    await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
    const { sqlite } = connection;
    const now = Date.now();
    sqlite
      .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('demo/en', 'demo', 'en', 'Demo', 'en')")
      .run();
    sqlite
      .prepare(
        "INSERT INTO manga (source_id, url, title, author, genres_json, created_at, updated_at) VALUES ('demo/en', '/a', 'Blade of the Ashen Sky', 'Ren Kaito', '[\"Action\"]', ?, ?)",
      )
      .run(now, now);

    const search = (query: string) =>
      sqlite.prepare('SELECT rowid FROM manga_fts WHERE manga_fts MATCH ?').all(query).length;
    expect(search('ashen')).toBe(1);
    expect(search('kaito')).toBe(1);

    sqlite.prepare("UPDATE manga SET title = 'Iron Tide' WHERE url = '/a'").run();
    expect(search('ashen')).toBe(0);
    expect(search('iron')).toBe(1);

    sqlite.prepare("DELETE FROM manga WHERE url = '/a'").run();
    expect(search('iron')).toBe(0);
    sqlite.close();
  });

  it('backs up an existing database before applying new migrations', async () => {
    const dir = tempDir();
    const backupDir = join(dir, 'backups');
    const connection = openDatabase(join(dir, 'data.db'));
    // Simulate an older install: only the first migration was applied.
    connection.sqlite.exec(
      `CREATE TABLE "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)`,
    );
    connection.sqlite.prepare('INSERT INTO "__drizzle_migrations" (hash, created_at) VALUES (?, ?)').run('old', 0);

    const result = await runMigrations(connection, { migrationsFolder, backupDir });
    expect(result.backupPath).not.toBeNull();
    expect(readdirSync(backupDir).filter((name) => name.endsWith('.db'))).toHaveLength(1);
    connection.sqlite.close();
  });
});

describe('SettingsRepository', () => {
  it('falls back to defaults and persists partial updates', async () => {
    const dir = tempDir();
    const connection = openDatabase(join(dir, 'data.db'));
    await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
    const repo = new SettingsRepository(connection.db);

    expect(repo.getAppSettings()).toMatchObject({ theme: 'mocha', accent: 'mauve', language: null });
    expect(repo.updateAppSettings({ theme: 'latte' }).theme).toBe('latte');

    // A corrupt stored value only resets that key.
    connection.sqlite.prepare("UPDATE settings SET value_json = '\"neon\"' WHERE key = 'theme'").run();
    connection.sqlite.prepare("INSERT INTO settings (key, value_json) VALUES ('accent', '\"blue\"')").run();
    expect(repo.getAppSettings()).toMatchObject({ theme: 'mocha', accent: 'blue' });
    connection.sqlite.close();
  });
});
