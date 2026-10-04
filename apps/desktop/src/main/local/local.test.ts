import { createWriteStream, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { LOCAL_SOURCE_ID } from '@manga-reader/shared';
import yazl from 'yazl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ExtensionsRepository } from '../db/repositories/extensions';
import { ExtensionRegistry } from '../extensions/registry';
import { ExtensionService } from '../extensions/service';
import { validate } from '../extensions/validate';
import { parseComicInfo, readArchiveComicInfo } from './comicinfo-read';
import { LocalFiles } from './files';
import { safeJoin } from './paths';
import { createLocalExtension } from './source';
import { LocalStore } from './store';

const migrationsFolder = resolve(__dirname, '../../../drizzle');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let root: string;
let outside: string;
let folder: string | null;
let files: LocalFiles;

/** A CBZ with the given entries (name → bytes or text). */
async function cbz(path: string, entries: Record<string, string | Buffer>) {
  const zip = new yazl.ZipFile();
  for (const [name, data] of Object.entries(entries)) zip.addBuffer(Buffer.from(data), name);
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(path));
}

const pages = (...names: string[]) => Object.fromEntries(names.map((n) => [n, JPG]));

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'matane-local-'));
  root = join(base, 'library');
  outside = join(base, 'outside');
  mkdirSync(root);
  mkdirSync(outside);
  folder = root;
  files = new LocalFiles({ folder: () => folder });
});

afterEach(async () => {
  await files.reader.closeAll();
  rmSync(join(root, '..'), { recursive: true, force: true });
});

describe('safeJoin', () => {
  it('resolves names inside the folder', async () => {
    mkdirSync(join(root, 'Manga A'));
    expect(await safeJoin(root, 'Manga A')).toBe(join(realpathSync(root), 'Manga A'));
  });

  it.each(['..', '../outside', 'a/../../outside', '/etc', 'a\\..\\..\\outside', 'x\0y'])(
    'refuses "%s"',
    async (url) => {
      mkdirSync(join(root, 'a'), { recursive: true });
      await expect(safeJoin(root, url)).rejects.toThrow(/not inside|does not exist/);
    },
  );

  it('refuses a symlink that leads outside the folder', async () => {
    symlinkSync(outside, join(root, 'escape'));
    await expect(safeJoin(root, 'escape')).rejects.toThrow(/not inside/);
  });

  it('accepts a symlink that stays inside', async () => {
    mkdirSync(join(root, 'real'));
    symlinkSync(join(root, 'real'), join(root, 'alias'));
    await expect(safeJoin(root, 'alias')).resolves.toMatch(/real$/);
  });
});

describe('ComicInfo', () => {
  it('reads the tags the app shows, with entities and CDATA', () => {
    const info = parseComicInfo(`<?xml version="1.0"?><ComicInfo>
      <Series>Tom &amp; Jerry &#8212; Remix</Series><Writer>A. Writer</Writer><Penciller>B. Artist</Penciller>
      <Summary><![CDATA[Cats <and> mice]]></Summary><Genre>Action, Comedy</Genre><Manga>YesAndRightToLeft</Manga>
    </ComicInfo>`);
    expect(info).toMatchObject({
      series: 'Tom & Jerry — Remix',
      writer: 'A. Writer',
      penciller: 'B. Artist',
      summary: 'Cats <and> mice',
      genres: ['Action', 'Comedy'],
      manga: true,
    });
    expect(parseComicInfo('not xml at all')).toMatchObject({ genres: [], manga: false });
  });

  it('reads the one inside an archive, and nothing from one that is not a zip', async () => {
    await cbz(join(root, 'a.cbz'), { 'ComicInfo.xml': '<ComicInfo><Series>S</Series></ComicInfo>', '1.jpg': JPG });
    expect((await readArchiveComicInfo(join(root, 'a.cbz')))?.series).toBe('S');
    writeFileSync(join(root, 'bad.cbz'), 'nope');
    expect(await readArchiveComicInfo(join(root, 'bad.cbz'))).toBeUndefined();
  });
});

