import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { HttpRequest, HttpResponse } from '@matane/extension-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ExtensionHost } from '../../extension-host/host';
import type { HostMethods, MainMethods } from '../../extension-host/protocol';
import { type RpcMessage, RpcPeer, type RpcTransport } from '../../extension-host/rpc';
import { DbChanges } from '../db/changes';
import { type DatabaseConnection, openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { ChaptersRepository } from '../db/repositories/chapters';
import { ExtensionsRepository } from '../db/repositories/extensions';
import { MangaRepository } from '../db/repositories/manga';
import { ExtensionRegistry } from './registry';
import { ExtensionService } from './service';
import { SourceService } from './sources';

const migrationsFolder = resolve(__dirname, '../../../drizzle');

const manifest = (version = '1.0.0') => ({
  id: 'demo',
  name: 'Demo',
  version,
  apiVersion: 1,
  domains: ['example.com'],
  sources: [{ key: 'en', lang: 'en', name: 'Demo' }],
});

// Chapter list and page count are driven by what the fake site returns.
const CODE = `globalThis.__extension = {
  preferences: () => [{ type: 'switch', key: 'hd', label: 'HD', default: false }],
  createSource: () => ({
    baseUrl: 'https://example.com',
    async getPopular(page) {
      const res = await http.get('https://example.com/popular?page=' + page, { responseType: 'json' });
      await storage.set('visits', ((await storage.get('visits')) || 0) + 1);
      return res.body;
    },
    async search(query) {
      if (query === 'broken') return { items: [{ title: 'no url' }], hasNextPage: false };
      if (query === 'slow') { await timers.sleep(2000); }
      return { items: [{ url: '/s', title: 'Found ' + query }], hasNextPage: false };
    },
    async getMangaDetails(manga) {
      return { url: manga.url, title: 'Details of ' + manga.url, status: 'ongoing', genres: ['Action'], author: 'Someone' };
    },
    async getChapters(manga) {
      const res = await http.get('https://example.com/chapters' + manga.url, { responseType: 'json' });
      return res.body;
    },
    async getPages(chapter) {
      return [0, 1, 2].map((index) => ({ index, imageUrl: 'https://example.com/' + chapter.url + '/' + index + '.jpg' + (prefs.get('hd') ? '?hd' : '') }));
    },
    resolveUrl(url) {
      const m = /^https:\\/\\/example\\.com\\/manga(\\/.+)$/.exec(url);
      return m ? { url: m[1], title: '' } : null;
    },
  }),
};`;

const transport = (port: MessagePort): RpcTransport => ({
  send: (message) => port.postMessage(message),
  listen: (handler) => {
    const listener = (message: RpcMessage) => handler(message);
    port.on('message', listener);
    return () => port.off('message', listener);
  },
});

let dir: string;
let connection: DatabaseConnection;
let ports: MessagePort[];
let site: Record<string, unknown>;
let requests: HttpRequest[];
let devFolders: string[];
let recorded: string[];
let extensions: ExtensionService;
let sources: SourceService;
let extensionsRepo: ExtensionsRepository;
let chaptersRepo: ChaptersRepository;

function writeExtension(folder: string, code = CODE, version = '1.0.0') {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'manifest.json'), JSON.stringify(manifest(version)));
  writeFileSync(join(folder, 'index.js'), code);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'matane-ext-'));
  writeExtension(join(dir, 'builtin', 'demo'));
  connection = openDatabase(join(dir, 'data.db'));
  await runMigrations(connection, { migrationsFolder, backupDir: join(dir, 'backups') });
  const changes = new DbChanges(() => undefined);
  extensionsRepo = new ExtensionsRepository(connection.db, changes);
  const mangaRepo = new MangaRepository(connection.db, changes);
  chaptersRepo = new ChaptersRepository(connection.db, changes);

  site = {
    'https://example.com/popular?page=1': {
      items: [
        { url: '/a', title: 'A', thumbnailUrl: 'https://example.com/a.jpg' },
        { url: '/b', title: 'B' },
      ],
      hasNextPage: true,
    },
    'https://example.com/chapters/a': [
      { url: 'a-2', name: 'Ch. 2', number: 2 },
      { url: 'a-1', name: 'Ch. 1', number: 1 },
    ],
  };
  requests = [];
  devFolders = [];
  recorded = [];

  const { port1, port2 } = new MessageChannel();
  ports = [port1, port2];
  const registry = new ExtensionRegistry({ builtinDir: join(dir, 'builtin'), devFolders: () => devFolders });
  // The peers need the service/host handlers and vice versa; the closures bind late.
  const mainPeer: RpcPeer<MainMethods, HostMethods> = new RpcPeer(transport(port1), {
    getExtension: (p) => service.mainHandlers.getExtension(p),
    http: (p) => service.mainHandlers.http(p),
    storage: (p) => service.mainHandlers.storage(p),
    log: (p) => service.mainHandlers.log(p),
  });
  const hostPeer: RpcPeer<HostMethods, MainMethods> = new RpcPeer(transport(port2), {
    call: (p) => host.handlers.call(p),
    transformImage: (p) => host.handlers.transformImage(p),
    migrateUrls: (p) => host.handlers.migrateUrls(p),
    unload: (p) => host.handlers.unload(p),
    stats: (p) => host.handlers.stats(p),
  });
  const host: ExtensionHost = new ExtensionHost(hostPeer, { appName: 'Test', appVersion: '1' });

  const service: ExtensionService = new ExtensionService({
    registry,
    repo: extensionsRepo,
    host: mainPeer,
    network: {
      request: async (_manifest, request): Promise<HttpResponse> => {
        requests.push(request);
        const body = site[request.url];
        return body === undefined
          ? { status: 404, url: request.url, headers: {}, body: null }
          : { status: 200, url: request.url, headers: {}, body };
      },
      invalidate: () => undefined,
      isSolving: () => false,
    },
    devFolders: { get: () => devFolders, set: (folders) => (devFolders = folders) },
    log: () => undefined,
    record: (extensionId, level, kind, message) => recorded.push(`${extensionId} ${level} ${kind} ${message}`),
  });
  extensions = service;
  sources = new SourceService({ extensions, extensionsRepo, manga: mangaRepo, chapters: chaptersRepo });
  await extensions.init();
});

