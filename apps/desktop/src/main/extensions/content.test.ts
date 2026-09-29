import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { initialContentLanguages } from './content';

let dir: string;
let connection: DatabaseConnection;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-content-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, {
    migrationsFolder: resolve(__dirname, '../../../drizzle'),
    backupDir: join(dir, 'backups'),
  });
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

it('keeps the languages of sources in use, besides the UI language and English', () => {
  const source = connection.sqlite.prepare(
    'INSERT INTO sources (id, extension_id, key, name, lang, pinned, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  source.run('x/ja', 'x', 'ja', 'X', 'ja', 0, null);
  source.run('x/ko', 'x', 'ko', 'X', 'ko', 1, null);
  source.run('x/fr', 'x', 'fr', 'X', 'fr', 0, 123);
  source.run('x/pt-br', 'x', 'pt-br', 'X', 'pt-br', 0, null);
  connection.sqlite
    .prepare('INSERT INTO manga (source_id, url, title, in_library, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0)')
    .run('x/pt-br', '/a', 'A');

  expect(initialContentLanguages(connection.sqlite, 'id-ID').sort()).toEqual(['en', 'fr', 'id', 'ko', 'pt']);
});
