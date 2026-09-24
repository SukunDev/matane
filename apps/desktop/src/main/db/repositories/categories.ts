import type { Category } from '@manga-reader/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { categories } from '../schema';

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
        count: sql<number>`(SELECT COUNT(*) FROM manga_categories mc JOIN manga m ON m.id = mc.manga_id
          WHERE mc.category_id = ${categories.id} AND m.in_library = 1)`,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.id))
      .all();
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
    return { id: row.id, name: row.name, sortOrder: row.sortOrder, count: 0 };
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
