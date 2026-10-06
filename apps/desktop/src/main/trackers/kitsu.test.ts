import { describe, expect, it } from 'vitest';
import { KITSU_CLIENT_ID, KITSU_CLIENT_SECRET } from './client-ids';
import { type KitsuFetch, createKitsu } from './kitsu';
import { TrackerAuthError, TrackerRateLimitError, TrackerRequestError } from './types';

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  form: Record<string, string> | null;
  query: string;
  variables: Record<string, unknown>;
}

/** A Kitsu that answers with `reply(sent)`: a body, or [status, body, headers]. */
function fake(reply: (sent: Sent) => unknown) {
  const sent: Sent[] = [];
  const fetch: KitsuFetch = async (url, init) => {
    const isForm = init.headers['content-type']?.includes('x-www-form-urlencoded');
    const json =
      !isForm && init.body ? (JSON.parse(init.body) as { query: string; variables: Record<string, unknown> }) : null;
    const request: Sent = {
      url,
      method: init.method,
      headers: init.headers,
      form: isForm ? Object.fromEntries(new URLSearchParams(init.body)) : null,
      query: json?.query ?? '',
      variables: json?.variables ?? {},
    };
    sent.push(request);
    const answer = reply(request);
    const [status, body, headers] = Array.isArray(answer)
      ? (answer as [number, unknown, Record<string, string>?])
      : [200, answer];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: headers ?? {} });
  };
  return {
    client: createKitsu({ fetch, graphqlUrl: 'https://api.test/graphql', tokenUrl: 'https://auth.test/token' }),
    sent,
  };
}

const MANGA = { id: '30', slug: 'moon-garden', titles: { preferred: 'Moon Garden' } };
const data = (value: unknown) => ({ data: value });

describe('Kitsu: login', () => {
  it("logs in with the password grant and Kitsu's published app credentials", async () => {
    const { client, sent } = fake(() => ({ access_token: 'a1', refresh_token: 'r1', expires_in: 2_592_000 }));
    expect(await client.loginWithPassword('mika@example.org', 'hunter2')).toEqual({
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresInSec: 2_592_000,
    });
    expect(sent[0]).toMatchObject({ url: 'https://auth.test/token', method: 'POST' });
    expect(sent[0]!.form).toEqual({
      grant_type: 'password',
      username: 'mika@example.org',
      password: 'hunter2',
      client_id: KITSU_CLIENT_ID,
      client_secret: KITSU_CLIENT_SECRET,
    });
  });

  it("tells a wrong password (the user's to fix) from a refresh token that no longer works", async () => {
    const wrong = fake(() => [400, { error: 'invalid_grant' }]);
    await expect(wrong.client.loginWithPassword('a', 'b')).rejects.toBeInstanceOf(TrackerRequestError);
    await expect(wrong.client.loginWithPassword('a', 'b')).rejects.toThrow(/email and password/);
    await expect(wrong.client.refresh('old')).rejects.toBeInstanceOf(TrackerAuthError);
  });

  it('renews with the refresh token', async () => {
    const { client, sent } = fake(() => ({ access_token: 'a2', expires_in: 100 }));
    expect(await client.refresh('r1')).toEqual({ accessToken: 'a2', refreshToken: null, expiresInSec: 100 });
    expect(sent[0]!.form).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1' });
  });

  it('says so when Cloudflare blocks the request', async () => {
    const { client } = fake(() => [403, '<html>challenge</html>', { 'cf-mitigated': 'challenge' }]);
    await expect(client.viewer('t')).rejects.toThrow(/Cloudflare/);
    await expect(client.loginWithPassword('a', 'b')).rejects.toThrow(/Cloudflare/);
  });
});

