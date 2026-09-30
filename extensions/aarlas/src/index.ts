import {
  type Chapter,
  type FilterState,
  type MangaPage,
  type MangaSummary,
  type Page,
  defineExtension,
} from '@matane/extension-sdk';
import { BASE_URL, type BloggerEntry, fetchFeed } from './api';
import { buildSearchPath, getFilters } from './filters';
import {
  extractFeedKey,
  parseMangaDetails,
  toChapter,
  toSummaryFromElement,
  toSummaryFromEntry,
} from './parse';

const EXCLUDED_CATEGORIES = ['Anime', 'Novel', 'Novela'];
const PAGE_SIZE = 20;
const CHAPTER_CHUNK = 150;

function isValidSeries(entry: BloggerEntry): boolean {
  const categories = entry.category?.map((c) => c.term) || [];
  const hasSeries = categories.includes('Series');
  const isExcluded = categories.some((c) => EXCLUDED_CATEGORIES.includes(c));
  return hasSeries && !isExcluded;
}

export default defineExtension({
  createSource: () => ({
    baseUrl: BASE_URL,

    async getPopular(): Promise<MangaPage> {
      const response = await http.get(BASE_URL);
      const doc = html.load(response.body);
      const elements = doc.select('div.PopularPosts div.grid > figure');
      const items = elements.map(toSummaryFromElement).filter((item) => Boolean(item.url && item.title));
      return {
        items,
        hasNextPage: false,
      };
    },

    async getLatest(page: number): Promise<MangaPage> {
      const startIndex = (page - 1) * PAGE_SIZE + 1;
      const response = await fetchFeed('/feeds/posts/default/-/Series', {
        orderby: 'published',
        'max-results': PAGE_SIZE + 1,
        'start-index': startIndex,
      });

      const rawEntries = response.feed?.entry || [];
      const items = rawEntries.filter(isValidSeries).map(toSummaryFromEntry);
      return {
        items: items.slice(0, PAGE_SIZE),
        hasNextPage: rawEntries.length > PAGE_SIZE,
      };
    },

    getFilters,

    async search(query: string, page: number, filters: FilterState): Promise<MangaPage> {
      const startIndex = (page - 1) * PAGE_SIZE + 1;
      const trimmed = query.trim();

      let response;
      if (trimmed) {
        response = await fetchFeed('/feeds/posts/default/-/Series', {
          q: `label:Series ${trimmed}`,
          'max-results': PAGE_SIZE + 1,
          'start-index': startIndex,
        });
      } else {
        const searchPath = buildSearchPath(filters);
        response = await fetchFeed(searchPath, {
          'max-results': PAGE_SIZE + 1,
          'start-index': startIndex,
        });
      }

      const rawEntries = response.feed?.entry || [];
      const items = rawEntries.filter(isValidSeries).map(toSummaryFromEntry);
      return {
        items: items.slice(0, PAGE_SIZE),
        hasNextPage: rawEntries.length > PAGE_SIZE,
      };
    },

    async getMangaDetails(manga: MangaSummary) {
      const response = await http.get(`${BASE_URL}${manga.url}`);
      const doc = html.load(response.body, { baseUrl: BASE_URL });
      return parseMangaDetails(doc, manga);
    },

    async getChapters(manga: MangaSummary): Promise<Chapter[]> {
      const mangaResponse = await http.get(`${BASE_URL}${manga.url}`);
      const feedKey = extractFeedKey(mangaResponse.body, manga.title);

      const allEntries: BloggerEntry[] = [];
      const feedPath = `/feeds/posts/default/-/Chapter/${encodeURIComponent(feedKey)}`;
      const firstFeed = await fetchFeed(feedPath, {
        'max-results': CHAPTER_CHUNK,
        'start-index': 1,
      });

      const totalResults = Number.parseInt(firstFeed.feed?.['openSearch$totalResults']?.$t || '0', 10);
      const firstBatch = firstFeed.feed?.entry || [];
      allEntries.push(...firstBatch);

      if (totalResults > CHAPTER_CHUNK && firstBatch.length > 0) {
        for (let startIndex = CHAPTER_CHUNK + 1; startIndex <= totalResults; startIndex += CHAPTER_CHUNK) {
          const nextFeed = await fetchFeed(feedPath, {
            'max-results': CHAPTER_CHUNK,
            'start-index': startIndex,
          });
          const nextBatch = nextFeed.feed?.entry || [];
          allEntries.push(...nextBatch);
          if (nextBatch.length === 0) break;
        }
      }

      return allEntries
        .filter((entry) => entry.category?.some((c) => c.term === 'Chapter'))
        .map(toChapter);
    },

    async getPages(chapter: Chapter): Promise<Page[]> {
      const response = await http.get(`${BASE_URL}${chapter.url}`);
      const doc = html.load(response.body, { baseUrl: BASE_URL });
      let imageElements = doc.select('div.check-box div.separator img');
      if (imageElements.length === 0) {
        imageElements = doc.select('.post-body img, div.separator img');
      }

      const pages: Page[] = [];
      for (const el of imageElements) {
        const url = el.absUrl('src') || el.attr('src');
        if (url) {
          pages.push({
            index: pages.length,
            imageUrl: url,
          });
        }
      }
      return pages;
    },

    resolveUrl(url: string): MangaSummary | null {
      const match = /^https?:\/\/(?:www\.)?arlas\.online(\/\d{4}\/\d{2}\/[^/]+\.html)/i.exec(url.trim());
      return match?.[1] ? { url: match[1], title: '' } : null;
    },

    getWebUrl(item: MangaSummary | Chapter): string {
      return `${BASE_URL}${item.url}`;
    },
  }),
});
