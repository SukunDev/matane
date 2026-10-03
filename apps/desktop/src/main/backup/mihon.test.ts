import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DEFAULT_SETTINGS } from '@manga-reader/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { type OfferedExtension, decodeMihon, matchOffers, matchSources, mihonSourceId } from './mihon';
import { BackupService } from './service';

const migrationsFolder = resolve(__dirname, '../../../drizzle');

// ---- a tiny protobuf encoder: just enough to write Mihon's `Backup` message in the tests

const varint = (value: bigint | number): Buffer => {
  let v = BigInt.asUintN(64, BigInt(value));
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return Buffer.from(out);
};
const tag = (num: number, wire: number) => varint((num << 3) | wire);
const num = (n: number, value: bigint | number) => Buffer.concat([tag(n, 0), varint(value)]);
const bool = (n: number, value: boolean) => num(n, value ? 1 : 0);
const bytes = (n: number, value: Buffer | string) => {
  const body = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([tag(n, 2), varint(body.length), body]);
};
const float = (n: number, value: number) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(value);
  return Buffer.concat([tag(n, 5), b]);
};
const msg = (n: number, ...parts: Buffer[]) => bytes(n, Buffer.concat(parts));

const SOURCE = BigInt(mihonSourceId('Demo Site', 'en'));

function chapter(
  url: string,
  name: string,
  o: { read?: boolean; bookmark?: boolean; page?: number; number?: number; order?: number; uploaded?: number } = {},
) {
  return msg(
    16,
    bytes(1, url),
    bytes(2, name),
    bool(4, o.read ?? false),
    bool(5, o.bookmark ?? false),
    num(6, o.page ?? 0),
    num(8, o.uploaded ?? 0),
    float(9, o.number ?? -1),
    num(10, o.order ?? 0),
  );
}

/** A Mihon backup: two manga of "Demo Site" (one favourite) and one of an unknown source. */
function mihonBackup(): Buffer {
  return Buffer.concat([
    msg(
      1,
      num(1, SOURCE),
      bytes(2, '/manga/one/'),
      bytes(3, 'One'),
      bytes(5, 'Author'),
      bytes(7, 'Action'),
      bytes(7, 'Comedy'),
      num(8, 4),
      bytes(9, 'https://cdn.example/one.jpg'),
      num(13, 1_700_000_000_000),
      // packed categories (as protobuf 3 writes them): order 1
      bytes(17, varint(1)),
      chapter('/one-3/', 'Chapter 3', { number: 3, order: 0, uploaded: 3000 }),
      chapter('/one-2/', 'Chapter 2', { read: true, bookmark: true, page: 7, number: 2.1, order: 1, uploaded: 2000 }),
      chapter('/one-1/', 'Chapter 1', { read: true, page: 19, number: 1, order: 2, uploaded: 1000 }),
      // no `favorite` field: Mihon leaves out the default, which is true
      msg(104, bytes(1, '/one-2/'), num(2, 1_700_000_500_000), num(3, 60_000)),
      msg(104, bytes(1, '/one-1/'), num(2, 1_700_000_100_000), num(3, 30_000)),
      msg(104, bytes(1, '/gone/'), num(2, 1_700_000_900_000)),
    ),
    msg(
      1,
      num(1, SOURCE),
      bytes(2, '/manga/two/'),
      bytes(3, 'Two'),
      num(8, 1),
      bool(100, false),
      chapter('/two-1/', 'Chapter 1', { read: true, number: 1 }),
    ),
    msg(1, num(1, 12345), bytes(2, '/other/'), bytes(3, 'Other'), bool(100, true), chapter('/o-1/', 'Ch. 1')),
    msg(2, bytes(1, 'Reading'), num(2, 1)),
    msg(2, bytes(1, 'Done'), num(2, 2)),
    msg(101, bytes(1, 'Demo Site'), num(2, SOURCE)),
    msg(101, bytes(1, 'Other Site'), num(2, 12345)),
    // preferences and repositories are skipped
    msg(106, bytes(1, 'https://example.com/index.pb'), bytes(2, 'Repo')),
    msg(104, bytes(1, 'app_theme'), bytes(2, 'x')),
  ]);
}

