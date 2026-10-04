import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeMalEntry {
  status: string;
  score: number;
  num_chapters_read: number;
  start_date?: string;
  finish_date?: string;
}

export interface FakeMal {
  /** For `MATANE_E2E_MAL_API` and `MATANE_E2E_MAL_TOKEN`. */
  api: string;
  tokenUrl: string;
  entries: Map<number, FakeEntryView>;
  /** Every form received at the token endpoint, in order. */
  tokenRequests: Record<string, string>[];
  /** Every `my_list_status` update received. */
  saves: { id: number; form: Record<string, string>; token: string }[];
  /** The code challenge the test saw in the address Matane opened; the token endpoint demands it back. */
  expectedVerifier: string | null;
  /** Makes this access token stop working (a token revoked on the other side). */
  revoke: (token: string) => void;
  close: () => Promise<void>;
}
type FakeEntryView = FakeMalEntry;

const MANGA = [
  { id: 44, title: 'Paged Hero', media_type: 'manga', num_chapters: 40, start_date: '2019-05-01' },
  { id: 45, title: 'Paged Hero Gaiden', media_type: 'one_shot', num_chapters: 1, start_date: '2021-02-01' },
];

/** A small MyAnimeList: a token endpoint (code and refresh), and the few API calls Matane makes. */
export async function startMal(code = 'e2e-code', accessLifetimeSec = 1): Promise<FakeMal> {
  const entries = new Map<number, FakeMalEntry>();
  const tokenRequests: Record<string, string>[] = [];
  const saves: FakeMal['saves'] = [];
  const valid = new Set<string>();
  let issued = 0;
  const state = { expectedVerifier: null as string | null };

  const issue = (lifetime: number) => {
    issued += 1;
    const access = `a-${issued}`;
    valid.add(access);
    return { token_type: 'Bearer', expires_in: lifetime, access_token: access, refresh_token: `r-${issued}` };
  };

  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk));
    req.on('end', () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const url = new URL(req.url ?? '/', 'http://fake');
      const form = Object.fromEntries(new URLSearchParams(raw));

      if (url.pathname === '/token') {
        tokenRequests.push(form);
        if (form['grant_type'] === 'authorization_code') {
          const ok =
            form['code'] === code && form['code_verifier'] === state.expectedVerifier && !('client_secret' in form);
          return ok ? send(200, issue(accessLifetimeSec)) : send(400, { error: 'invalid_grant', message: 'bad code' });
        }
        if (form['grant_type'] === 'refresh_token' && /^r-\d+$/.test(form['refresh_token'] ?? '')) {
          return send(200, issue(3600));
        }
        return send(400, { error: 'invalid_grant', message: 'bad refresh token' });
      }

      const token = /^Bearer (.+)$/.exec(String(req.headers.authorization))?.[1] ?? '';
      if (!valid.has(token)) return send(401, { error: 'invalid_token', message: 'The access token is invalid' });
      const path = url.pathname.replace(/^\/v2/, '');
      if (path === '/users/@me') return send(200, { id: 91, name: 'mika-mal' });
      if (path === '/manga' && req.method === 'GET') {
        const term = (url.searchParams.get('q') ?? '').toLowerCase();
        return send(200, { data: MANGA.filter((m) => m.title.toLowerCase().includes(term)).map((node) => ({ node })) });
      }
      const one = /^\/manga\/(\d+)$/.exec(path);
      if (one && req.method === 'GET') {
        const id = Number(one[1]);
        const manga = MANGA.find((m) => m.id === id);
        return manga ? send(200, { ...manga, my_list_status: entries.get(id) }) : send(404, { error: 'not_found' });
      }
      const save = /^\/manga\/(\d+)\/my_list_status$/.exec(path);
      if (save && req.method === 'PUT') {
        const id = Number(save[1]);
        saves.push({ id, form, token });
        const entry = entries.get(id) ?? { status: 'plan_to_read', score: 0, num_chapters_read: 0 };
        if (form['status']) entry.status = form['status'];
        if (form['score'] !== undefined) entry.score = Number(form['score']);
        if (form['num_chapters_read'] !== undefined) entry.num_chapters_read = Number(form['num_chapters_read']);
        if (form['start_date']) entry.start_date = form['start_date'];
        if (form['finish_date']) entry.finish_date = form['finish_date'];
        entries.set(id, entry);
        return send(200, entry);
      }
      return send(400, { error: 'bad_request' });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    api: `http://127.0.0.1:${port}/v2`,
    tokenUrl: `http://127.0.0.1:${port}/token`,
    entries,
    tokenRequests,
    saves,
    get expectedVerifier() {
      return state.expectedVerifier;
    },
    set expectedVerifier(value) {
      state.expectedVerifier = value;
    },
    revoke: (token) => void valid.delete(token),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
