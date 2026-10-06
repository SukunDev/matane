import { describe, expect, it } from 'vitest';
import { type MuFetch, createMangaUpdates } from './mangaupdates';
import { TrackerAuthError, TrackerRateLimitError, TrackerRequestError } from './types';

interface Sent {
  method: string;
  path: string;
  headers: Record<string, string>;
  json: unknown;
}

/** A MangaUpdates that answers with `reply(sent)`: a body, or [status, body, headers]. */
function fake(reply: (sent: Sent) => unknown) {
  const sent: Sent[] = [];
  const fetch: MuFetch = async (url, init) => {
    const request: Sent = {
      method: init.method,
      path: new URL(url).pathname.replace(/^\/v1/, ''),
      headers: init.headers,
      json: init.body ? (JSON.parse(init.body) as unknown) : undefined,
    };
    sent.push(request);
    const answer = reply(request);
    const [status, body, headers] = Array.isArray(answer)
      ? (answer as [number, unknown, Record<string, string>?])
      : [200, answer];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: headers ?? {} });
  };
  return { client: createMangaUpdates({ fetch, apiUrl: 'https://mu.test/v1' }), sent };
}

const LIST_ITEM = { series: { id: 123, title: 'Moon Garden' }, list_id: 0, status: { chapter: 12 } };

/** A server with the series 123 on the user's list (or not), recording nothing itself. */
const server =
  (options: { item?: object | null; rating?: number | null } = {}) =>
  (s: Sent) => {
    const { item = LIST_ITEM, rating = 8 } = options;
    if (s.method === 'GET' && s.path === '/lists/series/123') return item ? item : [404, { reason: 'not on list' }];
    if (s.method === 'GET' && s.path === '/series/123/rating') return rating ? { rating } : [404, {}];
    return { status: 'success' };
  };

describe('MangaUpdates: login', () => {
  it('logs in with a PUT and keeps the session token', async () => {
    const { client, sent } = fake(() => ({ status: 'success', context: { session_token: 'sess', uid: 5 } }));
    expect(await client.loginWithPassword('mika', 'pw')).toEqual({
      accessToken: 'sess',
      refreshToken: null,
      expiresInSec: null,
    });
    expect(sent[0]).toMatchObject({
      method: 'PUT',
      path: '/account/login',
      json: { username: 'mika', password: 'pw' },
    });
    expect(sent[0]!.headers['authorization']).toBeUndefined();
  });

  it('says so when the username or password is not accepted', async () => {
    for (const answer of [
      { status: 'exception', reason: 'Invalid username or password' },
      [401, { reason: 'bad' }],
      [200, { context: {} }],
    ]) {
      await expect(fake(() => answer).client.loginWithPassword('a', 'b')).rejects.toThrow(/username and password/);
    }
  });

  it('asks who the session belongs to', async () => {
    const { client, sent } = fake(() => ({ username: 'mika', user_id: 5 }));
    expect(await client.viewer('sess')).toEqual({ userId: '5', username: 'mika' });
    expect(sent[0]).toMatchObject({ method: 'GET', path: '/account/profile' });
    expect(sent[0]!.headers['authorization']).toBe('Bearer sess');
  });
});

