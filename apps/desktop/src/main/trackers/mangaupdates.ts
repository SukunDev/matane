import type { TrackPatch, TrackSearchResult, TrackStatus } from '@manga-reader/shared';
import {
  type RemoteEntry,
  type TrackerClient,
  type TrackerLogin,
  TrackerAuthError,
  TrackerRateLimitError,
  TrackerRequestError,
} from './types';

export const MU_API = 'https://api.mangaupdates.com/v1';
export const MU_SITE = 'https://www.mangaupdates.com';

export type MuFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

export interface MangaUpdatesClient extends TrackerClient {
  loginWithPassword(username: string, password: string): Promise<TrackerLogin>;
}

/** MangaUpdates keeps a user's manga in lists (0 reading, 1 wish, 2 complete, 3 unfinished, 4 on hold). */
const STATUS_FROM: Record<number, TrackStatus> = {
  0: 'reading',
  1: 'planning',
  2: 'completed',
  3: 'dropped',
  4: 'on_hold',
};
const LIST_OF: Record<TrackStatus, number> = { reading: 0, planning: 1, completed: 2, dropped: 3, on_hold: 4 };

/** JSON as it comes: nothing is assumed until it is looked at. */
type Json = { [key: string]: unknown };
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

interface ListItem {
  listId: number | null;
  chapter: number | null;
  title: string | null;
}

/** The image urls of a search record (`image.url.thumb` and `.original`). */
const urlsOf = (record: Json): Json | undefined => {
  const image = record['image'];
  const urls = isObject(image) ? image['url'] : undefined;
  return isObject(urls) ? urls : undefined;
};

const entryUrl = (id: number | string) => `${MU_SITE}/series.html?id=${id}`;

/**
 * MangaUpdates (https://api.mangaupdates.com): a login with username and password that gives a
 * session token, lists for status, a chapter for progress and a separate rating. It has no dates.
 */
