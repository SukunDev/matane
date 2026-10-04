import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { createCipheriv } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { buildRepo } from '@matane/extension-cli';

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
  /** Scanlator groups per chapter number (default: "Test Scans"); several = several versions. */
  groups?: Record<number, string[]>;
  /** Only found by searching its exact title (keeps listings and counts as they were). */
  unlisted?: boolean;
}

const PAGES_PER_CHAPTER = 4;

export const SITE_MANGA: SiteManga[] = [
  { id: 'paged', title: 'Paged Hero', type: 'manga', genres: ['Action'], status: 'ongoing', chapters: [1, 2, 3, 5] },
  { id: 'strip', title: 'Scroll Garden', type: 'manhwa', genres: ['Comedy'], status: 'completed', chapters: [1, 2] },
  // Several scanlator versions: 1 by Alpha, 2 by Alpha and Beta, 3 by Beta, 4 by Alpha and Beta.
  {
    id: 'twin',
    title: 'Twin Scans',
    type: 'manga',
    genres: ['Drama'],
    status: 'ongoing',
    chapters: [1, 2, 3, 4],
    groups: { 1: ['Alpha'], 2: ['Alpha', 'Beta'], 3: ['Beta'], 4: ['Alpha', 'Beta'] },
  },
  // Reader image processing (Milestone 5a): page 1 has white margins, page 2 is a 12000 px strip.
  {
    id: 'tall',
    title: 'Long Strip',
    type: 'manhwa',
    genres: ['Drama'],
    status: 'ongoing',
    chapters: [1],
    unlisted: true,
  },
  // Filler so the listing has a second page (24 manga in total).
  ...Array.from({ length: 21 }, (_, i) => ({
    id: `filler-${i}`,
    title: `Filler Title ${i + 1}`,
    type: 'manga' as const,
    genres: [i % 2 ? 'Comedy' : 'Action'],
    status: 'ongoing' as const,
    chapters: [1],
  })),
];

type Rgb = [number, number, number];

const tallPages: Buffer[] = [];
/**
 * "Long Strip" pages: 0 is 200×300 white with a 100×200 picture at (40, 50) (crop borders), 1 is a
 * 100×12000 strip in three coloured bands of 4000 px (cut into three segments).
 */
function tallPage(index: number): Buffer {
  const bands: Rgb[] = [
    [243, 139, 168],
    [166, 227, 161],
    [137, 180, 250],
  ];
  tallPages[index] ??=
    index === 0
      ? png(200, 300, (x, y) => (x >= 40 && x < 140 && y >= 50 && y < 250 ? [137, 180, 250] : [255, 255, 255]))
      : png(100, 12_000, (_x, y) => bands[Math.floor(y / 4000)]!);
  return tallPages[index]!;
}

