import {
  type Chapter,
  type FilterState,
  type MangaPage,
  type MangaSummary,
  type Page,
  defineExtension,
} from '@matane/extension-sdk';
import {
  BASE_URL,
  type BrowseManga,
  type Data,
  type ImageList,
  type MangaData,
  type PaginatedData,
  type QueryValue,
  apiGet,
} from './api';
import { filterParams, getFilters } from './filters';
import { extractSlug, toChapter, toDetails, toSummary } from './parse';

const PER_PAGE = 20;

export default defineExtension({
  createSource: () => {
    async function listManga(page: number, params: Record<string, QueryValue>): Promise<MangaPage> {
      const response = await apiGet<PaginatedData<BrowseManga>>('/api/contents', {
        page,
        per_page: PER_PAGE,
        type: 'Comic',
        ...params,
      });
      const items = (response.data || []).map(toSummary);
      const hasNextPage = response.paginator ? response.paginator.current_page < response.paginator.last_page : false;
      return {
        items,
        hasNextPage,
      };
    }

    return {
      baseUrl: BASE_URL,

      getPopular: (page) => listManga(page, { orderBy: 'Popular' }),

      getLatest: (page) => listManga(page, { orderBy: 'Update' }),

      getFilters,

      async search(query: string, page: number, filters: FilterState): Promise<MangaPage> {
        const trimmed = query.trim();
        const params = filterParams(filters);
        if (trimmed) {
          params.q = trimmed;
        }
        return listManga(page, params);
      },

      async getMangaDetails(manga: MangaSummary) {
        const slug = extractSlug(manga.url);
        const response = await apiGet<Data<MangaData>>(`/api/comic/${slug}`);
        return toDetails(response.data);
      },

      async getChapters(manga: MangaSummary): Promise<Chapter[]> {
        const slug = extractSlug(manga.url);
        const response = await apiGet<Data<MangaData>>(`/api/comic/${slug}`);
        const chapters = response.data.chapters || [];
        return chapters.map(toChapter);
      },

      async getPages(chapter: Chapter): Promise<Page[]> {
        const slug = extractSlug(chapter.url);
        const response = await apiGet<Data<ImageList>>(`/api/v/${slug}`);
        const images = response.data.images || [];
        return images.map((img, index) => ({
          index,
          imageUrl: img,
        }));
      },

      resolveUrl(url: string): MangaSummary | null {
        const match =
          /^https?:\/\/(?:[a-zA-Z0-9-]+\.)?westmanga\.(?:my|info|blog|online|org|com|net)\/(?:comic|manga)\/([a-zA-Z0-9_-]+)/i.exec(
            url.trim(),
          );
        return match?.[1] ? { url: `/manga/${match[1]}/`, title: '' } : null;
      },

      getWebUrl(item: MangaSummary | Chapter): string {
        const isChapter = 'name' in item;
        const slug = extractSlug(item.url);
        return isChapter ? `${BASE_URL}/view/${slug}` : `${BASE_URL}/comic/${slug}`;
      },
    };
  },
});
