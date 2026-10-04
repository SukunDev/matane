import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, appSettingsSchema } from '../settings';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from './channels';
import { eventContract, invokeContract } from './contract';

describe('ipc contract', () => {
  it('defines a schema for every allowlisted channel and nothing else', () => {
    expect(Object.keys(invokeContract).sort()).toEqual([...INVOKE_CHANNELS].sort());
    expect(Object.keys(eventContract).sort()).toEqual([...EVENT_CHANNELS].sort());
  });

  it('accepts partial settings updates and rejects unknown values', () => {
    const input = invokeContract['settings.set'].input;
    expect(input.safeParse({ theme: 'latte' }).success).toBe(true);
    expect(input.safeParse({ theme: 'solarized' }).success).toBe(false);
    expect(input.safeParse({ accent: 'mauve', language: null }).success).toBe(true);
  });

  it('lets only a plain extension id reach uninstall, which names a folder', () => {
    const input = invokeContract['extensions.uninstall'].input;
    for (const extensionId of ['demo', 'example-2', '9lives']) {
      expect(input.safeParse({ extensionId }).success, extensionId).toBe(true);
    }
    for (const extensionId of ['..', '../x', 'a/b', 'a\\b', 'A', '', '.hidden', '-x']) {
      expect(input.safeParse({ extensionId }).success, extensionId).toBe(false);
    }
  });

  it('ships valid default settings', () => {
    expect(appSettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