function png(width: number, height: number, rgb: Rgb | ((x: number, y: number) => Rgb)): Buffer {
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
  const color = typeof rgb === 'function' ? rgb : () => rgb;
  const raw = Buffer.concat(
    Array.from({ length: height }, (_, y) => {
      const row = Buffer.alloc(1 + width * 3);
      for (let x = 0; x < width; x++) row.set(color(x, y), 1 + x * 3);
      return row;
    }),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Quadrant colours of a restored "secure" page: top-left, top-right, bottom-left, bottom-right. */
export const QUADRANTS: Record<'tl' | 'tr' | 'bl' | 'br', Rgb> = {
  tl: [243, 139, 168],
  tr: [166, 227, 161],
  bl: [137, 180, 250],
  br: [249, 226, 175],
};
const SECURE_SIZE = { width: 120, height: 180 };
/** AES-128-CBC key and iv of the "aes" pages (the extension knows them too). */
export const SECURE_KEY = 'matane-e2e-key16';
export const SECURE_IV = 'matane-e2e-iv-16';

/** The four quadrants; `scrambled` swaps them diagonally (what the extension undoes with tiles). */
function quadrants(scrambled: boolean): Buffer {
  const { width, height } = SECURE_SIZE;
  return png(width, height, (x, y) => {
    const right = x >= width / 2;
    const bottom = y >= height / 2;
    const key = `${bottom !== scrambled ? 'b' : 't'}${right !== scrambled ? 'r' : 'l'}` as keyof typeof QUADRANTS;
    return QUADRANTS[key];
  });
}

/** How page `index` of the "secure" extension is protected. */
export const SECURE_MODES = ['xor', 'tiles', 'aes-tiles', 'plain'] as const;

function securePage(mode: (typeof SECURE_MODES)[number]): Buffer {
  if (mode === 'plain') return quadrants(false);
  if (mode === 'xor') return Buffer.from(quadrants(false).map((b) => b ^ 0x5a));
  if (mode === 'tiles') return quadrants(true);
  const cipher = createCipheriv('aes-128-cbc', Buffer.from(SECURE_KEY), Buffer.from(SECURE_IV));
  return Buffer.concat([cipher.update(quadrants(true)), cipher.final()]);
}

export interface Site {
  port: number;
  origin: string;
  /** Requests seen, e.g. to assert an image was served from the app cache. */
  hits: string[];
  /** User-Agent of each request, in order (Settings → Network). */
  userAgents: string[];
  /** Page images answer this much later (downloads in progress, pause/cancel). */
  pageDelayMs: number;
  /** Page images fail with HTTP 404 (a download error that is not retried). */
  failPages: boolean;
  /** The whole site is unreachable (connections are dropped). */
  down: boolean;
  /** Manga ids whose details fail with HTTP 503 (an update check error for one manga). */
  failManga: Set<string>;
  /** Publishes a new chapter (update checks find it). */
  addChapter(mangaId: string, number: number): void;
  /**
   * Builds an extension repository with `mr-ext repo build` and serves it at `<origin>/<path>/`;
   * returns its folder (tests may tamper with the files).
   */
  publishRepo(options: RepoOptions): Promise<string>;
  close(): Promise<void>;
}

export interface RepoOptions {
  path: string;
  name: string;
  /** Signing key (PEM); null publishes an unsigned repository. */
  privateKeyPem: string | null;
  extensions: { which: SiteExtension; version: string; description?: string }[];
}

export async function startSite(): Promise<Site> {
  const hits: string[] = [];
  const userAgents: string[] = [];
  const scratch = mkdtempSync(join(tmpdir(), 'matane-site-'));
  /** Served repository folders by URL path prefix. */
  const repos = new Map<string, string>();
  // A copy per site, so chapters added by one test don't leak into another.
  const catalogue: SiteManga[] = structuredClone(SITE_MANGA);
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
      // The "E2E Broken" source: every search fails.
      if (url.searchParams.get('lang') === 'broken' && q) {
        return { type: 'text/plain', body: Buffer.from('down'), status: 503 };
      }
      const all = catalogue.filter(
        (m) =>
          (m.unlisted ? m.title.toLowerCase() === q : m.title.toLowerCase().includes(q)) &&
          include.every((g) => m.genres.includes(g)) &&
          !exclude.some((g) => m.genres.includes(g)),
      );
      const slice = all.slice((page - 1) * 12, page * 12);
      return json({ items: slice.map(summary), more: page * 12 < all.length });
    }
    const manga = /^\/api\/manga\/([\w-]+)$/.exec(path);
    if (manga) {
      if (site.failManga.has(manga[1]!)) return { type: 'text/plain', body: Buffer.from('down'), status: 503 };
      const m = catalogue.find((x) => x.id === manga[1]);
      if (!m) return { type: 'text/plain', body: Buffer.from('no'), status: 404 };
      // The Indonesian mirror has only chapters up to 3 (migration: later ones can't be matched).
      return json(url.searchParams.get('lang') === 'id' ? { ...m, chapters: m.chapters.filter((n) => n <= 3) } : m);
    }
    const cover = /^\/img\/cover\/([\w-]+)\.png$/.exec(path);
    if (cover) return { type: 'image/png', body: png(60, 90, [203, 166, 247]) };
    const page = /^\/img\/page\/([\w-]+)\/([\d-]+)\/(\d+)\.png$/.exec(path);
    if (page) {
      const index = Number(page[3]);
      if (page[1] === 'tall' && index < 2) return { type: 'image/png', body: tallPage(index) };
      // Page 2 of every chapter is a two-page spread (landscape).
      return { type: 'image/png', body: index === 2 ? png(240, 160, [137, 180, 250]) : png(120, 180, [166, 227, 161]) };
    }
    // Protected pages of the "secure" extension; encrypted ones are not even labelled as images.
    const secure = /^\/img\/secure\/([\w-]+)\/[\w/-]+\/\d+\.png$/.exec(path);
    if (secure && (SECURE_MODES as readonly string[]).includes(secure[1]!)) {
      const mode = secure[1] as (typeof SECURE_MODES)[number];
      const encrypted = mode === 'xor' || mode === 'aes-tiles';
      return { type: encrypted ? 'application/octet-stream' : 'image/png', body: securePage(mode) };
    }
    return undefined;
  };

  const site: Site = {
    port: 0,
    origin: '',
    hits,
    userAgents,
    pageDelayMs: 0,
    failPages: false,
    failManga: new Set(),
    down: false,
    addChapter: (mangaId, number) => catalogue.find((m) => m.id === mangaId)!.chapters.push(number),
    publishRepo: async (options) => {
      const sources = options.extensions.map((ext, i) => {
        const dir = join(scratch, `src-${options.path}-${Date.now()}-${i}`);
        mkdirSync(dir);
        const files = extensionFiles(site.origin, ext.which, {
          version: ext.version,
          description: ext.description,
        });
        for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
        writeFileSync(join(dir, 'icon.png'), png(48, 48, [250, 179, 135]));
        return dir;
      });
      const out = repos.get(options.path) ?? join(scratch, `repo-${options.path}`);
      await buildRepo({
        extensions: sources,
        outDir: out,
        name: options.name,
        privateKeyPem: options.privateKeyPem ?? undefined,
      });
      repos.set(options.path, out);
      return out;
    },
    // The app keeps connections alive; without dropping them, close() waits for their timeout.
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        rmSync(scratch, { recursive: true, force: true });
      }),
  };
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://e2e.localhost');
    hits.push(url.pathname + url.search);
    userAgents.push(request.headers['user-agent'] ?? '');
    if (site.down) {
      response.destroy();
      return;
    }
    const [, prefix, ...rest] = url.pathname.split('/');
    const repo = prefix ? repos.get(prefix) : undefined;
    if (repo) {
      const file = normalize(join(repo, ...rest));
      if (!file.startsWith(repo) || !existsSync(file) || rest.length === 0) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/octet-stream' }).end(readFileSync(file));
      return;
    }
    const isPage = url.pathname.startsWith('/img/page/');
    const result = isPage && site.failPages ? undefined : route(url);
    if (!result) {
      response.writeHead(404).end();
      return;
    }
    const send = () => response.writeHead(result.status ?? 200, { 'content-type': result.type }).end(result.body);
    if (isPage && site.pageDelayMs > 0) setTimeout(send, site.pageDelayMs);
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  site.port = port;
  site.origin = `http://e2e.localhost:${port}`;
  return site;
}

