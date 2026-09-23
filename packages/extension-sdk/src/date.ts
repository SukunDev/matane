// Plain JS helpers bundled into extensions (they do not need the host).

const UNITS: [RegExp, number][] = [
  [/^(second|sec|detik)s?$/, 1_000],
  [/^(minute|min|menit)s?$/, 60_000],
  [/^(hour|hr|jam)s?$/, 3_600_000],
  [/^(day|hari)s?$/, 86_400_000],
  [/^(week|minggu)s?$/, 604_800_000],
  [/^(month|bulan)s?$/, 2_592_000_000],
  [/^(year|tahun)s?$/, 31_536_000_000],
];

/**
 * Parses "2 hours ago", "3 days ago", "5 menit yang lalu", "yesterday"/"kemarin", "today"/"hari ini".
 * Returns epoch ms, or undefined when the text is not recognised.
 */
export function parseRelativeDate(text: string, now: number = Date.now()): number | undefined {
  const value = text.trim().toLowerCase();
  if (/^(just now|baru saja|now)$/.test(value)) return now;
  if (/^(today|hari ini)$/.test(value)) return now;
  if (/^(yesterday|kemarin)$/.test(value)) return now - 86_400_000;
  const match = /^(an?|\d+)\s+([a-z]+)\b/.exec(value);
  if (!match) return undefined;
  const amount = match[1] === 'a' || match[1] === 'an' ? 1 : Number(match[1]);
  const unit = UNITS.find(([pattern]) => pattern.test(match[2] ?? ''));
  return unit ? now - amount * unit[1] : undefined;
}
