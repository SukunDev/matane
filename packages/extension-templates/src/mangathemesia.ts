import type { Chapter, HtmlElement, MangaDetails, MangaPage, MangaSummary, Page, Source } from '@matane/extension-sdk';
import { NotFoundError } from '@matane/extension-sdk';
import {
  clean,
  imageUrl,
  jsonAfter,
  known,
  loadDoc,
  parseDate,
  parseStatus,
  parseType,
  splitLabel,
  toPath,
  toUrl,
  unique,
} from './common.js';

/** CSS selectors of the MangaThemesia theme's default markup; override the ones a site changed. */
export interface MangaThemesiaSelectors {
  /** One manga in a listing or in search results. */
  item: string;
  itemLink: string;
  /** The title inside an item; the link's `title` attribute is used when missing. */
  itemTitle: string;
  itemImage: string;
  /** Present when there is a next page of a listing. */
  next: string;
  title: string;
  cover: string;
  /** Rows of the info block, printed as "Label: value" or "Label value". */
  infoRow: string;
  genres: string;
  description: string;
  chapter: string;
  chapterLink: string;
  chapterName: string;
  chapterDate: string;
  pageImage: string;
}

export interface MangaThemesiaConfig {
  baseUrl: string;
  /** Where the series archive lives, `/manga/` by default (some sites use `/comics/`, `/series/`). */
  listPath?: string;
  /** `order` of the popular listing; `popular` by default. */
  popularOrder?: string;
  /** `order` of the latest listing; `update` by default. */
  latestOrder?: string;
  selectors?: Partial<MangaThemesiaSelectors>;
}

export const MANGATHEMESIA_SELECTORS: MangaThemesiaSelectors = {
  item: '.listupd .bs .bsx',
  itemLink: 'a',
  itemTitle: '.tt',
  itemImage: 'img',
  next: 'a.next.page-numbers, .hpage a.r',
  title: 'h1.entry-title',
  cover: '.thumb img',
  infoRow: '.infox .spe span, .tsinfo .imptdt',
  genres: '.mgen a, .genres a',
  description: '[itemprop="description"], .entry-content[itemprop="description"]',
  chapter: '#chapterlist li',
  chapterLink: 'a',
  chapterName: '.chapternum',
  chapterDate: '.chapterdate',
  pageImage: '#readerarea img',
};

/**
 * A source for a site that runs the MangaThemesia WordPress theme. Returns a plain `Source`, so a
 * site's differences are a spread away: `createSource: () => ({ ...mangaThemesia({ baseUrl }), search: mine })`.
 */
export function mangaThemesia(config: MangaThemesiaConfig): Source {
  const baseUrl = config.baseUrl;
  const listPath = config.listPath ?? '/manga/';
  const sel: MangaThemesiaSelectors = { ...MANGATHEMESIA_SELECTORS, ...config.selectors };
  const absolute = (path: string) => toUrl(path, baseUrl);
  const archive = listPath.replace(/\/?$/, '/');

  function parseList(doc: HtmlElement): MangaPage {
    const items: MangaSummary[] = [];
    for (const el of doc.select(sel.item)) {
      const link = el.selectFirst(sel.itemLink);
      const href = link?.attr('href');
      const title = clean(el.selectFirst(sel.itemTitle)?.text()) || clean(link?.attr('title'));
      if (!href || !title) continue;
      items.push({
        url: toPath(link!.absUrl('href') ?? href, baseUrl),
        title,
        thumbnailUrl: imageUrl(el.selectFirst(sel.itemImage)),
      });
    }
    return { items: unique(items), hasNextPage: doc.selectFirst(sel.next) !== null };
  }

  async function listing(order: string, page: number): Promise<MangaPage> {
    return parseList(await loadDoc(`${absolute(archive)}?page=${page}&order=${order}`, baseUrl));
  }

  return {
    baseUrl,

    getPopular: (page) => listing(config.popularOrder ?? 'popular', page),
    getLatest: (page) => listing(config.latestOrder ?? 'update', page),

    async search(query, page) {
      return parseList(await loadDoc(`${absolute(`/page/${page}/`)}?s=${encodeURIComponent(query)}`, baseUrl));
    },

    async getMangaDetails(manga: MangaSummary): Promise<MangaDetails> {
      const doc = await loadDoc(absolute(manga.url), baseUrl);
      const title = clean(doc.selectFirst(sel.title)?.text());
      if (!title) throw new NotFoundError(`${manga.url} is not a manga page`);
      const details: MangaDetails = {
        ...manga,
        title,
        thumbnailUrl: imageUrl(doc.selectFirst(sel.cover)) ?? manga.thumbnailUrl,
        description: clean(doc.selectFirst(sel.description)?.text()) || undefined,
        genres: doc
          .select(sel.genres)
          .map((a) => clean(a.text()))
          .filter(Boolean),
        status: 'unknown',
      };
      for (const row of doc.select(sel.infoRow)) {
        const label = splitLabel(clean(row.text()));
        if (!label) continue;
        const [name, value] = label;
        if (name === 'status') details.status = parseStatus(value);
        else if (name === 'type') details.type = parseType(value);
        else if (name === 'author') details.author = known(value);
        else if (name === 'artist') details.artist = known(value);
      }
      return details;
    },

    async getChapters(manga: MangaSummary): Promise<Chapter[]> {
      const doc = await loadDoc(absolute(manga.url), baseUrl);
      const chapters: Chapter[] = [];
      for (const el of doc.select(sel.chapter)) {
        const link = el.selectFirst(sel.chapterLink);
        const href = link?.attr('href');
        const name = clean((el.selectFirst(sel.chapterName) ?? link)?.text());
        if (!href || !name) continue;
        const date = clean(el.selectFirst(sel.chapterDate)?.text());
        chapters.push({
          url: toPath(link!.absUrl('href') ?? href, baseUrl),
          name,
          uploadedAt: date ? parseDate(date) : undefined,
        });
      }
      return unique(chapters);
    },

    async getPages(chapter: Chapter): Promise<Page[]> {
      const doc = await loadDoc(absolute(chapter.url), baseUrl);
      let urls = doc.select(sel.pageImage).flatMap((img) => imageUrl(img) ?? []);
      if (urls.length === 0) {
        // Newer versions hand the images to a script: `ts_reader.run({ sources: [{ images: [...] }] })`.
        for (const script of doc.select('script')) {
          const code = script.html();
          if (!code.includes('ts_reader')) continue;
          const data = jsonAfter(code, /ts_reader\.run\(\s*/) as { sources?: { images?: unknown }[] } | undefined;
          const images = data?.sources?.[0]?.images;
          if (Array.isArray(images)) {
            urls = images.filter((u): u is string => typeof u === 'string' && u.length > 0);
            break;
          }
        }
      }
      return urls.map((url, index) => ({ index, imageUrl: toUrl(url, baseUrl) }));
    },

    imageHeaders: () => ({ Referer: `${baseUrl.replace(/\/+$/, '')}/` }),

    resolveUrl(url) {
      const prefix = `${baseUrl.replace(/\/+$/, '')}${archive}`.toLowerCase();
      if (!url.toLowerCase().startsWith(prefix)) return null;
      const slug = url.slice(prefix.length).split(/[/?#]/)[0] ?? '';
      return slug ? { url: `${archive}${slug}/`, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item) => absolute(item.url),
  };
}