const EXTENSIONS = {
  demo: {
    id: 'e2e-demo',
    name: 'E2E Demo',
    sources: [
      { key: 'en', lang: 'en', name: 'E2E Demo' },
      // Searches always fail: global search must go on without it.
      { key: 'broken', lang: 'en', name: 'E2E Broken' },
    ],
  },
  // A second extension on the same site: same catalogue in Indonesian, chapters only up to 3.
  // Global search and migration work across extensions with it.
  mirror: { id: 'e2e-mirror', name: 'E2E Mirror', sources: [{ key: 'id', lang: 'id', name: 'E2E Mirror' }] },
  // Adult content: hidden until Settings → Browse & extensions allows it. Its requests say lang=nsfw.
  adult: { id: 'e2e-adult', name: 'E2E Adult', nsfw: true, sources: [{ key: 'nsfw', lang: 'en', name: 'E2E Adult' }] },
  // Protected images (docs/BRAINSTORM.md §5.6): page i is SECURE_MODES[i]; transformImage restores them.
  secure: { id: 'e2e-secure', name: 'E2E Secure', sources: [{ key: 'en', lang: 'en', name: 'E2E Secure' }] },
} as const;
export type SiteExtension = keyof typeof EXTENSIONS;

// Undoes SECURE_MODES: XOR 0x5a, AES-128-CBC (host crypto), and a diagonal swap of the quadrants
// (the size comes from the PNG header, as a real extension would read it).
const SECURE_TRANSFORM = `
      transformImage(page, bytes) {
        const mode = page.imageUrl.split('/img/secure/')[1].split('/')[0];
        if (mode === 'plain') return {};
        let data = bytes;
        if (mode === 'xor') {
          data = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) data[i] = bytes[i] ^ 0x5a;
          return { bytes: data };
        }
        if (mode === 'aes-tiles') {
          data = crypto.aesDecrypt(bytes, ${JSON.stringify(SECURE_KEY)}, { mode: 'cbc', iv: ${JSON.stringify(SECURE_IV)} });
        }
        const view = new DataView(data.buffer, data.byteOffset);
        const width = view.getUint32(16);
        const height = view.getUint32(20);
        const w = width / 2, h = height / 2;
        const ops = [
          { sx: 0, sy: 0, w, h, dx: w, dy: h },
          { sx: w, sy: h, w, h, dx: 0, dy: 0 },
          { sx: w, sy: 0, w, h, dx: 0, dy: h },
          { sx: 0, sy: h, w, h, dx: w, dy: 0 },
        ];
        return mode === 'aes-tiles' ? { bytes: data, tiles: { width, height, ops } } : { tiles: { width, height, ops } };
      },`;

