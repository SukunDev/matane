import type { MigratedUrls } from '@matane/extension-runtime';
import type { UrlKind } from '@matane/extension-sdk';
import type Database from 'better-sqlite3';

/** Settings key: per extension, the version whose urls are stored in the database. */
export const URL_VERSIONS_KEY = 'extensions.urlVersions';
const BATCH = 500;

export interface UrlMigrationDeps {
  sqlite: Database.Database;
  store: { get(): Record<string, string>; set(value: Record<string, string>): void };
  /** Installed extensions: id, version and source keys (null while one fails to load). */
  installed: () => { id: string; version: string; sourceKeys: string[] }[];
  /** Whether a source implements `migrateUrl`. */
  supports: (sourceId: string) => Promise<boolean>;
  migrate: (
    extensionId: string,
    sourceKey: string,
    items: { url: string; kind: UrlKind }[],
    fromVersion: string,
  ) => Promise<MigratedUrls>;
  record: (extensionId: string, level: 'info' | 'warn' | 'error', message: string) => void;
  /** After urls changed (tags to refresh). */
  changed?: () => void;
}

export interface UrlMigrationResult {
  extensionId: string;
  from: string;
  to: string;
  manga: number;
  chapters: number;
  skipped: number;
}

/**
 * Runs `migrateUrl` after an extension update changed its version (docs/BRAINSTORM.md §5.10): every
 * manga and chapter of its sources, library or not. All answers are collected first and written in
 * one transaction together with the new version, so an interrupted run (the app closed) changes
 * nothing and simply runs again at the next start. A url that would collide with an existing row
 * is kept and logged.
 */
export class UrlMigration {
  private running: Promise<UrlMigrationResult[]> | null = null;
  private again = false;

  constructor(private readonly deps: UrlMigrationDeps) {}

  /** Checks every installed extension; overlapping calls are merged into one more pass. */
  run(): Promise<UrlMigrationResult[]> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.pass().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.run();
      }
    });
    return this.running;
  }

  private async pass(): Promise<UrlMigrationResult[]> {
    const results: UrlMigrationResult[] = [];
    for (const extension of this.deps.installed()) {
      const versions = this.deps.store.get();
      const from = versions[extension.id];
      if (from === extension.version) continue;
      // First time seen: its urls are the current version's.
      if (from === undefined) {
        this.deps.store.set({ ...versions, [extension.id]: extension.version });
        continue;
      }
      try {
        const result = await this.migrateExtension(extension, from);
        if (result) results.push(result);
      } catch (error) {
        this.deps.record(
          extension.id,
          'error',
          `migrateUrl from ${from} failed, retried at the next start: ${(error as Error).message}`,
        );
      }
    }
    return results;
  }

  private async migrateExtension(
    extension: { id: string; version: string; sourceKeys: string[] },
    from: string,
  ): Promise<UrlMigrationResult | null> {
    const { sqlite } = this.deps;
    const mangaUpdates: { id: number; url: string }[] = [];
    const chapterUpdates: { id: number; url: string }[] = [];
    for (const key of extension.sourceKeys) {
      const sourceId = `${extension.id}/${key}`;
      const manga = sqlite.prepare('SELECT id, url FROM manga WHERE source_id = ?').all(sourceId) as {
        id: number;
        url: string;
      }[];
      if (manga.length === 0 || !(await this.deps.supports(sourceId))) continue;
      const chapters = sqlite
        .prepare('SELECT c.id, c.url FROM chapters c JOIN manga m ON m.id = c.manga_id WHERE m.source_id = ?')
        .all(sourceId) as { id: number; url: string }[];
      const items = [
        ...manga.map((row) => ({ ...row, kind: 'manga' as const })),
        ...chapters.map((row) => ({ ...row, kind: 'chapter' as const })),
      ];
      for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        const answer = await this.deps.migrate(
          extension.id,
          key,
          batch.map(({ url, kind }) => ({ url, kind })),
          from,
        );
        for (const error of answer.errors) this.deps.record(extension.id, 'warn', `migrateUrl kept ${error}`);
        batch.forEach((item, j) => {
          const next = answer.urls[j];
          if (typeof next !== 'string' || next === item.url || next.length === 0 || next.length > 2048) return;
          (item.kind === 'manga' ? mangaUpdates : chapterUpdates).push({ id: item.id, url: next });
        });
      }
    }

    let skipped = 0;
    let manga = 0;
    let chapters = 0;
    const updateManga = sqlite.prepare('UPDATE manga SET url = ? WHERE id = ?');
    const updateChapter = sqlite.prepare('UPDATE chapters SET url = ? WHERE id = ?');
    sqlite.transaction(() => {
      // Unique (source, url) and (manga, url): a collision keeps the old url.
      for (const { id, url } of mangaUpdates) {
        try {
          updateManga.run(url, id);
          manga++;
        } catch {
          skipped++;
          this.deps.record(extension.id, 'warn', `migrateUrl: manga ${id} → ${url} collides with another row; kept`);
        }
      }
      for (const { id, url } of chapterUpdates) {
        try {
          updateChapter.run(url, id);
          chapters++;
        } catch {
          skipped++;
          this.deps.record(extension.id, 'warn', `migrateUrl: chapter ${id} → ${url} collides with another row; kept`);
        }
      }
      this.deps.store.set({ ...this.deps.store.get(), [extension.id]: extension.version });
    })();
    if (manga + chapters > 0) this.deps.changed?.();
    this.deps.record(
      extension.id,
      'info',
      `migrateUrl ${from} → ${extension.version}: ${manga} manga and ${chapters} chapters updated, ${skipped} kept`,
    );
    return { extensionId: extension.id, from, to: extension.version, manga, chapters, skipped };
  }
}
