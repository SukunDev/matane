import type { Filter, FilterOption, FilterState, SortValue } from '@manga-reader/extension-sdk';
import { type Collection, type QueryValue, type Tag, apiGet } from './api';

const TAG_CACHE_KEY = 'tags';
const TAG_CACHE_MS = 7 * 24 * 3_600_000;

const STATUSES: FilterOption[] = [
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'hiatus', label: 'Hiatus' },
  { value: 'cancelled', label: 'Cancelled' },
];
// Erotica and pornographic stay out: the extension is not flagged nsfw.
const CONTENT_RATINGS: FilterOption[] = [
  { value: 'safe', label: 'Safe' },
  { value: 'suggestive', label: 'Suggestive' },
];
export const DEFAULT_CONTENT_RATINGS = CONTENT_RATINGS.map((r) => r.value);
const DEMOGRAPHICS: FilterOption[] = [
  { value: 'shounen', label: 'Shounen' },
  { value: 'shoujo', label: 'Shoujo' },
  { value: 'seinen', label: 'Seinen' },
  { value: 'josei', label: 'Josei' },
  { value: 'none', label: 'None' },
];
const ORIGINAL_LANGUAGES: FilterOption[] = [
  { value: 'ja', label: 'Japanese (manga)' },
  { value: 'ko', label: 'Korean (manhwa)' },
  { value: 'zh', label: 'Chinese (manhua)' },
];
const SORTS: FilterOption[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'followedCount', label: 'Popularity' },
  { value: 'latestUploadedChapter', label: 'Latest upload' },
  { value: 'createdAt', label: 'Recently added' },
  { value: 'rating', label: 'Rating' },
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Year' },
];
const TAG_GROUPS: [Tag['attributes']['group'], string][] = [
  ['genre', 'Genres'],
  ['theme', 'Themes'],
  ['format', 'Format'],
  ['content', 'Content warnings'],
];

export const DEFAULT_SORT: SortValue = { value: 'relevance', ascending: false };

const checkboxes = (prefix: string, options: FilterOption[], checked: string[] = []): Filter[] =>
  options.map((o) => ({
    type: 'checkbox',
    id: `${prefix}.${o.value}`,
    label: o.label,
    default: checked.includes(o.value),
  }));

async function loadTags(): Promise<Tag[]> {
  const cached = await storage.get<{ at: number; tags: Tag[] }>(TAG_CACHE_KEY);
  if (cached && Date.now() - cached.at < TAG_CACHE_MS) return cached.tags;
  const response = await apiGet<Collection<Tag>>('/manga/tag');
  await storage.set(TAG_CACHE_KEY, { at: Date.now(), tags: response.data });
  return response.data;
}

export async function getFilters(): Promise<Filter[]> {
  const tags = await loadTags();
  const tagGroups: Filter[] = TAG_GROUPS.map(([group, label]) => ({
    type: 'group',
    id: `tags.${group}`,
    label,
    filters: tags
      .filter((tag) => tag.attributes.group === group)
      .map((tag): Filter & { label: string } => ({
        type: 'tristate',
        id: `tag.${tag.id}`,
        label: tag.attributes.name.en ?? tag.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  }));
  return [
    { type: 'sort', id: 'sort', label: 'Sort', options: SORTS, default: DEFAULT_SORT },
    { type: 'group', id: 'status', label: 'Status', filters: checkboxes('status', STATUSES) },
    {
      type: 'group',
      id: 'rating',
      label: 'Content rating',
      filters: checkboxes('rating', CONTENT_RATINGS, DEFAULT_CONTENT_RATINGS),
    },
    { type: 'group', id: 'demographic', label: 'Demographic', filters: checkboxes('demographic', DEMOGRAPHICS) },
    { type: 'group', id: 'origin', label: 'Original language', filters: checkboxes('origin', ORIGINAL_LANGUAGES) },
    { type: 'separator' },
    ...tagGroups,
  ];
}

/** Values of checked checkboxes with the given prefix. Unset checkboxes fall back to `defaults`. */
function checked(filters: FilterState, prefix: string, options: FilterOption[], defaults: string[] = []): string[] {
  return options
    .filter((o) => {
      const value = filters[`${prefix}.${o.value}`];
      return value === undefined ? defaults.includes(o.value) : value === true;
    })
    .map((o) => o.value);
}

/** Maps the host filter state onto /manga query parameters. */
export function filterParams(filters: FilterState): Record<string, QueryValue> {
  const included: string[] = [];
  const excluded: string[] = [];
  for (const [id, value] of Object.entries(filters)) {
    if (!id.startsWith('tag.')) continue;
    if (value === 'include') included.push(id.slice(4));
    if (value === 'exclude') excluded.push(id.slice(4));
  }
  const ratings = checked(filters, 'rating', CONTENT_RATINGS, DEFAULT_CONTENT_RATINGS);
  const origin = checked(filters, 'origin', ORIGINAL_LANGUAGES);
  // MangaDex splits Chinese into zh and zh-hk.
  if (origin.includes('zh')) origin.push('zh-hk');
  const sort = isSort(filters.sort) ? filters.sort : DEFAULT_SORT;

  return {
    includedTags: included.length > 0 ? included : undefined,
    excludedTags: excluded.length > 0 ? excluded : undefined,
    status: nonEmpty(checked(filters, 'status', STATUSES)),
    contentRating: ratings.length > 0 ? ratings : DEFAULT_CONTENT_RATINGS,
    publicationDemographic: nonEmpty(checked(filters, 'demographic', DEMOGRAPHICS)),
    originalLanguage: nonEmpty(origin),
    [`order[${sort.value}]`]: sort.ascending ? 'asc' : 'desc',
  };
}

const nonEmpty = (values: string[]) => (values.length > 0 ? values : undefined);

function isSort(value: unknown): value is SortValue {
  return typeof value === 'object' && value !== null && typeof (value as SortValue).value === 'string';
}
