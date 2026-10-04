import { openZip, readEntry } from '../downloads/archive';

/** What the local source uses of a `ComicInfo.xml` (the ComicRack schema). */
export interface LocalComicInfo {
  series?: string;
  title?: string;
  writer?: string;
  penciller?: string;
  summary?: string;
  genres: string[];
  /** `Manga` is "Yes…": a manga rather than a western comic. */
  manga: boolean;
}

export const COMIC_INFO_MAX_BYTES = 256 * 1024;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const decode = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name: string) => {
      if (name.startsWith('#')) {
        const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .trim();

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return match ? decode(match[1] ?? '') || undefined : undefined;
}

/** A small reader for the few tags the app shows; unknown tags and bad XML give an empty result. */
export function parseComicInfo(xml: string): LocalComicInfo {
  const genres = (tag(xml, 'Genre') ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);
  return {
    series: tag(xml, 'Series'),
    title: tag(xml, 'Title'),
    writer: tag(xml, 'Writer'),
    penciller: tag(xml, 'Penciller'),
    summary: tag(xml, 'Summary'),
    genres,
    manga: /^yes/i.test(tag(xml, 'Manga') ?? ''),
  };
}

/** `ComicInfo.xml` inside a CBZ, or undefined when there is none (or the archive cannot be read). */
export async function readArchiveComicInfo(path: string): Promise<LocalComicInfo | undefined> {
  let archive;
  try {
    archive = await openZip(path);
  } catch {
    return undefined;
  }
  try {
    const name = [...archive.entries.keys()].find((n) => n.toLowerCase() === 'comicinfo.xml');
    const entry = name === undefined ? undefined : archive.entries.get(name);
    if (!entry || entry.uncompressedSize > COMIC_INFO_MAX_BYTES) return undefined;
    return parseComicInfo((await readEntry(archive.zip, entry)).toString('utf8'));
  } catch {
    return undefined;
  } finally {
    archive.zip.close();
  }
}