describe('LocalFiles', () => {
  async function layout() {
    mkdirSync(join(root, 'Alpha'));
    await cbz(join(root, 'Alpha', 'Ch 2.cbz'), pages('1.jpg', '2.jpg', '10.jpg'));
    await cbz(join(root, 'Alpha', 'Ch 10.cbz'), pages('1.jpg'));
    mkdirSync(join(root, 'Alpha', 'Ch 1'));
    writeFileSync(join(root, 'Alpha', 'Ch 1', 'p1.png'), JPG);
    writeFileSync(join(root, 'Alpha', 'Ch 1', 'notes.txt'), 'x');
    mkdirSync(join(root, 'Beta One-shot'));
    writeFileSync(join(root, 'Beta One-shot', '001.jpg'), JPG);
    writeFileSync(join(root, 'Beta One-shot', '002.jpg'), JPG);
    mkdirSync(join(root, '.hidden'));
    writeFileSync(join(root, 'loose.cbz'), 'not a manga folder');
  }

  it('lists manga folders by name, skipping hidden folders and loose files', async () => {
    await layout();
    const page = await files.manga('popular', 1);
    expect(page.items.map((m) => m.title)).toEqual(['Alpha', 'Beta One-shot']);
    expect(page.hasNextPage).toBe(false);
    expect(page.items[0]!.thumbnailUrl).toMatch(/^local:cover\/Alpha\?m=\d+$/);
  });

  it('searches by name, and lists 40 manga to a page', async () => {
    await layout();
    expect((await files.manga('search', 1, 'one')).items.map((m) => m.title)).toEqual(['Beta One-shot']);
    for (let i = 0; i < 45; i++) mkdirSync(join(root, `m${String(i).padStart(2, '0')}`));
    const first = await files.manga('popular', 1);
    expect(first.items).toHaveLength(40);
    expect(first.hasNextPage).toBe(true);
    expect((await files.manga('popular', 2)).items).toHaveLength(7);
  });

  it('orders chapters naturally and lists the newest first', async () => {
    await layout();
    const chapters = await files.chapters('Alpha');
    expect(chapters.map((c) => c.name)).toEqual(['Ch 10', 'Ch 2', 'Ch 1']);
    expect(chapters.map((c) => c.url)).toEqual(['Alpha/Ch 10.cbz', 'Alpha/Ch 2.cbz', 'Alpha/Ch 1']);
  });

  it('treats images in the manga folder as one chapter', async () => {
    await layout();
    const chapters = await files.chapters('Beta One-shot');
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.url).toBe('Beta One-shot');
    expect((await files.pages('Beta One-shot')).map((p) => p.index)).toEqual([0, 1]);
  });

  it('reads pages of an archive and of a folder, in natural order', async () => {
    await layout();
    expect((await files.pages('Alpha/Ch 2.cbz')).length).toBe(3);
    expect((await files.readPage('Alpha/Ch 2.cbz', 2)).contentType).toBe('image/jpeg');
    const folderPage = await files.readPage('Alpha/Ch 1', 0);
    expect(folderPage.contentType).toBe('image/png');
    expect(folderPage.bytes.equals(JPG)).toBe(true);
    await expect(files.pages('Alpha/Ch 1')).resolves.toHaveLength(1);
  });

  it('takes details from a ComicInfo.xml next to the chapters, else from the first archive', async () => {
    await layout();
    expect(await files.details('Alpha')).toMatchObject({ title: 'Alpha', status: 'unknown' });
    writeFileSync(
      join(root, 'Alpha', 'ComicInfo.xml'),
      '<ComicInfo><Series>Alpha Prime</Series><Writer>W</Writer><Manga>Yes</Manga></ComicInfo>',
    );
    expect(await files.details('Alpha')).toMatchObject({ title: 'Alpha Prime', author: 'W', type: 'manga' });
    mkdirSync(join(root, 'Gamma'));
    await cbz(join(root, 'Gamma', '1.cbz'), {
      'ComicInfo.xml': '<ComicInfo><Series>From Archive</Series></ComicInfo>',
      ...pages('1.jpg'),
    });
    expect((await files.details('Gamma')).title).toBe('From Archive');
  });

  it('uses cover.jpg, else the first page of the first chapter', async () => {
    await layout();
    expect(Buffer.from((await files.cover('Alpha')).bytes).equals(JPG)).toBe(true);
    writeFileSync(join(root, 'Alpha', 'cover.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(await files.cover('Alpha')).toMatchObject({ contentType: 'image/png' });
    mkdirSync(join(root, 'Empty'));
    await expect(files.cover('Empty')).rejects.toThrow(/no pages/);
  });

  it('never leaves the folder, and skips symlinks that lead out of it', async () => {
    await layout();
    mkdirSync(join(outside, 'Secret'));
    writeFileSync(join(outside, 'Secret', '1.jpg'), JPG);
    symlinkSync(join(outside, 'Secret'), join(root, 'Linked'));
    expect((await files.manga('popular', 1)).items.map((m) => m.title)).not.toContain('Linked');
    await expect(files.chapters('Linked')).rejects.toThrow(/not inside/);
    await expect(files.pages('../outside/Secret')).rejects.toThrow(/not inside/);
    await expect(files.readPage('Alpha/../../outside/Secret', 0)).rejects.toThrow(/not inside/);
  });

  it('asks for a folder first, and says so when it cannot be read', async () => {
    folder = null;
    await expect(files.manga('popular', 1)).rejects.toThrow(/Choose the local folder/);
    folder = join(root, 'missing');
    await expect(files.manga('popular', 1)).rejects.toThrow(/cannot be read/);
  });
});

describe('the local extension', () => {
  let dir: string;
  let connection: DatabaseConnection;
  let extensions: ExtensionService;
  let hostCalls: string[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'matane-local-ext-'));
    hostCalls = [];
    connection = openDatabase(join(dir, 'data.db'));
    await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
    const repo = new ExtensionsRepository(connection.db, new DbChanges(() => undefined));
    const local = createLocalExtension(files, '1.2.3');
    extensions = new ExtensionService({
      registry: new ExtensionRegistry({ builtinDir: join(dir, 'none'), devFolders: () => [], native: [local.entry] }),
      repo,
      host: { request: (async (method: string) => void hostCalls.push(method)) as never },
      network: { request: async () => ({}) as never, invalidate: () => undefined, isSolving: () => false },
      devFolders: { get: () => [], set: () => undefined },
      log: () => undefined,
      native: [local],
    });
    await extensions.init();
  });

  afterEach(() => {
    connection.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('shows up as a built-in extension with one source that suits every language', () => {
    expect(extensions.list()).toEqual([
      expect.objectContaining({
        id: 'local',
        origin: 'builtin',
        version: '1.2.3',
        error: null,
        sourceIds: [LOCAL_SOURCE_ID],
      }),
    ]);
    expect(extensions.list()[0]!.langs).toEqual(['all']);
    expect(extensions.isInstalled('local')).toBe(true);
  });

  it('answers calls itself, without the sandbox', async () => {
    mkdirSync(join(root, 'Alpha'));
    await cbz(join(root, 'Alpha', 'Ch 1.cbz'), pages('1.jpg'));
    expect(await extensions.call('local', 'files', '__info')).toEqual({
      baseUrl: 'local:',
      capabilities: ['getLatest'],
    });
    expect(await extensions.call('local', '', '__preferences')).toEqual([]);
    const popular = await extensions.call<{ items: { url: string }[] }>('local', 'files', 'getPopular', [1]);
    expect(popular.items.map((m) => m.url)).toEqual(['Alpha']);
    const [chapter] = await extensions.call<{ url: string }[]>('local', 'files', 'getChapters', [
      { url: 'Alpha', title: 'Alpha' },
    ]);
    expect(await extensions.call('local', 'files', 'getPages', [chapter])).toEqual([{ index: 0, url: 'local:1.jpg' }]);
    await expect(extensions.call('local', 'files', 'getImageUrl', [{}])).rejects.toThrow(/does not implement/);
    expect(hostCalls).toEqual([]);
  });

  it('cannot be replaced by a bundle with the same id, and has no image transform or url migration', async () => {
    await expect(extensions.transformImage('local', 'files', { index: 0 }, new Uint8Array())).rejects.toThrow(
      /no image transform/,
    );
    expect(await extensions.migrateUrls('local', 'files', [{ url: 'a', kind: 'manga' }], '0.0.1')).toEqual({
      urls: [null],
      errors: [],
    });
    expect(hostCalls).toEqual([]);
  });
});

