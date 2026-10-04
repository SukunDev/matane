import { describe, expect, it } from 'vitest';
import { type FetchLike, createAniList } from './anilist';
import { TrackerAuthError, TrackerRateLimitError, TrackerRequestError } from './types';

interface Sent {
  url: string;
  headers: Record<string, string>;
  query: string;
  variables: Record<string, unknown>;
}

/** An AniList that answers with `reply(sent)` (a body, or [status, body, headers]). */
function fake(reply: (sent: Sent) => unknown) {
  const sent: Sent[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
    const request = { url, headers: init.headers, ...body };
    sent.push(request);
    const answer = reply(request);
    const [status, json, headers] = Array.isArray(answer)
      ? (answer as [number, unknown, Record<string, string>?])
      : [200, answer];
    return new Response(typeof json === 'string' ? json : JSON.stringify(json), { status, headers: headers ?? {} });
  };
  return { client: createAniList({ fetch, url: 'https://api.test/graphql' }), sent };
}

const MEDIA = {
  id: 30013,
  siteUrl: 'https://anilist.co/manga/30013',
  title: { romaji: 'Tsuki no Niwa', english: 'Moon Garden' },
};

describe('AniList', () => {
  it('asks who the token belongs to, with the token as a bearer', async () => {
    const { client, sent } = fake(() => ({ data: { Viewer: { id: 7, name: 'mika' } } }));
    expect(await client.viewer('tok')).toEqual({ userId: '7', username: 'mika' });
    expect(sent[0]).toMatchObject({ url: 'https://api.test/graphql', headers: { authorization: 'Bearer tok' } });
  });

  it('searches manga and describes each result', async () => {
    const { client, sent } = fake(() => ({
      data: {
        Page: {
          media: [
            {
              ...MEDIA,
              format: 'ONE_SHOT',
              chapters: 1,
              startDate: { year: 2019 },
              coverImage: { medium: 'https://img/1.jpg' },
            },
            {
              id: 2,
              siteUrl: null,
              title: { romaji: 'Only Romaji', english: null },
              format: null,
              chapters: null,
              startDate: null,
              coverImage: null,
            },
          ],
        },
      },
    }));
    expect(await client.search('tok', 'moon')).toEqual([
      {
        remoteId: '30013',
        title: 'Moon Garden',
        coverUrl: 'https://img/1.jpg',
        url: 'https://anilist.co/manga/30013',
        detail: 'One shot · 2019 · 1 chapters',
      },
      { remoteId: '2', title: 'Only Romaji', coverUrl: null, url: 'https://anilist.co/manga/2', detail: null },
    ]);
    expect(sent[0]!.variables).toEqual({ search: 'moon' });
    expect(sent[0]!.query).toContain('type: MANGA');
  });

  it('reads an entry: status, score on 0 to 10, progress and dates', async () => {
    const { client, sent } = fake(() => ({
      data: {
        Media: {
          ...MEDIA,
          mediaListEntry: {
            id: 1,
            status: 'PAUSED',
            progress: 12,
            score: 85,
            startedAt: { year: 2024, month: 1, day: 5 },
            completedAt: { year: null, month: null, day: null },
          },
        },
      },
    }));
    expect(await client.getEntry('tok', '30013')).toEqual({
      remoteId: '30013',
      remoteUrl: 'https://anilist.co/manga/30013',
      remoteTitle: 'Moon Garden',
      status: 'on_hold',
      score: 8.5,
      progress: 12,
      startedAt: Date.UTC(2024, 0, 5),
      finishedAt: null,
    });
    expect(sent[0]!.variables).toEqual({ id: 30013 });
  });

  it('says null for a manga that is not on the list, and fails for one that does not exist', async () => {
    expect(
      await fake(() => ({ data: { Media: { ...MEDIA, mediaListEntry: null } } })).client.getEntry('tok', '1'),
    ).toBeNull();
    await expect(fake(() => ({ data: { Media: null } })).client.getEntry('tok', '1')).rejects.toThrow(/no manga 1/);
  });

  it('maps every status both ways', async () => {
    const statuses = ['CURRENT', 'REPEATING', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNING'];
    const out: unknown[] = [];
    for (const status of statuses) {
      const { client } = fake(() => ({
        data: { Media: { ...MEDIA, mediaListEntry: { status, progress: 0, score: 0 } } },
      }));
      out.push((await client.getEntry('t', '1'))?.status);
    }
    expect(out).toEqual(['reading', 'reading', 'completed', 'on_hold', 'dropped', 'planning']);
    const sent: string[] = [];
    for (const status of ['reading', 'completed', 'on_hold', 'dropped', 'planning'] as const) {
      const { client, sent: s } = fake(() => ({ data: { SaveMediaListEntry: { status: 'CURRENT', media: MEDIA } } }));
      await client.save('t', '1', { status });
      sent.push(s[0]!.variables['status'] as string);
    }
    expect(sent).toEqual(['CURRENT', 'COMPLETED', 'PAUSED', 'DROPPED', 'PLANNING']);
  });

  it('saves only the fields it was given, scores on the 0 to 100 scale and dates as year, month, day', async () => {
    const { client, sent } = fake(() => ({
      data: { SaveMediaListEntry: { status: 'CURRENT', progress: 13, score: 90, media: MEDIA } },
    }));
    const entry = await client.save('tok', '30013', { progress: 13, score: 9, startedAt: Date.UTC(2024, 2, 9) });
    expect(sent[0]!.variables).toEqual({
      mediaId: 30013,
      progress: 13,
      scoreRaw: 90,
      startedAt: { year: 2024, month: 3, day: 9 },
    });
    expect(sent[0]!.query).toContain('$progress: Int');
    expect(sent[0]!.query).not.toContain('$status');
    expect(entry).toMatchObject({ remoteTitle: 'Moon Garden', status: 'reading', score: 9, progress: 13 });
  });

  it('clears a score and a date by sending zero and an empty date', async () => {
    const { client, sent } = fake(() => ({ data: { SaveMediaListEntry: { status: 'CURRENT', media: MEDIA } } }));
    await client.save('tok', '1', { score: null, finishedAt: null });
    expect(sent[0]!.variables).toEqual({
      mediaId: 1,
      scoreRaw: 0,
      completedAt: { year: null, month: null, day: null },
    });
  });

  it('tells a refused token from other failures', async () => {
    await expect(
      fake(() => [401, { errors: [{ message: 'Invalid token', status: 400 }] }]).client.viewer('t'),
    ).rejects.toBeInstanceOf(TrackerAuthError);
    await expect(
      fake(() => [200, { errors: [{ message: 'Invalid token' }], data: null }]).client.viewer('t'),
    ).rejects.toBeInstanceOf(TrackerAuthError);
    await expect(
      fake(() => [400, { errors: [{ message: 'Bad id', status: 400 }] }]).client.viewer('t'),
    ).rejects.toBeInstanceOf(TrackerRequestError);
    await expect(fake(() => [502, '<html>bad gateway</html>']).client.viewer('t')).rejects.toThrow(/having trouble/);
  });

  it('says how long to wait when it is asked to slow down', async () => {
    const limited = fake(() => [
      429,
      { errors: [{ message: 'Too Many Requests.', status: 429 }] },
      { 'retry-after': '45' },
    ]);
    await expect(limited.client.viewer('t')).rejects.toMatchObject({
      name: 'TrackerRateLimitError',
      retryAfterMs: 45_000,
    });
    const noHeader = fake(() => [429, {}]);
    await expect(noHeader.client.viewer('t')).rejects.toBeInstanceOf(TrackerRateLimitError);
    await expect(noHeader.client.viewer('t')).rejects.toMatchObject({ retryAfterMs: 60_000 });
  });
});