describe('Kitsu: lists', () => {
  it('asks who the token belongs to', async () => {
    const { client, sent } = fake(() => data({ currentAccount: { id: '99', profile: { name: 'mika' } } }));
    expect(await client.viewer('tok')).toEqual({ userId: '99', username: 'mika' });
    expect(sent[0]!.headers['authorization']).toBe('Bearer tok');
    await expect(fake(() => data({ currentAccount: null })).client.viewer('t')).rejects.toBeInstanceOf(
      TrackerAuthError,
    );
  });

  it('searches manga and describes each result', async () => {
    const { client, sent } = fake(() =>
      data({
        searchMangaByTitle: {
          nodes: [
            { ...MANGA, chapterCount: 40, subtype: 'MANHWA', startDate: '2019-05-01' },
            { id: '31', slug: null, titles: null, chapterCount: null, subtype: null, startDate: null },
          ],
        },
      }),
    );
    expect(await client.search('tok', 'moon')).toEqual([
      {
        remoteId: '30',
        title: 'Moon Garden',
        coverUrl: null,
        url: 'https://kitsu.app/manga/moon-garden',
        detail: 'Manhwa · 2019 · 40 chapters',
      },
      { remoteId: '31', title: '#31', coverUrl: null, url: 'https://kitsu.app/manga/31', detail: null },
    ]);
    expect(sent[0]!.variables).toEqual({ query: 'moon' });
  });

  it('reads an entry: status, rating on 0 to 10, progress and dates', async () => {
    const { client, sent } = fake(() =>
      data({
        findMangaById: {
          ...MANGA,
          myLibraryEntry: {
            id: '700',
            private: false,
            progress: 12,
            rating: 17,
            status: 'PLANNED',
            startedAt: '2024-01-05T00:00:00Z',
            finishedAt: null,
          },
        },
      }),
    );
    expect(await client.getEntry('tok', '30')).toEqual({
      remoteId: '30',
      remoteUrl: 'https://kitsu.app/manga/moon-garden',
      remoteTitle: 'Moon Garden',
      status: 'planning',
      score: 8.5,
      progress: 12,
      startedAt: Date.UTC(2024, 0, 5),
      finishedAt: null,
    });
    expect(sent[0]!.variables).toEqual({ id: '30' });
  });

  it('says null for a manga that is not on the list, and fails for one that does not exist', async () => {
    expect(
      await fake(() => data({ findMangaById: { ...MANGA, myLibraryEntry: null } })).client.getEntry('t', '30'),
    ).toBeNull();
    await expect(fake(() => data({ findMangaById: null })).client.getEntry('t', '999')).rejects.toThrow(/no manga 999/);
  });

  it('maps every status both ways', async () => {
    const out: unknown[] = [];
    for (const status of ['CURRENT', 'PLANNED', 'COMPLETED', 'ON_HOLD', 'DROPPED']) {
      const f = fake(() => data({ findMangaById: { ...MANGA, myLibraryEntry: { id: '1', status, progress: 0 } } }));
      out.push((await f.client.getEntry('t', '30'))?.status);
    }
    expect(out).toEqual(['reading', 'planning', 'completed', 'on_hold', 'dropped']);
    const sent: unknown[] = [];
    for (const status of ['reading', 'planning', 'completed', 'on_hold', 'dropped'] as const) {
      const f = fake((s) =>
        s.query.includes('findMangaById')
          ? data({ findMangaById: { ...MANGA, myLibraryEntry: { id: '700', progress: 1, status: 'CURRENT' } } })
          : data({ libraryEntry: { update: { errors: [], libraryEntry: { id: '700' } } } }),
      );
      await f.client.save('t', '30', { status });
      sent.push(f.sent[1]!.variables['status']);
    }
    expect(sent).toEqual(['CURRENT', 'PLANNED', 'COMPLETED', 'ON_HOLD', 'DROPPED']);
  });
});

