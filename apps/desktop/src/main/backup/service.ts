import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AppSettings, BackupFile, BackupPreview, BackupProgress, RestoreResult } from '@manga-reader/shared';
import type Database from 'better-sqlite3';
import { collectBackup, writeBackup } from './export';
import { openBackup, previewBackup, restoreBackup } from './restore';

/** Automatic backups kept in the folder (older ones are removed). */
export const KEEP_AUTO = 7;
const AUTO_PREFIX = 'matane-backup-';
const SAFETY_PREFIX = 'matane-before-restore-';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Settings key (not an app setting): when the last automatic backup was written. */
export const LAST_AUTO_KEY = 'backup.lastAuto';
/** Settings key: preferences/storage from a backup for extensions not installed yet, by id. */
export const PENDING_KEY = 'backup.pendingExtensions';

type PendingData = Record<string, { prefs: Record<string, unknown>; storage: Record<string, unknown> }>;

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-10-02-0915": local date and time, sortable. */
export function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export interface BackupServiceDeps {
  sqlite: Database.Database;
  appVersion: string;
  settingKeys: readonly string[];
  settings: () => AppSettings['backup'];
  defaultFolder: string;
  customCoversDir: string;
  isInstalled: (extensionId: string) => boolean;
  store: { get<T>(key: string, fallback: T): T; set(key: string, value: unknown): void };
  /** Applies restored app settings (keeping what belongs to this machine). */
  applySettings: (settings: Record<string, unknown>) => void;
  /** After a restore: caches, the library and repositories are refreshed. */
  restored: () => void;
  onProgress?: (progress: BackupProgress) => void;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * Backup and restore (BRAINSTORM.md §6.7, ADR 0029): "Back up now", automatic daily or weekly
 * backups (the last 7 kept), previews, merge or replace restores, and the preferences of
 * extensions installed after a restore.
 */
export class BackupService {
  private busy: Promise<unknown> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: BackupServiceDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  folder(): string {
    return this.deps.settings().folder ?? this.deps.defaultFolder;
  }

  /** A file name for a backup written now. */
  defaultName(): string {
    return `${AUTO_PREFIX}${stamp(this.now())}.zip`;
  }

  /** Writes a backup to `target`. One backup or restore at a time. */
  async create(target: string): Promise<number> {
    return this.exclusive(async () => {
      this.deps.onProgress?.({ phase: 'writing', done: 0, total: 1 });
      const collected = collectBackup(this.deps.sqlite, {
        appVersion: this.deps.appVersion,
        settingKeys: this.deps.settingKeys,
        now: this.now(),
      });
      const size = await writeBackup(target, collected);
      this.deps.onProgress?.({ phase: 'writing', done: 1, total: 1 });
      this.deps.log?.(`backup written: ${target} (${collected.backup.data.manga.length} manga, ${size} bytes)`);
      return size;
    });
  }

  async list(): Promise<BackupFile[]> {
    const folder = this.folder();
    const names = await readdir(folder).catch(() => [] as string[]);
    const files = await Promise.all(
      names
        .filter((name) => name.endsWith('.zip') && (name.startsWith(AUTO_PREFIX) || name.startsWith(SAFETY_PREFIX)))
        .map(async (name) => {
          const path = join(folder, name);
          const info = await stat(path).catch(() => null);
          return info?.isFile()
            ? { path, name, sizeBytes: info.size, modifiedAt: info.mtimeMs, auto: name.startsWith(AUTO_PREFIX) }
            : null;
        }),
    );
    return files.filter((f): f is BackupFile => f !== null).sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  async preview(path: string): Promise<BackupPreview> {
    const open = await openBackup(path);
    try {
      return previewBackup(path, open.backup, this.deps.isInstalled);
    } finally {
      open.close();
    }
  }

  /** Restores a backup; "replace" writes a safety backup of the current state first. */
  async restore(path: string, options: { mode: 'merge' | 'replace'; settings: boolean }): Promise<RestoreResult> {
    const open = await openBackup(path);
    try {
      let safetyBackup: string | null = null;
      if (options.mode === 'replace') {
        await mkdir(this.folder(), { recursive: true });
        safetyBackup = join(this.folder(), `${SAFETY_PREFIX}${stamp(this.now())}.zip`);
        await this.create(safetyBackup);
      }
      const result = await this.exclusive(() =>
        restoreBackup(open, options, {
          sqlite: this.deps.sqlite,
          customCoversDir: this.deps.customCoversDir,
          isInstalled: this.deps.isInstalled,
          pendingExtensionData: (id, data) => {
            const pending = this.deps.store.get<PendingData>(PENDING_KEY, {});
            this.deps.store.set(PENDING_KEY, { ...pending, [id]: data });
          },
          applySettings: this.deps.applySettings,
          onProgress: (done, total) => this.deps.onProgress?.({ phase: 'restoring', done, total }),
          now: () => this.now(),
        }),
      );
      this.deps.log?.(
        `restored ${basename(path)} (${options.mode}): ${result.manga.added} manga added, ${result.manga.updated} updated, ` +
          `${result.failed.length} failed`,
      );
      this.deps.restored();
      return { ...result, safetyBackup };
    } finally {
      open.close();
    }
  }

  /**
   * Preferences and storage a backup had for an extension that was not installed then: written
   * once it is (keys already there are kept).
   */
  applyPending(extensionId: string): boolean {
    const pending = this.deps.store.get<PendingData>(PENDING_KEY, {});
    const data = pending[extensionId];
    if (!data || !this.deps.isInstalled(extensionId)) return false;
    const { sqlite } = this.deps;
    if (sqlite.prepare('SELECT 1 FROM extensions WHERE id = ?').get(extensionId) === undefined) return false;
    sqlite.transaction(() => {
      for (const [table, values] of [
        ['extension_prefs', data.prefs],
        ['extension_storage', data.storage],
      ] as const) {
        const statement = sqlite.prepare(
          `INSERT INTO ${table} (extension_id, key, value_json) VALUES (?, ?, ?) ON CONFLICT(extension_id, key) DO NOTHING`,
        );
        for (const [key, value] of Object.entries(values)) statement.run(extensionId, key, JSON.stringify(value));
      }
    })();
    const rest = { ...pending };
    delete rest[extensionId];
    this.deps.store.set(PENDING_KEY, rest);
    this.deps.log?.(`applied the backed up preferences of ${extensionId}`);
    return true;
  }

  /** Applies every pending extension data whose extension is installed now (at start). */
  applyAllPending(): void {
    for (const id of Object.keys(this.deps.store.get<PendingData>(PENDING_KEY, {}))) this.applyPending(id);
  }

  /** Whether an automatic backup is due (daily or weekly since the last one). */
  isDue(): boolean {
    const { auto } = this.deps.settings();
    if (auto === 'off') return false;
    const last = this.deps.store.get<number | null>(LAST_AUTO_KEY, null);
    return last === null || this.now() - last >= (auto === 'daily' ? DAY_MS : 7 * DAY_MS);
  }

  /** Writes an automatic backup when due, then keeps the newest `KEEP_AUTO` of them. */
  async runAutoIfDue(): Promise<string | null> {
    if (!this.isDue() || this.busy) return null;
    const folder = this.folder();
    await mkdir(folder, { recursive: true });
    const target = join(folder, this.defaultName());
    await this.create(target);
    this.deps.store.set(LAST_AUTO_KEY, this.now());
    await this.rotate();
    return target;
  }

  async rotate(): Promise<void> {
    // By name (a sortable time stamp), not by file time: synced folders rewrite file times.
    const auto = (await this.list()).filter((file) => file.auto).sort((a, b) => b.name.localeCompare(a.name));
    for (const old of auto.slice(KEEP_AUTO)) await rm(old.path, { force: true });
  }

  /**
   * Checks now and then (a missed backup runs soon after start); the first check waits a minute
   * so start-up stays quick.
   */
  start(firstDelayMs = 60_000, everyMs = 60 * 60_000): void {
    const run = () =>
      void this.runAutoIfDue().catch((error: unknown) => this.deps.log?.(`automatic backup failed: ${String(error)}`));
    setTimeout(run, firstDelayMs).unref?.();
    this.timer = setInterval(run, everyMs);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private exclusive<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.busy ?? Promise.resolve();
    const next = previous.then(run);
    // The queue itself never rejects (each caller gets its own result through `next`).
    const tracked: Promise<unknown> = next.then(
      () => undefined,
      () => undefined,
    );
    this.busy = tracked;
    void tracked.then(() => {
      if (this.busy === tracked) this.busy = null;
    });
    return next;
  }
}