/** An extension under test, written as a ready bundle (manifest.json + index.js). */
export function extensionFiles(
  origin: string,
  which: SiteExtension = 'demo',
  overrides: {
    version?: string;
    description?: string;
    /** v2 stores manga as "m:<id>" and chapters as "c:<id>/<n>", and migrates v1 urls. */
    urlScheme?: 'v1' | 'v2';
  } = {},
): Record<string, string> {
  const v2 = overrides.urlScheme === 'v2';
  const manifest = {
    ...EXTENSIONS[which],
    version: overrides.version ?? '1.0.0',
    apiVersion: 1,
    ...(overrides.description ? { description: overrides.description } : {}),
    nsfw: 'nsfw' in EXTENSIONS[which],
  };
  const code = `globalThis.__extension = {
  createSource: ({ key }) => {
    const base = ${JSON.stringify(origin)};
    const get = async (path) =>
      (await http.get(base + path + (path.includes('?') ? '&' : '?') + 'lang=' + key, { responseType: 'json' })).body;
    const M = ${JSON.stringify(v2 ? 'm:' : '')};
    const C = ${JSON.stringify(v2 ? 'c:' : '')};
    const strip = (url, prefix) => (url.startsWith(prefix) ? url.slice(prefix.length) : url);
    const toPage = (data) => ({ items: data.items.map((m) => ({ url: M + m.id, title: m.title, thumbnailUrl: base + '/img/cover/' + m.id + '.png' })), hasNextPage: data.more });
    return {
      baseUrl: base,
      getPopular: async (page) => {
        log.info('popular page ' + page);
        return toPage(await get('/api/list?page=' + page));
      },
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
        const m = await get('/api/manga/' + strip(manga.url, M));
        return { url: M + m.id, title: m.title, thumbnailUrl: base + '/img/cover/' + m.id + '.png', genres: m.genres, status: m.status, type: m.type, author: 'E2E Author', description: 'A manga that only exists in tests.' };
      },
      async getChapters(manga) {
        const m = await get('/api/manga/' + strip(manga.url, M));
        // Newest first; versions of one number: the later group uploaded a day later.
        return m.chapters.slice().reverse().flatMap((n) => (m.groups?.[n] ?? ['Test Scans']).map((group, v) => ({ url: C + m.id + '/' + n + (v ? '-' + v : ''), name: 'Ch. ' + n, number: n, scanlator: group, uploadedAt: Date.UTC(2026, 0, n + v) })).reverse());
      },
      async getPages(chapter) {
        return [0, 1, 2, 3].slice(0, ${PAGES_PER_CHAPTER}).map((index) => ({ index, imageUrl: ${
          which === 'secure'
            ? `base + '/img/secure/' + ${JSON.stringify(SECURE_MODES)}[index] + '/' + strip(chapter.url, C) + '/' + index + '.png'`
            : `base + '/img/page/' + strip(chapter.url, C) + '/' + index + '.png'`
        } }));
      },
      resolveUrl: (url) => (url.startsWith(base + '/manga/') ? { url: M + url.slice(base.length + 7), title: '' } : null),${
        v2
          ? `
      migrateUrl(url, kind, fromVersion) {
        if (!fromVersion.startsWith('1.')) return null;
        return (kind === 'manga' ? M : C) + url;
      },`
          : ''
      }${which === 'secure' ? SECURE_TRANSFORM : ''}
    };
  },
};`;
  return { 'manifest.json': JSON.stringify(manifest, null, 2), 'index.js': code };
}