afterEach(() => {
  for (const port of ports) port.close();
  connection.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ExtensionService', () => {
  it('registers built-in extensions and their sources', () => {
    expect(extensions.list()).toEqual([
      expect.objectContaining({ id: 'demo', version: '1.0.0', origin: 'builtin', error: null, sourceIds: ['demo/en'] }),
    ]);
    expect(sources.list()).toEqual([expect.objectContaining({ id: 'demo/en', installed: true, lang: 'en' })]);
  });

  it('lets a dev folder override the built-in and reports broken folders', async () => {
    writeExtension(join(dir, 'dev'), CODE, '1.1.0-dev');
    const entry = await extensions.addDevFolder(join(dir, 'dev'));
    expect(entry).toMatchObject({ origin: 'dev', version: '1.1.0-dev' });
    expect(extensionsRepo.get('demo')?.version).toBe('1.1.0-dev');

    // An unbuilt folder stays registered with its error, so building it later hot-reloads it.
    mkdirSync(join(dir, 'empty'));
    await expect(extensions.addDevFolder(join(dir, 'empty'))).resolves.toMatchObject({
      id: 'empty',
      error: expect.stringMatching(/mr-ext build/),
    });

    await extensions.removeDevFolder(join(dir, 'dev'));
    await extensions.removeDevFolder(join(dir, 'empty'));
    expect(extensions.list()).toEqual([expect.objectContaining({ origin: 'builtin', version: '1.0.0' })]);
  });

  it('exposes preferences with stored values over defaults', async () => {
    await expect(extensions.preferences('demo')).resolves.toMatchObject({ values: { hd: false } });
    extensions.setPreference('demo', 'hd', true);
    await expect(extensions.preferences('demo')).resolves.toMatchObject({ values: { hd: true } });
  });
});

