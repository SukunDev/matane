import { describe, expect, it } from 'vitest';
import { type MalFetch, createMyAnimeList, malAuthorizeUrl, newCodeVerifier } from './mal';
import { TrackerAuthError, TrackerRateLimitError, TrackerRequestError } from './types';

interface Sent {
  url: URL;
  method: string;
  headers: Record<string, string>;
  form: Record<string, string> | null;
}

/** A MyAnimeList that answers with `reply(sent)`: a body, or [status, body, headers]. */
function fake(reply: (sent: Sent) => unknown, clientId: string | null = 'mal-client') {
  const sent: Sent[] = [];
  const fetch: MalFetch = async (url, init) => {
    const request: Sent = {
      url: new URL(url),
      method: init.method,
      headers: init.headers,
      form: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null,
    };
    sent.push(request);
    const answer = reply(request);
    const [status, json, headers] = Array.isArray(answer)
      ? (answer as [number, unknown, Record<string, string>?])
      : [200, answer];
    return new Response(typeof json === 'string' ? json : JSON.stringify(json), { status, headers: headers ?? {} });
  };
  return {
    client: createMyAnimeList({
      fetch,
      clientId: () => clientId,
      apiUrl: 'https://api.test/v2',
      tokenUrl: 'https://auth.test/token',
    }),
    sent,
  };
}

describe('MyAnimeList: login', () => {
  it('builds the address with PKCE `plain`, where the challenge is the verifier', () => {
    const verifier = newCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(newCodeVerifier()).not.toBe(verifier);
    const url = new URL(
      malAuthorizeUrl({ clientId: 'cid', verifier, state: 's1', redirectUri: 'http://127.0.0.1:47654/callback' }),
    );
    expect(url.origin + url.pathname).toBe('https://myanimelist.net/v1/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      code_challenge: verifier,
      code_challenge_method: 'plain',
      state: 's1',
      redirect_uri: 'http://127.0.0.1:47654/callback',
    });
  });

  it('exchanges the code with the verifier, and no client secret', async () => {
    const { client, sent } = fake(() => ({
      token_type: 'Bearer',
      expires_in: 2678400,
      access_token: 'a1',
      refresh_token: 'r1',
    }));
    expect(await client.exchange('the-code', 'the-verifier', 'http://127.0.0.1:47654/callback')).toEqual({
      accessToken: 'a1',
      refreshToken: 'r1',
      expiresInSec: 2_678_400,
    });
    expect(sent[0]).toMatchObject({
      method: 'POST',
      url: expect.objectContaining({ href: 'https://auth.test/token' }),
    });
    expect(sent[0]!.form).toEqual({
      client_id: 'mal-client',
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'http://127.0.0.1:47654/callback',
    });
  });

  it('renews with the refresh token', async () => {
    const { client, sent } = fake(() => ({ expires_in: 3600, access_token: 'a2', refresh_token: 'r2' }));
    expect(await client.refresh('r1')).toEqual({ accessToken: 'a2', refreshToken: 'r2', expiresInSec: 3600 });
    expect(sent[0]!.form).toEqual({ client_id: 'mal-client', grant_type: 'refresh_token', refresh_token: 'r1' });
  });

  it('knows a refresh token that is no good, and an app without a registration', async () => {
    const dead = fake(() => [400, { error: 'invalid_grant', message: 'The refresh token is invalid' }]);
    await expect(dead.client.refresh('old')).rejects.toBeInstanceOf(TrackerAuthError);
    const unregistered = fake(() => ({}), null);
    await expect(unregistered.client.refresh('r')).rejects.toThrow(/no app registration/);
    expect(unregistered.sent).toHaveLength(0);
    await expect(fake(() => ({ expires_in: 1 })).client.refresh('r')).rejects.toThrow(/no access token/);
  });
});

