import type { Chapter, MangaDetails, MangaStatus, MangaSummary, MangaType } from '@matane/extension-sdk';
import { COVERS_URL, type ChapterData, type LocalizedString, type MangaData } from './api';

/** Preferred localisation: the source language, then English, then whatever exists. */
export function localized(value: LocalizedString | undefined, lang: string): string | undefined {
  if (!value) return undefined;
  return value[lang] ?? value.en ?? Object.values(value)[0];
}

function title(manga: MangaData, lang: string): string {
  const { title: main, altTitles } = manga.attributes;
  // Main titles are often romanised Japanese; an alt title in the reader's language reads better.
  const alt = lang === 'en' ? undefined : altTitles.find((t) => t[lang])?.[lang];
  return alt ?? main.en ?? Object.values(main)[0] ?? altTitles.find((t) => t.en)?.en ?? manga.id;
}

function coverUrl(manga: MangaData): string | undefined {
  const fileName = manga.relationships.find((r) => r.type === 'cover_art')?.attributes?.fileName;
  return fileName ? `${COVERS_URL}/${manga.id}/${fileName}.512.jpg` : undefined;
}

export function toSummary(manga: MangaData, lang: string): MangaSummary {
  return { url: manga.id, title: title(manga, lang), thumbnailUrl: coverUrl(manga) };
}

const names = (manga: MangaData, type: string) =>
  [...new Set(manga.relationships.filter((r) => r.type === type).map((r) => r.attributes?.name))]
    .filter((name): name is string => Boolean(name))
    .join(', ') || undefined;

const TYPES: Record<string, MangaType> = { ja: 'manga', ko: 'manhwa', zh: 'manhua', 'zh-hk': 'manhua' };

export function toDetails(manga: MangaData, lang: string): MangaDetails {
  const { attributes } = manga;
  const description = localized(attributes.description, lang)?.trim();
  return {
    ...toSummary(manga, lang),
    author: names(manga, 'author'),
    artist: names(manga, 'artist'),
    description: description || undefined,
    genres: attributes.tags.map((tag) => localized(tag.attributes.name, 'en')).filter((n): n is string => Boolean(n)),
    status: (attributes.status ?? 'unknown') satisfies MangaStatus,
    type: TYPES[attributes.originalLanguage],
  };
}

export function toChapter(chapter: ChapterData): Chapter {
  const { volume, chapter: number, title: chapterTitle } = chapter.attributes;
  const label = [volume ? `Vol. ${volume}` : '', number ? `Ch. ${number}` : ''].filter(Boolean).join(' ');
  const name = label && chapterTitle ? `${label} - ${chapterTitle}` : label || chapterTitle || 'Oneshot';
  const groups = chapter.relationships
    .filter((r) => r.type === 'scanlation_group')
    .map((r) => r.attributes?.name)
    .filter((n): n is string => Boolean(n));
  const parsed = number === null ? Number.NaN : Number.parseFloat(number);
  const uploadedAt = Date.parse(chapter.attributes.publishAt);
  return {
    url: chapter.id,
    name,
    number: Number.isFinite(parsed) ? parsed : undefined,
    scanlator: groups.length > 0 ? groups.join(' & ') : undefined,
    uploadedAt: Number.isFinite(uploadedAt) ? uploadedAt : undefined,
  };
}
