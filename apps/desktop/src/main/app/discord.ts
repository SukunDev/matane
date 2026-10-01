import { Client } from '@xhayper/discord-rpc';

/**
 * The Discord application Matane shows up as (its Application ID, which Discord RPC calls the
 * client id; not a secret). `MATANE_DISCORD_CLIENT_ID` overrides it for testing, and set but empty
 * turns the feature off.
 */
export const DISCORD_CLIENT_ID: string | null = '1555185294750257252';

export const discordClientId = (env: NodeJS.ProcessEnv = process.env): string | null =>
  'MATANE_DISCORD_CLIENT_ID' in env ? env['MATANE_DISCORD_CLIENT_ID'] || null : DISCORD_CLIENT_ID;

/** What is being read, as far as Discord may know. */
export interface ReadingNow {
  title: string;
  chapter: string;
  /** From an adult source: never shown. */
  nsfw: boolean;
}

export interface PresenceActivity {
  details: string;
  state?: string;
  startTimestamp: number;
}

/** The part of the RPC client the presence uses (a fake in tests). */
export interface PresenceClient {
  connect(): Promise<void>;
  setActivity(activity: PresenceActivity): Promise<void>;
  clearActivity(): Promise<void>;
  close(): Promise<void>;
  onDisconnect(listener: () => void): void;
}

export function createDiscordClient(clientId: string): PresenceClient {
  const client = new Client({ clientId, transport: { type: 'ipc' } });
  return {
    connect: () => client.connect(),
    setActivity: async (activity) => {
      await client.user?.setActivity({ ...activity, largeImageKey: 'matane', instance: false });
    },
    clearActivity: async () => {
      await client.user?.clearActivity();
    },
    close: () => client.destroy(),
    onDisconnect: (listener) => void client.on('disconnected', listener),
  };
}

const RETRY_MS = 60_000;
/** Without a reader heartbeat this long, reading has stopped (window left open, app idle). */
const IDLE_MS = 10 * 60_000;

/**
 * Discord Rich Presence (BRAINSTORM.md §6.6): "Reading <title> · <chapter>" while the reader is in
 * use. Off by default; nothing for adult sources or while incognito; "Reading manga" only with
 * `hideTitle`. Talks to the local Discord app over IPC; when Discord is not running it stays quiet
 * and tries again now and then.
 */
export class DiscordPresence {
  private client: PresenceClient | null = null;
  private connecting: Promise<PresenceClient | null> | null = null;
  private retryAt = 0;
  private current: ReadingNow | null = null;
  private since = 0;
  private lastBeat = 0;
  private shown: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly deps: {
      createClient: () => PresenceClient;
      options: () => { enabled: boolean; hideTitle: boolean; incognito: boolean };
      texts: () => { reading: string; readingManga: string };
      now?: () => number;
      log?: (message: string) => void;
    },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The reader is on this chapter (each reader heartbeat). */
  reading(now: ReadingNow): Promise<void> {
    if (!this.current || this.current.title !== now.title) this.since = this.now();
    this.current = now;
    this.lastBeat = this.now();
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.stopped(), IDLE_MS);
    return this.sync();
  }

  /** The reader closed. */
  stopped(): Promise<void> {
    clearTimeout(this.idleTimer);
    this.current = null;
    return this.sync();
  }

  /** Settings or incognito changed. */
  async sync(): Promise<void> {
    const { enabled, hideTitle, incognito } = this.deps.options();
    if (!enabled) {
      await this.disconnect();
      return;
    }
    const reading = this.current && this.now() - this.lastBeat < IDLE_MS ? this.current : null;
    const activity = reading && !incognito && !reading.nsfw ? this.activity(reading, hideTitle) : null;
    const key = activity ? JSON.stringify(activity) : null;
    if (key === this.shown) return;
    const client = await this.connect();
    if (!client) return;
    try {
      if (activity) await client.setActivity(activity);
      else await client.clearActivity();
      this.shown = key;
    } catch (error) {
      this.deps.log?.(`discord: ${String(error)}`);
      await this.disconnect();
    }
  }

  async dispose(): Promise<void> {
    clearTimeout(this.idleTimer);
    await this.disconnect();
  }

  private activity(reading: ReadingNow, hideTitle: boolean): PresenceActivity {
    const texts = this.deps.texts();
    return hideTitle
      ? { details: texts.readingManga, startTimestamp: this.since }
      : {
          details: `${texts.reading} ${reading.title}`.slice(0, 128),
          state: reading.chapter.slice(0, 128),
          startTimestamp: this.since,
        };
  }

  private connect(): Promise<PresenceClient | null> {
    if (this.client) return Promise.resolve(this.client);
    if (this.now() < this.retryAt) return Promise.resolve(null);
    this.connecting ??= (async () => {
      const client = this.deps.createClient();
      try {
        await client.connect();
        client.onDisconnect(() => {
          if (this.client === client) {
            this.client = null;
            this.shown = null;
          }
        });
        this.client = client;
        return client;
      } catch {
        // Discord is not running (or not installed): quietly try again later.
        this.retryAt = this.now() + RETRY_MS;
        await client.close().catch(() => undefined);
        return null;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  private async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.shown = null;
    if (client) await client.close().catch(() => undefined);
  }
}
