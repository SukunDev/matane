import {
  type Chapter,
  type FilterState,
  type MangaPage,
  type MangaSummary,
  type Page,
  defineExtension,
} from '@matane/extension-sdk';
import { BASE_URL, type ChapterPagesResponseDto, type SearchResponseDto, type SeriesDetailDto, apiGet } from './api';
import { filterParams, getFilters } from './filters';
import { extractChapterParts, extractMangaSlug, toChapter, toDetails, toFilteredPageList, toSummary } from './parse';

const PAGE_SIZE = 20;

export default defineExtension({
  createSource: () => ({
    baseUrl: BASE_URL,

    async getPopular(page: number): Promise<MangaPage> {
      const response = await apiGet<SearchResponseDto>('/search', {
        type: 'COMIC',
        limit: PAGE_SIZE,
        page,
        sort: 'views',
        order: 'desc',
      });
      const items = (response.data || []).map(toSummary);
      return {
        items,
        hasNextPage: page < (response.total_pages || 0),
      };
    },

    async getLatest(page: number): Promise<MangaPage> {
      const response = await apiGet<SearchResponseDto>('/search', {
        type: 'COMIC',
        limit: PAGE_SIZE,
        page,
        sort: 'latest',
        order: 'desc',
      });
      const items = (response.data || []).map(toSummary);
      return {
        items,
        hasNextPage: page < (response.total_pages || 0),
      };
    },

    getFilters,

    async search(query: string, page: number, filters: FilterState): Promise<MangaPage> {
      const trimmed = query.trim();
      const params = filterParams(filters);
      if (trimmed) {
        params.q = trimmed;
      }
      if (!params.sort) {
        params.sort = 'views';
      }
      if (!params.order) {
        params.order = 'desc';
      }

      const response = await apiGet<SearchResponseDto>('/search', {
        type: 'COMIC',
        limit: PAGE_SIZE,
        page,
        ...params,
      });

      let items = (response.data || []).map(toSummary);
      if (params.sort === 'az') {
        items = items.sort((a, b) => a.title.localeCompare(b.title));
      } else if (params.sort === 'za') {
        items = items.sort((a, b) => b.title.localeCompare(a.title));
      }

      return {
        items,
        hasNextPage: page < (response.total_pages || 0),
      };
    },

    async getMangaDetails(manga: MangaSummary) {
      const slug = extractMangaSlug(manga.url);
      const response = await apiGet<SeriesDetailDto>(`/series/comic/${slug}`);
      return toDetails(response);
    },

    async getChapters(manga: MangaSummary): Promise<Chapter[]> {
      const slug = extractMangaSlug(manga.url);
      const response = await apiGet<SeriesDetailDto>(`/series/comic/${slug}`);
      const units = response.units || [];
      return units.map((unit) => toChapter(unit, response.slug || slug));
    },

    async getPages(chapter: Chapter): Promise<Page[]> {
      const { seriesSlug, chapterSlug } = extractChapterParts(chapter.url);
      const response = await apiGet<ChapterPagesResponseDto>(`/series/comic/${seriesSlug}/chapter/${chapterSlug}`);
      const pages = response.chapter?.pages || [];
      return toFilteredPageList(pages);
    },

    resolveUrl(url: string): MangaSummary | null {
      const match = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?ainzscans01\.com\/comic\/([a-zA-Z0-9_-]+)/i.exec(url.trim());
      return match?.[1] ? { url: `/comic/${match[1]}`, title: '' } : null;
    },

    getWebUrl(item: MangaSummary | Chapter): string {
      return `${BASE_URL}${item.url}`;
    },
  }),
});
