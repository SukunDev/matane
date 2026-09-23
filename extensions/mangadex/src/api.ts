// Thin client for https://api.mangadex.org (docs: https://api.mangadex.org/docs/).
// The sandbox has no URL/URLSearchParams, so query strings are built by hand.

export const API_URL = 'https://api.mangadex.org';
export const COVERS_URL = 'https://uploads.mangadex.org/covers';
export const WEB_URL = 'https://mangadex.org';
export const REPORT_URL = 'https://api.mangadex.network/report';

/** Listing endpoints refuse offset + limit above this. */
export const MAX_RESULTS = 10_000;

export type LocalizedString = Record<string, string>;

export interface Relationship {
  id: string;
  type: string;
  attributes?: { name?: string; fileName?: string };
}

export interface Tag {
  id: string;
  type: 'tag';
  attributes: { name: LocalizedString; group: 'genre' | 'theme' | 'format' | 'content' };
}

export interface MangaData {
  id: string;
  type: 'manga';
  attributes: {
    title: LocalizedString;
    altTitles: LocalizedString[];
    description: LocalizedString;
    status: 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | null;
    originalLanguage: string;
    tags: Tag[];
  };
  relationships: Relationship[];
}

export interface ChapterData {
  id: string;
  type: 'chapter';
  attributes: {
    volume: string | null;
    chapter: string | null;
    title: string | null;
    translatedLanguage: string;
    externalUrl: string | null;
    publishAt: string;
    pages: number;
  };
  relationships: Relationship[];
}

export interface Collection<T> {
  result: 'ok';
  data: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface Entity<T> {
  result: 'ok';
  data: T;
}

export interface AtHome {
  result: 'ok';
  baseUrl: string;
  chapter: { hash: string; data: string[]; dataSaver: string[] };
}

export type QueryValue = string | number | boolean | readonly (string | number)[] | undefined;

/** `{ a: 1, tags: ['x', 'y'] }` → `a=1&tags[]=x&tags[]=y`. Keys may already contain brackets. */
export function queryString(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value as readonly (string | number)[]) {
        parts.push(`${encodeURIComponent(`${key}[]`)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

/** MangaDex asks clients to identify themselves and never spoof a browser. */
export const userAgent = () => `${host.appName}/${host.appVersion}`;

export async function apiGet<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  const query = queryString(params);
  const response = await http.get(`${API_URL}${path}${query ? `?${query}` : ''}`, {
    headers: { 'User-Agent': userAgent() },
    responseType: 'json',
  });
  return response.body as T;
}