describe('MangaUpdates: lists', () => {
  it('searches series, leaving out novels and drama CDs', async () => {
    const { client, sent } = fake(() => ({
      results: [
        {
          record: {
            series_id: 123,
            title: 'Moon Garden',
            url: 'https://www.mangaupdates.com/series/abc/moon-garden',
            image: { url: { thumb: 'https://t/1.jpg', original: 'https://o/1.jpg' } },
            type: 'Manhwa',
            year: '2019',
          },
        },
        { record: { series_id: 124, title: 'Bare', year: 2021 } },
        { record: {} },
      ],
    }));
    expect(await client.search('sess', 'moon')).toEqual([
      {
        remoteId: '123',
        title: 'Moon Garden',
        coverUrl: 'https://t/1.jpg',
        url: 'https://www.mangaupdates.com/series/abc/moon-garden',
        detail: 'Manhwa · 2019',
      },
      {
        remoteId: '124',
        title: 'Bare',
        coverUrl: null,
        url: 'https://www.mangaupdates.com/series.html?id=124',
        detail: '2021',
      },
    ]);
    expect(sent[0]).toMatchObject({
      method: 'POST',
      path: '/series/search',
      json: { search: 'moon', filter_types: ['drama cd', 'novel'] },
    });
  });

  it('reads an entry: list, chapter and rating', async () => {
    const { client } = fake(server({ item: { ...LIST_ITEM, list_id: 4 } }));
    expect(await client.getEntry('sess', '123')).toEqual({
      remoteId: '123',
      remoteUrl: 'https://www.mangaupdates.com/series.html?id=123',
      remoteTitle: 'Moon Garden',
      status: 'on_hold',
      score: 8,
      progress: 12,
      startedAt: null,
      finishedAt: null,
    });
  });

  it('says null for a series that is not on the list, and does not mind a missing rating', async () => {
    expect(await fake(server({ item: null })).client.getEntry('s', '123')).toBeNull();
    expect(await fake(server({ rating: null })).client.getEntry('s', '123')).toMatchObject({
      score: null,
      progress: 12,
    });
  });

  it('maps every list both ways', async () => {
    const out: unknown[] = [];
    for (const list_id of [0, 1, 2, 3, 4]) {
      out.push((await fake(server({ item: { ...LIST_ITEM, list_id } })).client.getEntry('s', '123'))?.status);
    }
    expect(out).toEqual(['reading', 'planning', 'completed', 'dropped', 'on_hold']);
    const lists: unknown[] = [];
    for (const status of ['reading', 'planning', 'completed', 'dropped', 'on_hold'] as const) {
      const f = fake(server({ item: { ...LIST_ITEM, list_id: 9 } }));
      await f.client.save('s', '123', { status });
      lists.push((f.sent.find((s) => s.path === '/lists/series/update')!.json as { list_id: number }[])[0]!.list_id);
    }
    expect(lists).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('MangaUpdates: saving', () => {
  const calls = (f: ReturnType<typeof fake>) =>
    f.sent.filter((s) => s.method !== 'GET').map((s) => `${s.method} ${s.path}`);

  it('adds a series that is not on the list (reading when chapters were read), then sets the chapter', async () => {
    const f = fake(server({ item: null, rating: null }));
    const entry = await f.client.save('sess', '123', { progress: 3 });
    expect(calls(f)).toEqual(['POST /lists/series', 'POST /lists/series/update']);
    expect(f.sent.find((s) => s.path === '/lists/series')!.json).toEqual([{ series: { id: 123 }, list_id: 0 }]);
    expect(f.sent.find((s) => s.path === '/lists/series/update')!.json).toEqual([
      { series: { id: 123 }, list_id: 0, status: { chapter: 3 } },
    ]);
    expect(entry).toMatchObject({ status: 'reading', progress: 3, score: null });
  });

  it('adds a series nothing was read of to the wish list, with no chapter to set', async () => {
    const f = fake(server({ item: null }));
    await f.client.save('sess', '123', { status: 'planning', progress: 0 });
    expect((f.sent.find((s) => s.path === '/lists/series')!.json as { list_id: number }[])[0]!.list_id).toBe(1);
    const planning = fake(server({ item: null }));
    await planning.client.save('sess', '123', {});
    expect(calls(planning)).toEqual(['POST /lists/series']);
  });

  it('moves a series between lists, and sets a chapter, without touching what is not asked', async () => {
    const f = fake(server());
    await f.client.save('sess', '123', { progress: 20 });
    expect(calls(f)).toEqual(['POST /lists/series/update']);
    expect(f.sent.find((s) => s.path === '/lists/series/update')!.json).toEqual([
      { series: { id: 123 }, list_id: 0, status: { chapter: 20 } },
    ]);

    const moved = fake(server());
    await moved.client.save('sess', '123', { status: 'completed' });
    expect(moved.sent.find((s) => s.path === '/lists/series/update')!.json).toEqual([
      { series: { id: 123 }, list_id: 2, status: { chapter: 12 } },
    ]);

    const same = fake(server());
    await same.client.save('sess', '123', { status: 'reading' });
    expect(calls(same)).toEqual([]);
  });

  it('rates in tenths from 1 to 10, and removes a rating with DELETE', async () => {
    const f = fake(server());
    const entry = await f.client.save('s', '123', { score: 8.66 });
    expect(f.sent.find((s) => s.method === 'PUT')).toMatchObject({ path: '/series/123/rating', json: { rating: 8.7 } });
    expect(entry.score).toBe(8.7);
    const low = fake(server());
    await low.client.save('s', '123', { score: 0.3 });
    expect(low.sent.find((s) => s.method === 'PUT')!.json).toEqual({ rating: 1 });
    for (const score of [null, 0]) {
      const gone = fake(server());
      expect((await gone.client.save('s', '123', { score })).score).toBeNull();
      expect(calls(gone)).toEqual(['DELETE /series/123/rating']);
    }
    // A rating that was never there is not an error.
    const none = fake((s) => (s.method === 'DELETE' ? [404, {}] : server()(s)));
    await expect(none.client.save('s', '123', { score: null })).resolves.toBeTruthy();
  });

  it('ignores dates, which MangaUpdates does not have', async () => {
    const f = fake(server());
    await f.client.save('s', '123', { startedAt: 1, finishedAt: 2 });
    expect(calls(f)).toEqual([]);
  });

  it('reports what MangaUpdates refuses, and a series id that cannot be one', async () => {
    const refused = fake((s) =>
      s.method === 'POST' ? [400, { status: 'exception', reason: 'List full' }] : server()(s),
    );
    await expect(refused.client.save('s', '123', { progress: 1 })).rejects.toThrow(/List full/);
    await expect(fake(server()).client.getEntry('s', 'abc')).rejects.toThrow(/no series abc/);
  });
});

describe('MangaUpdates: failures', () => {
  it('tells a refused session from other failures', async () => {
    await expect(fake(() => [401, { reason: 'expired' }]).client.viewer('s')).rejects.toBeInstanceOf(TrackerAuthError);
    await expect(fake(() => [503, 'down']).client.viewer('s')).rejects.toThrow(/having trouble/);
    await expect(fake(() => [400, { reason: 'bad' }]).client.search('s', 'x')).rejects.toBeInstanceOf(
      TrackerRequestError,
    );
  });

  it('says how long to wait when it is asked to slow down', async () => {
    await expect(fake(() => [429, {}, { 'retry-after': '15' }]).client.viewer('s')).rejects.toMatchObject({
      retryAfterMs: 15_000,
    });
    await expect(fake(() => [429, {}]).client.viewer('s')).rejects.toBeInstanceOf(TrackerRateLimitError);
  });
});
