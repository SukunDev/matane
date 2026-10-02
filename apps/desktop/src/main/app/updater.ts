import { PACKAGE_MANAGED, type PackageKind, type UpdaterSettings, type UpdaterStatus } from '@manga-reader/shared';
import { toAppErrorData } from '@manga-reader/shared/errors';

export const RELEASES_URL = 'https://github.com/SukunDev/matane/releases';
const RELEASES_API = 'https://api.github.com/repos/SukunDev/matane/releases?per_page=20';
/** First check shortly after start, then every 6 hours. */
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 3_600_000;

/**
 * Semver precedence for release versions ("0.1.0-beta.2" < "0.1.0-beta.10" < "0.1.0"); a leading
 * "v" is ignored. Negative when `a` is older.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre] = v.replace(/^v/, '').split(/-(.*)/s, 2);
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (d !== 0) return d;
  }
  // A release outranks its pre-releases.
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) {
      if (Number(p) !== Number(q)) return Number(p) - Number(q);
    } else if (pn !== qn) {
      return pn ? -1 : 1;
    } else if (p !== q) {
      return p < q ? -1 : 1;
    }
  }
  return 0;
}

export interface ReleaseInfo {
  tag: string;
  prerelease: boolean;
  draft: boolean;
  url: string;
}

/** The newest release on this channel that is newer than `current`, if any. */
export function newerRelease(
  releases: readonly ReleaseInfo[],
  current: string,
  channel: UpdaterSettings['channel'],
): ReleaseInfo | undefined {
  return releases
    .filter((r) => !r.draft && (channel === 'beta' || !r.prerelease) && compareVersions(r.tag, current) > 0)
    .sort((a, b) => compareVersions(b.tag, a.tag))[0];
}

/** What of electron-updater's `autoUpdater` is used (tests pass a fake). */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: never[]) => void): unknown;
}

export interface AppUpdaterDeps {
  /** How this copy was installed (the message differs for package managers). */
  packaging: PackageKind;
  kind: UpdaterStatus['kind'];
  version: string;
  settings: () => UpdaterSettings;
  /** electron-updater, only created for "auto" installs. */
  autoUpdater?: () => AutoUpdaterLike;
  /** GitHub releases (notify-only installs). */
  fetchReleases: () => Promise<ReleaseInfo[]>;
  isOnline: () => boolean;
  notify: (text: { title: string; body: string }) => void;
  language: () => string;
  onStatus: (status: UpdaterStatus) => void;
  log?: (message: string) => void;
  now?: () => number;
}

/**
 * App updates (BRAINSTORM.md §10; ADR 0021). NSIS and AppImage update through electron-updater
 * (downloading by itself, or on request in "notify only" mode) and install on restart. Other installs
 * only learn about a newer GitHub release and link to it. Nothing is sent anywhere but the release
 * feed.
 */
export class AppUpdater {
  private status: UpdaterStatus;
  private updater: AutoUpdaterLike | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private notified = new Set<string>();

  constructor(private readonly deps: AppUpdaterDeps) {
    this.status = {
      kind: deps.kind,
      packaging: deps.packaging,
      state: 'idle',
      version: null,
      progress: null,
      error: null,
      checkedAt: null,
      releaseUrl: RELEASES_URL,
    };
  }

  getStatus(): UpdaterStatus {
    return this.status;
  }

