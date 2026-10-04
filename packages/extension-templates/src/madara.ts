import type { Chapter, HtmlElement, MangaDetails, MangaPage, MangaSummary, Page, Source } from '@matane/extension-sdk';
import { NotFoundError } from '@matane/extension-sdk';
import { clean, imageUrl, known, loadDoc, parseDate, parseStatus, parseType, toPath, toUrl, unique } from './common.js';

/** CSS selectors of the Madara theme's default markup; override the ones a site changed. */
export interface MadaraSelectors {
  /** One manga in a listing or in search results. */
  item: string;
  /** The title link inside an item. */
  itemLink: string;
  /** The cover inside an item. */
  itemImage: string;
  /** Present when there is a next page of a listing. */
  next: string;
  title: string;
  cover: string;
  /** Rows of the details block, each with a heading and a value. */
  infoRow: string;
  infoHeading: string;
  infoValue: string;
  description: string;
  chapter: string;
  chapterLink: string;
  chapterDate: string;
  /** Holds the manga's id for the older chapter endpoint (`data-id`). */
  chaptersHolder: string;
  pageImage: string;
}

export interface MadaraConfig {
  baseUrl: string;
  /** Where the series archive lives, `/manga/` by default (some sites use `/series/`, `/webtoon/`). */
  listPath?: string;
  /** `m_orderby` of the popular listing; `views` by default. */
  popularOrder?: string;
  /** `m_orderby` of the latest listing; `latest` by default. */
  latestOrder?: string;
  /**
   * Where chapters come from: `auto` reads them from the manga's page and asks the site's ajax
   * endpoints when the page has none, `always` goes straight to ajax, `never` only reads the page.
   */
  chaptersAjax?: 'auto' | 'always' | 'never';
  selectors?: Partial<MadaraSelectors>;
}

export const MADARA_SELECTORS: MadaraSelectors = {
  item: '.page-item-detail, .c-tabs-item__content',
  itemLink: '.post-title a',
  itemImage: 'img',
  next: 'a.nextpostslink, a.next.page-numbers, .nav-previous a',
  title: '.post-title h1, .post-title h3',
  cover: '.summary_image img',
  infoRow: '.post-content_item',
  infoHeading: '.summary-heading',
  infoValue: '.summary-content',
  description: '.description-summary .summary__content, .summary__content, .manga-excerpt',
  chapter: 'li.wp-manga-chapter',
  chapterLink: 'a',
  chapterDate: 'span.chapter-release-date',
  chaptersHolder: '#manga-chapters-holder',
  pageImage: '.reading-content img, .page-break img',
};

/** Badges the theme prints inside the title ("HOT", "NEW"). */
const stripBadges = (title: string) =>
  title
    .replace(/^(hot|new|up|end)\s+/i, '')
    .replace(/\s+(hot|new|up)$/i, '')
    .trim();

/**
 * A source for a site that runs the Madara WordPress theme. Returns a plain `Source`, so a site's
 * differences are a spread away: `createSource: () => ({ ...madara({ baseUrl }), search: mine })`.
 */
