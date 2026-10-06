import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeMuItem {
  list_id: number;
  chapter: number | null;
}

export interface FakeMangaUpdates {
  api: string;
  /** The user's lists: series id → list and chapter. */
  items: Map<number, FakeMuItem>;
  ratings: Map<number, number>;
  /** Every request received that changes something, in order. */
  writes: string[];
  close: () => Promise<void>;
}

const SERIES = [
  {
    series_id: 123,
    title: 'Paged Hero',
    url: 'https://www.mangaupdates.com/series/abc/paged-hero',
    type: 'Manga',
    year: '2019',
  },
  {
    series_id: 124,
    title: 'Paged Hero Gaiden',
    url: 'https://www.mangaupdates.com/series/def/paged-hero-gaiden',
    type: 'Manga',
    year: '2021',
  },
];

/** A small MangaUpdates: a login, a search, lists with chapters, and ratings. */
export async function startMangaUpdates(username = 'mika', password = 'pw'): Promise<FakeMangaUpdates> {
  const items = new Map<number, FakeMuItem>();
  const ratings = new Map<number, number>();
  const writes: string[] = [];
  const session = 'mu-session';

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const path = (req.url ?? '').replace(/^\/v1/, '');
      const body: unknown = raw ? JSON.parse(raw) : undefined;
      const obj = (body ?? {}) as { username?: string; password?: string; search?: string; rating?: number };
      const list = (Array.isArray(body) ? body : []) as {
        series: { id: number };
        list_id: number;
        status?: { chapter: number };
      }[];
      if (req.method === 'PUT' && path === '/account/login') {
        return obj.username === username && obj.password === password
          ? send(200, { status: 'success', context: { session_token: session, uid: 5 } })
          : send(200, { status: 'exception', reason: 'Invalid username or password' });
      }
      if (req.headers.authorization !== `Bearer ${session}`) return send(401, { reason: 'Unauthorized' });
      if (path === '/account/profile') return send(200, { username, user_id: 5 });
      if (req.method === 'POST' && path === '/series/search') {
        const term = String(obj.search ?? '').toLowerCase();
        return send(200, {
          results: SERIES.filter((s) => s.title.toLowerCase().includes(term)).map((record) => ({ record })),
        });
      }
      const listed = /^\/lists\/series\/(\d+)$/.exec(path);
      if (listed && req.method === 'GET') {
        const id = Number(listed[1]);
        const item = items.get(id);
        const series = SERIES.find((s) => s.series_id === id);
        return item
          ? send(200, {
              series: { id, title: series?.title },
              list_id: item.list_id,
              status: { chapter: item.chapter },
            })
          : send(404, { reason: 'not on list' });
      }
      if (req.method === 'POST' && path === '/lists/series') {
        writes.push('add');
        for (const entry of list) items.set(entry.series.id, { list_id: entry.list_id, chapter: null });
        return send(200, { status: 'success' });
      }
      if (req.method === 'POST' && path === '/lists/series/update') {
        writes.push('update');
        for (const entry of list) {
          const item = items.get(entry.series.id) ?? { list_id: entry.list_id, chapter: null };
          item.list_id = entry.list_id;
          if (entry.status) item.chapter = entry.status.chapter;
          items.set(entry.series.id, item);
        }
        return send(200, { status: 'success' });
      }
      const rated = /^\/series\/(\d+)\/rating$/.exec(path);
      if (rated) {
        const id = Number(rated[1]);
        if (req.method === 'GET') return ratings.has(id) ? send(200, { rating: ratings.get(id) }) : send(404, {});
        if (req.method === 'PUT') {
          writes.push('rate');
          ratings.set(id, Number(obj.rating));
          return send(200, { status: 'success' });
        }
        if (req.method === 'DELETE') {
          writes.push('unrate');
          ratings.delete(id);
          return send(200, { status: 'success' });
        }
      }
      return send(400, { reason: 'Unsupported' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    api: `http://127.0.0.1:${port}/v1`,
    items,
    ratings,
    writes,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
