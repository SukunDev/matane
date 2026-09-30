import type { Filter, FilterOption, FilterState } from '@matane/extension-sdk';

export const STATUSES: FilterOption[] = [
  { value: '', label: 'All' },
  { value: 'Ongoing', label: 'Ongoing' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Dropped', label: 'Dropped' },
  { value: 'Upcoming', label: 'Upcoming' },
  { value: 'Hiatus', label: 'Hiatus' },
  { value: 'Cancelled', label: 'Cancelled' },
];

export const TYPES: FilterOption[] = [
  { value: '', label: 'All' },
  { value: 'Manga', label: 'Manga' },
  { value: 'Manhua', label: 'Manhua' },
  { value: 'Manhwa', label: 'Manhwa' },
  { value: 'Novel', label: 'Novel' },
  { value: 'Web Novel (JP)', label: 'Web Novel (JP)' },
  { value: 'Web Novel (KR)', label: 'Web Novel (KR)' },
  { value: 'Web Novel (CN)', label: 'Web Novel (CN)' },
  { value: 'Doujinshi', label: 'Doujinshi' },
];

export const LANGUAGES: FilterOption[] = [
  { value: '', label: 'All' },
  { value: 'Indonesian', label: 'Indonesian' },
  { value: 'English', label: 'English' },
];

export const GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Crime',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Harem',
  'Historical',
  'Horror',
  'Isekai',
  'Josei',
  'Magic',
  'Martial Arts',
  'Medical',
  'Military',
  'Music',
  'Mystery',
  'One Shot',
  'Police',
  'Psychological',
  'Reincarnation',
  'Revenge',
  'Romance',
  'School Life',
  'Sci-Fi',
  'Seinen',
  'Shounen',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Survival',
  'Thriller',
  'Time Travel',
  'Tragedy',
  'Vampire',
];

export function getFilters(): Filter[] {
  return [
    {
      type: 'select',
      id: 'status',
      label: 'Status',
      options: STATUSES,
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
      id: 'language',
      label: 'Language',
      options: LANGUAGES,
      default: '',
    },
    {
      type: 'group',
      id: 'genres',
      label: 'Genre',
      filters: GENRES.map((g) => ({
        type: 'checkbox',
        id: `genre.${g}`,
        label: g,
        default: false,
      })),
    },
  ];
}

export function buildSearchPath(filters: FilterState): string {
  const segments: string[] = ['Series'];

  if (typeof filters.status === 'string' && filters.status) {
    segments.push(filters.status);
  }
  if (typeof filters.type === 'string' && filters.type) {
    segments.push(filters.type);
  }
  if (typeof filters.language === 'string' && filters.language) {
    segments.push(filters.language);
  }

  for (const [key, value] of Object.entries(filters)) {
    if (key.startsWith('genre.') && value === true) {
      segments.push(key.slice(6));
    }
  }

  return `/feeds/posts/default/-/${segments.map(encodeURIComponent).join('/')}`;
}
