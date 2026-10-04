// Data model shared by extensions and the host (docs/BRAINSTORM.md §5.3–5.5). Mirrors Mihon so ports are easy.

/**
 * Stable identity chosen by the extension. Usually a path relative to `baseUrl` (so a domain change
 * does not break libraries), but any stable id works (e.g. a site's own UUID).
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

/** One rectangle copied from the source image (`sx`, `sy`) to the result (`dx`, `dy`). */
export interface TileOp {
  sx: number;
  sy: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

/**
 * What `transformImage` asks the host to do (docs/BRAINSTORM.md §5.6): replace the bytes (decrypted or
 * de-XORed), and/or rebuild the picture from tiles. Pixel work runs in the host, not the sandbox.
 */
export interface ImageTransform {
  /** The real image file, when the fetched one was encrypted. */
  bytes?: Uint8Array;
  /** Rebuild a `width` × `height` picture by copying rectangles of the (decrypted) image. */
  tiles?: {
    width: number;
    height: number;
    ops: TileOp[];
  };
}

/** What an entity url stands for, for `migrateUrl`. */
export type UrlKind = 'manga' | 'chapter';

/** Outcome of an image fetch, passed to `Source.reportImage` (e.g. an image network's reporting). */
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
  /**
   * Scrambled or encrypted images (docs/BRAINSTORM.md §5.6): gets the fetched bytes of a page and says how
   * to restore them. Only called when defined; the result is cached and downloaded restored.
   */
  transformImage?(page: Page, bytes: Uint8Array): ImageTransform | Promise<ImageTransform>;
  /**
   * After an update changes how `url` looks, maps a stored url (written by `fromVersion`) to the new
   * form; return null (or the same url) to keep it. Called by the host once per update, for every
   * manga and chapter of this source in the library and history.
   */
  migrateUrl?(url: EntityUrl, kind: UrlKind, fromVersion: string): EntityUrl | null;
}

export interface ExtensionDefinition {
  createSource(info: SourceInfo): Source;
  /** Extension-wide settings; the host renders the UI and exposes values through `prefs`. */
  preferences?(): Preference[];
}
