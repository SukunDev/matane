import type { TrackPatch, TrackSearchResult, TrackStatus } from '@manga-reader/shared';
import { KITSU_CLIENT_ID, KITSU_CLIENT_SECRET } from './client-ids';
import {
  type RemoteEntry,
  type TrackerClient,
  type TrackerLogin,
  TrackerAuthError,
  TrackerRateLimitError,
  TrackerRequestError,
} from './types';

export const KITSU_GRAPHQL = 'https://kitsu.app/api/graphql';
export const KITSU_TOKEN = 'https://kitsu.app/api/oauth/token';
export const KITSU_SITE = 'https://kitsu.app';

export type KitsuFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

export interface KitsuClient extends TrackerClient {
  loginWithPassword(username: string, password: string): Promise<TrackerLogin>;
  refresh(refreshToken: string): Promise<TrackerLogin>;
}

const STATUS_FROM: Record<string, TrackStatus> = {
  CURRENT: 'reading',
  PLANNED: 'planning',
  COMPLETED: 'completed',
  ON_HOLD: 'on_hold',
  DROPPED: 'dropped',
};
const STATUS_TO: Record<TrackStatus, string> = {
  reading: 'CURRENT',
  planning: 'PLANNED',
  completed: 'COMPLETED',
  on_hold: 'ON_HOLD',
  dropped: 'DROPPED',
};

/** Kitsu rates from 2 to 20 (a 10-point scale in halves); no rating at all is `null`. */
const toRating = (score: number | null): number | null =>
  score === null || score <= 0 ? null : Math.min(20, Math.max(2, Math.round(score * 2)));
const fromRating = (rating: number | null | undefined): number | null => (rating ? rating / 2 : null);
const fromIso = (text: string | null | undefined): number | null => {
  const ms = text ? Date.parse(text) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
};
/** A date as a GraphQL literal (written into the query, so the scalar's name never has to be known). */
const literal = (ms: number | null): string => (ms === null ? 'null' : JSON.stringify(new Date(ms).toISOString()));

interface KitsuEntry {
  id: string;
  private?: boolean | null;
  progress?: number | null;
  rating?: number | null;
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}
interface KitsuManga {
  id: string;
  slug?: string | null;
  titles?: { preferred?: string | null } | null;
  myLibraryEntry?: KitsuEntry | null;
}

const MANGA_FIELDS = 'id slug titles { preferred }';
const ENTRY_FIELDS = 'id private progress rating status startedAt finishedAt';

const mangaUrl = (manga: KitsuManga) => `${KITSU_SITE}/manga/${manga.slug ?? manga.id}`;

function toEntry(manga: KitsuManga, entry: KitsuEntry): RemoteEntry {
  return {
    remoteId: String(manga.id),
    remoteUrl: mangaUrl(manga),
    remoteTitle: manga.titles?.preferred ?? null,
    status: entry.status ? (STATUS_FROM[entry.status] ?? null) : null,
    score: fromRating(entry.rating),
    progress: entry.progress ?? null,
    startedAt: fromIso(entry.startedAt),
    finishedAt: fromIso(entry.finishedAt),
  };
}

const prettyType = (type: string | null | undefined) =>
  type
    ? type
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase())
    : null;

/**
 * Kitsu (https://kitsu.app), through its GraphQL API: a login with email and password (the password
 * grant), tokens that are renewed, and a library entry that is created or updated whole.
 */
