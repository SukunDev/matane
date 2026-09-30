export const BASE_URL = 'https://v3.ainzscans01.com';
export const API_URL = 'https://api.ainzscans01.com/api';

export interface MangaDto {
  id: string;
  title: string;
  slug: string;
  poster_image_url?: string | null;
  banner_image_url?: string | null;
  comic_status?: string | null;
  comic_subtype?: string | null;
  author_name?: string | null;
  artist_name?: string | null;
  primary_genre?: string | null;
}

export interface SearchResponseDto {
  data: MangaDto[];
  total_pages: number;
  current_page?: number;
  total_records?: number;
}

export interface GenreDto {
  id?: number | string;
  name: string;
  slug: string;
}

export interface ChapterDto {
  id?: string;
  slug: string;
  number: string;
  title?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SeriesDetailDto {
  id: string;
  title: string;
  slug: string;
  synopsis?: string | null;
  poster_image_url?: string | null;
  banner_image_url?: string | null;
  comic_status?: string | null;
  comic_subtype?: string | null;
  author_name?: string | null;
  artist_name?: string | null;
  primary_genre?: string | null;
  genres?: GenreDto[];
  units?: ChapterDto[];
}

export interface PageDto {
  id?: string;
  page_number?: number;
  image_url: string;
}

export interface ChapterPagesDto {
  login_required?: boolean | null;
  password_required?: boolean;
  pages?: PageDto[];
}

export interface ChapterPagesResponseDto {
  chapter?: ChapterPagesDto;
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

export async function apiGet<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
  const query = queryString(params);
  const url = `${API_URL}${path}${query ? `?${query}` : ''}`;
  const response = await http.get<T>(url, {
    responseType: 'json',
  });
  return response.body;
}
