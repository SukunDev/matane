import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the fake AniList keeps for one manga on the user's list. */
export interface FakeEntry {
  status: string;
  progress: number;
  scoreRaw: number;
  startedAt: { year: number | null; month: number | null; day: number | null };
  completedAt: { year: number | null; month: number | null; day: number | null };
}

export interface FakeAniList {
  /** The GraphQL endpoint, for `MATANE_E2E_ANILIST_API`. */
  url: string;
  /** The token the fake accepts. */
  token: string;
  entries: Map<number, FakeEntry>;
  /** Every mutation received, in order. */
  saves: { mediaId: number; variables: Record<string, unknown> }[];
  /** While set, every request answers with this HTTP status (a tracker that is down). */
  failWith: number | null;
  close: () => Promise<void>;
}

const NONE = { year: null, month: null, day: null };
const MEDIA = [
  {
    id: 30013,
    title: { romaji: 'Paged Hero', english: 'Paged Hero' },
    format: 'MANGA',
    chapters: 40,
    startDate: { year: 2019 },
  },
  {
    id: 30014,
    title: { romaji: 'Paged Hero Gaiden', english: null },
    format: 'ONE_SHOT',
    chapters: 1,
    startDate: { year: 2021 },
  },
];

/** A small AniList: a viewer, a search, list entries and `SaveMediaListEntry`, behind one bearer token. */
export async function startAniList(token = 'good-token'): Promise<FakeAniList> {
  const entries = new Map<number, FakeEntry>();
  const saves: FakeAniList['saves'] = [];
  const state = { failWith: null as number | null };

  const media = (id: number) => {
    const found = MEDIA.find((m) => m.id === id) ?? MEDIA[0]!;
    return { ...found, id, siteUrl: `https://anilist.co/manga/${id}`, coverImage: { medium: null } };
  };
  const entryOut = (id: number) => {
    const e = entries.get(id);
    return e
      ? {
          id,
          status: e.status,
          progress: e.progress,
          score: e.scoreRaw,
          startedAt: e.startedAt,
          completedAt: e.completedAt,
        }
      : null;
  };

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (state.failWith) return send(state.failWith, { errors: [{ message: 'Service Unavailable' }] });
      if (req.headers.authorization !== `Bearer ${token}`) {
        return send(401, { errors: [{ message: 'Invalid token', status: 400 }], data: null });
      }
      const { query, variables } = JSON.parse(raw) as { query: string; variables: Record<string, unknown> };
      if (query.includes('Viewer')) return send(200, { data: { Viewer: { id: 7, name: 'mika' } } });
      if (query.includes('Page(')) {
        const term = String(variables['search'] ?? '').toLowerCase();
        return send(200, {
          data: {
            Page: { media: MEDIA.filter((m) => m.title.romaji.toLowerCase().includes(term)).map((m) => media(m.id)) },
          },
        });
      }
      if (query.includes('SaveMediaListEntry')) {
        const id = Number(variables['mediaId']);
        saves.push({ mediaId: id, variables });
        const entry = entries.get(id) ?? {
          status: 'PLANNING',
          progress: 0,
          scoreRaw: 0,
          startedAt: NONE,
          completedAt: NONE,
        };
        if (variables['status'] !== undefined) entry.status = String(variables['status']);
        if (variables['progress'] !== undefined) entry.progress = Number(variables['progress']);
        if (variables['scoreRaw'] !== undefined) entry.scoreRaw = Number(variables['scoreRaw']);
        if (variables['startedAt'] !== undefined) entry.startedAt = variables['startedAt'] as FakeEntry['startedAt'];
        if (variables['completedAt'] !== undefined)
          entry.completedAt = variables['completedAt'] as FakeEntry['completedAt'];
        entries.set(id, entry);
        return send(200, { data: { SaveMediaListEntry: { ...entryOut(id), media: media(id) } } });
      }
      if (query.includes('Media(id')) {
        const id = Number(variables['id']);
        return send(200, { data: { Media: { ...media(id), mediaListEntry: entryOut(id) } } });
      }
      return send(400, { errors: [{ message: 'Unsupported query' }] });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/graphql`,
    token,
    entries,
    saves,
    get failWith() {
      return state.failWith;
    },
    set failWith(value) {
      state.failWith = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
