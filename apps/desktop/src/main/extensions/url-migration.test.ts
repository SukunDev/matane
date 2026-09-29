import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { UrlMigration, type UrlMigrationDeps } from './url-migration';

let dir: string;
let connection: DatabaseConnection;
let versions: Record<string, string>;
let installedVersion: string;
let lines: string[];
let calls: number;
let fail: boolean;

function migration(overrides: Partial<UrlMigrationDeps> = {}) {
  return new UrlMigration({
    sqlite: connection.sqlite,
    store: { get: () => versions, set: (value) => (versions = value) },
    installed: () => [{ id: 'demo', version: installedVersion, sourceKeys: ['en'] }],
    supports: async () => true,
    // v2 moved manga under /series and chapters under /read; /taken already exists.
    migrate: async (_id, _key, items, from) => {
      calls++;
      if (fail) throw new Error('host gone');
      return {
        urls: items.map((item) =>
          from !== '1.0.0' ? null : item.kind === 'manga' ? `/series${item.url}` : `/read${item.url}`,
        ),
        errors: [],
      };
    },
    record: (id, level, message) => lines.push(`${id} ${level} ${message}`),
    ...overrides,
  });
}

const urls = (table: 'manga' | 'chapters') =>
  (connection.sqlite.prepare(`SELECT url FROM ${table} ORDER BY id`).all() as { url: string }[]).map((r) => r.url);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-urls-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, {
    migrationsFolder: resolve(__dirname, '../../../drizzle'),
    backupDir: join(dir, 'backups'),
  });
  const source = connection.sqlite.prepare(
    'INSERT INTO sources (id, extension_id, key, name, lang) VALUES (?, ?, ?, ?, ?)',
  );
  source.run('demo/en', 'demo', 'en', 'Demo', 'en');
  source.run('other/en', 'other', 'en', 'Other', 'en');
  const manga = connection.sqlite.prepare(
    'INSERT INTO manga (source_id, url, title, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
  );
  manga.run('demo/en', '/a', 'A');
  manga.run('demo/en', '/b', 'B');
  // Already in the new form: /b would collide with it.
  manga.run('demo/en', '/series/b', 'B again');
  manga.run('other/en', '/a', 'Other');
  const chapter = connection.sqlite.prepare(
    'INSERT INTO chapters (manga_id, url, name, fetched_at) VALUES (?, ?, ?, 0)',
  );
  chapter.run(1, '/a/1', 'Ch. 1');
  chapter.run(1, '/a/2', 'Ch. 2');
  versions = {};
  installedVersion = '1.0.0';
  lines = [];
  calls = 0;
  fail = false;
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

it('only remembers the version the first time an extension is seen', async () => {
  await expect(migration().run()).resolves.toEqual([]);
  expect(versions).toEqual({ demo: '1.0.0' });
  expect(calls).toBe(0);
});

it('rewrites manga and chapter urls after an update, keeping collisions and other sources', async () => {
  versions = { demo: '1.0.0' };
  installedVersion = '2.0.0';
  const [result] = await migration().run();
  expect(result).toEqual({ extensionId: 'demo', from: '1.0.0', to: '2.0.0', manga: 2, chapters: 2, skipped: 1 });
  expect(urls('manga')).toEqual(['/series/a', '/b', '/series/series/b', '/a']);
  expect(urls('chapters')).toEqual(['/read/a/1', '/read/a/2']);
  expect(versions).toEqual({ demo: '2.0.0' });
  expect(lines).toContainEqual(expect.stringMatching(/manga 2 → \/series\/b collides/));
  // Nothing more to do afterwards.
  await migration().run();
  expect(calls).toBe(1);
});

it('changes nothing when the extension fails, and tries again next time', async () => {
  versions = { demo: '1.0.0' };
  installedVersion = '2.0.0';
  fail = true;
  await migration().run();
  expect(urls('manga')).toEqual(['/a', '/b', '/series/b', '/a']);
  expect(versions).toEqual({ demo: '1.0.0' });
  expect(lines).toContainEqual(expect.stringMatching(/failed, retried at the next start: host gone/));
  fail = false;
  await migration().run();
  expect(versions).toEqual({ demo: '2.0.0' });
});

it('skips sources without migrateUrl but still records the new version', async () => {
  versions = { demo: '1.0.0' };
  installedVersion = '2.0.0';
  await migration({ supports: async () => false }).run();
  expect(calls).toBe(0);
  expect(urls('manga')[0]).toBe('/a');
  expect(versions).toEqual({ demo: '2.0.0' });
});
