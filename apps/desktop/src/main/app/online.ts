/** How often the network state is read (Electron has no change event in main). */
const POLL_MS = 3_000;

/**
 * Whether the app is online (docs/BRAINSTORM.md §6.5): `net.isOnline()` read every few seconds, with
 * listeners told about changes. Update checks and the download queue wait while offline and go
 * on by themselves once back online. Tests can force a state with `override`.
 */
export class OnlineMonitor {
  private online: boolean;
  private forced: boolean | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor(private readonly probe: () => boolean) {
    this.online = probe();
  }

  isOnline(): boolean {
    return this.forced ?? this.online;
  }

  onChange(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(pollMs = POLL_MS): void {
    this.timer = setInterval(() => this.poll(), pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** Forces a state (null = follow the network again). */
  override(online: boolean | null): void {
    const before = this.isOnline();
    this.forced = online;
    this.notifyIfChanged(before);
  }

  poll(): void {
    const before = this.isOnline();
    this.online = this.probe();
    this.notifyIfChanged(before);
  }

  private notifyIfChanged(before: boolean): void {
    const now = this.isOnline();
    if (now === before) return;
    for (const listener of this.listeners) listener(now);
  }
}
