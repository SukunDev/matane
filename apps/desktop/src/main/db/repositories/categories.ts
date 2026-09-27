import { type Category, type CategorySettings, categorySettingsSchema } from '@manga-reader/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { categories } from '../schema';

/** A category's settings, each field falling back on its own. */
export function categorySettingsOf(json: string | null): CategorySettings {
  let raw: unknown = {};
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {
    // keep defaults
  }
  return categorySettingsSchema.parse(raw && typeof raw === 'object' ? raw : {});
}

/** User categories; a manga can be in several (§6.2). "Default" is implicit: no category. */
export class CategoriesRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  list(): Category[] {
    return this.db
      .select({
        id: categories.id,
        name: categories.name,
        sortOrder: categories.sortOrder,
        settingsJson: categories.settingsJson,
        count: sql<number>`(SELECT COUNT(*) FROM manga_categories mc JOIN manga m ON m.id = mc.manga_id
          WHERE mc.category_id = ${categories.id} AND m.in_library = 1)`,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.id))
      .all()
      .map(({ settingsJson, ...row }) => ({ ...row, autoDownload: categorySettingsOf(settingsJson).autoDownload }));
  }

  /** Settings of every category, by id. */
  settings(): Map<number, CategorySettings> {
    return new Map(
      this.db
        .select({ id: categories.id, settingsJson: categories.settingsJson })
        .from(categories)
        .all()
        .map((row) => [row.id, categorySettingsOf(row.settingsJson)]),
    );
  }

  setAutoDownload(id: number, autoDownload: CategorySettings['autoDownload']): void {
    const row = this.db
      .select({ settingsJson: categories.settingsJson })
      .from(categories)
      .where(eq(categories.id, id))
      .get();
    if (!row) return;
    const settingsJson = JSON.stringify({ ...categorySettingsOf(row.settingsJson), autoDownload });
    this.db.update(categories).set({ settingsJson }).where(eq(categories.id, id)).run();
    this.changes.mark('categories');
  }

  create(name: string): Category {
    const next = this.db
      .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), -1)` })
      .from(categories)
      .get();
    const row = this.db
      .insert(categories)
      .values({ name: name.trim(), sortOrder: (next?.max ?? -1) + 1 })
      .returning()
      .get();
    this.changes.mark('categories');
    return { id: row.id, name: row.name, sortOrder: row.sortOrder, count: 0, autoDownload: null };
  }

  rename(id: number, name: string): void {
    this.db.update(categories).set({ name: name.trim() }).where(eq(categories.id, id)).run();
    this.changes.mark('categories');
  }

  /** Its manga stay in the library (in "Default" if it was their only category). */
  delete(id: number): void {
    this.db.delete(categories).where(eq(categories.id, id)).run();
    this.changes.mark('categories', 'library');
  }

  reorder(ids: readonly number[]): void {
    this.db.transaction((tx) => {
      ids.forEach((id, index) => tx.update(categories).set({ sortOrder: index }).where(eq(categories.id, id)).run());
    });
    this.changes.mark('categories');
  }
}