describe('LocalStore', () => {
  const chapters = {
    get: (id: number) =>
      id === 1
        ? { id: 1, mangaId: 10, url: 'Alpha/Ch 1.cbz' }
        : id === 2
          ? { id: 2, mangaId: 20, url: 'x/y' }
          : undefined,
  };
  const manga = { get: (id: number) => ({ id, sourceId: id === 10 ? LOCAL_SOURCE_ID : 'other/en' }) };

  it('serves pages and covers of local chapters only', async () => {
    mkdirSync(join(root, 'Alpha'));
    await cbz(join(root, 'Alpha', 'Ch 1.cbz'), pages('1.jpg', '2.jpg'));
    const store = new LocalStore({ files, chapters: chapters as never, manga: manga as never });
    expect(await store.pages(1)).toHaveLength(2);
    expect((await store.page(1, 1))?.contentType).toBe('image/jpeg');
    // Another source's chapter, an unknown one, and a missing page are not the store's to answer.
    expect(await store.pages(2)).toBeUndefined();
    expect(await store.pages(99)).toBeUndefined();
    expect(await store.page(1, 5)).toBeUndefined();
    expect(Buffer.from((await store.cover('local:cover/Alpha?m=1')).bytes).equals(JPG)).toBe(true);
    await expect(store.cover('https://example.org/cover.jpg')).rejects.toThrow(/not a local cover/);
  });
});

describe('cover urls', () => {
  it('keeps local covers, and still drops other schemes', () => {
    const page = validate.mangaPage({
      items: [
        { url: 'a', title: 'A', thumbnailUrl: 'local:cover/a?m=1' },
        { url: 'b', title: 'B', thumbnailUrl: 'file:///etc/passwd' },
        { url: 'c', title: 'C', thumbnailUrl: 'https://example.org/c.jpg' },
      ],
      hasNextPage: false,
    });
    expect(page.items.map((i) => i.thumbnailUrl)).toEqual([
      'local:cover/a?m=1',
      undefined,
      'https://example.org/c.jpg',
    ]);
  });
});