describe('Kitsu: saving', () => {
  const missing = data({ findMangaById: { ...MANGA, myLibraryEntry: null } });
  const existing = (entry: Record<string, unknown> = {}) =>
    data({
      findMangaById: {
        ...MANGA,
        myLibraryEntry: {
          id: '700',
          private: true,
          progress: 5,
          rating: 14,
          status: 'CURRENT',
          startedAt: '2024-02-01T00:00:00.000Z',
          finishedAt: null,
          ...entry,
        },
      },
    });

  it('creates an entry that is not there: reading with what was read, planning otherwise', async () => {
    const { client, sent } = fake((s) =>
      s.query.includes('findMangaById')
        ? missing
        : data({ libraryEntry: { create: { errors: [], libraryEntry: { id: '800' } } } }),
    );
    const entry = await client.save('tok', '30', { progress: 3, score: 9 });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.query).toMatch(/create\(/);
    expect(sent[1]!.query).toMatch(/mediaType:\s*MANGA/);
    expect(sent[1]!.variables).toEqual({ media_id: '30', status: 'CURRENT', progress: 3, private: false, rating: 18 });
    expect(entry).toMatchObject({ remoteTitle: 'Moon Garden', status: 'reading', score: 9, progress: 3 });

    const planning = fake((s) =>
      s.query.includes('findMangaById')
        ? missing
        : data({ libraryEntry: { create: { errors: [], libraryEntry: { id: '800' } } } }),
    );
    await planning.client.save('tok', '30', {});
    expect(planning.sent[1]!.variables).toMatchObject({ status: 'PLANNED', progress: 0, rating: null });
  });

  it('gives dates to a new entry in an update that follows the create', async () => {
    const { client, sent } = fake((s) =>
      s.query.includes('findMangaById')
        ? missing
        : /create\(/.test(s.query)
          ? data({ libraryEntry: { create: { errors: [], libraryEntry: { id: '800' } } } })
          : data({ libraryEntry: { update: { errors: [], libraryEntry: { id: '800' } } } }),
    );
    await client.save('tok', '30', { progress: 1, startedAt: Date.UTC(2024, 2, 9) });
    expect(sent).toHaveLength(3);
    expect(sent[2]!.query).toMatch(/update\(/);
    expect(sent[2]!.query).toMatch(/startedAt:\s*"2024-03-09T00:00:00\.000Z"/);
    expect(sent[2]!.query).toMatch(/finishedAt:\s*null/);
    expect(sent[2]!.variables).toMatchObject({ library_id: '800', progress: 1 });
  });

  it('updates the whole entry, keeping what the patch leaves out', async () => {
    const { client, sent } = fake((s) =>
      s.query.includes('findMangaById')
        ? existing()
        : data({ libraryEntry: { update: { errors: [], libraryEntry: { id: '700' } } } }),
    );
    const entry = await client.save('tok', '30', { progress: 6 });
    expect(sent[1]!.variables).toEqual({
      library_id: '700',
      status: 'CURRENT',
      progress: 6,
      private: true,
      rating: 14,
    });
    // The date that was there stays.
    expect(sent[1]!.query).toMatch(/startedAt:\s*"2024-02-01T00:00:00\.000Z"/);
    expect(entry).toMatchObject({
      status: 'reading',
      score: 7,
      progress: 6,
      startedAt: Date.UTC(2024, 1, 1),
      finishedAt: null,
    });
  });

  it("writes ratings on Kitsu's 2 to 20 scale, and clears one with null", async () => {
    const ratings: unknown[] = [];
    for (const score of [8.6, 0.2, 10, 5, null, 0]) {
      const f = fake((s) =>
        s.query.includes('findMangaById') ? existing() : data({ libraryEntry: { update: { errors: [] } } }),
      );
      await f.client.save('t', '30', { score });
      ratings.push(f.sent[1]!.variables['rating']);
    }
    expect(ratings).toEqual([17, 2, 20, 10, null, null]);
  });

  it('can clear a date, and set a finished one', async () => {
    const { client, sent } = fake((s) =>
      s.query.includes('findMangaById') ? existing() : data({ libraryEntry: { update: { errors: [] } } }),
    );
    await client.save('t', '30', { startedAt: null, finishedAt: Date.UTC(2024, 5, 1), status: 'completed' });
    expect(sent[1]!.query).toMatch(/startedAt:\s*null/);
    expect(sent[1]!.query).toMatch(/finishedAt:\s*"2024-06-01T00:00:00\.000Z"/);
  });

  it('reports what Kitsu refuses in a mutation', async () => {
    const { client } = fake((s) =>
      s.query.includes('findMangaById')
        ? existing()
        : data({ libraryEntry: { update: { errors: [{ message: 'Progress is too high' }] } } }),
    );
    await expect(client.save('t', '30', { progress: 9999 })).rejects.toThrow(/Progress is too high/);
  });
});

describe('Kitsu: failures', () => {
  it('tells a refused token from other failures', async () => {
    await expect(
      fake(() => [401, { errors: [{ message: 'Unauthorized' }] }]).client.viewer('t'),
    ).rejects.toBeInstanceOf(TrackerAuthError);
    await expect(
      fake(() => [200, { errors: [{ message: 'The access token is invalid' }] }]).client.viewer('t'),
    ).rejects.toBeInstanceOf(TrackerAuthError);
    await expect(
      fake(() => [200, { errors: [{ message: 'Field x is missing' }] }]).client.viewer('t'),
    ).rejects.toBeInstanceOf(TrackerRequestError);
    await expect(fake(() => [502, 'bad gateway']).client.viewer('t')).rejects.toThrow(/having trouble/);
  });

  it('says how long to wait when it is asked to slow down', async () => {
    await expect(fake(() => [429, {}, { 'retry-after': '20' }]).client.viewer('t')).rejects.toMatchObject({
      retryAfterMs: 20_000,
    });
    await expect(fake(() => [429, {}]).client.viewer('t')).rejects.toBeInstanceOf(TrackerRateLimitError);
  });
});
