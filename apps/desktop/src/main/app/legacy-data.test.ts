import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { moveLegacyUserData, rewriteDataPaths } from './legacy-data';

const migrationsFolder = resolve(__dirname, '../../../drizzle');

let root: string;
let from: string;
let to: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'matane-legacy-'));
  from = join(root, 'MangaReader');
  to = join(root, 'Matane');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const seedOld = () => {
  mkdirSync(join(from, 'covers'), { recursive: true });
  writeFileSync(join(from, 'data.db'), 'db');
  writeFileSync(join(from, 'covers', '1.png'), 'cover');
  writeFileSync(join(from, 'SingletonLock'), '');
};

describe('moveLegacyUserData', () => {
  it('renames the old folder when the new one does not exist', () => {
    seedOld();
    expect(moveLegacyUserData(from, to)).toBe(true);
    expect(existsSync(from)).toBe(false);
    expect(readFileSync(join(to, 'covers', '1.png'), 'utf8')).toBe('cover');
  });

  it('merges into an existing folder without a database, skipping lock files and existing names', () => {
    seedOld();
    mkdirSync(join(to, 'logs'), { recursive: true });
    writeFileSync(join(from, 'logs'), 'old');
    expect(moveLegacyUserData(from, to)).toBe(true);
    expect(readFileSync(join(to, 'data.db'), 'utf8')).toBe('db');
    expect(existsSync(join(to, 'covers', '1.png'))).toBe(true);
    expect(existsSync(join(to, 'SingletonLock'))).toBe(false);
    expect(existsSync(join(from, 'logs'))).toBe(true);
  });

  it('does nothing without old data or when the new folder already has a database', () => {
    expect(moveLegacyUserData(from, to)).toBe(false);
    seedOld();
    mkdirSync(to);
    writeFileSync(join(to, 'data.db'), 'new');
    expect(moveLegacyUserData(from, to)).toBe(false);
    expect(readFileSync(join(to, 'data.db'), 'utf8')).toBe('new');
    expect(existsSync(join(from, 'data.db'))).toBe(true);
  });
});

describe('rewriteDataPaths', () => {
  it('points stored paths inside the old folder at the new one', async () => {
    mkdirSync(to);
    const connection = openDatabase(join(to, 'data.db'));
    await runMigrations(connection, { migrationsFolder, backupDir: join(to, 'backups') });
    const { sqlite } = connection;
    sqlite.prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('s', 'e', 's', 'S', 'en')").run();
    const insert = sqlite.prepare(
      "INSERT INTO manga (source_id, url, title, cover_path, custom_cover_path, created_at, updated_at) VALUES ('s', ?, 'T', ?, ?, 0, 0)",
    );
    insert.run('/a', join(from, 'covers', '1.png'), join(from, 'covers', 'custom', '1.png'));
    insert.run('/b', '/elsewhere/cover.png', null);
    insert.run('/c', join(`${from}Other`, 'x.png'), null);
    sqlite
      .prepare("INSERT INTO image_cache (key, kind, path, size_bytes, last_access_at) VALUES ('k', 'page', ?, 1, 0)")
      .run(join(from, 'cache', 'images', 'abc'));

    expect(rewriteDataPaths(sqlite, from, to)).toBe(3);
    const rows = sqlite.prepare('SELECT cover_path, custom_cover_path FROM manga ORDER BY url').all();
    expect(rows).toEqual([
      { cover_path: join(to, 'covers', '1.png'), custom_cover_path: join(to, 'covers', 'custom', '1.png') },
      { cover_path: '/elsewhere/cover.png', custom_cover_path: null },
      { cover_path: join(`${from}Other`, 'x.png'), custom_cover_path: null },
    ]);
    expect(sqlite.prepare('SELECT path FROM image_cache').pluck().get()).toBe(join(to, 'cache', 'images', 'abc'));
    sqlite.close();
  });
});
