import type { ExtensionManifest } from '@manga-reader/extension-sdk/manifest';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { extensionPrefs, extensionStorage, extensions, sources } from '../schema';

export type ExtensionRow = typeof extensions.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;

export const sourceIdOf = (extensionId: string, key: string) => `${extensionId}/${key}`;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Installed extensions, their sources, and the per-extension storage/prefs they may use. */
export class ExtensionsRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  /** Records an extension and its sources. Sources dropped by a new version are kept (§7). */
  upsert(manifest: ExtensionManifest, now = Date.now()): void {
    this.db.transaction((tx) => {
      const values = {
        name: manifest.name,
        version: manifest.version,
        apiVersion: manifest.apiVersion,
        nsfw: manifest.nsfw,
        updatedAt: now,
      };
      tx.insert(extensions)
        .values({ id: manifest.id, ...values, installedAt: now })
        .onConflictDoUpdate({ target: extensions.id, set: values })
        .run();
      for (const source of manifest.sources) {
        const set = { name: source.name, lang: source.lang };
        tx.insert(sources)
          .values({ id: sourceIdOf(manifest.id, source.key), extensionId: manifest.id, key: source.key, ...set })
          .onConflictDoUpdate({ target: sources.id, set })
          .run();
      }
    });
    this.changes.mark('extensions', 'sources');
  }

  list(): ExtensionRow[] {
    return this.db.select().from(extensions).all();
  }

  get(id: string): ExtensionRow | undefined {
    return this.db.select().from(extensions).where(eq(extensions.id, id)).get();
  }

  listSources(): SourceRow[] {
    return this.db.select().from(sources).all();
  }

  getSource(id: string): SourceRow | undefined {
    return this.db.select().from(sources).where(eq(sources.id, id)).get();
  }

  setSourcePinned(id: string, pinned: boolean): void {
    this.db.update(sources).set({ pinned }).where(eq(sources.id, id)).run();
    this.changes.mark('sources');
  }

  touchSource(id: string, now = Date.now()): void {
    this.db.update(sources).set({ lastUsedAt: now }).where(eq(sources.id, id)).run();
    this.changes.mark('sources');
  }

  // ------------------------------------------------------------ extension storage

  getStorage(extensionId: string, key: string): unknown {
    const row = this.db
      .select()
      .from(extensionStorage)
      .where(and(eq(extensionStorage.extensionId, extensionId), eq(extensionStorage.key, key)))
      .get();
    return row ? parseJson(row.valueJson) : null;
  }

  setStorage(extensionId: string, key: string, value: unknown): void {
    const valueJson = JSON.stringify(value ?? null);
    this.db
      .insert(extensionStorage)
      .values({ extensionId, key, valueJson })
      .onConflictDoUpdate({ target: [extensionStorage.extensionId, extensionStorage.key], set: { valueJson } })
      .run();
  }

  removeStorage(extensionId: string, key: string): void {
    this.db
      .delete(extensionStorage)
      .where(and(eq(extensionStorage.extensionId, extensionId), eq(extensionStorage.key, key)))
      .run();
  }

  // ------------------------------------------------------------ preferences

  getPrefs(extensionId: string): Record<string, unknown> {
    const rows = this.db.select().from(extensionPrefs).where(eq(extensionPrefs.extensionId, extensionId)).all();
    return Object.fromEntries(rows.map((row) => [row.key, parseJson(row.valueJson)]));
  }

  setPref(extensionId: string, key: string, value: unknown): void {
    const valueJson = JSON.stringify(value ?? null);
    this.db
      .insert(extensionPrefs)
      .values({ extensionId, key, valueJson })
      .onConflictDoUpdate({ target: [extensionPrefs.extensionId, extensionPrefs.key], set: { valueJson } })
      .run();
    this.changes.mark('extensions');
  }
}
