/** Metadata for `ComicInfo.xml` (the ComicRack schema other readers understand). */
export interface ComicInfo {
  series: string;
  title: string;
  number: number | null;
  scanlator: string | null;
  writer: string | null;
  penciller: string | null;
  genres: readonly string[];
  summary: string | null;
  /** Read right to left (manga). */
  rightToLeft: boolean;
  web: string | null;
  languageIso: string | null;
  pageCount: number;
}

const escape = (text: string) =>
  text
    // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these control characters
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** `ComicInfo.xml` for a downloaded chapter (docs/BRAINSTORM.md §6.4); empty fields are left out. */
export function comicInfoXml(info: ComicInfo): string {
  const fields: [string, string | number | null][] = [
    ['Title', info.title],
    ['Series', info.series],
    ['Number', info.number],
    ['Summary', info.summary],
    ['Writer', info.writer],
    ['Penciller', info.penciller],
    ['Translator', info.scanlator],
    ['Genre', info.genres.length > 0 ? info.genres.join(', ') : null],
    ['Web', info.web],
    ['PageCount', info.pageCount],
    ['LanguageISO', info.languageIso],
    ['Manga', info.rightToLeft ? 'YesAndRightToLeft' : 'Yes'],
  ];
  const lines = fields
    .filter(([, value]) => value !== null && value !== '')
    .map(([name, value]) => `  <${name}>${escape(String(value))}</${name}>`);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    ...lines,
    '</ComicInfo>',
    '',
  ].join('\n');
}
