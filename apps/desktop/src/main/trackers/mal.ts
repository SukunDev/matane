import { randomBytes } from 'node:crypto';
import type { TrackPatch, TrackSearchResult, TrackStatus } from '@manga-reader/shared';
import {
  type RemoteEntry,
  type TrackerClient,
  type TrackerLogin,
  TrackerAuthError,
  TrackerRateLimitError,
  TrackerRequestError,
} from './types';

export const MAL_API = 'https://api.myanimelist.net/v2';
export const MAL_AUTHORIZE = 'https://myanimelist.net/v1/oauth2/authorize';
export const MAL_TOKEN = 'https://myanimelist.net/v1/oauth2/token';
export const MAL_SITE = 'https://myanimelist.net';

export type MalFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

export interface MalClient extends TrackerClient {
  exchange(code: string, verifier: string, redirectUri: string): Promise<TrackerLogin>;
  refresh(refreshToken: string): Promise<TrackerLogin>;
}

const STATUS_FROM: Record<string, TrackStatus> = {
  reading: 'reading',
  completed: 'completed',
  on_hold: 'on_hold',
  dropped: 'dropped',
  plan_to_read: 'planning',
};
const STATUS_TO: Record<TrackStatus, string> = {
  reading: 'reading',
  completed: 'completed',
  on_hold: 'on_hold',
  dropped: 'dropped',
  planning: 'plan_to_read',
};

interface MalListStatus {
  status?: string | null;
  score?: number | null;
  num_chapters_read?: number | null;
  is_rereading?: boolean | null;
  start_date?: string | null;
  finish_date?: string | null;
}

/** MAL dates are "2024-03-09", or less ("2024-03", "2024"). */
const fromMalDate = (text: string | null | undefined): number | null => {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text ?? '');
  return match ? Date.UTC(Number(match[1]), Number(match[2] ?? 1) - 1, Number(match[3] ?? 1)) : null;
};
const toMalDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const prettyType = (type: string | null | undefined) =>
  type ? type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null;

function toEntry(id: number | string, title: string | null, list: MalListStatus | null | undefined): RemoteEntry {
  return {
    remoteId: String(id),
    remoteUrl: `${MAL_SITE}/manga/${id}`,
    remoteTitle: title,
    // Re-reading something completed is reading again.
    status: list?.is_rereading ? 'reading' : list?.status ? (STATUS_FROM[list.status] ?? null) : null,
    // 0 means "no score".
    score: list?.score ? list.score : null,
    progress: list?.num_chapters_read ?? null,
    startedAt: fromMalDate(list?.start_date),
    finishedAt: fromMalDate(list?.finish_date),
  };
}

/** A random string for PKCE (MyAnimeList only knows the `plain` method, where the challenge is the verifier). */
export const newCodeVerifier = () => randomBytes(48).toString('base64url');

/** The address to open in the browser for the code flow. */
export function malAuthorizeUrl(options: { clientId: string; verifier: string; state: string; redirectUri: string }) {
  return `${MAL_AUTHORIZE}?${new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    code_challenge: options.verifier,
    code_challenge_method: 'plain',
    state: options.state,
    redirect_uri: options.redirectUri,
  })}`;
}

/**
 * MyAnimeList's API v2 (https://myanimelist.net/apiconfig/references/api/v2): OAuth2 with PKCE and no
 * client secret (an app of type "other"), tokens that are renewed with a refresh token.
 */
