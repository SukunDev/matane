import {
  type Chapter,
  type FilterState,
  type MangaPage,
  type MangaSummary,
  type Page,
  defineExtension,
} from '@manga-reader/extension-sdk';
import {
  type AtHome,
  type ChapterData,
  type Collection,
  type Entity,
  type MangaData,
  MAX_RESULTS,
  type QueryValue,
  REPORT_URL,
  WEB_URL,
  apiGet,
  userAgent,
} from './api';
import { DEFAULT_CONTENT_RATINGS, filterParams, getFilters } from './filters';
import { toChapter, toDetails, toSummary } from './parse';

const PAGE_SIZE = 24;
const FEED_PAGE_SIZE = 500;
const MANGA_INCLUDES = ['cover_art', 'author', 'artist'];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const DATA_SAVER_PREF = 'dataSaver';

export default defineExtension({
  preferences: () => [
    {
      type: 'switch',
      key: DATA_SAVER_PREF,
      label: 'Data saver',
      description: 'Load compressed, lower-quality images',
      default: false,
    },
  ],

  createSource: ({ lang }) => {
    async function listManga(page: number, params: Record<string, QueryValue>): Promise<MangaPage> {
      const offset = (page - 1) * PAGE_SIZE;
      if (offset + PAGE_SIZE > MAX_RESULTS) return { items: [], hasNextPage: false };
      const response = await apiGet<Collection<MangaData>>('/manga', {
        limit: PAGE_SIZE,
        offset,
        includes: ['cover_art'],
        availableTranslatedLanguage: [lang],
        hasAvailableChapters: true,
        contentRating: DEFAULT_CONTENT_RATINGS,
        ...params,
      });
      return {
        items: response.data.map((manga) => toSummary(manga, lang)),
        hasNextPage: offset + response.data.length < Math.min(response.total, MAX_RESULTS),
      };
    }

    return {
      baseUrl: WEB_URL,

      getPopular: (page) => listManga(page, { 'order[followedCount]': 'desc' }),

      getLatest: (page) => listManga(page, { 'order[latestUploadedChapter]': 'desc' }),

      getFilters,

      async search(query: string, page: number, filters: FilterState) {
        const trimmed = query.trim();
        // A pasted manga link or UUID opens that manga directly.
        const id = UUID.exec(trimmed)?.[0];
        if (id && page === 1) {
          const response = await apiGet<Entity<MangaData>>(`/manga/${id}`, { includes: ['cover_art'] });
          return { items: [toSummary(response.data, lang)], hasNextPage: false };
        }
        const params = filterParams(filters);
        // Relevance only makes sense for a title search.
        if (!trimmed && 'order[relevance]' in params) {
          delete params['order[relevance]'];
          params['order[followedCount]'] = 'desc';
        }
        return listManga(page, { ...params, title: trimmed || undefined });
      },

      async getMangaDetails(manga: MangaSummary) {
        const response = await apiGet<Entity<MangaData>>(`/manga/${manga.url}`, { includes: MANGA_INCLUDES });
        return toDetails(response.data, lang);
      },

      async getChapters(manga: MangaSummary): Promise<Chapter[]> {
        const chapters: Chapter[] = [];
        for (let offset = 0; offset < MAX_RESULTS; offset += FEED_PAGE_SIZE) {
          const response = await apiGet<Collection<ChapterData>>(`/manga/${manga.url}/feed`, {
            limit: FEED_PAGE_SIZE,
            offset,
            translatedLanguage: [lang],
            includes: ['scanlation_group'],
            // The feed filters by rating too; the manga itself was already allowed.
            contentRating: ['safe', 'suggestive', 'erotica', 'pornographic'],
            includeFutureUpdates: 0,
            includeEmptyPages: 0,
            includeExternalUrl: 0,
            'order[volume]': 'desc',
            'order[chapter]': 'desc',
            'order[publishAt]': 'desc',
          });
          chapters.push(...response.data.map(toChapter));
          if (offset + response.data.length >= response.total || response.data.length === 0) break;
        }
        return chapters;
      },

      async getPages(chapter: Chapter): Promise<Page[]> {
        const atHome = await apiGet<AtHome>(`/at-home/server/${chapter.url}`);
        const dataSaver = prefs.get<boolean>(DATA_SAVER_PREF) === true;
        const files = dataSaver ? atHome.chapter.dataSaver : atHome.chapter.data;
        const quality = dataSaver ? 'data-saver' : 'data';
        return files.map((file, index) => ({
          index,
          imageUrl: `${atHome.baseUrl}/${quality}/${atHome.chapter.hash}/${file}`,
        }));
      },

      // MangaDex forbids browser User-Agents, images included.
      imageHeaders: () => ({ 'User-Agent': userAgent() }),

      resolveUrl(url: string): MangaSummary | null {
        const match = /^https?:\/\/(?:www\.)?mangadex\.org\/(?:title|manga)\/([0-9a-f-]{36})/i.exec(url.trim());
        return match?.[1] ? { url: match[1].toLowerCase(), title: '' } : null;
      },

      getWebUrl: (item: MangaSummary | Chapter) =>
        // Chapters carry `name`, manga carry `title`.
        'name' in item ? `${WEB_URL}/chapter/${item.url}` : `${WEB_URL}/title/${item.url}`,

      // MangaDex@Home asks clients to report every image from its network (not uploads.mangadex.org).
      async reportImage(result) {
        if (/^https:\/\/[^/]*mangadex\.org\//.test(result.url)) return;
        const response = await http.request({
          url: REPORT_URL,
          method: 'POST',
          headers: { 'User-Agent': userAgent() },
          body: {
            json: {
              url: result.url,
              success: result.success,
              bytes: result.bytes,
              duration: result.durationMs,
              cached: result.cached,
            },
          },
        });
        if (response.status >= 300) log.warn(`MangaDex@Home report failed with HTTP ${response.status}`);
      },
    };
  },
});
