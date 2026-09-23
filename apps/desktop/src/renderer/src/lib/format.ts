const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "5 minutes ago", "3 days ago"; older than a month shows the date. */
export function formatRelative(timestamp: number, language: string, now = Date.now()): string {
  const diff = timestamp - now;
  const abs = Math.abs(diff);
  if (abs >= 30 * DAY) {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(timestamp);
  }
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), 'hour');
  return rtf.format(Math.round(diff / DAY), 'day');
}

/** Language name for a source language code, in the UI language ("id" → "Indonesian"). */
export function languageName(code: string, uiLanguage: string): string {
  if (code === 'all' || code === 'multi') return code.toUpperCase();
  try {
    return new Intl.DisplayNames([uiLanguage], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Two-letter badge for extensions/sources without an icon. */
export function initials(name: string): string {
  const words = name
    // "MangaDex" → "Manga Dex" so camel-cased names get two letters (MD).
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