  start(): void {
    if (this.deps.kind === 'none') return;
    const tick = () => {
      if (this.deps.settings().mode !== 'off' && this.deps.isOnline()) void this.check();
    };
    const first = setTimeout(tick, FIRST_CHECK_MS);
    const every = setInterval(tick, CHECK_EVERY_MS);
    first.unref?.();
    every.unref?.();
    this.timers.push(first, every);
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private set(patch: Partial<UpdaterStatus>): void {
    this.status = { ...this.status, ...patch };
    this.deps.onStatus(this.status);
  }

  private text(kind: 'ready' | 'available', version: string): { title: string; body: string } {
    const id = this.deps.language().startsWith('id');
    if (kind === 'ready') {
      return id
        ? { title: `Matane ${version} siap dipasang`, body: 'Mulai ulang Matane untuk memperbarui.' }
        : { title: `Matane ${version} is ready`, body: 'Restart Matane to update.' };
    }
    // Flatpak, AUR and deb/rpm installs update through their package manager.
    if (PACKAGE_MANAGED.includes(this.deps.packaging)) {
      return id
        ? { title: `Matane ${version} tersedia`, body: 'Perbarui lewat package manager kamu.' }
        : { title: `Matane ${version} is available`, body: 'Update it through your package manager.' };
    }
    return id
      ? { title: `Matane ${version} tersedia`, body: 'Lihat Setting → Tentang.' }
      : { title: `Matane ${version} is available`, body: 'See Settings → About.' };
  }

  /** Tells once per version. */
  private notifyOnce(kind: 'ready' | 'available', version: string): void {
    const key = `${kind}:${version}`;
    if (this.notified.has(key)) return;
    this.notified.add(key);
    this.deps.notify(this.text(kind, version));
  }

  async check(): Promise<UpdaterStatus> {
    if (this.deps.kind === 'none') return this.status;
    if (['checking', 'downloading', 'downloaded'].includes(this.status.state)) return this.status;
    this.set({ state: 'checking', error: null });
    try {
      if (this.deps.kind === 'auto') await this.checkAuto();
      else await this.checkNotify();
    } catch (error) {
      const { message } = toAppErrorData(error);
      this.deps.log?.(`update check failed: ${message}`);
      this.set({ state: 'error', error: message, checkedAt: this.now() });
    }
    return this.status;
  }

  async download(): Promise<void> {
    if (this.deps.kind !== 'auto' || this.status.state !== 'available') return;
    this.set({ state: 'downloading', progress: 0 });
    await this.auto()
      .downloadUpdate()
      .catch((error: unknown) => this.set({ state: 'error', error: toAppErrorData(error).message }));
  }

  install(): void {
    if (this.status.state === 'downloaded') this.auto().quitAndInstall(false, true);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private auto(): AutoUpdaterLike {
    if (this.updater) return this.updater;
    const updater = this.deps.autoUpdater!();
    updater.autoInstallOnAppQuit = true;
    updater.allowDowngrade = false;
    updater.on('update-available', ((info: { version: string }) => {
      const downloading = updater.autoDownload;
      this.set({
        state: downloading ? 'downloading' : 'available',
        version: info.version,
        progress: downloading ? 0 : null,
        checkedAt: this.now(),
        releaseUrl: `${RELEASES_URL}/tag/v${info.version}`,
      });
      if (!downloading) this.notifyOnce('available', info.version);
    }) as never);
    updater.on('update-not-available', (() =>
      this.set({ state: 'latest', version: null, checkedAt: this.now() })) as never);
    updater.on('download-progress', ((p: { percent: number }) =>
      this.set({ state: 'downloading', progress: Math.round(p.percent) })) as never);
    updater.on('update-downloaded', ((info: { version: string }) => {
      this.set({ state: 'downloaded', version: info.version, progress: 100 });
      this.notifyOnce('ready', info.version);
    }) as never);
    updater.on('error', ((error: Error) => {
      this.deps.log?.(`updater: ${error.message}`);
      this.set({ state: 'error', error: error.message });
    }) as never);
    this.updater = updater;
    return updater;
  }

  private async checkAuto(): Promise<void> {
    const updater = this.auto();
    const settings = this.deps.settings();
    updater.autoDownload = settings.mode === 'auto';
    updater.allowPrerelease = settings.channel === 'beta';
    // Results arrive through the events above.
    await updater.checkForUpdates();
  }

  private async checkNotify(): Promise<void> {
    const found = newerRelease(await this.deps.fetchReleases(), this.deps.version, this.deps.settings().channel);
    if (!found) {
      this.set({ state: 'latest', version: null, checkedAt: this.now(), releaseUrl: RELEASES_URL });
      return;
    }
    const version = found.tag.replace(/^v/, '');
    this.set({ state: 'available', version, checkedAt: this.now(), releaseUrl: found.url });
    this.notifyOnce('available', version);
  }
}

/** GitHub's releases API → `ReleaseInfo` (notify-only installs; no auth, public data only). */
export async function fetchGithubReleases(fetchJson: (url: string) => Promise<unknown>): Promise<ReleaseInfo[]> {
  const data = (await fetchJson(RELEASES_API)) as {
    tag_name: string;
    prerelease: boolean;
    draft: boolean;
    html_url: string;
  }[];
  return data.map((r) => ({ tag: r.tag_name, prerelease: r.prerelease, draft: r.draft, url: r.html_url }));
}
