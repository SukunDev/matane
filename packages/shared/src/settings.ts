import { z } from 'zod';
import { READER_BACKGROUNDS, READER_DIRECTIONS, READER_FITS, READER_MODES, TAP_ZONES } from './reader';
import { ACCENTS, LANGUAGES, THEME_MODES } from './theme';

/**
 * Global reader defaults (BRAINSTORM.md §6.1). "auto" picks from the manga type: manhwa/manhua read
 * as webtoon, manga right-to-left. Per-manga overrides arrive in Phase 2. Each field falls back on
 * its own so a stored value from an older version never resets the rest.
 */
export const readerSettingsSchema = z.object({
  mode: z.enum(READER_MODES).catch('auto'),
  direction: z.enum(READER_DIRECTIONS).catch('auto'),
  fit: z.enum(READER_FITS).catch('screen'),
  tapZones: z.enum(TAP_ZONES).catch('l'),
  /** Double-page: show the first page alone (covers) and shift pairs by one. */
  shiftDouble: z.boolean().catch(false),
  /** Webtoon column width in CSS px. */
  webtoonWidth: z.number().int().min(320).max(2000).catch(800),
  /** Gap between pages in vertical mode, px. */
  verticalGap: z.number().int().min(0).max(64).catch(16),
  background: z.enum(READER_BACKGROUNDS).catch('black'),
});
export type ReaderSettings = z.infer<typeof readerSettingsSchema>;
export type ReaderMode = ReaderSettings['mode'];

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  mode: 'auto',
  direction: 'auto',
  fit: 'screen',
  tapZones: 'l',
  shiftDouble: false,
  webtoonWidth: 800,
  verticalGap: 16,
  background: 'black',
};

export const appSettingsSchema = z.object({
  theme: z.enum(THEME_MODES),
  accent: z.enum(ACCENTS),
  /** `null` follows the operating system language. */
  language: z.enum(LANGUAGES).nullable(),
  sidebarCollapsed: z.boolean(),
  reader: readerSettingsSchema,
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'mocha',
  accent: 'mauve',
  language: null,
  sidebarCollapsed: false,
  reader: DEFAULT_READER_SETTINGS,
};
