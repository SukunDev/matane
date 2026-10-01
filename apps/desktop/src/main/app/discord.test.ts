import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscordPresence, type PresenceActivity, type PresenceClient, discordClientId } from './discord';

function fakeClient(options: { failConnect?: boolean } = {}) {
  const calls: (PresenceActivity | 'clear' | 'close')[] = [];
  let onDisconnect: (() => void) | null = null;
  const client: PresenceClient = {
    connect: vi.fn(async () => {
      if (options.failConnect) throw new Error('Could not connect');
    }),
    setActivity: async (activity) => void calls.push(activity),
    clearActivity: async () => void calls.push('clear'),
    close: async () => void calls.push('close'),
    onDisconnect: (listener) => (onDisconnect = listener),
  };
  return { client, calls, disconnect: () => onDisconnect?.() };
}

describe('DiscordPresence', () => {
  let now: number;
  let opts: { enabled: boolean; hideTitle: boolean; incognito: boolean };
  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
    opts = { enabled: true, hideTitle: false, incognito: false };
  });
  afterEach(() => vi.useRealTimers());

  const make = (fake: ReturnType<typeof fakeClient>) => {
    const created = vi.fn(() => fake.client);
    const presence = new DiscordPresence({
      createClient: created,
      options: () => opts,
      texts: () => ({ reading: 'Reading', readingManga: 'Reading manga' }),
      now: () => now,
    });
    return { presence, created };
  };
  const reading = { title: 'Long Strip', chapter: 'Ch. 1', nsfw: false };

  it('shows the title and chapter while reading, once, and clears when the reader closes', async () => {
    const fake = fakeClient();
    const { presence } = make(fake);
    await presence.reading(reading);
    now += 30_000;
    await presence.reading(reading);
    expect(fake.calls).toEqual([{ details: 'Reading Long Strip', state: 'Ch. 1', startTimestamp: 1_000_000 }]);
    await presence.reading({ ...reading, chapter: 'Ch. 2' });
    expect(fake.calls.at(-1)).toMatchObject({ state: 'Ch. 2', startTimestamp: 1_000_000 });
    await presence.stopped();
    expect(fake.calls.at(-1)).toBe('clear');
  });

  it('hides the title on request, and shows nothing for adult sources or in incognito', async () => {
    const fake = fakeClient();
    const { presence } = make(fake);
    opts.hideTitle = true;
    await presence.reading(reading);
    expect(fake.calls).toEqual([{ details: 'Reading manga', startTimestamp: 1_000_000 }]);
    await presence.reading({ ...reading, nsfw: true });
    expect(fake.calls.at(-1)).toBe('clear');
    opts.hideTitle = false;
    await presence.reading(reading);
    opts.incognito = true;
    await presence.sync();
    expect(fake.calls.at(-1)).toBe('clear');
  });

  it('never connects while turned off, and disconnects when turned off', async () => {
    const fake = fakeClient();
    const { presence, created } = make(fake);
    opts.enabled = false;
    await presence.reading(reading);
    expect(created).not.toHaveBeenCalled();
    opts.enabled = true;
    await presence.sync();
    expect(fake.calls).toHaveLength(1);
    opts.enabled = false;
    await presence.sync();
    expect(fake.calls.at(-1)).toBe('close');
  });

  it('stays quiet without Discord and tries again a minute later', async () => {
    const down = fakeClient({ failConnect: true });
    const { presence, created } = make(down);
    await presence.reading(reading);
    await presence.reading(reading);
    expect(created).toHaveBeenCalledTimes(1);
    now += 61_000;
    await presence.reading(reading);
    expect(created).toHaveBeenCalledTimes(2);
  });

  it('shows again after Discord restarts, and clears after a long idle', async () => {
    const fake = fakeClient();
    const { presence } = make(fake);
    await presence.reading(reading);
    fake.disconnect();
    await presence.reading(reading);
    expect(fake.calls.filter((c) => typeof c === 'object')).toHaveLength(2);
    now += 11 * 60_000;
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(fake.calls.at(-1)).toBe('clear');
  });

  it('takes the application id from the build, or the environment for testing (empty = off)', () => {
    expect(discordClientId({})).toBe('1555185294750257252');
    expect(discordClientId({ MATANE_DISCORD_CLIENT_ID: '123' })).toBe('123');
    expect(discordClientId({ MATANE_DISCORD_CLIENT_ID: '' })).toBeNull();
  });
});
