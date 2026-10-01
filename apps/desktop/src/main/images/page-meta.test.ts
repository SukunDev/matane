import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { PageMetaStore } from './page-meta';

const migrationsFolder = resolve(__dirname, '../../../drizzle');
const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let connection: DatabaseConnection;
let now: number;
let store: PageMetaStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-meta-'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  now = 1000;
  store = new PageMetaStore(connection.db, () => now);
});

afterEach(() => {
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const accessed = (key: string) =>
  (connection.sqlite.prepare('SELECT accessed_at AS t FROM page_meta WHERE key = ?').get(key) as { t: number }).t;

describe('PageMetaStore', () => {
  it('stores sizes, then a crop box, and forgets the box when the image changes', () => {
    store.put('page:s:abc:0', 100, { width: 200, height: 300 });
    expect(store.get('page:s:abc:0')).toEqual({ bytes: 100, width: 200, height: 300, crop: undefined });
    const box = { left: 1, top: 2, width: 150, height: 250 };
    store.setCrop('page:s:abc:0', box);
    expect(store.get('page:s:abc:0')?.crop).toEqual(box);
    store.put('page:s:abc:0', 120, { width: 200, height: 300 });
    expect(store.get('page:s:abc:0')).toMatchObject({ bytes: 120, crop: undefined });
  });

  it("lists one chapter's pages by index, not its neighbours'", () => {
    for (const index of [0, 1, 10]) store.put(`page:s:abc:${index}`, 1, { width: 10, height: 10 + index });
    store.put('page:s:abd:0', 1, { width: 10, height: 10 });
    store.put('page:s:ab:0', 1, { width: 10, height: 10 });
    const list = store.list('page:s:abc:');
    expect(list.map(({ index, meta }) => [index, meta.height]).sort((a, b) => a[0]! - b[0]!)).toEqual([
      [0, 10],
      [1, 11],
      [10, 20],
    ]);
  });

  it('marks use at most once a day', () => {
    store.put('k', 1, { width: 1, height: 1 });
    now += DAY / 2;
    store.get('k');
    expect(accessed('k')).toBe(1000);
    now += DAY;
    store.get('k');
    expect(accessed('k')).toBe(now);
  });

  it('keeps only the most recently used rows', () => {
    for (let i = 0; i < 10; i++) {
      now = 1000 + i;
      store.put(`k${i}`, 1, { width: 1, height: 1 });
    }
    store.prune(4);
    expect(store.count()).toBe(4);
    expect(store.get('k9')).toBeDefined();
    expect(store.get('k5')).toBeUndefined();
    store.prune(100);
    expect(store.count()).toBe(4);
  });
});
