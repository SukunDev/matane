import type { Chapter, MangaDetails, MangaStatus, MangaSummary, MangaType } from '@matane/extension-sdk';
import type { BloggerEntry } from './api';

export type HtmlElement = ReturnType<typeof html.load>;

export function extractRelativePath(url: string): string {
  if (!url) return '';
  const match = /^https?:\/\/[^/]+(\/.*)$/.exec(url);
  if (match?.[1]) {
    return match[1];
  }
  return url.startsWith('/') ? url : `/${url}`;
}

export function toSummaryFromEntry(entry: BloggerEntry): MangaSummary {
  const title = entry.title?.$t?.trim() ?? '';
  const alternate = entry.link?.find((l) => l.rel === 'alternate');
  const url = extractRelativePath(alternate?.href ?? '');

  let thumbnailUrl: string | undefined;
  if (entry['media$thumbnail']?.url) {
    thumbnailUrl = entry['media$thumbnail'].url
      .replace(/\/s.+?-c\//, '/w600/')
      .replace(/=s(?!.*=s).+?-c$/, '=w600');
  } else if (entry.content?.$t) {
    const doc = html.load(entry.content.$t);
    thumbnailUrl = doc.selectFirst('img')?.attr('src') ?? doc.selectFirst('img')?.absUrl('src');
  }

  return {
    url,
    title,
    thumbnailUrl,
  };
}

export function toSummaryFromElement(el: HtmlElement): MangaSummary {
  const link = el.selectFirst('figcaption > a');
  const title = link?.text().trim() ?? '';
  const url = extractRelativePath(link?.attr('href') ?? '');
  const img = el.selectFirst('img');
  const thumbnailUrl = img?.absUrl('src') ?? img?.attr('src');

  return {
    url,
    title,
    thumbnailUrl,
  };
}

export function parseStatus(text: string): MangaStatus {
  const lower = text.toLowerCase().trim();
  if (['ongoing', 'en curso', 'en emisión', 'em lançamento', 'activo', 'ativo', 'lançando', 'berjalan'].includes(lower)) {
    return 'ongoing';
  }
  if (['completed', 'completo', 'finalizado', 'tamat'].includes(lower)) {
    return 'completed';
  }
  if (['hiatus', 'pausado'].includes(lower)) {
    return 'hiatus';
  }
  if (['cancelled', 'dropped', 'dropado', 'abandonado', 'cancelado'].includes(lower)) {
    return 'cancelled';
  }
  return 'unknown';
}

export function parseMangaDetails(doc: HtmlElement, manga: MangaSummary): MangaDetails {
  const profile = doc.selectFirst('.grid.gtc-235fr') ?? doc;

  let title = manga.title?.trim() || '';
  if (!title) {
    const pageTitle = doc.selectFirst('h1.entry-title, h1')?.text().trim();
    if (pageTitle) {
      title = pageTitle.replace(/^komik\s+/i, '').replace(/\s+bahasa indonesia$/i, '').trim();
    } else {
      const ogTitle = doc.selectFirst('meta[property="og:title"]')?.attr('content');
      if (ogTitle) {
        title = ogTitle.split('-')[0]?.trim() || ogTitle.trim();
      }
    }
  }

  const img = profile.selectFirst('img');
  const thumbnailUrl = img?.absUrl('src') ?? img?.attr('src') ?? manga.thumbnailUrl;

  const synopsisEl = profile.selectFirst('#synopsis');
  let description = synopsisEl?.text().trim() ?? '';

  const altTitleEl = profile.selectFirst('header > p');
  const altTitle = altTitleEl?.text().trim();
  if (altTitle) {
    description = description ? `${description}\n\nAlternative Names: ${altTitle}` : `Alternative Names: ${altTitle}`;
  }

  const genreElements = profile.select('div.mt-15 > a[rel=tag]');
  const genres: string[] = genreElements
    .map((el: HtmlElement) => el.text().trim())
    .filter((g: string) => Boolean(g));

  let author = profile.selectFirst('span#author')?.text().trim() || undefined;
  let artist = profile.selectFirst('span#artist')?.text().trim() || undefined;
  let status: MangaStatus = parseStatus(profile.selectFirst('span[data-status]')?.text() ?? '');

  const infoElements = profile.select('.y6x11p');
  for (const element of infoElements) {
    const infoTitle = element.selectFirst('strong')?.text().trim().toLowerCase() ?? '';
    const descText = element.selectFirst('span.dt')?.text().trim() ?? '';
    if (!descText) continue;

    if (status === 'unknown' && infoTitle.includes('status')) {
      status = parseStatus(descText);
    }
    if (!author && (infoTitle.includes('author') || infoTitle.includes('mangaka') || infoTitle.includes('penulis'))) {
      author = descText;
    }
    if (!artist && (infoTitle.includes('artist') || infoTitle.includes('illustrator') || infoTitle.includes('art'))) {
      artist = descText;
    }
  }

  let type: MangaType | undefined;
  const genreLower = genres.map((g: string) => g.toLowerCase());
  if (genreLower.some((g) => g.includes('manhwa') || g.includes('webtoon'))) {
    type = 'manhwa';
  } else if (genreLower.some((g) => g.includes('manhua'))) {
    type = 'manhua';
  } else if (genreLower.some((g) => g.includes('manga'))) {
    type = 'manga';
  } else if (genreLower.some((g) => g.includes('comic') || g.includes('komik'))) {
    type = 'comic';
  }

  return {
    url: manga.url,
    title,
    thumbnailUrl,
    description: description || undefined,
    genres: genres.length > 0 ? genres : undefined,
    author,
    artist,
    status,
    type,
  };
}

export function extractFeedKey(htmlString: string, fallbackTitle: string): string {
  const clwdMatch = /clwd\.run\(["'](.*?)["']\)/.exec(htmlString);
  if (clwdMatch?.[1]) {
    return clwdMatch[1];
  }

  const labelMatch = /label\s*=\s*['"]([^'"]+)['"]/.exec(htmlString);
  if (labelMatch?.[1]) {
    return labelMatch[1];
  }

  const scriptFeedMatch = /feeds\/posts\/default\/-\/([^?/'"]+)/.exec(htmlString);
  if (scriptFeedMatch?.[1]) {
    return scriptFeedMatch[1];
  }

  return fallbackTitle;
}

const CHAPTER_NUMBER_REGEX = /(?:chapter|ch\.?|chp\.?)\s*(\d+(?:\.\d+)?)/i;

export function toChapter(entry: BloggerEntry): Chapter {
  const name = entry.title?.$t?.trim() ?? 'Chapter';
  const alternate = entry.link?.find((l) => l.rel === 'alternate');
  const url = extractRelativePath(alternate?.href ?? '');

  const dateStr = entry.updated?.$t || entry.published?.$t;
  const uploadedAt = dateStr ? Date.parse(dateStr) : undefined;

  const numMatch = CHAPTER_NUMBER_REGEX.exec(name) ?? /(\d+(?:\.\d+)?)/.exec(name);
  const parsedNum = numMatch?.[1] ? Number.parseFloat(numMatch[1]) : Number.NaN;

  return {
    url,
    name,
    number: Number.isFinite(parsedNum) ? parsedNum : undefined,
    uploadedAt: typeof uploadedAt === 'number' && Number.isFinite(uploadedAt) ? uploadedAt : undefined,
  };
}
