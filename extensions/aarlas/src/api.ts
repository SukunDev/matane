export const BASE_URL = 'https://www.arlas.online';

export interface BloggerText {
  $t: string;
}

export interface BloggerLink {
  rel: string;
  type?: string;
  href: string;
  title?: string;
}

export interface BloggerCategory {
  term: string;
  scheme?: string;
}

export interface BloggerThumbnail {
  url: string;
}

export interface BloggerEntry {
  title?: BloggerText;
  published?: BloggerText;
  updated?: BloggerText;
  category?: BloggerCategory[];
  link?: BloggerLink[];
  content?: BloggerText;
  summary?: BloggerText;
  media$thumbnail?: BloggerThumbnail;
}

export interface BloggerFeed {
  title?: BloggerText;
  openSearch$totalResults?: BloggerText;
  openSearch$startIndex?: BloggerText;
  openSearch$itemsPerPage?: BloggerText;
  category?: BloggerCategory[];
  entry?: BloggerEntry[];
}

export interface BloggerFeedResponse {
  feed?: BloggerFeed;
}

export type QueryValue = string | number | boolean | undefined;

export function queryString(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.join('&');
}

export async function fetchFeed(path: string, params: Record<string, QueryValue> = {}): Promise<BloggerFeedResponse> {
  const query = queryString({ alt: 'json', ...params });
  const url = `${BASE_URL}${path}${query ? `?${query}` : ''}`;
  const response = await http.get<BloggerFeedResponse>(url, {
    responseType: 'json',
  });
  return response.body;
}
