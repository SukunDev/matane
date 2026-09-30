import type { Chapter, MangaDetails, MangaStatus, MangaSummary, MangaType, Page } from '@matane/extension-sdk';
import type { ChapterDto, MangaDto, PageDto, SeriesDetailDto } from './api';

export function extractMangaSlug(url: string): string {
  const clean = url.trim().replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/');
  return parts[parts.length - 1] ?? clean;
}

export function extractChapterParts(url: string): { seriesSlug: string; chapterSlug: string } {
  const clean = url.trim().replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/chapter/');
  const seriesSlug = parts[0]?.split('/').pop() ?? '';
  const chapterSlug = parts[1] ?? '';
  return { seriesSlug, chapterSlug };
}

export function toSummary(manga: MangaDto): MangaSummary {
  return {
    url: `/comic/${manga.slug}`,
    title: manga.title.trim(),
    thumbnailUrl: manga.poster_image_url || undefined,
  };
}

export function formatChapterNumber(number: string): string {
  if (number.endsWith('.00')) {
    return number.slice(0, -3);
  }
  return number;
}

export function toDetails(detail: SeriesDetailDto): MangaDetails {
  const genres: string[] = [];
  if (detail.primary_genre) {
    genres.push(detail.primary_genre);
  }
  if (Array.isArray(detail.genres)) {
    for (const g of detail.genres) {
      if (g.name && !genres.includes(g.name)) {
        genres.push(g.name);
      }
    }
  }

  let description: string | undefined;
  if (detail.synopsis) {
    description = html.load(detail.synopsis).text().trim();
  }

  let status: MangaStatus = 'unknown';
  const statusStr = detail.comic_status?.toLowerCase();
  if (statusStr === 'ongoing') status = 'ongoing';
  else if (statusStr === 'completed') status = 'completed';
  else if (statusStr === 'hiatus') status = 'hiatus';

  let type: MangaType | undefined;
  const subtype = detail.comic_subtype?.toLowerCase();
  if (subtype === 'manhwa') type = 'manhwa';
  else if (subtype === 'manhua') type = 'manhua';
  else if (subtype === 'manga') type = 'manga';

  return {
    url: `/comic/${detail.slug}`,
    title: detail.title.trim(),
    thumbnailUrl: detail.poster_image_url || undefined,
    author: detail.author_name || undefined,
    artist: detail.artist_name || undefined,
    description: description || undefined,
    genres: genres.length > 0 ? genres : undefined,
    status,
    type,
  };
}

export function toChapter(unit: ChapterDto, seriesSlug: string): Chapter {
  const formattedNum = formatChapterNumber(unit.number);
  const parsedNum = Number.parseFloat(unit.number);
  const label = `Chapter ${formattedNum}`;
  const name = unit.title ? `${label} - ${unit.title}` : label;
  const uploadedAt = unit.created_at ? Date.parse(unit.created_at) : undefined;

  return {
    url: `/comic/${seriesSlug}/chapter/${unit.slug}`,
    name,
    number: Number.isFinite(parsedNum) ? parsedNum : undefined,
    uploadedAt: typeof uploadedAt === 'number' && Number.isFinite(uploadedAt) ? uploadedAt : undefined,
  };
}

export function cleanPageUrl(rawUrl: string): string {
  let url = rawUrl.startsWith('http') ? rawUrl : `https://api.ainzscans01.com${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;

  if (url.includes('googleusercontent.com') || url.includes('bp.blogspot.com')) {
    url = url
      .replace(/=[swh]\d+[^/?]*($|\?)/i, '=s0$1')
      .replace(/\/[swh]\d+[^/]*\//i, '/s0/');
  }

  const queryIdx = url.indexOf('?');
  if (queryIdx !== -1) {
    const base = url.slice(0, queryIdx);
    const queryString = url.slice(queryIdx + 1);
    const filteredParams = queryString
      .split('&')
      .filter((param) => {
        const key = param.split('=')[0]?.toLowerCase();
        return key !== 'w' && key !== 'width' && key !== 'resize';
      })
      .join('&');
    url = filteredParams ? `${base}?${filteredParams}` : base;
  }

  return url;
}

const adDomainRegex = /^999(-\d+)?\.jpe?g$/i;
const adDonationRegex = /^997(-\d+)?\.jpe?g$/i;
const adVotePreRegex = /^00\.0\.jpg$/i;
const adReadOnRegex = /^00\.1\.jpg$/i;
const adVotePostRegex = /^995\.jpg$/i;

function getFilename(url: string): string {
  const path = url.split('?')[0] ?? url;
  const segments = path.split('/');
  return segments[segments.length - 1] ?? '';
}

export function toFilteredPageList(rawPages: PageDto[]): Page[] {
  const pages: Page[] = [];
  const lastIndex = rawPages.length - 1;

  rawPages.forEach((page, i) => {
    const cleanedUrl = cleanPageUrl(page.image_url);
    const filename = getFilename(cleanedUrl);

    let isAd = false;
    if (i === lastIndex) {
      isAd = adDomainRegex.test(filename);
    } else if (i === lastIndex - 2) {
      isAd = adDonationRegex.test(filename) || adVotePostRegex.test(filename);
    } else if (i === 0) {
      isAd = adVotePreRegex.test(filename);
    } else if (i === 1) {
      isAd = adReadOnRegex.test(filename);
    }

    if (!isAd) {
      pages.push({
        index: pages.length,
        imageUrl: cleanedUrl,
      });
    }
  });

  return pages;
}
