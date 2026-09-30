import { hmacSha256Hex } from './crypto';

export const BASE_URL = 'https://v1.westmanga.my';
export const API_URL = 'https://data.mantweh.online';

export const ACCESS_KEY = 'WM_WEB_FRONT_END';
export const SECRET_KEY = 'xxxoidj';

export interface Data<T> {
  data: T;
}

export interface Paginator {
  current_page: number;
  last_page: number;
}

export interface PaginatedData<T> {
  data: T[];
  paginator: Paginator;
}

export interface BrowseManga {
  id: number;
  title: string;
  slug: string;
  cover?: string | null;
}

export interface Genre {
  name: string;
}

export interface ChapterData {
  id: number;
  slug: string;
  number: string;
  updated_at: { time: number; formatted?: string };
}

export interface MangaData {
  id: number;
  title: string;
  slug: string;
  alternative_name?: string | null;
  sinopsis?: string | null;
  cover?: string | null;
  author?: string | null;
  country_id?: string | null;
  status?: string | null;
  color?: boolean | null;
  genres: Genre[];
  chapters: ChapterData[];
}

export interface ImageList {
  images: string[];
}

export interface ApiGenre {
  id: number;
  name: string;
  slug: string;
}

export type QueryValue = string | number | boolean | readonly (string | number)[] | undefined;

export function queryString(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      const arrayKey = key.endsWith('[]') ? key : `${key}[]`;
      for (const item of value as readonly (string | number)[]) {
        parts.push(`${encodeURIComponent(arrayKey)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

export async function apiGet<T>(
  path: string,
  params: Record<string, QueryValue> = {},
  includeToken = true,
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = 'wm-api-request';
  const key = timestamp + 'GET' + path + ACCESS_KEY + SECRET_KEY;
  const signature = hmacSha256Hex(key, message);

  const headers: Record<string, string> = {
    'x-wm-request-time': timestamp,
    'x-wm-accses-key': ACCESS_KEY,
    'x-wm-request-signature': signature,
  };

  if (includeToken) {
    const token = await storage.get<string>('access_token');
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const query = queryString(params);
  const url = `${API_URL}${path}${query ? `?${query}` : ''}`;
  const response = await http.get(url, {
    headers,
    responseType: 'json',
  });
  return response.body as T;
}
