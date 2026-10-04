import { type HtmlElement, type MangaStatus, type MangaType, parseRelativeDate } from '@matane/extension-sdk';

// Helpers both templates share. They run inside the sandbox (ES2020, no `URL`, no Node.js), so they
// stick to strings and regular expressions.

/** Where lazy loaders keep the real address of an image; `src` is often a placeholder. */
const IMAGE_ATTRS = ['data-src', 'data-lazy-src', 'data-cfsrc', 'data-original', 'src'];

/** An image's absolute address, from the first attribute that holds one. */
export function imageUrl(el: HtmlElement | null | undefined): string | undefined {
  if (!el) return undefined;
  for (const name of IMAGE_ATTRS) {
    const value = el.attr(name)?.trim();
    if (value && !value.startsWith('data:')) return el.absUrl(name) ?? value;
  }
  return undefined;
}

/** Text with runs of whitespace (newlines, indentation, non-breaking spaces) as single spaces. */
export const clean = (text: string | undefined): string => (text ?? '').replace(/[\s\u00a0]+/g, ' ').trim();

const trimEnd = (base: string) => base.replace(/\/+$/, '');

/** The part of `url` after `baseUrl` (what extensions store), or `url` itself for another site. */
export function toPath(url: string, baseUrl: string): string {
  const base = trimEnd(baseUrl);
  if (!url.toLowerCase().startsWith(base.toLowerCase())) return url;
  const rest = url.slice(base.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}

/** The inverse of {@link toPath}. */
export function toUrl(path: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return trimEnd(baseUrl) + (path.startsWith('/') ? path : `/${path}`);
}

/** A page of the site as parsed HTML; `baseUrl` lets `absUrl` resolve links and images. */
export async function loadDoc(
  url: string,
  baseUrl: string,
  options: {
    method?: 'GET' | 'POST';
    body?: string | { form: Record<string, string> };
    headers?: Record<string, string>;
  } = {},
): Promise<HtmlElement> {
  const response =
    options.method === 'POST'
      ? await http.post<string>(url, options.body ?? '', { headers: options.headers })
      : await http.get<string>(url, { headers: options.headers });
  return html.load(response.body, { baseUrl });
}

export function parseStatus(text: string): MangaStatus {
  const value = text.toLowerCase();
  if (/hiatus|on hold|paused|istirahat/.test(value)) return 'hiatus';
  if (/cancel|drop|discontinued|dihentikan/.test(value)) return 'cancelled';
  if (/complete|finish|tamat|\bend(ed)?\b/.test(value)) return 'completed';
  if (/ongoing|on going|publishing|berjalan/.test(value)) return 'ongoing';
  return 'unknown';
}

export function parseType(text: string): MangaType | undefined {
  const value = text.toLowerCase();
  for (const type of ['manhwa', 'manhua', 'manga', 'comic'] as const) if (value.includes(type)) return type;
  return undefined;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  januari: 0,
  january: 0,
  feb: 1,
  februari: 1,
  february: 1,
  mar: 2,
  maret: 2,
  march: 2,
  apr: 3,
  april: 3,
  mei: 4,
  may: 4,
  jun: 5,
  juni: 5,
  june: 5,
  jul: 6,
  juli: 6,
  july: 6,
  agu: 7,
  agt: 7,
  agustus: 7,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  okt: 9,
  oct: 9,
  oktober: 9,
  october: 9,
  nov: 10,
  november: 10,
  des: 11,
  dec: 11,
  desember: 11,
  december: 11,
};

/** "January 5, 2024", "5 Januari 2024", "2024-01-05": epoch ms (UTC), or undefined. */
export function parseAbsoluteDate(text: string): number | undefined {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, '$1')
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ');
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(value);
  if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = /^([a-z]+) (\d{1,2}) (\d{4})$/.exec(value);
  if (match && MONTHS[match[1]!] !== undefined) return Date.UTC(Number(match[3]), MONTHS[match[1]!]!, Number(match[2]));
  match = /^(\d{1,2}) ([a-z]+) (\d{4})$/.exec(value);
  if (match && MONTHS[match[2]!] !== undefined) return Date.UTC(Number(match[3]), MONTHS[match[2]!]!, Number(match[1]));
  return undefined;
}

/** A chapter date as sites show it: "3 days ago", "yesterday" or a calendar date. */
export function parseDate(text: string, now: number = Date.now()): number | undefined {
  return parseRelativeDate(text, now) ?? parseAbsoluteDate(text);
}

/**
 * The JSON object that follows `marker` in a script (e.g. the argument of `ts_reader.run(`), found
 * by matching braces, so it works however much code surrounds it.
 */
export function jsonAfter(source: string, marker: RegExp): unknown {
  const found = marker.exec(source);
  if (!found) return undefined;
  const start = source.indexOf('{', found.index + found[0].length);
  if (start < 0) return undefined;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(source.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** "Label: value" or "Label value" → [label, value], for the info rows themes print. */
export function splitLabel(text: string): [string, string] | undefined {
  const match =
    /^\s*([A-Za-z][A-Za-z() ]*?)\s*:\s*(.*)$/s.exec(text) ?? /^\s*(Status|Type|Author|Artist)\s+(.*)$/is.exec(text);
  return match ? [match[1]!.trim().toLowerCase(), match[2]!.trim()] : undefined;
}

/** Drops placeholders such as "-" or "N/A" that themes print for unknown values. */
export const known = (value: string | undefined): string | undefined =>
  value && !/^(-|–|n\/a|unknown|none|\?)$/i.test(value.trim()) ? value.trim() : undefined;

/** Items once, in order (listings repeat entries between the grid and a slider). */
export function unique<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.url) ? false : (seen.add(item.url), true)));
}
