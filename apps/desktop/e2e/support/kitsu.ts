import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeKitsuEntry {
  id: string;
  status: string;
  progress: number;
  rating: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  private: boolean;
}

export interface FakeKitsu {
  graphql: string;
  tokenUrl: string;
  entries: Map<string, FakeKitsuEntry>;
  /** Every form received at the token endpoint, in order. */
  tokenRequests: Record<string, string>[];
  close: () => Promise<void>;
}

const MANGA = [
  {
    id: '30',
    slug: 'paged-hero',
    titles: { preferred: 'Paged Hero' },
    chapterCount: 40,
    subtype: 'MANGA',
    startDate: '2019-05-01',
  },
  {
    id: '31',
    slug: 'paged-hero-gaiden',
    titles: { preferred: 'Paged Hero Gaiden' },
    chapterCount: 1,
    subtype: 'ONESHOT',
    startDate: '2021-02-01',
  },
];

/** A small Kitsu: the password and refresh grants, and the few GraphQL calls Matane makes. */
export async function startKitsu(
  email = 'mika@example.org',
  password = 'hunter2',
  lifetimeSec = 1,
): Promise<FakeKitsu> {
  const entries = new Map<string, FakeKitsuEntry>();
  const tokenRequests: Record<string, string>[] = [];
  const valid = new Set<string>();
  let issued = 0;
  let nextEntry = 700;

  const issue = () => {
    issued += 1;
    valid.add(`k-${issued}`);
    return {
      token_type: 'Bearer',
      expires_in: lifetimeSec,
      access_token: `k-${issued}`,
      refresh_token: `kr-${issued}`,
    };
  };
  const entryOut = (e: FakeKitsuEntry | undefined) => (e ? { ...e } : null);
  const literal = (query: string, name: string) => {
    const match = new RegExp(`${name}:\\s*("[^"]*"|null)`).exec(query);
    return match ? (JSON.parse(match[1]!) as string | null) : null;
  };

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.url === '/token') {
        const form = Object.fromEntries(new URLSearchParams(raw));
        tokenRequests.push(form);
        if (!form['client_id'] || !form['client_secret']) return send(401, { error: 'invalid_client' });
        if (form['grant_type'] === 'password') {
          return form['username'] === email && form['password'] === password
            ? send(200, issue())
            : send(400, { error: 'invalid_grant', error_description: 'wrong credentials' });
        }
        if (form['grant_type'] === 'refresh_token' && /^kr-\d+$/.test(form['refresh_token'] ?? ''))
          return send(200, issue());
        return send(400, { error: 'invalid_grant' });
      }

      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization))?.[1] ?? '';
      if (!valid.has(token)) return send(401, { errors: [{ message: 'Unauthorized' }] });
      const { query, variables } = JSON.parse(raw) as { query: string; variables: Record<string, unknown> };

      if (query.includes('currentAccount')) {
        return send(200, { data: { currentAccount: { id: '99', profile: { name: 'mika-kitsu' } } } });
      }
      if (query.includes('searchMangaByTitle')) {
        const term = String(variables['query'] ?? '').toLowerCase();
        return send(200, {
          data: { searchMangaByTitle: { nodes: MANGA.filter((m) => m.titles.preferred.toLowerCase().includes(term)) } },
        });
      }
      if (query.includes('findMangaById')) {
        const manga = MANGA.find((m) => m.id === variables['id']);
        return send(200, {
          data: { findMangaById: manga ? { ...manga, myLibraryEntry: entryOut(entries.get(manga.id)) } : null },
        });
      }
      if (/create\s*\(/.test(query)) {
        const id = String(variables['media_id']);
        entries.set(id, {
          id: String(nextEntry++),
          status: String(variables['status']),
          progress: Number(variables['progress']),
          rating: (variables['rating'] as number | null) ?? null,
          startedAt: null,
          finishedAt: null,
          private: false,
        });
        return send(200, {
          data: { libraryEntry: { create: { errors: [], libraryEntry: { id: entries.get(id)!.id } } } },
        });
      }
      if (/update\s*\(/.test(query)) {
        const entry = [...entries.values()].find((e) => e.id === variables['library_id']);
        if (!entry)
          return send(200, {
            data: { libraryEntry: { update: { errors: [{ message: 'not found' }], libraryEntry: null } } },
          });
        entry.status = String(variables['status']);
        entry.progress = Number(variables['progress']);
        entry.rating = (variables['rating'] as number | null) ?? null;
        entry.startedAt = literal(query, 'startedAt');
        entry.finishedAt = literal(query, 'finishedAt');
        return send(200, { data: { libraryEntry: { update: { errors: [], libraryEntry: { id: entry.id } } } } });
      }
      return send(400, { errors: [{ message: 'Unsupported query' }] });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    graphql: `http://127.0.0.1:${port}/graphql`,
    tokenUrl: `http://127.0.0.1:${port}/token`,
    entries,
    tokenRequests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
