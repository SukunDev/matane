export const SETTINGS_SECTIONS = [
  'general',
  'library',
  'reader',
  'downloads',
  'browse',
  'tracking',
  'network',
  'data',
  'advanced',
  'about',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Sections that are implemented so far; the rest show a "coming soon" state. */
export const READY_SECTIONS: readonly SettingsSection[] = ['general', 'library', 'downloads', 'advanced', 'about'];

export function isSettingsSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}
