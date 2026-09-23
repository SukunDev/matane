import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';

// A tiny fake manga site for end-to-end tests: JSON API + generated PNG images, on 127.0.0.1.
// The app reaches it as http://e2e.localhost:<port> (Chromium resolves *.localhost to loopback).

export interface SiteManga {
  id: string;
  title: string;
  type: 'manga' | 'manhwa';
  genres: string[];
  status: 'ongoing' | 'completed';
  /** Chapter numbers, oldest first. */
  chapters: number[];
}

const PAGES_PER_CHAPTER = 4;

export const SITE_MANGA: SiteManga[] = [
  { id: 'paged', title: 'Paged Hero', type: 'manga', genres: ['Action'], status: 'ongoing', chapters: [1, 2, 3, 5] },
  { id: 'strip', title: 'Scroll Garden', type: 'manhwa', genres: ['Comedy'], status: 'completed', chapters: [1, 2] },
  // Filler so the listing has a second page.
  ...Array.from({ length: 22 }, (_, i) => ({
    id: `filler-${i}`,
    title: `Filler Title ${i + 1}`,
    type: 'manga' as const,
    genres: [i % 2 ? 'Comedy' : 'Action'],
    status: 'ongoing' as const,
    chapters: [1],
  })),
];

function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export interface Site {
  port: number;
  origin: string;
  /** Requests seen, e.g. to assert an image was served from the app cache. */
  hits: string[];
  close(): Promise<void>;
}

export async function startSite(): Promise<Site> {
  const hits: string[] = [];
  const json = (value: unknown) => ({ type: 'application/json', body: Buffer.from(JSON.stringify(value)) });
  const summary = (m: SiteManga) => ({ id: m.id, title: m.title });

  const route = (url: URL): { type: string; body: Buffer; status?: number } | undefined => {
    const path = url.pathname;
    if (path === '/api/list') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const include = url.searchParams.getAll('include');
      const exclude = url.searchParams.getAll('exclude');
      if (q === 'boom') return { type: 'text/plain', body: Buffer.from('broken'), status: 404 };
      const all = SITE_MANGA.filter(
        (m) =>
          m.title.toLowerCase().includes(q) &&
          include.every((g) => m.genres.includes(g)) &&
          !exclude.some((g) => m.genres.includes(g)),
      );
      const slice = all.slice((page - 1) * 12, page * 12);
      return json({ items: slice.map(summary), more: page * 12 < all.length });
    }
    const manga = /^\/api\/manga\/([\w-]+)$/.exec(path);
    if (manga) {
      const m = SITE_MANGA.find((x) => x.id === manga[1]);
      return m ? json(m) : { type: 'text/plain', body: Buffer.from('no'), status: 404 };
    }
    const cover = /^\/img\/cover\/([\w-]+)\.png$/.exec(path);
    if (cover) return { type: 'image/png', body: png(60, 90, [203, 166, 247]) };
    const page = /^\/img\/page\/([\w-]+)\/(\d+)\/(\d+)\.png$/.exec(path);
    if (page) {
      const index = Number(page[3]);
      // Page 2 of every chapter is a two-page spread (landscape).
      return { type: 'image/png', body: index === 2 ? png(240, 160, [137, 180, 250]) : png(120, 180, [166, 227, 161]) };
    }
    return undefined;
  };

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://e2e.localhost');
    hits.push(url.pathname + url.search);
    const result = route(url);
    if (!result) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(result.status ?? 200, { 'content-type': result.type }).end(result.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    origin: `http://e2e.localhost:${port}`,
    hits,
    // The app keeps connections alive; without dropping them, close() waits for their timeout.
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** The extension under test, written as a ready bundle (manifest.json + index.js). */
export function extensionFiles(origin: string): Record<string, string> {
  const manifest = {
    id: 'e2e-demo',
    name: 'E2E Demo',
    version: '1.0.0',
    apiVersion: 1,
    nsfw: false,
    domains: ['e2e.localhost'],
    sources: [{ key: 'en', lang: 'en', name: 'E2E Demo' }],
  };
  const code = `globalThis.__extension = {
  createSource: () => {
    const base = ${JSON.stringify(origin)};
    const get = async (path) => (await http.get(base + path, { responseType: 'json' })).body;
    const toPage = (data) => ({ items: data.items.map((m) => ({ url: m.id, title: m.title, thumbnailUrl: base + '/img/cover/' + m.id + '.png' })), hasNextPage: data.more });
    return {
      baseUrl: base,
      getPopular: async (page) => toPage(await get('/api/list?page=' + page)),
      getLatest: async (page) => toPage(await get('/api/list?page=' + page)),
      getFilters: () => [{ type: 'group', id: 'genres', label: 'Genres', filters: [
        { type: 'tristate', id: 'genre.Action', label: 'Action' },
        { type: 'tristate', id: 'genre.Comedy', label: 'Comedy' },
      ] }],
      async search(query, page, filters) {
        let path = '/api/list?page=' + page + '&q=' + encodeURIComponent(query);
        for (const [id, value] of Object.entries(filters)) {
          if (value === 'include') path += '&include=' + id.slice(6);
          if (value === 'exclude') path += '&exclude=' + id.slice(6);
        }
        return toPage(await get(path));
      },
      async getMangaDetails(manga) {
        const m = await get('/api/manga/' + manga.url);
        return { url: m.id, title: m.title, thumbnailUrl: base + '/img/cover/' + m.id + '.png', genres: m.genres, status: m.status, type: m.type, author: 'E2E Author', description: 'A manga that only exists in tests.' };
      },
      async getChapters(manga) {
        const m = await get('/api/manga/' + manga.url);
        return m.chapters.slice().reverse().map((n) => ({ url: m.id + '/' + n, name: 'Ch. ' + n, number: n, scanlator: 'Test Scans', uploadedAt: Date.UTC(2026, 0, n) }));
      },
      async getPages(chapter) {
        return [0, 1, 2, 3].slice(0, ${PAGES_PER_CHAPTER}).map((index) => ({ index, imageUrl: base + '/img/page/' + chapter.url + '/' + index + '.png' }));
      },
      resolveUrl: (url) => (url.startsWith(base + '/manga/') ? { url: url.slice(base.length + 7), title: '' } : null),
    };
  },
};`;
  return { 'manifest.json': JSON.stringify(manifest, null, 2), 'index.js': code };
}