describe('MyAnimeList: lists', () => {
  it('asks who the token belongs to', async () => {
    const { client, sent } = fake(() => ({ id: 77, name: 'Mika' }));
    expect(await client.viewer('tok')).toEqual({ userId: '77', username: 'Mika' });
    expect(sent[0]!.url.pathname).toBe('/v2/users/@me');
    expect(sent[0]!.headers['authorization']).toBe('Bearer tok');
  });

  it('searches manga and describes each result', async () => {
    const { client, sent } = fake(() => ({
      data: [
        {
          node: {
            id: 44,
            title: 'Moon Garden',
            main_picture: { medium: 'https://img/44.jpg' },
            media_type: 'one_shot',
            num_chapters: 1,
            start_date: '2019-05-01',
          },
        },
        { node: { id: 45, title: 'Bare', main_picture: null, media_type: null, num_chapters: 0, start_date: null } },
      ],
    }));
    expect(await client.search('tok', 'moon')).toEqual([
      {
        remoteId: '44',
        title: 'Moon Garden',
        coverUrl: 'https://img/44.jpg',
        url: 'https://myanimelist.net/manga/44',
        detail: 'One shot · 2019 · 1 chapters',
      },
      { remoteId: '45', title: 'Bare', coverUrl: null, url: 'https://myanimelist.net/manga/45', detail: null },
    ]);
    expect(sent[0]!.url.searchParams.get('q')).toBe('moon');
    expect(sent[0]!.url.searchParams.get('limit')).toBe('15');
  });

  it('needs three letters to search, as MyAnimeList does, and cuts long titles to 64', async () => {
    const { client, sent } = fake(() => ({ data: [] }));
    await expect(client.search('tok', 'ab')).rejects.toBeInstanceOf(TrackerRequestError);
    expect(sent).toHaveLength(0);
    await client.search('tok', 'x'.repeat(100));
    expect(sent[0]!.url.searchParams.get('q')).toHaveLength(64);
  });

  it('reads an entry: status, score, chapters and dates', async () => {
    const { client, sent } = fake(() => ({
      id: 44,
      title: 'Moon Garden',
      my_list_status: {
        status: 'plan_to_read',
        score: 7,
        num_chapters_read: 12,
        is_rereading: false,
        start_date: '2024-01-05',
        finish_date: '2024-03',
      },
    }));
    expect(await client.getEntry('tok', '44')).toEqual({
      remoteId: '44',
      remoteUrl: 'https://myanimelist.net/manga/44',
      remoteTitle: 'Moon Garden',
      status: 'planning',
      score: 7,
      progress: 12,
      startedAt: Date.UTC(2024, 0, 5),
      finishedAt: Date.UTC(2024, 2, 1),
    });
    expect(sent[0]!.url.pathname).toBe('/v2/manga/44');
    expect(sent[0]!.url.searchParams.get('fields')).toContain('my_list_status{start_date,finish_date}');
  });

  it('says null for a manga that is not on the list, a re-read as reading, and a score of 0 as none', async () => {
    expect(await fake(() => ({ id: 44, title: 'x' })).client.getEntry('t', '44')).toBeNull();
    const reread = await fake(() => ({
      id: 1,
      title: 'x',
      my_list_status: { status: 'completed', score: 0, is_rereading: true },
    })).client.getEntry('t', '1');
    expect(reread).toMatchObject({ status: 'reading', score: null });
  });

  it('maps every status both ways', async () => {
    const out: unknown[] = [];
    for (const status of ['reading', 'completed', 'on_hold', 'dropped', 'plan_to_read']) {
      out.push(
        (await fake(() => ({ id: 1, title: 'x', my_list_status: { status } })).client.getEntry('t', '1'))?.status,
      );
    }
    expect(out).toEqual(['reading', 'completed', 'on_hold', 'dropped', 'planning']);
    const sent: (string | undefined)[] = [];
    for (const status of ['reading', 'completed', 'on_hold', 'dropped', 'planning'] as const) {
      const f = fake(() => ({ status: 'reading' }));
      await f.client.save('t', '1', { status });
      sent.push(f.sent[0]!.form!['status']);
    }
    expect(sent).toEqual(['reading', 'completed', 'on_hold', 'dropped', 'plan_to_read']);
  });

  it('saves with a PUT of a form: whole-number scores, calendar dates, only what was given', async () => {
    const { client, sent } = fake(() => ({
      status: 'reading',
      score: 9,
      num_chapters_read: 13,
      start_date: '2024-03-09',
    }));
    const entry = await client.save('tok', '44', { progress: 13, score: 8.6, startedAt: Date.UTC(2024, 2, 9) });
    expect(sent[0]).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({ 'content-type': 'application/x-www-form-urlencoded' }),
    });
    expect(sent[0]!.url.pathname).toBe('/v2/manga/44/my_list_status');
    expect(sent[0]!.form).toEqual({ num_chapters_read: '13', score: '9', start_date: '2024-03-09' });
    expect(entry).toMatchObject({
      remoteId: '44',
      remoteTitle: null,
      status: 'reading',
      score: 9,
      progress: 13,
      startedAt: Date.UTC(2024, 2, 9),
    });
  });

  it('removes a score with 0, and leaves cleared dates out (the API cannot clear them)', async () => {
    const { client, sent } = fake(() => ({ status: 'reading' }));
    await client.save('tok', '44', { score: null, startedAt: null, finishedAt: null, status: null });
    expect(sent[0]!.form).toEqual({ score: '0' });
  });
});

describe('MyAnimeList: failures', () => {
  it('tells a refused token from other failures', async () => {
    await expect(
      fake(() => [401, { error: 'invalid_token', message: 'The access token is invalid' }]).client.viewer('t'),
    ).rejects.toBeInstanceOf(TrackerAuthError);
    await expect(
      fake(() => [400, { error: 'invalid_content', message: 'status is invalid' }]).client.save('t', '1', {
        status: 'reading',
      }),
    ).rejects.toThrow(/status is invalid/);
    await expect(fake(() => [404, { error: 'not_found' }]).client.getEntry('t', '999')).rejects.toThrow(
      /no such manga/,
    );
    await expect(fake(() => [503, 'busy']).client.viewer('t')).rejects.toThrow(/having trouble/);
  });

  it('says how long to wait when it is asked to slow down', async () => {
    const limited = fake(() => [429, {}, { 'retry-after': '30' }]);
    await expect(limited.client.viewer('t')).rejects.toMatchObject({
      name: 'TrackerRateLimitError',
      retryAfterMs: 30_000,
    });
    await expect(fake(() => [429, {}]).client.viewer('t')).rejects.toBeInstanceOf(TrackerRateLimitError);
  });
});