let dir: string;
const open: DatabaseConnection[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'matane-mihon-'));
});
afterEach(() => {
  for (const connection of open.splice(0)) connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

async function profile(installed: string[] = ['demo'], offered: OfferedExtension[] = []) {
  const connection = openDatabase(join(dir, 'a.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'a-backups') });
  open.push(connection);
  connection.sqlite
    .prepare(
      "INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('demo/en', 'demo', 'en', 'Demo Site', 'en')",
    )
    .run();
  connection.sqlite
    .prepare("INSERT INTO sources (id, extension_id, key, name, lang) VALUES ('gone/en', 'gone', 'en', 'Gone', 'en')")
    .run();
  const kv = new Map<string, unknown>();
  const backups = new BackupService({
    sqlite: connection.sqlite,
    appVersion: '1.0.0',
    settingKeys: Object.keys(DEFAULT_SETTINGS),
    settings: () => ({ auto: 'off', folder: join(dir, 'auto') }),
    defaultFolder: join(dir, 'auto'),
    customCoversDir: join(dir, 'covers'),
    isInstalled: (id) => installed.includes(id),
    offered: () => offered,
    store: {
      get: (key, fallback) => (kv.has(key) ? (kv.get(key) as never) : fallback),
      set: (key, value) => kv.set(key, value),
    },
    applySettings: () => undefined,
    restored: () => undefined,
  });
  return { connection, backups };
}

describe('Mihon source ids', () => {
  it('computes the id Mihon gives a source', () => {
    // Taken from a real backup: "Doujindesu" (id) and "Everia.club" (all), version 1.
    expect(mihonSourceId('Doujindesu', 'id')).toBe('7704282043609669342');
    expect(mihonSourceId('Everia.club', 'all')).toBe('7698513740234984368');
  });

  it('matches by id first, then by a name that is unique', () => {
    const installed = [
      { id: 'a/id', extensionId: 'a', key: 'id', name: 'Doujindesu', lang: 'id' },
      { id: 'b/en', extensionId: 'b', key: 'en', name: 'Kiryuu', lang: 'en' },
      { id: 'c/en', extensionId: 'c', key: 'en', name: 'Twin', lang: 'en' },
      { id: 'c/id', extensionId: 'c', key: 'id', name: 'Twin', lang: 'id' },
    ];
    const matches = matchSources(
      [
        { id: '7704282043609669342', name: null },
        { id: '1', name: 'KIRYUU' },
        { id: '2', name: 'Twin' },
        { id: '3', name: 'Nowhere' },
      ],
      installed,
    );
    expect(Object.fromEntries(matches)).toEqual({
      '7704282043609669342': 'a/id', // by id, the name is not even known
      '1': 'b/en', // by name
      '2': null, // two sources are called that
      '3': null,
    });
  });
});

describe('extensions to install', () => {
  const offered = [
    { repoId: 1, id: 'kiryuu', name: 'Tachiyomi: Kiryuu', langs: ['id'] },
    { repoId: 1, id: 'doujin', name: 'Doujindesu', langs: ['id'] },
    { repoId: 2, id: 'twin-a', name: 'Twin', langs: ['en'] },
    { repoId: 2, id: 'twin-b', name: 'Twin', langs: ['id'] },
  ];

  it('finds the extension a source probably came from, by id or by a unique name', () => {
    const matches = matchOffers(
      [
        { id: '7704282043609669342', name: null }, // Doujindesu (id): by the computed id
        { id: '1', name: 'Kiryuu' }, // by name
        { id: '2', name: 'Twin' }, // two extensions are called that
        { id: '3', name: 'Nowhere' },
      ],
      offered,
    );
    expect(Object.fromEntries([...matches].map(([id, e]) => [id, e?.id ?? null]))).toEqual({
      '7704282043609669342': 'doujin',
      '1': 'kiryuu',
      '2': null,
      '3': null,
    });
  });

  it('shows the offer in the preview of sources nothing installed matches', async () => {
    const { backups } = await profile(['demo'], offered);
    const file = join(dir, 'offer.tachibk');
    writeFileSync(file, gzipSync(mihonBackup()));
    const sources = (await backups.preview(file)).mihon!.sources;
    expect(sources.map((s) => [s.name, s.matchedSourceId, s.offer])).toEqual([
      ['Demo Site', 'demo/en', null], // installed: no offer needed
      ['Other Site', null, null], // nothing in the repositories either
    ]);
  });

  it('offers the extension whose name is the source name', async () => {
    const { backups } = await profile(['demo'], [{ repoId: 3, id: 'other', name: 'Other Site', langs: ['en'] }]);
    const file = join(dir, 'offer2.tachibk');
    writeFileSync(file, gzipSync(mihonBackup()));
    expect((await backups.preview(file)).mihon!.sources[1]!.offer).toEqual({
      repoId: 3,
      extensionId: 'other',
      name: 'Other Site',
    });
  });
});

describe('decoding', () => {
  it('reads the fields Matane keeps and skips the rest', () => {
    const backup = decodeMihon(mihonBackup());
    expect(backup.manga).toHaveLength(3);
    expect(backup.categories).toEqual([
      { name: 'Reading', order: 1 },
      { name: 'Done', order: 2 },
    ]);
    expect(backup.sources.get(SOURCE.toString())).toBe('Demo Site');
    const one = backup.manga[0]!;
    expect(one).toMatchObject({
      source: SOURCE.toString(),
      url: '/manga/one/',
      title: 'One',
      author: 'Author',
      artist: null,
      genres: ['Action', 'Comedy'],
      status: 4,
      favorite: true,
      categories: [1],
    });
    expect(one.chapters.map((c) => c.url)).toEqual(['/one-3/', '/one-2/', '/one-1/']);
    expect(one.chapters[1]).toMatchObject({ read: true, bookmark: true, lastPageRead: 7, sourceOrder: 1 });
    expect(one.history).toHaveLength(3);
  });

  it('refuses bytes that are not protobuf', () => {
    expect(() => decodeMihon(Buffer.from('hello'))).toThrow();
  });
});

describe('importing a Mihon backup', () => {
  it('asks for a source for each source, then imports what has one', async () => {
    const { backups, connection } = await profile();
    const file = join(dir, 'app.mihon.tachibk');
    writeFileSync(file, gzipSync(mihonBackup()));

    const preview = await backups.preview(file);
    expect(preview).toMatchObject({ appVersion: 'Mihon', manga: 3, inLibrary: 2, categories: 2, chaptersRead: 3 });
    expect(preview.mihon?.sources).toEqual([
      { id: SOURCE.toString(), name: 'Demo Site', manga: 2, inLibrary: 1, matchedSourceId: 'demo/en', offer: null },
      { id: '12345', name: 'Other Site', manga: 1, inLibrary: 1, matchedSourceId: null, offer: null },
    ]);

    const result = await backups.restore(file, { mode: 'replace', settings: true });
    // Mihon backups are only merged, whatever was asked for.
    expect(result.safetyBackup).toBeNull();
    expect(result).toMatchObject({
      manga: { added: 2, updated: 0 },
      chapters: { added: 4, updated: 0 },
      categories: 2,
      settings: false,
      failed: [],
      unmatched: [{ name: 'Other Site', manga: 1 }],
    });

    const db = connection.sqlite;
    expect(
      db.prepare('SELECT source_id, title, status, in_library, added_at, genres_json FROM manga ORDER BY id').all(),
    ).toEqual([
      {
        source_id: 'demo/en',
        title: 'One',
        status: 'completed', // 4 = publishing finished
        in_library: 1,
        added_at: 1_700_000_000_000,
        genres_json: '["Action","Comedy"]',
      },
      { source_id: 'demo/en', title: 'Two', status: 'ongoing', in_library: 0, added_at: null, genres_json: '[]' },
    ]);
    expect(
      db
        .prepare(
          'SELECT url, number, source_order, read, read_at, bookmarked, last_page, uploaded_at FROM chapters WHERE manga_id = 1 ORDER BY source_order',
        )
        .all(),
    ).toEqual([
      {
        url: '/one-3/',
        number: 3,
        source_order: 0,
        read: 0,
        read_at: null,
        bookmarked: 0,
        last_page: 0,
        uploaded_at: 3000,
      },
      {
        url: '/one-2/',
        number: 2.1,
        source_order: 1,
        read: 1,
        read_at: 1_700_000_500_000,
        bookmarked: 1,
        last_page: 7,
        uploaded_at: 2000,
      },
      {
        url: '/one-1/',
        number: 1,
        source_order: 2,
        read: 1,
        read_at: 1_700_000_100_000,
        bookmarked: 0,
        last_page: 19,
        uploaded_at: 1000,
      },
    ]);
    expect(db.prepare('SELECT name FROM categories ORDER BY sort_order').all()).toEqual([
      { name: 'Reading' },
      { name: 'Done' },
    ]);
    expect(
      db
        .prepare(
          'SELECT c.name FROM manga_categories mc JOIN categories c ON c.id = mc.category_id WHERE mc.manga_id = 1',
        )
        .all(),
    ).toEqual([{ name: 'Reading' }]);
    // The newest history entry whose chapter is in the backup (the entry for "/gone/" is dropped).
    expect(db.prepare('SELECT chapter_id, read_at FROM history WHERE manga_id = 1').all()).toEqual([
      { chapter_id: 2, read_at: 1_700_000_500_000 },
    ]);
    expect(
      db.prepare('SELECT chapter_id, started_at, ended_at, active_ms FROM reading_sessions ORDER BY chapter_id').all(),
    ).toEqual([
      { chapter_id: 2, started_at: 1_700_000_440_000, ended_at: 1_700_000_500_000, active_ms: 60_000 },
      { chapter_id: 3, started_at: 1_700_000_070_000, ended_at: 1_700_000_100_000, active_ms: 30_000 },
    ]);
  });

  it('imports the same file twice without changing anything', async () => {
    const { backups, connection } = await profile();
    const file = join(dir, 'twice.tachibk');
    writeFileSync(file, gzipSync(mihonBackup()));
    await backups.restore(file, { mode: 'merge', settings: false });
    const again = await backups.restore(file, { mode: 'merge', settings: false });
    expect(again).toMatchObject({ manga: { added: 0, updated: 2 }, chapters: { added: 0, updated: 0 }, categories: 0 });
    const db = connection.sqlite;
    expect((db.prepare('SELECT count(*) AS n FROM chapters').get() as { n: number }).n).toBe(4);
    expect((db.prepare('SELECT count(*) AS n FROM reading_sessions').get() as { n: number }).n).toBe(2);
  });

  it('follows the sources the user picked, and an unpacked file works too', async () => {
    const { backups, connection } = await profile(['demo', 'gone']);
    const file = join(dir, 'raw.proto');
    writeFileSync(file, mihonBackup());
    const result = await backups.restore(file, {
      mode: 'merge',
      settings: false,
      sourceMap: { [SOURCE.toString()]: '', '12345': 'gone/en' }, // skip the matched one, send the other
    });
    expect(result).toMatchObject({ manga: { added: 1 }, unmatched: [{ name: 'Demo Site', manga: 2 }] });
    expect(connection.sqlite.prepare('SELECT source_id, title FROM manga').all()).toEqual([
      { source_id: 'gone/en', title: 'Other' },
    ]);
  });

  it('leaves out manga when the extension of a picked source is not installed', async () => {
    const { backups } = await profile(['demo']);
    const file = join(dir, 'x.tachibk');
    writeFileSync(file, gzipSync(mihonBackup()));
    const result = await backups.restore(file, { mode: 'merge', settings: false, sourceMap: { '12345': 'gone/en' } });
    expect(result.manga.added).toBe(2);
    expect(result.unmatched).toEqual([{ name: 'Other Site', manga: 1 }]);
  });

  it('refuses a file that is neither a Matane nor a Mihon backup', async () => {
    const { backups } = await profile();
    writeFileSync(join(dir, 'junk.tachibk'), gzipSync(Buffer.from('this is not protobuf')));
    await expect(backups.preview(join(dir, 'junk.tachibk'))).rejects.toThrow('not a Matane or Mihon backup');
    writeFileSync(join(dir, 'empty.tachibk'), gzipSync(Buffer.alloc(0)));
    await expect(backups.preview(join(dir, 'empty.tachibk'))).rejects.toThrow('holds no library');
    writeFileSync(join(dir, 'broken.tachibk'), Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 1, 2, 3]));
    await expect(backups.preview(join(dir, 'broken.tachibk'))).rejects.toThrow('cannot be unpacked');
  });
});
