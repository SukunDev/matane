import { join } from 'node:path';

/** Characters no common file system accepts in a name (Windows is the strictest). */
// eslint-disable-next-line no-control-regex -- control characters are exactly what must go
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;
/** Device names Windows reserves, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** Well below every OS limit (255 bytes), leaving room for " (2)" and the extension. */
const MAX_BYTES = 120;

/**
 * One path segment that is valid on Windows, macOS and Linux: forbidden characters become "_",
 * trailing dots/spaces go (Windows drops them), reserved device names get a "_" prefix, and long
 * names are cut at a character boundary.
 */
export function sanitizeSegment(name: string, fallback = 'Untitled'): string {
  let text = name.normalize('NFC').replace(/\s+/g, ' ').replace(FORBIDDEN, '_').trim();
  text = text.replace(/[. ]+$/, '');
  if (!text || /^_+$/.test(text)) text = fallback;
  if (RESERVED.test(text)) text = `_${text}`;
  while (Buffer.byteLength(text, 'utf8') > MAX_BYTES) text = [...text].slice(0, -1).join('').trimEnd();
  return text;
}

export interface ChapterLocation {
  sourceName: string;
  sourceLang: string;
  mangaTitle: string;
  chapterName: string;
  scanlator: string | null;
}

/**
 * `<folder>/<Source (LANG)>/<Manga title>/<Chapter name [group]>` without the extension
 * (BRAINSTORM.md §6.4). The group keeps two releases of one chapter apart; the language keeps two
 * languages of one source apart.
 */
export function chapterBasePath(folder: string, at: ChapterLocation): string {
  const source = sanitizeSegment(`${at.sourceName} (${at.sourceLang.toUpperCase()})`, 'Source');
  const manga = sanitizeSegment(at.mangaTitle, 'Manga');
  const chapter = sanitizeSegment(at.scanlator ? `${at.chapterName} [${at.scanlator}]` : at.chapterName, 'Chapter');
  return join(folder, source, manga, chapter);
}

/** Zero-padded page file name inside a download, e.g. `007.jpg`. */
export const pageFileName = (index: number, ext: string) => `${String(index + 1).padStart(3, '0')}${ext}`;
