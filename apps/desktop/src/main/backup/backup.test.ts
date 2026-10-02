import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_SETTINGS } from '@manga-reader/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { BackupService, KEEP_AUTO, LAST_AUTO_KEY, PENDING_KEY } from './service';

const migrationsFolder = resolve(__dirname, '../../../drizzle');
const DAY = 24 * 60 * 60 * 1000;

let dir: string;
const open: DatabaseConnection[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'matane-backup-'));
});
afterEach(() => {
  for (const connection of open.splice(0)) connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

async function database(name: string): Promise<DatabaseConnection> {
  const connection = openDatabase(join(dir, `${name}.db`));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, `${name}-backups`) });
  open.push(connection);
  return connection;
}

function service(
  connection: DatabaseConnection,
  options: { now?: () => number; installed?: string[]; folder?: string; applied?: Record<string, unknown>[] } = {},
) {
  const kv = new Map<string, unknown>();
  const backups = new BackupService({
    sqlite: connection.sqlite,
    appVersion: '1.0.0',
    settingKeys: Object.keys(DEFAULT_SETTINGS),
    settings: () => ({ auto: 'daily', folder: options.folder ?? join(dir, 'auto') }),
    defaultFolder: join(dir, 'auto'),
    customCoversDir: join(dir, 'covers-restored'),
    isInstalled: (id) => (options.installed ?? []).includes(id),
    store: {
      get: (key, fallback) => (kv.has(key) ? (kv.get(key) as never) : fallback),
      set: (key, value) => kv.set(key, value),
    },
    applySettings: (settings) => options.applied?.push(settings),
    restored: () => undefined,
    now: options.now,
  });
  return { backups, kv };
}