export function createMyAnimeList(options: {
  fetch: MalFetch;
  clientId: () => string | null;
  apiUrl?: string;
  tokenUrl?: string;
}): MalClient {
  const apiUrl = options.apiUrl ?? MAL_API;
  const tokenUrl = options.tokenUrl ?? MAL_TOKEN;

  /** The answer as JSON, or the tracker's error for what went wrong. */
  async function interpret<T>(response: Response, auth: 'token' | 'login'): Promise<T> {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      error?: string;
      error_description?: string;
    } | null;
    const message = body?.message ?? body?.error_description ?? body?.error ?? `HTTP ${response.status}`;
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      throw new TrackerRateLimitError(
        'MyAnimeList asked to slow down',
        (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000,
      );
    }
    // A token that is refused, or (at the token endpoint) a refresh token that is no good.
    if (response.status === 401 || (auth === 'login' && body?.error === 'invalid_grant')) {
      throw new TrackerAuthError('MyAnimeList no longer accepts the login');
    }
    if (response.status >= 500) throw new Error(`MyAnimeList is having trouble (${message})`);
    if (response.status === 404) throw new TrackerRequestError('MyAnimeList has no such manga');
    if (!response.ok || body === null) throw new TrackerRequestError(`MyAnimeList: ${message}`);
    return body as T;
  }

  async function api<T>(token: string, path: string, form?: Record<string, string>, method = 'GET'): Promise<T> {
    const response = await options.fetch(`${apiUrl}${path}`, {
      method: form ? 'PUT' : method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    return interpret<T>(response, 'token');
  }

  async function tokens(form: Record<string, string>): Promise<TrackerLogin> {
    const clientId = options.clientId();
    if (!clientId) throw new TrackerRequestError('MyAnimeList has no app registration in this build');
    const response = await options.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, ...form }).toString(),
    });
    const body = await interpret<{ access_token?: string; refresh_token?: string; expires_in?: number }>(
      response,
      'login',
    );
    if (!body.access_token) throw new TrackerRequestError('MyAnimeList sent no access token');
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresInSec: typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : null,
    };
  }

  return {
    service: 'mal',
    name: 'MyAnimeList',

    exchange: (code, verifier, redirectUri) =>
      tokens({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }),
    refresh: (refreshToken) => tokens({ grant_type: 'refresh_token', refresh_token: refreshToken }),

    async viewer(token) {
      const me = await api<{ id: number; name: string }>(token, '/users/@me');
      return { userId: String(me.id), username: me.name };
    },

    async search(token, query): Promise<TrackSearchResult[]> {
      const text = query.trim();
      if (text.length < 3) throw new TrackerRequestError('MyAnimeList needs at least 3 letters to search');
      const params = new URLSearchParams({
        q: text.slice(0, 64),
        limit: '15',
        nsfw: 'true',
        fields: 'id,title,main_picture,media_type,num_chapters,start_date',
      });
      const data = await api<{
        data?: {
          node: {
            id: number;
            title: string;
            main_picture?: { medium?: string } | null;
            media_type?: string | null;
            num_chapters?: number | null;
            start_date?: string | null;
          };
        }[];
      }>(token, `/manga?${params}`);
      return (data.data ?? []).map(({ node }) => ({
        remoteId: String(node.id),
        title: node.title,
        coverUrl: node.main_picture?.medium ?? null,
        url: `${MAL_SITE}/manga/${node.id}`,
        detail:
          [
            prettyType(node.media_type),
            node.start_date?.slice(0, 4) ?? null,
            node.num_chapters ? `${node.num_chapters} chapters` : null,
          ]
            .filter((part) => part !== null)
            .join(' · ') || null,
      }));
    },

    async getEntry(token, remoteId) {
      const params = new URLSearchParams({ fields: 'title,num_chapters,my_list_status{start_date,finish_date}' });
      const manga = await api<{ id: number; title: string; my_list_status?: MalListStatus | null }>(
        token,
        `/manga/${encodeURIComponent(remoteId)}?${params}`,
      );
      return manga.my_list_status?.status ? toEntry(manga.id, manga.title, manga.my_list_status) : null;
    },

    async save(token, remoteId, patch: TrackPatch) {
      const form: Record<string, string> = {};
      if (patch.status != null) form['status'] = STATUS_TO[patch.status];
      if (patch.progress !== undefined) form['num_chapters_read'] = String(patch.progress ?? 0);
      // MyAnimeList scores are whole numbers; 0 removes the score.
      if (patch.score !== undefined) form['score'] = String(patch.score === null ? 0 : Math.round(patch.score));
      // A date can be set but not cleared through the API, so an empty one is left out.
      if (patch.startedAt != null) form['start_date'] = toMalDate(patch.startedAt);
      if (patch.finishedAt != null) form['finish_date'] = toMalDate(patch.finishedAt);
      const list = await api<MalListStatus>(token, `/manga/${encodeURIComponent(remoteId)}/my_list_status`, form);
      return toEntry(remoteId, null, list);
    },
  };
}
