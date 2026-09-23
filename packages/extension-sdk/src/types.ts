// Data model shared by extensions and the host (BRAINSTORM.md §5.3–5.5). Mirrors Mihon so ports are easy.

/**
 * Stable identity chosen by the extension. Usually a path relative to `baseUrl` (so a domain change
 * does not break libraries), but any stable id works (e.g. a MangaDex UUID).
 */
export type EntityUrl = string;

export interface MangaSummary {
  url: EntityUrl;
  title: string;
  thumbnailUrl?: string;
}

export type MangaStatus = 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | 'unknown';
export type MangaType = 'manga' | 'manhwa' | 'manhua' | 'comic';

export interface MangaDetails extends MangaSummary {
  author?: string;
  artist?: string;
  description?: string;
  genres?: string[];
  status: MangaStatus;
  /** Used to pick the default reading mode (manhwa/manhua → webtoon). */
  type?: MangaType;
}

export interface Chapter {
  url: EntityUrl;
  name: string;
  /** Chapter number when known; the host can guess it from `name` otherwise. */
  number?: number;
  scanlator?: string;
  /** Epoch milliseconds. */
  uploadedAt?: number;
}

export interface Page {
  index: number;
  /** Direct image URL, or… */
  imageUrl?: string;
  /** …a page URL that `getImageUrl()` resolves to an image URL. */
  url?: string;
}

export interface MangaPage {
  items: MangaSummary[];
  hasNextPage: boolean;
}

// ---------------------------------------------------------------- filters

export interface FilterOption {
  value: string;
  label: string;
}

export type Filter =
  | { type: 'header'; label: string }
  | { type: 'separator' }
  | { type: 'text'; id: string; label: string; placeholder?: string }
  | { type: 'select'; id: string; label: string; options: FilterOption[]; default?: string }
  | { type: 'checkbox'; id: string; label: string; default?: boolean }
  /** include / exclude / ignore */
  | { type: 'tristate'; id: string; label: string }
  | { type: 'sort'; id: string; label: string; options: FilterOption[]; default?: SortValue }
  /** A titled group of checkbox/tristate filters (e.g. genres). Child ids share the flat state. */
  | { type: 'group'; id: string; label: string; filters: Filter[] };

export type TriState = 'include' | 'exclude';
export interface SortValue {
  value: string;
  ascending: boolean;
}
export type FilterValue = string | boolean | TriState | SortValue;
/** Keyed by filter id. Unset filters are simply absent. */
export type FilterState = Record<string, FilterValue>;

// ------------------------------------------------------------ preferences

export type Preference =
  | { type: 'switch'; key: string; label: string; description?: string; default: boolean }
  | { type: 'select'; key: string; label: string; description?: string; options: FilterOption[]; default: string }
  | {
      type: 'multiselect';
      key: string;
      label: string;
      description?: string;
      options: FilterOption[];
      default: string[];
    }
  | { type: 'text'; key: string; label: string; description?: string; default: string };

// ------------------------------------------------------------------ images

export interface ImageTransform {
  bytes?: Uint8Array;
  tiles?: {
    width: number;
    height: number;
    ops: { sx: number; sy: number; w: number; h: number; dx: number; dy: number }[];
  };
}

/** Outcome of an image fetch, passed to `Source.reportImage` (e.g. MangaDex@Home reporting). */
export interface ImageFetchResult {
  url: string;
  success: boolean;
  bytes: number;
  durationMs: number;
  /** True when the response carried `X-Cache: HIT`. */
  cached: boolean;
}

// ------------------------------------------------------------------ source

export interface SourceInfo {
  /** Source key from the manifest, e.g. "en". */
  key: string;
  lang: string;
  name: string;
}

export interface Source {
  baseUrl: string;

  getPopular(page: number): Promise<MangaPage>;
  getLatest?(page: number): Promise<MangaPage>;
  search(query: string, page: number, filters: FilterState): Promise<MangaPage>;
  getFilters?(): Filter[] | Promise<Filter[]>;

  getMangaDetails(manga: MangaSummary): Promise<MangaDetails>;
  /** Newest first. */
  getChapters(manga: MangaSummary): Promise<Chapter[]>;
  getPages(chapter: Chapter): Promise<Page[]>;
  getImageUrl?(page: Page): Promise<string>;

  /** Extra headers for image requests (e.g. Referer). */
  imageHeaders?(): Record<string, string>;
  /** Maps a pasted web URL to a manga of this source, or null. */
  resolveUrl?(url: string): MangaSummary | null;
  /** Full URL for "open in browser". Defaults to `baseUrl + url`. */
  getWebUrl?(item: MangaSummary | Chapter): string;

  /** Called by the host after every image fetch; fire-and-forget. */
  reportImage?(result: ImageFetchResult): Promise<void> | void;
  /** Designed in API v1, implemented by the host in a later phase (BRAINSTORM.md §5.6). */
  transformImage?(page: Page, bytes: Uint8Array): Promise<ImageTransform>;
}

export interface ExtensionDefinition {
  createSource(info: SourceInfo): Source;
  /** Extension-wide settings; the host renders the UI and exposes values through `prefs`. */
  preferences?(): Preference[];
}
