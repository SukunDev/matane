import { z } from 'zod';
import { ACCENTS, LANGUAGES, THEME_MODES } from './theme';

export const appSettingsSchema = z.object({
  theme: z.enum(THEME_MODES),
  accent: z.enum(ACCENTS),
  /** `null` follows the operating system language. */
  language: z.enum(LANGUAGES).nullable(),
  sidebarCollapsed: z.boolean(),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'mocha',
  accent: 'mauve',
  language: null,
  sidebarCollapsed: false,
};
