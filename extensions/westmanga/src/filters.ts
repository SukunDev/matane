import type { Filter, FilterOption, FilterState } from '@matane/extension-sdk';
import { type ApiGenre, type Data, type QueryValue, apiGet } from './api';

const GENRE_CACHE_KEY = 'genres';
const GENRE_CACHE_MS = 7 * 24 * 3_600_000;

export const SORTS: FilterOption[] = [
  { value: 'Default', label: 'Default' },
  { value: 'Az', label: 'A-Z' },
  { value: 'Za', label: 'Z-A' },
  { value: 'Update', label: 'Updated' },
  { value: 'Added', label: 'Added' },
  { value: 'Popular', label: 'Popular' },
];

export const STATUSES: FilterOption[] = [
  { value: 'All', label: 'All' },
  { value: 'Ongoing', label: 'Ongoing' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Hiatus', label: 'Hiatus' },
];

export const COUNTRIES: FilterOption[] = [
  { value: 'All', label: 'All' },
  { value: 'JP', label: 'Japan / Manga' },
  { value: 'CN', label: 'China / Manhua' },
  { value: 'KR', label: 'Korea / Manhwa' },
];

export const COLORS: FilterOption[] = [
  { value: 'All', label: 'All' },
  { value: 'Colored', label: 'Colored' },
  { value: 'Uncolored', label: 'Uncolored' },
];

async function loadGenres(): Promise<ApiGenre[]> {
  const cached = await storage.get<{ at: number; genres: ApiGenre[] }>(GENRE_CACHE_KEY);
  if (cached && Date.now() - cached.at < GENRE_CACHE_MS) return cached.genres;
  try {
    const response = await apiGet<Data<ApiGenre[]>>('/api/contents/genres', {}, false);
    const genres = response.data || [];
    await storage.set(GENRE_CACHE_KEY, { at: Date.now(), genres });
    return genres;
  } catch (error) {
    log.warn('Failed to load dynamic genres', error);
    return cached?.genres || [];
  }
}

export async function getFilters(): Promise<Filter[]> {
  const genres = await loadGenres();
  const filters: Filter[] = [
    {
      type: 'select',
      id: 'sort',
      label: 'Order',
      options: SORTS,
      default: 'Default',
    },
    {
      type: 'select',
      id: 'status',
      label: 'Status',
      options: STATUSES,
      default: 'All',
    },
    {
      type: 'select',
      id: 'country',
      label: 'Country / Type',
      options: COUNTRIES,
      default: 'All',
    },
    {
      type: 'select',
      id: 'color',
      label: 'Color',
      options: COLORS,
      default: 'All',
    },
  ];

  if (genres.length > 0) {
    filters.push({
      type: 'group',
      id: 'genres',
      label: 'Genre',
      filters: genres.map((g) => ({
        type: 'checkbox',
        id: `genre.${g.id}`,
        label: g.name,
        default: false,
      })),
    });
  }

  return filters;
}

export function filterParams(filters: FilterState): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};

  if (typeof filters.sort === 'string' && filters.sort !== 'Default') {
    params.orderBy = filters.sort;
  }
  if (typeof filters.status === 'string' && filters.status !== 'All') {
    params.status = filters.status;
  }
  if (typeof filters.country === 'string' && filters.country !== 'All') {
    params.country = filters.country;
  }
  if (typeof filters.color === 'string' && filters.color !== 'All') {
    params.color = filters.color;
  }

  const selectedGenres: (string | number)[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (key.startsWith('genre.') && value === true) {
      selectedGenres.push(key.slice(6));
    }
  }
  if (selectedGenres.length > 0) {
    params['genre[]'] = selectedGenres;
  }

  return params;
}