export function createKitsu(options: {
  fetch: KitsuFetch;
  graphqlUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
}): KitsuClient {
  const graphqlUrl = options.graphqlUrl ?? KITSU_GRAPHQL;
  const tokenUrl = options.tokenUrl ?? KITSU_TOKEN;
  const clientId = options.clientId ?? KITSU_CLIENT_ID;
  const clientSecret = options.clientSecret ?? KITSU_CLIENT_SECRET;

  /** What a failed answer means, for both the API and the token endpoint. */
  function check(response: Response): void {
    if (response.headers.get('cf-mitigated') === 'challenge') {
      throw new TrackerRequestError('Kitsu blocked the request with a Cloudflare check; try again later');
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      throw new TrackerRateLimitError(
        'Kitsu asked to slow down',
        (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000,
      );
    }
    if (response.status >= 500) throw new Error(`Kitsu is having trouble (HTTP ${response.status})`);
  }

  async function graphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const response = await options.fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    });
    check(response);
    const body = (await response.json().catch(() => null)) as {
      data?: T | null;
      errors?: { message?: string }[];
    } | null;
    const message = body?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    if (
      response.status === 401 ||
      /unauthori[sz]ed|not authenticated|(invalid|expired|revoked).{0,12}token|token.{0,12}(invalid|expired|revoked)/i.test(
        message,
      )
    ) {
      throw new TrackerAuthError('Kitsu no longer accepts the login');
    }
    if (!response.ok || body?.errors?.length || !body?.data) throw new TrackerRequestError(`Kitsu: ${message}`);
    return body.data;
  }

  async function tokens(form: Record<string, string>, kind: 'password' | 'refresh'): Promise<TrackerLogin> {
    const response = await options.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ ...form, client_id: clientId, client_secret: clientSecret }).toString(),
    });
    check(response);
    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    } | null;
    if (response.status === 400 || response.status === 401) {
      // A wrong password is the user's to fix; a refresh token that no longer works needs a new login.
      if (kind === 'password') throw new TrackerRequestError('Kitsu did not accept that email and password');
      throw new TrackerAuthError('Kitsu no longer accepts the login');
    }
    if (!response.ok || !body?.access_token) {
      throw new TrackerRequestError(`Kitsu: ${body?.error_description ?? body?.error ?? `HTTP ${response.status}`}`);
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresInSec: typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : null,
    };
  }

  async function findManga(token: string, remoteId: string): Promise<KitsuManga | null> {
    const data = await graphql<{ findMangaById: KitsuManga | null }>(
      token,
      `query ($id: ID!) { findMangaById(id: $id) { ${MANGA_FIELDS} myLibraryEntry { ${ENTRY_FIELDS} } } }`,
      { id: remoteId },
    );
    return data.findMangaById;
  }

  return {
    service: 'kitsu',
    name: 'Kitsu',

    loginWithPassword: (username, password) => tokens({ grant_type: 'password', username, password }, 'password'),
    refresh: (refreshToken) => tokens({ grant_type: 'refresh_token', refresh_token: refreshToken }, 'refresh'),

    async viewer(token) {
      const data = await graphql<{ currentAccount: { id: string; profile?: { name?: string | null } | null } | null }>(
        token,
        'query { currentAccount { id profile { name } } }',
      );
      if (!data.currentAccount) throw new TrackerAuthError('Kitsu no longer accepts the login');
      return {
        userId: String(data.currentAccount.id),
        username: data.currentAccount.profile?.name ?? data.currentAccount.id,
      };
    },

    async search(token, query): Promise<TrackSearchResult[]> {
      const data = await graphql<{
        searchMangaByTitle: {
          nodes: (KitsuManga & { chapterCount?: number | null; subtype?: string | null; startDate?: string | null })[];
        };
      }>(
        token,
        `query ($query: String!) { searchMangaByTitle(title: $query, first: 15) {
           nodes { ${MANGA_FIELDS} chapterCount subtype startDate } } }`,
        { query },
      );
      return data.searchMangaByTitle.nodes.map((node) => ({
        remoteId: String(node.id),
        title: node.titles?.preferred ?? `#${node.id}`,
        coverUrl: null,
        url: mangaUrl(node),
        detail:
          [
            prettyType(node.subtype),
            node.startDate?.slice(0, 4) ?? null,
            node.chapterCount ? `${node.chapterCount} chapters` : null,
          ]
            .filter((part) => part !== null)
            .join(' · ') || null,
      }));
    },

    async getEntry(token, remoteId) {
      const manga = await findManga(token, remoteId);
      if (!manga) throw new TrackerRequestError(`Kitsu has no manga ${remoteId}`);
      return manga.myLibraryEntry ? toEntry(manga, manga.myLibraryEntry) : null;
    },

    /** Kitsu's mutations take the whole entry, so what the patch leaves out is read first and kept. */
    async save(token, remoteId, patch: TrackPatch) {
      const manga = await findManga(token, remoteId);
      if (!manga) throw new TrackerRequestError(`Kitsu has no manga ${remoteId}`);
      const entry = manga.myLibraryEntry ?? null;
      const progress = patch.progress !== undefined ? (patch.progress ?? 0) : (entry?.progress ?? 0);
      const status: TrackStatus =
        patch.status ??
        (entry?.status ? STATUS_FROM[entry.status] : undefined) ??
        (progress > 0 ? 'reading' : 'planning');
      const rating = patch.score !== undefined ? toRating(patch.score) : (entry?.rating ?? null);
      const startedAt = patch.startedAt !== undefined ? patch.startedAt : fromIso(entry?.startedAt);
      const finishedAt = patch.finishedAt !== undefined ? patch.finishedAt : fromIso(entry?.finishedAt);

      const fail = (errors: { message?: string }[] | null | undefined) => {
        if (errors?.length) throw new TrackerRequestError(`Kitsu: ${errors[0]?.message ?? 'the entry was refused'}`);
      };
      const update = async (libraryId: string) => {
        const result = await graphql<{
          libraryEntry: { update: { errors?: { message?: string }[]; libraryEntry?: { id: string } | null } };
        }>(
          token,
          `mutation ($library_id: ID!, $status: LibraryEntryStatusEnum!, $progress: Int!, $private: Boolean!, $rating: Int) {
             libraryEntry { update(input: {
               id: $library_id, status: $status, progress: $progress, private: $private, rating: $rating,
               startedAt: ${literal(startedAt)}, finishedAt: ${literal(finishedAt)}
             }) { errors { message } libraryEntry { id } } } }`,
          {
            library_id: libraryId,
            status: STATUS_TO[status],
            progress,
            private: entry?.private ?? false,
            rating,
          },
        );
        fail(result.libraryEntry.update.errors);
      };

      if (entry) {
        await update(entry.id);
      } else {
        const created = await graphql<{
          libraryEntry: { create: { errors?: { message?: string }[]; libraryEntry?: { id: string } | null } };
        }>(
          token,
          `
            mutation (
              $media_id: ID!
              $status: LibraryEntryStatusEnum!
              $progress: Int!
              $private: Boolean!
              $rating: Int
            ) {
              libraryEntry {
                create(
                  input: {
                    mediaId: $media_id
                    mediaType: MANGA
                    status: $status
                    progress: $progress
                    private: $private
                    rating: $rating
                  }
                ) {
                  errors {
                    message
                  }
                  libraryEntry {
                    id
                  }
                }
              }
            }
          `,
          { media_id: remoteId, status: STATUS_TO[status], progress, private: false, rating },
        );
        fail(created.libraryEntry.create.errors);
        const id = created.libraryEntry.create.libraryEntry?.id;
        // Creating takes no dates: they follow in an update.
        if (id && (startedAt !== null || finishedAt !== null)) await update(id);
      }
      return {
        remoteId: String(manga.id),
        remoteUrl: mangaUrl(manga),
        remoteTitle: manga.titles?.preferred ?? null,
        status,
        score: fromRating(rating),
        progress,
        startedAt,
        finishedAt,
      };
    },
  };
}