describe('SourceService', () => {
  it('refuses to browse an adult source while adult content is hidden, and records calls in the log', async () => {
    const folder = join(dir, 'builtin', 'demo');
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ ...manifest(), nsfw: true }));
    await extensions.reload('demo');
    let showNsfw = false;
    const guarded = new SourceService({
      extensions,
      extensionsRepo,
      manga: new MangaRepository(connection.db, new DbChanges(() => undefined)),
      chapters: chaptersRepo,
      showNsfw: () => showNsfw,
    });
    expect(guarded.list()).toEqual([expect.objectContaining({ id: 'demo/en', nsfw: true })]);
    await expect(guarded.browse({ sourceId: 'demo/en', kind: 'popular', page: 1 })).rejects.toMatchObject({
      code: 'nsfw_hidden',
    });
    await expect(guarded.resolveUrl('https://example.com/manga/x')).resolves.toBeNull();
    showNsfw = true;
    await expect(guarded.browse({ sourceId: 'demo/en', kind: 'popular', page: 1 })).resolves.toMatchObject({
      hasNextPage: true,
    });
    expect(
      recorded.filter((line) => line.startsWith('demo debug http GET https://example.com/popular?page=1 → 200')),
    ).toHaveLength(1);
    await guarded.browse({ sourceId: 'demo/en', kind: 'search', page: 1, query: 'broken' }).catch(() => undefined);
    expect(recorded).toContainEqual(expect.stringMatching(/^demo error call search \(en\): /));
  });

  it('browses, stores manga rows and persists extension storage', async () => {
    const result = await sources.browse({ sourceId: 'demo/en', kind: 'popular', page: 1 });
    expect(result.hasNextPage).toBe(true);
    expect(result.items.map((i) => [i.url, i.title, i.inLibrary])).toEqual([
      ['/a', 'A', false],
      ['/b', 'B', false],
    ]);
    expect(sources.getManga(result.items[0]!.mangaId)).toMatchObject({ title: 'A', lastFetchedAt: null });
    expect(extensionsRepo.getStorage('demo', 'visits')).toBe(1);
    expect(extensionsRepo.getSource('demo/en')?.lastUsedAt).not.toBeNull();

    // Same manga again → same ids.
    const again = await sources.browse({ sourceId: 'demo/en', kind: 'popular', page: 1 });
    expect(again.items.map((i) => i.mangaId)).toEqual(result.items.map((i) => i.mangaId));
    expect(extensionsRepo.getStorage('demo', 'visits')).toBe(2);
  });

  it('refreshes details and syncs chapters', async () => {
    const [a] = (await sources.browse({ sourceId: 'demo/en', kind: 'popular', page: 1 })).items;
    const first = await sources.refreshManga(a!.mangaId);
    expect(first.manga).toMatchObject({ title: 'Details of /a', status: 'ongoing', genres: ['Action'] });
    expect(first.newChapterIds).toHaveLength(2);

    // a-1 is bookmarked, so it stays (flagged) when the source drops it.
    chaptersRepo.setBookmarked([chaptersRepo.list(a!.mangaId).find((c) => c.url === 'a-1')!.id], true);
    site['https://example.com/chapters/a'] = [
      { url: 'a-3', name: 'Ch. 3', number: 3 },
      { url: 'a-2', name: 'Ch. 2', number: 2 },
    ];
    const second = await sources.refreshManga(a!.mangaId);
    expect(second.newChapterIds).toHaveLength(1);
    expect(chaptersRepo.list(a!.mangaId).map((c) => [c.url, c.sourceMissing])).toEqual([
      ['a-3', false],
      ['a-2', false],
      ['a-1', true],
    ]);
  });

  it('caches page lists and applies preferences', async () => {
    const [a] = (await sources.browse({ sourceId: 'demo/en', kind: 'popular', page: 1 })).items;
    const { newChapterIds } = await sources.refreshManga(a!.mangaId);
    extensions.setPreference('demo', 'hd', true);
    const first = await sources.pages(newChapterIds[0]!);
    expect(first).toMatchObject({ fromCache: false });
    expect(first.pages[0]?.imageUrl).toBe('https://example.com/a-2/0.jpg?hd');
    await expect(sources.pages(newChapterIds[0]!)).resolves.toMatchObject({ fromCache: true });
  });

  it('resolves pasted URLs to manga rows', async () => {
    const resolved = await sources.resolveUrl('https://example.com/manga/xyz');
    expect(resolved).toMatchObject({ sourceId: 'demo/en' });
    expect(sources.getManga(resolved!.mangaId)).toMatchObject({ url: '/xyz' });
    await expect(sources.resolveUrl('https://other.com/manga/xyz')).resolves.toBeNull();
  });

  it('rejects invalid extension output with a parse error', async () => {
    await expect(
      sources.browse({ sourceId: 'demo/en', kind: 'search', page: 1, query: 'broken' }),
    ).rejects.toMatchObject({
      code: 'parse',
      message: expect.stringMatching(/items\.0\.url/),
    });
  });

  it('maps extension failures and missing capabilities to codes', async () => {
    delete site['https://example.com/popular?page=1'];
    await expect(sources.browse({ sourceId: 'demo/en', kind: 'popular', page: 1 })).rejects.toMatchObject({
      code: 'http',
      status: 404,
    });
    await expect(sources.browse({ sourceId: 'demo/en', kind: 'latest', page: 1 })).rejects.toMatchObject({
      code: 'not_implemented',
    });
    await expect(sources.browse({ sourceId: 'nope/en', kind: 'popular', page: 1 })).rejects.toMatchObject({
      code: 'not_installed',
    });
    await expect(sources.info('demo/en')).resolves.toEqual({
      baseUrl: 'https://example.com',
      capabilities: ['resolveUrl'],
    });
  });

  it('cancels a call when its signal aborts', async () => {
    const controller = new AbortController();
    const pending = sources.browse({ sourceId: 'demo/en', kind: 'search', page: 1, query: 'slow' }, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });
});
