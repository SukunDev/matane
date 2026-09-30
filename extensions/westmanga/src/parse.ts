import type { Chapter, MangaDetails, MangaStatus, MangaSummary, MangaType } from '@matane/extension-sdk';
import type { BrowseManga, ChapterData, MangaData } from './api';

export function extractSlug(url: string): string {
  const clean = url.trim().replace(/^\/+|\/+$/g, '');
  const parts = clean.split('/');
  return parts[parts.length - 1] ?? clean;
}

export function toSummary(manga: BrowseManga): MangaSummary {
  return {
    url: `/manga/${manga.slug}/`,
    title: manga.title,
    thumbnailUrl: manga.cover || undefined,
  };
}

const TYPES: Record<string, MangaType> = {
  JP: 'manga',
  CN: 'manhua',
  KR: 'manhwa',
};

const COUNTRY_NAMES: Record<string, string> = {
  JP: 'Manga',
  CN: 'Manhua',
  KR: 'Manhwa',
};

export function toDetails(manga: MangaData): MangaDetails {
  const genres: string[] = [];
  if (manga.country_id && COUNTRY_NAMES[manga.country_id]) {
    const countryGenre = COUNTRY_NAMES[manga.country_id];
    if (countryGenre) genres.push(countryGenre);
  }
  if (manga.color === true) {
    genres.push('Colored');
  }
  if (Array.isArray(manga.genres)) {
    for (const g of manga.genres) {
      if (g.name && !genres.includes(g.name)) {
        genres.push(g.name);
      }
    }
  }

  let description = '';
  if (manga.sinopsis) {
    description = html.load(manga.sinopsis).text().trim();
  }
  if (manga.alternative_name) {
    const alt = manga.alternative_name.trim();
    if (alt) {
      description = description ? `${description}\n\nAlternative Name: ${alt}` : `Alternative Name: ${alt}`;
    }
  }

  let status: MangaStatus = 'unknown';
  const statusStr = manga.status?.toLowerCase();
  if (statusStr === 'ongoing') status = 'ongoing';
  else if (statusStr === 'completed') status = 'completed';
  else if (statusStr === 'hiatus') status = 'hiatus';

  return {
    url: `/manga/${manga.slug}/`,
    title: manga.title,
    thumbnailUrl: manga.cover || undefined,
    author: manga.author || undefined,
    description: description || undefined,
    genres: genres.length > 0 ? genres : undefined,
    status,
    type: manga.country_id ? TYPES[manga.country_id] : undefined,
  };
}

export function toChapter(chapter: ChapterData): Chapter {
  const parsedNum = Number.parseFloat(chapter.number);
  const uploadedAt = chapter.updated_at?.time ? chapter.updated_at.time * 1000 : undefined;
  return {
    url: `/${chapter.slug}/`,
    name: `Chapter ${chapter.number}`,
    number: Number.isFinite(parsedNum) ? parsedNum : undefined,
    uploadedAt: typeof uploadedAt === 'number' && Number.isFinite(uploadedAt) ? uploadedAt : undefined,
  };
}
