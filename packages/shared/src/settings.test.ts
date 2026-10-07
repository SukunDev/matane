import { describe, expect, it } from 'vitest';
import { resolveDirection, resolveMode } from './chapters';
import {
  DEFAULT_READER_SETTINGS,
  DEFAULT_SETTINGS,
  DEFAULT_TYPE_DEFAULTS,
  effectiveReaderSettings,
  readerSettingsSchema,
  toMangaReaderSettings,
  updaterSettingsSchema,
} from './settings';

describe('reader settings', () => {
  it('fills what an older version did not store, keeping what it did', () => {
    const old = { mode: 'webtoon', direction: 'rtl', fit: 'width', tapZones: 'kindle', background: 'white' };
    const parsed = readerSettingsSchema.parse(old);
    expect(parsed).toMatchObject(old);
    expect(parsed.typeDefaults).toEqual(DEFAULT_TYPE_DEFAULTS);
    expect(parsed.filters).toEqual(DEFAULT_READER_SETTINGS.filters);
    expect(parsed.keymap).toEqual({});
    expect(parsed.preloadPages).toBe(4);
  });

  it('drops a broken field on its own', () => {
    const parsed = readerSettingsSchema.parse({
      ...DEFAULT_READER_SETTINGS,
      typeDefaults: { ...DEFAULT_TYPE_DEFAULTS, manga: { mode: 'sideways', direction: 'ltr' } },
      filters: { ...DEFAULT_READER_SETTINGS.filters, brightness: 999 },
      keymap: { nextPage: ['L'], jump: ['J'] },
      backgroundColor: 'red',
    });
    expect(parsed.typeDefaults.manga).toEqual({ mode: 'single', direction: 'ltr' });
    expect(parsed.filters.brightness).toBe(100);
    expect(parsed.keymap).toEqual({});
    expect(parsed.backgroundColor).toBe('#1e1e2e');
  });

  it('resolves auto from the type, unless a manga sets its own', () => {
    const typeDefaults = { ...DEFAULT_TYPE_DEFAULTS, manga: { mode: 'double', direction: 'ltr' } } as const;
    const global = { ...DEFAULT_READER_SETTINGS, typeDefaults };
    expect(resolveMode(global.mode, 'manga', global.typeDefaults)).toBe('double');
    expect(resolveDirection(global.direction, 'manga', global.typeDefaults)).toBe('ltr');
    expect(resolveMode(global.mode, 'manhwa', global.typeDefaults)).toBe('webtoon');
    expect(resolveMode(global.mode, null, global.typeDefaults)).toBe('single');
    const own = effectiveReaderSettings(global, { mode: 'vertical', direction: 'rtl' });
    expect(resolveMode(own.mode, 'manga', own.typeDefaults)).toBe('vertical');
    expect(resolveDirection(own.direction, 'manga', own.typeDefaults)).toBe('rtl');
  });

  it('keeps filters and background with a manga, not keys or tap zones', () => {
    const saved = toMangaReaderSettings({
      ...DEFAULT_READER_SETTINGS,
      filters: { ...DEFAULT_READER_SETTINGS.filters, warm: 40 },
    });
    expect(saved.filters?.warm).toBe(40);
    expect(saved).toHaveProperty('backgroundColor');
    expect(saved).not.toHaveProperty('keymap');
    expect(saved).not.toHaveProperty('tapZones');
  });
});

describe('updater settings', () => {
  it('follows the stable releases by default, and keeps a saved choice of beta', () => {
    expect(DEFAULT_SETTINGS.updater.channel).toBe('stable');
    expect(updaterSettingsSchema.parse({ mode: 'notify', channel: 'beta' })).toEqual({
      mode: 'notify',
      channel: 'beta',
    });
    // A value that cannot be read falls back to stable, not to pre-releases.
    expect(updaterSettingsSchema.parse({ mode: 'auto', channel: 'nightly' }).channel).toBe('stable');
    expect(updaterSettingsSchema.parse({}).channel).toBe('stable');
  });
});
