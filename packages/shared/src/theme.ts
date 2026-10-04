// Catppuccin names shared by main (settings validation) and renderer (theming). See docs/BRAINSTORM.md §6.6.
export const THEME_MODES = ['system', 'mocha', 'macchiato', 'frappe', 'latte', 'amoled'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const ACCENTS = [
  'rosewater',
  'flamingo',
  'pink',
  'mauve',
  'red',
  'maroon',
  'peach',
  'yellow',
  'green',
  'teal',
  'sky',
  'sapphire',
  'blue',
  'lavender',
] as const;
export type Accent = (typeof ACCENTS)[number];

export const LANGUAGES = ['en', 'id'] as const;
export type Language = (typeof LANGUAGES)[number];