export function createMangaUpdates(options: { fetch: MuFetch; apiUrl?: string }): MangaUpdatesClient {
  const apiUrl = options.apiUrl ?? MU_API;

  /** One call; what every call shares is handled here, a 404 and the body are left to the caller. */
  async function call(
    token: string | null,
    method: string,
    path: string,
    json?: unknown,
  ): Promise<{ status: number; body: Json | null }> {
    const response = await options.fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      throw new TrackerRateLimitError(
        'MangaUpdates asked to slow down',
        (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000,
      );
    }
    // A session that is refused (only meaningful once there is one).
    if (response.status === 401 && token) throw new TrackerAuthError('MangaUpdates no longer accepts the login');
    if (response.status >= 500) throw new Error(`MangaUpdates is having trouble (HTTP ${response.status})`);
    const body = (await response.json().catch(() => null)) as Json | null;
    return { status: response.status, body };
  }

  const reason = (result: { status: number; body: Json | null }) =>
    String(result.body?.['reason'] ?? `HTTP ${result.status}`);
  const ok = (result: { status: number; body: Json | null }) => {
    if (result.status < 200 || result.status >= 300) throw new TrackerRequestError(`MangaUpdates: ${reason(result)}`);
  };
  const seriesId = (remoteId: string): number => {
    const id = Number(remoteId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new TrackerRequestError(`MangaUpdates has no series ${remoteId}`);
    return id;
  };

  async function listItem(token: string, id: number): Promise<ListItem | null> {
    const result = await call(token, 'GET', `/lists/series/${id}`);
    if (result.status === 404) return null;
    ok(result);
    const status = isObject(result.body?.['status']) ? result.body['status'] : undefined;
    const series = isObject(result.body?.['series']) ? result.body['series'] : undefined;
    const listId = result.body?.['list_id'];
    return {
      listId: typeof listId === 'number' ? listId : null,
      chapter: typeof status?.['chapter'] === 'number' ? status['chapter'] : null,
      title: text(series?.['title']) ?? null,
    };
  }

  /** The user's rating of a series, or null (none, or not readable: a missing rating is not an error). */
  async function rating(token: string, id: number): Promise<number | null> {
    const result = await call(token, 'GET', `/series/${id}/rating`);
    const value = result.body?.['rating'];
    return result.status === 200 && typeof value === 'number' && value > 0 ? value : null;
  }

  return {
    service: 'mangaupdates',
    name: 'MangaUpdates',

    async loginWithPassword(username, password): Promise<TrackerLogin> {
      const result = await call(null, 'PUT', '/account/login', { username, password });
      const context = result.body?.['context'];
      const token = isObject(context) ? context['session_token'] : undefined;
      if (typeof token !== 'string' || token === '') {
        throw new TrackerRequestError('MangaUpdates did not accept that username and password');
      }
      return { accessToken: token, refreshToken: null, expiresInSec: null };
    },

    async viewer(token) {
      const result = await call(token, 'GET', '/account/profile');
      ok(result);
      const name = result.body?.['username'];
      if (typeof name !== 'string') throw new TrackerAuthError('MangaUpdates no longer accepts the login');
      return { userId: String(result.body?.['user_id'] ?? name), username: name };
    },

    async search(token, query): Promise<TrackSearchResult[]> {
      const result = await call(token, 'POST', '/series/search', {
        search: query,
        perpage: 15,
        filter_types: ['drama cd', 'novel'],
      });
      ok(result);
      const hits = (Array.isArray(result.body?.['results']) ? result.body['results'] : []) as { record?: Json }[];
      return hits.flatMap(({ record }) => {
        if (!record || record['series_id'] === undefined) return [];
        const id = record['series_id'] as number | string;
        const year = record['year'] ? String(record['year']) : null;
        return [
          {
            remoteId: String(id),
            title: String(record['title'] ?? `#${id}`),
            coverUrl: text(urlsOf(record)?.['thumb']) ?? text(urlsOf(record)?.['original']) ?? null,
            url: text(record['url']) ?? entryUrl(id),
            detail:
              [record['type'] ? String(record['type']) : null, year].filter((part) => part !== null).join(' · ') ||
              null,
          },
        ];
      });
    },

    async getEntry(token, remoteId) {
      const id = seriesId(remoteId);
      const item = await listItem(token, id);
      if (!item) return null;
      return {
        remoteId,
        remoteUrl: entryUrl(id),
        remoteTitle: item.title,
        status: item.listId !== null ? (STATUS_FROM[item.listId] ?? null) : null,
        score: await rating(token, id),
        progress: item.chapter,
        startedAt: null,
        finishedAt: null,
      } satisfies RemoteEntry;
    },

    async save(token, remoteId, patch: TrackPatch) {
      const id = seriesId(remoteId);
      const current = await listItem(token, id);
      const chapter = patch.progress !== undefined ? (patch.progress ?? 0) : (current?.chapter ?? null);
      const listId =
        patch.status != null
          ? LIST_OF[patch.status]
          : (current?.listId ?? ((chapter ?? 0) > 0 ? LIST_OF.reading : LIST_OF.planning));

      if (!current) {
        ok(await call(token, 'POST', '/lists/series', [{ series: { id }, list_id: listId }]));
      }
      const moved = current !== null && listId !== current.listId;
      if (patch.progress !== undefined || moved || (!current && chapter !== null && chapter > 0)) {
        ok(
          await call(token, 'POST', '/lists/series/update', [
            { series: { id }, list_id: listId, ...(chapter !== null ? { status: { chapter } } : {}) },
          ]),
        );
      }
      let score = current ? await rating(token, id) : null;
      if (patch.score !== undefined) {
        if (patch.score === null || patch.score <= 0) {
          const removed = await call(token, 'DELETE', `/series/${id}/rating`);
          if (removed.status !== 404) ok(removed);
          score = null;
        } else {
          // Ratings are 1 to 10, in tenths.
          score = Math.min(10, Math.max(1, Math.round(patch.score * 10) / 10));
          ok(await call(token, 'PUT', `/series/${id}/rating`, { rating: score }));
        }
      }
      return {
        remoteId,
        remoteUrl: entryUrl(id),
        remoteTitle: current?.title ?? null,
        status: STATUS_FROM[listId] ?? null,
        score,
        progress: chapter,
        startedAt: null,
        finishedAt: null,
      };
    },
  };
}
