import type { TrackPatch, TrackSearchResult, TrackStatus } from '@manga-reader/shared';
import {
  type RemoteEntry,
  type TrackerClient,
  TrackerAuthError,
  TrackerRateLimitError,
  TrackerRequestError,
} from './types';

export const ANILIST_API = 'https://graphql.anilist.co';
export const ANILIST_AUTHORIZE = 'https://anilist.co/api/v2/oauth/authorize';
export const ANILIST_SITE = 'https://anilist.co';

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<Response>;

const STATUS_FROM: Record<string, TrackStatus> = {
  CURRENT: 'reading',
  REPEATING: 'reading',
  COMPLETED: 'completed',
  PAUSED: 'on_hold',
  DROPPED: 'dropped',
  PLANNING: 'planning',
};
const STATUS_TO: Record<TrackStatus, string> = {
  reading: 'CURRENT',
  completed: 'COMPLETED',
  on_hold: 'PAUSED',
  dropped: 'DROPPED',
  planning: 'PLANNING',
};

interface FuzzyDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

/** AniList dates are year, month and day, any of them missing. Epoch ms (UTC) in, and out. */
const toFuzzy = (ms: number | null): FuzzyDate => {
  if (ms === null) return { year: null, month: null, day: null };
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const fromFuzzy = (date: FuzzyDate | null | undefined): number | null =>
  date?.year ? Date.UTC(date.year, (date.month ?? 1) - 1, date.day ?? 1) : null;

const ENTRY_FIELDS = `id status progress score(format: POINT_100)
  startedAt { year month day } completedAt { year month day }`;
const MEDIA_FIELDS = `id siteUrl title { romaji english }`;

interface MediaListGql {
  status?: string | null;
  progress?: number | null;
  score?: number | null;
  startedAt?: FuzzyDate | null;
  completedAt?: FuzzyDate | null;
}
interface MediaGql {
  id: number;
  siteUrl?: string | null;
  title?: { romaji?: string | null; english?: string | null } | null;
}

const titleOf = (media: MediaGql) => media.title?.english || media.title?.romaji || null;

function toEntry(media: MediaGql, list: MediaListGql | null | undefined): RemoteEntry {
  return {
    remoteId: String(media.id),
    remoteUrl: media.siteUrl ?? `${ANILIST_SITE}/manga/${media.id}`,
    remoteTitle: titleOf(media),
    status: list?.status ? (STATUS_FROM[list.status] ?? null) : null,
    // 0 means "no score" on AniList.
    score: list?.score ? Math.round(list.score) / 10 : null,
    progress: list?.progress ?? null,
    startedAt: fromFuzzy(list?.startedAt),
    finishedAt: fromFuzzy(list?.completedAt),
  };
}

/** AniList's GraphQL API (https://docs.anilist.co), scores read and written on the 0 to 100 scale. */
export function createAniList(options: { fetch: FetchLike; url?: string; name?: string }): TrackerClient {
  const url = options.url ?? ANILIST_API;

  async function request<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await options.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    // Not JSON (an error page) is fine: the status says enough.
    const body = (await response.json().catch(() => null)) as {
      data?: T | null;
      errors?: { message?: string; status?: number }[];
    } | null;
    const message = body?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    if (response.status === 429 || body?.errors?.[0]?.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      throw new TrackerRateLimitError(
        'AniList asked to slow down',
        (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000,
      );
    }
    if (response.status === 401 || /invalid token|unauthenticated/i.test(message)) {
      throw new TrackerAuthError('AniList no longer accepts the login');
    }
    if (response.status >= 500) throw new Error(`AniList is having trouble (${message})`);
    if (!response.ok || body?.errors?.length || !body?.data) throw new TrackerRequestError(`AniList: ${message}`);
    return body.data;
  }

  return {
    service: 'anilist',
    name: options.name ?? 'AniList',

    async viewer(token) {
      const data = await request<{ Viewer: { id: number; name: string } }>(token, 'query { Viewer { id name } }');
      return { userId: String(data.Viewer.id), username: data.Viewer.name };
    },

    async search(token, query): Promise<TrackSearchResult[]> {
      const data = await request<{
        Page: {
          media: (MediaGql & {
            format?: string | null;
            chapters?: number | null;
            startDate?: { year?: number | null } | null;
            coverImage?: { medium?: string | null } | null;
          })[];
        };
      }>(
        token,
        `query ($search: String) { Page(perPage: 15) {
           media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
             ${MEDIA_FIELDS} format chapters startDate { year } coverImage { medium }
           } } }`,
        { search: query },
      );
      return data.Page.media.map((media) => ({
        remoteId: String(media.id),
        title: titleOf(media) ?? `#${media.id}`,
        coverUrl: media.coverImage?.medium ?? null,
        url: media.siteUrl ?? `${ANILIST_SITE}/manga/${media.id}`,
        detail:
          [
            media.format
              ? media.format
                  .replace(/_/g, ' ')
                  .toLowerCase()
                  .replace(/^./, (c) => c.toUpperCase())
              : null,
            media.startDate?.year ?? null,
            media.chapters ? `${media.chapters} chapters` : null,
          ]
            .filter((part) => part !== null)
            .join(' · ') || null,
      }));
    },

    async getEntry(token, remoteId) {
      const data = await request<{ Media: (MediaGql & { mediaListEntry?: MediaListGql | null }) | null }>(
        token,
        `query ($id: Int) { Media(id: $id, type: MANGA) { ${MEDIA_FIELDS} mediaListEntry { ${ENTRY_FIELDS} } } }`,
        { id: Number(remoteId) },
      );
      if (!data.Media) throw new TrackerRequestError(`AniList has no manga ${remoteId}`);
      return data.Media.mediaListEntry ? toEntry(data.Media, data.Media.mediaListEntry) : null;
    },

    async save(token, remoteId, patch: TrackPatch) {
      const variables: Record<string, unknown> = { mediaId: Number(remoteId) };
      const declared = ['$mediaId: Int'];
      const args = ['mediaId: $mediaId'];
      const add = (name: string, type: string, value: unknown) => {
        variables[name] = value;
        declared.push(`$${name}: ${type}`);
        args.push(`${name}: $${name}`);
      };
      if (patch.status !== undefined) {
        // Without a status there is nothing to say; a list entry always has one.
        if (patch.status !== null) add('status', 'MediaListStatus', STATUS_TO[patch.status]);
      }
      if (patch.progress !== undefined) add('progress', 'Int', patch.progress ?? 0);
      if (patch.score !== undefined) add('scoreRaw', 'Int', patch.score === null ? 0 : Math.round(patch.score * 10));
      if (patch.startedAt !== undefined) add('startedAt', 'FuzzyDateInput', toFuzzy(patch.startedAt));
      if (patch.finishedAt !== undefined) add('completedAt', 'FuzzyDateInput', toFuzzy(patch.finishedAt));
      const data = await request<{ SaveMediaListEntry: MediaListGql & { media: MediaGql } }>(
        token,
        `mutation (${declared.join(', ')}) { SaveMediaListEntry(${args.join(', ')}) {
           ${ENTRY_FIELDS} media { ${MEDIA_FIELDS} } } }`,
        variables,
      );
      return toEntry(data.SaveMediaListEntry.media, data.SaveMediaListEntry);
    },
  };
}
