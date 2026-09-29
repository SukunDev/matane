import { describe, expect, it } from 'vitest';
import {
  type BrowseSettings,
  DEFAULT_SETTINGS,
  browseSettingsSchema,
  contentLanguages,
  isContentVisible,
  primaryLanguage,
} from './settings';

const browse = (patch: Partial<BrowseSettings> = {}): BrowseSettings => ({ ...DEFAULT_SETTINGS.browse, ...patch });

describe('content filter', () => {
  it('defaults to the UI language and English', () => {
    expect(contentLanguages(browse(), 'id')).toEqual(['id', 'en']);
    expect(contentLanguages(browse(), 'en-US')).toEqual(['en']);
    expect(contentLanguages(browse({ languages: ['ja'] }), 'id')).toEqual(['ja']);
    expect(primaryLanguage('pt_BR')).toBe('pt');
  });

  it('shows items in a content language, or for every language', () => {
    expect(isContentVisible({ langs: ['en', 'ja'], nsfw: false }, browse(), 'id')).toBe(true);
    expect(isContentVisible({ langs: ['ja'], nsfw: false }, browse(), 'id')).toBe(false);
    expect(isContentVisible({ langs: ['pt-br'], nsfw: false }, browse({ languages: ['pt'] }), 'en')).toBe(true);
    expect(isContentVisible({ langs: ['all'], nsfw: false }, browse({ languages: ['ko'] }), 'en')).toBe(true);
  });

  it('hides adult content until it is turned on', () => {
    expect(isContentVisible({ langs: ['en'], nsfw: true }, browse(), 'en')).toBe(false);
    expect(isContentVisible({ langs: ['en'], nsfw: true }, browse({ showNsfw: true }), 'en')).toBe(true);
  });

  it('parses broken stored values to the defaults', () => {
    expect(browseSettingsSchema.parse({ showNsfw: 'yes', languages: 3, repoSyncHours: 5 })).toEqual(
      DEFAULT_SETTINGS.browse,
    );
  });
});