/** A profile with a bit of everything a backup holds. */
function seed(connection: DatabaseConnection): void {
  const db = connection.sqlite;
  db.prepare(
    "INSERT INTO sources (id, extension_id, key, name, lang, pinned) VALUES ('demo/en', 'demo', 'en', 'Demo', 'en', 1)",
  ).run();
  db.prepare(
    "INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('gone/en', 'gone', 'en', 'Gone', 'en')",
  ).run();
  db.prepare(
    "INSERT INTO categories (name, sort_order, settings_json) VALUES ('Reading', 0, '{\"update\":true}'), ('Done', 1, NULL)",
  ).run();
  const manga = db.prepare(
    `INSERT INTO manga (source_id, url, title, genres_json, status, type, in_library, added_at, custom_cover_path,
       reader_settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'ongoing', 'manga', ?, ?, ?, ?, 1, 1)`,
  );
  const cover = join(dir, 'cover.png');
  writeFileSync(cover, Buffer.from('89504e470d0a1a0a', 'hex'));
  manga.run('demo/en', '/one', 'One', '["Action"]', 1, 100, cover, '{"mode":"webtoon"}');
  manga.run('gone/en', '/two', 'Two', '[]', 1, 200, null, null);
  manga.run('demo/en', '/three', 'Three (history only)', '[]', 0, null, null, null);
  manga.run('demo/en', '/four', 'Four (browsed only)', '[]', 0, null, null, null);
  db.prepare('INSERT INTO manga_categories (manga_id, category_id) VALUES (1, 1), (2, 2)').run();
  const chapter = db.prepare(
    `INSERT INTO chapters (manga_id, url, name, number, source_order, fetched_at, read, read_at, bookmarked, last_page,
       total_pages, page_offset) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
  );
  chapter.run(1, 'c1', 'Ch. 1', 1, 0, 1, 500, 0, 0, 20, null);
  chapter.run(1, 'c2', 'Ch. 2', 2, 1, 0, null, 1, 7, 20, 0.25);
  chapter.run(2, 'd1', 'Ch. 1', 1, 0, 0, null, 0, 0, null, null);
  chapter.run(3, 'e1', 'Ch. 1', 1, 0, 0, null, 0, 3, 10, null);
  chapter.run(3, 'e2', 'Ch. 2', 2, 1, 0, null, 0, 0, null, null);
  chapter.run(4, 'f1', 'Ch. 1', 1, 0, 0, null, 0, 0, null, null);
  const file = join(dir, 'One - Ch. 1.cbz');
  writeFileSync(file, 'cbz');
  db.prepare(
    "INSERT INTO downloads (chapter_id, status, format, path, size_bytes, created_at, completed_at) VALUES (1, 'done', 'cbz', ?, 3, 1, 2)",
  ).run(file);
  db.prepare('INSERT INTO history (manga_id, chapter_id, read_at) VALUES (1, 2, 900), (3, 4, 800)').run();
  db.prepare(
    'INSERT INTO reading_sessions (manga_id, chapter_id, started_at, ended_at, active_ms) VALUES (1, 1, 400, 500, 100), (3, 4, 700, 800, 50)',
  ).run();
  db.prepare(
    "INSERT INTO extension_repos (url, name, public_key) VALUES ('https://repo.example/', 'Repo', 'ed25519:abc')",
  ).run();
  db.prepare(
    "INSERT INTO extensions (id, name, version, api_version, repo_id, installed_at, updated_at) VALUES ('demo', 'Demo', '1.2.0', 1, 1, 1, 1)",
  ).run();
  db.prepare(`INSERT INTO extension_prefs (extension_id, key, value_json) VALUES ('demo', 'quality', '"high"')`).run();
  db.prepare(`INSERT INTO extension_storage (extension_id, key, value_json) VALUES ('demo', 'token', '{"a":1}')`).run();
  db.prepare(
    `INSERT INTO settings (key, value_json) VALUES ('theme', '"latte"'), ('extensions.handoffDone', '[]')`,
  ).run();
}

/** What a restore must carry over, by natural keys. */
function snapshot(connection: DatabaseConnection) {
  const db = connection.sqlite;
  return {
    manga: db
      .prepare(
        `SELECT source_id, url, title, in_library, added_at, reader_settings_json, custom_cover_path IS NOT NULL AS cover,
           (SELECT group_concat(c.name) FROM manga_categories mc JOIN categories c ON c.id = mc.category_id WHERE mc.manga_id = m.id) AS cats
         FROM manga m ORDER BY url`,
      )
      .all(),
    chapters: db
      .prepare(
        `SELECT m.url AS manga, c.url, c.read, c.read_at, c.bookmarked, c.last_page, c.total_pages, c.page_offset
         FROM chapters c JOIN manga m ON m.id = c.manga_id ORDER BY m.url, c.url`,
      )
      .all(),
    history: db
      .prepare(
        'SELECT m.url, c.url AS chapter, h.read_at FROM history h JOIN manga m ON m.id = h.manga_id JOIN chapters c ON c.id = h.chapter_id ORDER BY m.url',
      )
      .all(),
    sessions: db
      .prepare(
        'SELECT m.url, s.started_at, s.active_ms FROM reading_sessions s JOIN manga m ON m.id = s.manga_id ORDER BY s.started_at',
      )
      .all(),
    downloads: db
      .prepare('SELECT c.url, d.status, d.path FROM downloads d JOIN chapters c ON c.id = d.chapter_id')
      .all(),
    categories: db.prepare('SELECT name, settings_json FROM categories ORDER BY sort_order').all(),
    repos: db.prepare('SELECT url, name, public_key FROM extension_repos').all(),
  };
}

describe('backup and restore', () => {
  it('restores everything into a new profile (round trip)', async () => {
    const source = await database('a');
    seed(source);
    const file = join(dir, 'backup.zip');
    await service(source).backups.create(file);

    const target = await database('b');
    const applied: Record<string, unknown>[] = [];
    const { backups, kv } = service(target, { installed: [], applied });
    const preview = await backups.preview(file);
    expect(preview).toMatchObject({ manga: 3, inLibrary: 2, categories: 2, chaptersRead: 1 });
    expect(preview.missingExtensions).toEqual([
      { id: 'demo', name: 'Demo', repoUrl: 'https://repo.example/' },
      { id: 'gone', name: 'Gone', repoUrl: null },
    ]);

    const result = await backups.restore(file, { mode: 'merge', settings: true });
    expect(result).toMatchObject({
      manga: { added: 3, updated: 0 },
      categories: 2,
      covers: 1,
      downloads: 1,
      repos: 1,
      settings: true,
      failed: [],
    });
    const before = snapshot(source);
    const after = snapshot(target);
    // Browsed-only manga are not backed up; manga only in history keep just the chapters it points at.
    expect(after.manga).toEqual(before.manga.filter((m) => (m as { url: string }).url !== '/four'));
    expect(after.chapters).toEqual(
      before.chapters.filter(
        (c) => !['/four'].includes((c as { manga: string }).manga) && (c as { url: string }).url !== 'e2',
      ),
    );
    expect(after.history).toEqual(before.history);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.downloads).toEqual(before.downloads);
    expect(after.categories).toEqual(before.categories);
    expect(after.repos).toEqual(before.repos);
    expect(applied).toEqual([{ theme: 'latte' }]);
    // The extension is not installed here: its data waits for it.
    expect(kv.get(PENDING_KEY)).toEqual({ demo: { prefs: { quality: 'high' }, storage: { token: { a: 1 } } } });
  });

  it('merges: read = either, furthest progress, both categories, newest history, local settings kept', async () => {
    const source = await database('a');
    seed(source);
    const file = join(dir, 'backup.zip');
    await service(source).backups.create(file);

    const target = await database('b');
    const db = target.sqlite;
    db.prepare(
      "INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('demo/en', 'demo', 'en', 'Demo', 'en')",
    ).run();
    db.prepare("INSERT INTO categories (name, sort_order) VALUES ('Favourites', 0)").run();
    db.prepare(
      `INSERT INTO manga (source_id, url, title, genres_json, in_library, reader_settings_json, created_at, updated_at)
       VALUES ('demo/en', '/one', 'One (local title)', '[]', 0, '{"mode":"single"}', 1, 1)`,
    ).run();
    db.prepare('INSERT INTO manga_categories (manga_id, category_id) VALUES (1, 1)').run();
    const chapter = db.prepare(
      `INSERT INTO chapters (manga_id, url, name, source_order, fetched_at, read, read_at, bookmarked, last_page, page_offset)
       VALUES (1, ?, ?, 0, 1, ?, ?, 0, ?, ?)`,
    );
    chapter.run('c1', 'Ch. 1', 0, null, 12, null); // backup: read
    chapter.run('c2', 'Ch. 2', 0, null, 9, 0.1); // backup: page 7 → local page 9 is further
    chapter.run('c3', 'Ch. 3', 1, 300, 0, null); // only here
    db.prepare('INSERT INTO history (manga_id, chapter_id, read_at) VALUES (1, 3, 950)').run();

    const result = await service(target).backups.restore(file, { mode: 'merge', settings: false });
    expect(result.manga).toEqual({ added: 2, updated: 1 });
    expect(result.settings).toBe(false);
    const one = db.prepare("SELECT * FROM manga WHERE url = '/one'").get() as Record<string, unknown>;
    expect(one).toMatchObject({
      title: 'One (local title)',
      in_library: 1,
      reader_settings_json: '{"mode":"single"}',
      added_at: 100,
    });
    const chapters = db
      .prepare(
        'SELECT url, read, read_at, bookmarked, last_page, page_offset FROM chapters WHERE manga_id = 1 ORDER BY url',
      )
      .all();
    expect(chapters).toEqual([
      { url: 'c1', read: 1, read_at: 500, bookmarked: 0, last_page: 12, page_offset: null },
      { url: 'c2', read: 0, read_at: null, bookmarked: 1, last_page: 9, page_offset: 0.1 },
      { url: 'c3', read: 1, read_at: 300, bookmarked: 0, last_page: 0, page_offset: null },
    ]);
    const cats = db
      .prepare(
        'SELECT c.name FROM manga_categories mc JOIN categories c ON c.id = mc.category_id WHERE mc.manga_id = 1 ORDER BY c.name',
      )
      .all();
    expect(cats).toEqual([{ name: 'Favourites' }, { name: 'Reading' }]);
    // The local history entry (950) is newer than the backup's (900).
    expect(db.prepare('SELECT chapter_id, read_at FROM history WHERE manga_id = 1').get()).toEqual({
      chapter_id: 3,
      read_at: 950,
    });
    // Restoring the same backup twice adds nothing.
    const again = await service(target).backups.restore(file, { mode: 'merge', settings: false });
    expect(again.manga).toEqual({ added: 0, updated: 3 });
    expect(again.chapters.added).toBe(0);
    expect((db.prepare('SELECT count(*) AS n FROM reading_sessions').get() as { n: number }).n).toBe(2);
  });

  it('replace backs up first, then leaves only what the backup has', async () => {
    const source = await database('a');
    seed(source);
    const file = join(dir, 'backup.zip');
    await service(source).backups.create(file);

    const target = await database('b');
    target.sqlite
      .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('x/en', 'x', 'en', 'X', 'en')")
      .run();
    target.sqlite
      .prepare(
        "INSERT INTO manga (source_id, url, title, in_library, created_at, updated_at) VALUES ('x/en', '/mine', 'Mine', 1, 1, 1)",
      )
      .run();
    const folder = join(dir, 'safety');
    const result = await service(target, { folder }).backups.restore(file, { mode: 'replace', settings: false });
    expect(result.safetyBackup).toMatch(/matane-before-restore-.*\.zip$/);
    expect(existsSync(result.safetyBackup!)).toBe(true);
    const urls = (target.sqlite.prepare('SELECT url FROM manga ORDER BY url').all() as { url: string }[]).map(
      (r) => r.url,
    );
    expect(urls).toEqual(['/one', '/three', '/two']);
    // The safety backup has what was there.
    const check = await database('c');
    await service(check).backups.restore(result.safetyBackup!, { mode: 'merge', settings: false });
    expect(check.sqlite.prepare('SELECT title FROM manga').all()).toEqual([{ title: 'Mine' }]);
  });

  it('refuses files that are not a backup, are damaged, or come from a newer Matane', async () => {
    const target = await database('b');
    const { backups } = service(target);
    const write = async (name: string, entries: Record<string, string>) => {
      const zip = new yazl.ZipFile();
      for (const [entry, text] of Object.entries(entries)) zip.addBuffer(Buffer.from(text), entry);
      zip.end();
      const path = join(dir, name);
      await pipeline(zip.outputStream, createWriteStream(path));
      return path;
    };
    writeFileSync(join(dir, 'text.zip'), 'hello');
    await expect(backups.preview(join(dir, 'text.zip'))).rejects.toThrow('it is not a zip archive');
    await expect(backups.preview(await write('empty.zip', { 'other.txt': 'x' }))).rejects.toThrow(
      'backup.json is missing',
    );
    await expect(backups.preview(await write('json.zip', { 'backup.json': '{oops' }))).rejects.toThrow(
      'cannot be read',
    );
    await expect(
      backups.preview(await write('newer.zip', { 'backup.json': JSON.stringify({ formatVersion: 2 }) })),
    ).rejects.toThrow('made by a newer version of Matane');
    await expect(
      backups.preview(
        await write('bad.zip', {
          'backup.json': JSON.stringify({ formatVersion: 1, appVersion: '1', createdAt: 1, data: {} }),
        }),
      ),
    ).rejects.toThrow('The backup is damaged (data.sources');
    // Nothing was touched.
    expect((target.sqlite.prepare('SELECT count(*) AS n FROM manga').get() as { n: number }).n).toBe(0);
  });

  it('writes automatic backups when due and keeps the last 7', async () => {
    const connection = await database('a');
    seed(connection);
    let now = new Date(2026, 9, 1, 9, 0).getTime();
    const { backups, kv } = service(connection, { now: () => now });
    const folder = join(dir, 'auto');
    mkdirSync(folder, { recursive: true });
    // A manual backup and a safety backup in the folder are never rotated away.
    writeFileSync(join(folder, 'matane-before-restore-2020-01-01-0000.zip'), 'x');
    expect(backups.isDue()).toBe(true);
    for (let i = 0; i < 9; i++) {
      const written = await backups.runAutoIfDue();
      expect(written).not.toBeNull();
      expect(await backups.runAutoIfDue()).toBeNull(); // not due again the same day
      now += DAY;
    }
    expect(kv.get(LAST_AUTO_KEY)).toBe(now - DAY);
    const files = await backups.list();
    expect(files.filter((f) => f.auto)).toHaveLength(KEEP_AUTO);
    expect(files.some((f) => f.name.startsWith('matane-before-restore-'))).toBe(true);
    const names = files
      .filter((f) => f.auto)
      .map((f) => f.name)
      .sort();
    expect(names[0]).toBe('matane-backup-2026-10-03-0900.zip');
    expect(names.at(-1)).toBe('matane-backup-2026-10-09-0900.zip');
    expect(readFileSync(files[0]!.path).subarray(0, 2).toString()).toBe('PK');
  });

  it('applies preferences kept for an extension once it is installed', async () => {
    const connection = await database('a');
    const installed: string[] = [];
    const { backups, kv } = service(connection, { installed });
    kv.set(PENDING_KEY, { demo: { prefs: { quality: 'high' }, storage: { token: 1 } } });
    expect(backups.applyPending('demo')).toBe(false); // not installed yet
    installed.push('demo');
    connection.sqlite
      .prepare(
        "INSERT INTO extensions (id, name, version, api_version, installed_at, updated_at) VALUES ('demo', 'Demo', '1', 1, 1, 1)",
      )
      .run();
    connection.sqlite
      .prepare(`INSERT INTO extension_prefs (extension_id, key, value_json) VALUES ('demo', 'quality', '"low"')`)
      .run();
    expect(backups.applyPending('demo')).toBe(true);
    expect(
      connection.sqlite.prepare("SELECT key, value_json FROM extension_prefs WHERE extension_id = 'demo'").all(),
    ).toEqual([
      { key: 'quality', value_json: '"low"' }, // what was set here stays
    ]);
    expect(connection.sqlite.prepare("SELECT value_json FROM extension_storage WHERE key = 'token'").get()).toEqual({
      value_json: '1',
    });
    expect(kv.get(PENDING_KEY)).toEqual({});
  });
});

describe('backup at library scale', () => {
  it('backs up and restores 1,000 manga with 50,000 chapters in short steps', async () => {
    const source = await database('a');
    const db = source.sqlite;
    db.prepare(
      "INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('demo/en', 'demo', 'en', 'Demo', 'en')",
    ).run();
    const manga = db.prepare(
      "INSERT INTO manga (source_id, url, title, in_library, created_at, updated_at) VALUES ('demo/en', ?, ?, 1, 1, 1)",
    );
    const chapter = db.prepare(
      'INSERT INTO chapters (manga_id, url, name, source_order, fetched_at, read, read_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    );
    db.transaction(() => {
      for (let m = 0; m < 1000; m++) {
        const id = Number(manga.run(`/m${m}`, `Manga ${m}`).lastInsertRowid);
        for (let c = 0; c < 50; c++)
          chapter.run(id, `m${m}/c${c}`, `Ch. ${c}`, c, c < 20 ? 1 : 0, c < 20 ? 1000 : null);
      }
    })();
    const file = join(dir, 'big.zip');
    const started = performance.now();
    await service(source).backups.create(file);
    const written = performance.now() - started;

    const target = await database('b');
    let last = performance.now();
    let longest = 0;
    let steps = 0;
    const kv = new Map<string, unknown>();
    const backups = new BackupService({
      sqlite: target.sqlite,
      appVersion: '1.0.0',
      settingKeys: [],
      settings: () => ({ auto: 'off', folder: dir }),
      defaultFolder: dir,
      customCoversDir: join(dir, 'covers'),
      isInstalled: () => true,
      store: {
        get: (key, fallback) => (kv.has(key) ? (kv.get(key) as never) : fallback),
        set: (key, value) => kv.set(key, value),
      },
      applySettings: () => undefined,
      restored: () => undefined,
      onProgress: () => {
        const at = performance.now();
        longest = Math.max(longest, at - last);
        steps++;
        last = at;
      },
    });
    const restoreStarted = performance.now();
    const result = await backups.restore(file, { mode: 'merge', settings: false });
    const restored = performance.now() - restoreStarted;
    expect(result.manga.added).toBe(1000);
    expect(result.chapters.added).toBe(50_000);
    // In steps of 50 manga (about 300 ms for the longest, the first, on an idle machine); the
    // bounds are loose so a busy test run does not fail on timing alone.
    expect(steps).toBeGreaterThanOrEqual(20);
    expect(longest).toBeLessThan(3000);
    expect(written + restored).toBeLessThan(30_000);
  });
});