export function madara(config: MadaraConfig): Source {
  const baseUrl = config.baseUrl;
  const listPath = config.listPath ?? '/manga/';
  const sel: MadaraSelectors = { ...MADARA_SELECTORS, ...config.selectors };
  const ajaxMode = config.chaptersAjax ?? 'auto';
  const absolute = (path: string) => toUrl(path, baseUrl);

  function parseList(doc: HtmlElement): MangaPage {
    const items: MangaSummary[] = [];
    for (const el of doc.select(sel.item)) {
      const link = el.selectFirst(sel.itemLink);
      const href = link?.attr('href');
      const title = clean(link?.text());
      if (!href || !title) continue;
      items.push({
        url: toPath(link!.absUrl('href') ?? href, baseUrl),
        title: stripBadges(title),
        thumbnailUrl: imageUrl(el.selectFirst(sel.itemImage)),
      });
    }
    return { items: unique(items), hasNextPage: doc.selectFirst(sel.next) !== null };
  }

  async function listing(order: string, page: number): Promise<MangaPage> {
    const path = `${listPath.replace(/\/?$/, '/')}page/${page}/?m_orderby=${order}`;
    return parseList(await loadDoc(absolute(path), baseUrl));
  }

  /** Chapters from a block of markup, in the order the site lists them (newest first). */
  function parseChapters(doc: HtmlElement): Chapter[] {
    const chapters: Chapter[] = [];
    for (const el of doc.select(sel.chapter)) {
      const link = el.selectFirst(sel.chapterLink);
      const href = link?.attr('href');
      const name = clean(link?.text());
      if (!href || !name) continue;
      const date = el.selectFirst(sel.chapterDate);
      const dateText = date?.selectFirst('a')?.attr('title') ?? clean(date?.text());
      chapters.push({
        url: toPath(link!.absUrl('href') ?? href, baseUrl),
        name,
        uploadedAt: dateText ? parseDate(dateText) : undefined,
      });
    }
    return unique(chapters);
  }

  async function chaptersFromAjax(mangaUrl: string, doc: HtmlElement): Promise<Chapter[]> {
    const headers = { 'X-Requested-With': 'XMLHttpRequest', Referer: mangaUrl };
    const endpoint = `${mangaUrl.replace(/\/?$/, '/')}ajax/chapters/`;
    const viaEndpoint = parseChapters(await loadDoc(endpoint, baseUrl, { method: 'POST', headers }));
    if (viaEndpoint.length > 0) return viaEndpoint;
    // Older versions of the theme ask admin-ajax for the manga's id instead.
    const id = doc.selectFirst(sel.chaptersHolder)?.attr('data-id');
    if (!id) return [];
    const form = { action: 'manga_get_chapters', manga: id };
    return parseChapters(
      await loadDoc(absolute('/wp-admin/admin-ajax.php'), baseUrl, { method: 'POST', body: { form }, headers }),
    );
  }

  return {
    baseUrl,

    getPopular: (page) => listing(config.popularOrder ?? 'views', page),
    getLatest: (page) => listing(config.latestOrder ?? 'latest', page),

    async search(query, page) {
      const url = `${absolute(`/page/${page}/`)}?s=${encodeURIComponent(query)}&post_type=wp-manga`;
      return parseList(await loadDoc(url, baseUrl));
    },

    async getMangaDetails(manga: MangaSummary): Promise<MangaDetails> {
      const doc = await loadDoc(absolute(manga.url), baseUrl);
      const title = clean(doc.selectFirst(sel.title)?.text());
      if (!title) throw new NotFoundError(`${manga.url} is not a manga page`);
      const details: MangaDetails = {
        ...manga,
        title: stripBadges(title),
        thumbnailUrl: imageUrl(doc.selectFirst(sel.cover)) ?? manga.thumbnailUrl,
        description: clean(doc.selectFirst(sel.description)?.text()) || undefined,
        status: 'unknown',
      };
      for (const row of doc.select(sel.infoRow)) {
        const heading = clean(row.selectFirst(sel.infoHeading)?.text()).toLowerCase();
        const value = row.selectFirst(sel.infoValue);
        if (!heading || !value) continue;
        const text = clean(value.text());
        if (heading.includes('author')) details.author = known(text);
        else if (heading.includes('artist')) details.artist = known(text);
        else if (heading.includes('genre'))
          details.genres = value
            .select('a')
            .map((a) => clean(a.text()))
            .filter(Boolean);
        else if (heading.includes('status')) details.status = parseStatus(text);
        else if (heading.includes('type')) details.type = parseType(text);
      }
      return details;
    },

    async getChapters(manga: MangaSummary): Promise<Chapter[]> {
      const url = absolute(manga.url);
      const doc = await loadDoc(url, baseUrl);
      const inline = ajaxMode === 'always' ? [] : parseChapters(doc);
      if (inline.length > 0 || ajaxMode === 'never') return inline;
      return chaptersFromAjax(url, doc);
    },

    async getPages(chapter: Chapter): Promise<Page[]> {
      const doc = await loadDoc(absolute(chapter.url), baseUrl);
      const urls = doc.select(sel.pageImage).map((img) => imageUrl(img));
      return urls.flatMap((url) => (url ? [url] : [])).map((url, index) => ({ index, imageUrl: url }));
    },

    imageHeaders: () => ({ Referer: `${baseUrl.replace(/\/+$/, '')}/` }),

    resolveUrl(url) {
      const base = baseUrl.replace(/\/+$/, '').toLowerCase();
      const prefix = `${base}${listPath.replace(/\/?$/, '/')}`.toLowerCase();
      if (!url.toLowerCase().startsWith(prefix)) return null;
      const slug = url.slice(prefix.length).split(/[/?#]/)[0] ?? '';
      return slug ? { url: `${listPath.replace(/\/?$/, '/')}${slug}/`, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item) => absolute(item.url),
  };
}
