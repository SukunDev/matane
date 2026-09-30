import type { Filter, FilterOption, FilterState } from '@matane/extension-sdk';
import { type GenreDto, type QueryValue, apiGet } from './api';

const GENRE_CACHE_KEY = 'genres';
const GENRE_CACHE_MS = 7 * 24 * 3_600_000;

export const OVERLOADED_GENRES = new Set(['action', 'adult', 'drama', 'fantasy', 'romance', 'smut', 'adventure']);

export const SORTS: FilterOption[] = [
  { value: 'views', label: 'Top Views' },
  { value: 'latest', label: 'Latest' },
  { value: 'new', label: 'New' },
  { value: 'rate', label: 'Top Rate' },
  { value: 'bookmark', label: 'Top Bookmark' },
  { value: 'az', label: 'Title A-Z' },
  { value: 'za', label: 'Title Z-A' },
];

export const ORDERS: FilterOption[] = [
  { value: 'desc', label: 'Descending' },
  { value: 'asc', label: 'Ascending' },
];

export const STATUSES: FilterOption[] = [
  { value: '', label: 'All' },
  { value: 'ONGOING', label: 'Ongoing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'HIATUS', label: 'Hiatus' },
];

export const TYPES: FilterOption[] = [
  { value: '', label: 'All' },
  { value: 'MANGA', label: 'Manga' },
  { value: 'MANHWA', label: 'Manhwa' },
  { value: 'MANHUA', label: 'Manhua' },
];

export const COLORS: FilterOption[] = [
  { value: '', label: 'All' },
  { value: 'FULL_COLOR', label: 'Full Color' },
  { value: 'BW', label: 'B&W' },
];

export const READING_FORMATS: FilterOption[] = [
  { value: '', label: 'All' },
  { value: 'VERTICAL_SCROLL', label: 'Vertical Scroll' },
  { value: 'PAGE', label: 'Page' },
];

export const FALLBACK_GENRES: [string, string][] = [
  ['Action', 'action'],
  ['Adult', 'adult'],
  ['Adventure', 'adventure'],
  ['Comedy', 'comedy'],
  ['Drama', 'drama'],
  ['Ecchi', 'ecchi'],
  ['Fantasy', 'fantasy'],
  ['Gender Bender', 'gender-bender'],
  ['Harem', 'harem'],
  ['Historical', 'historical'],
  ['Horror', 'horror'],
  ['Isekai', 'isekai'],
  ['Josei', 'josei'],
  ['Martial Arts', 'martial-arts'],
  ['Mature', 'mature'],
  ['Mystery', 'mystery'],
  ['Psychological', 'psychological'],
  ['Romance', 'romance'],
  ['School Life', 'school-life'],
  ['Sci Fi', 'sci-fi'],
  ['Seinen', 'seinen'],
  ['Shoujo', 'shoujo'],
  ['Slice Of Life', 'slice-of-life'],
  ['Smut', 'smut'],
  ['Sports', 'sports'],
  ['Supernatural', 'supernatural'],
  ['Thriller', 'thriller'],
  ['Tragedy', 'tragedy'],
];

async function loadGenres(): Promise<[string, string][]> {
  const cached = await storage.get<{ at: number; genres: [string, string][] }>(GENRE_CACHE_KEY);
  if (cached && Date.now() - cached.at < GENRE_CACHE_MS) return cached.genres;
  try {
    const response = await apiGet<GenreDto[]>('/genres');
    const genres: [string, string][] = (response || [])
      .filter((g) => Boolean(g.slug && g.name))
      .map((g) => [g.name, g.slug]);
    if (genres.length > 0) {
      await storage.set(GENRE_CACHE_KEY, { at: Date.now(), genres });
      return genres;
    }
  } catch (error) {
    log.warn('Failed to load genres from API, using fallbacks', error);
  }
  return cached?.genres || FALLBACK_GENRES;
}

export async function getFilters(): Promise<Filter[]> {
  const allGenres = await loadGenres();
  const availableGenres: FilterOption[] = [
    { value: '', label: 'All' },
    ...allGenres
      .filter(([, slug]) => !OVERLOADED_GENRES.has(slug))
      .map(([name, slug]) => ({ value: slug, label: name })),
  ];

  return [
    {
      type: 'select',
      id: 'sort',
      label: 'Sort',
      options: SORTS,
      default: 'views',
    },
    {
      type: 'select',
      id: 'order',
      label: 'Order',
      options: ORDERS,
      default: 'desc',
    },
    {
      type: 'select',
      id: 'status',
      label: 'Status',
      options: STATUSES,
      default: '',
    },
    {
      type: 'select',
      id: 'genre',
      label: 'Genre',
      options: availableGenres,
      default: '',
    },
    {
      type: 'select',
      id: 'type',
      label: 'Type',
      options: TYPES,
      default: '',
    },
    {
      type: 'select',
      id: 'color',
      label: 'Color',
      options: COLORS,
      default: '',
    },
    {
      type: 'select',
      id: 'reading',
      label: 'Reading',
      options: READING_FORMATS,
      default: '',
    },
    {
      type: 'checkbox',
      id: 'project_only',
      label: 'Project Only',
      default: false,
    },
    {
      type: 'text',
      id: 'author',
      label: 'Author',
    },
    {
      type: 'text',
      id: 'artist',
      label: 'Artist',
    },
    {
      type: 'text',
      id: 'publisher',
      label: 'Publisher',
    },
  ];
}

export function filterParams(filters: FilterState): Record<string, QueryValue> {
  const params: Record<string, QueryValue> = {};

  if (typeof filters.sort === 'string' && filters.sort) {
    params.sort = filters.sort;
  }
  if (typeof filters.order === 'string' && filters.order) {
    params.order = filters.order;
  }
  if (typeof filters.status === 'string' && filters.status) {
    params.status = filters.status;
  }
  if (typeof filters.genre === 'string' && filters.genre) {
    params.genre = filters.genre;
  }
  if (typeof filters.type === 'string' && filters.type) {
    params.comic_type = filters.type;
  }
  if (typeof filters.color === 'string' && filters.color) {
    params.color_format = filters.color;
  }
  if (typeof filters.reading === 'string' && filters.reading) {
    params.reading_format = filters.reading;
  }
  if (filters.project_only === true) {
    params.project_only = 1;
  }
  if (typeof filters.author === 'string' && filters.author.trim()) {
    params.author = filters.author.trim();
  }
  if (typeof filters.artist === 'string' && filters.artist.trim()) {
    params.artist = filters.artist.trim();
  }
  if (typeof filters.publisher === 'string' && filters.publisher.trim()) {
    params.publisher = filters.publisher.trim();
  }

  return params;
}
