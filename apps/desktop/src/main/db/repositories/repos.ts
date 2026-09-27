import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../client';
import type { DbChanges } from '../changes';
import { extensionRepos, extensions } from '../schema';

export type RepoRow = typeof extensionRepos.$inferSelect;

/** Extension repositories and which one an installed extension came from. */
export class ReposRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly changes: DbChanges,
  ) {}

  list(): RepoRow[] {
    return this.db.select().from(extensionRepos).orderBy(extensionRepos.id).all();
  }

  get(id: number): RepoRow | undefined {
    return this.db.select().from(extensionRepos).where(eq(extensionRepos.id, id)).get();
  }

  byUrl(url: string): RepoRow | undefined {
    return this.db.select().from(extensionRepos).where(eq(extensionRepos.url, url)).get();
  }

  insert(values: Omit<RepoRow, 'id'>): RepoRow {
    const row = this.db.insert(extensionRepos).values(values).returning().get();
    this.changes.mark('repos');
    return row;
  }

  update(id: number, values: Partial<Omit<RepoRow, 'id' | 'url'>>): void {
    this.db.update(extensionRepos).set(values).where(eq(extensionRepos.id, id)).run();
    this.changes.mark('repos');
  }

  /** Extensions installed from it stay installed, without a repository (no more updates). */
  remove(id: number): void {
    this.db.delete(extensionRepos).where(eq(extensionRepos.id, id)).run();
    this.changes.mark('repos', 'extensions');
  }

  /** The repository an installed extension came from (null: not from a repository). */
  installedFrom(extensionId: string): number | null {
    return (
      this.db.select({ repoId: extensions.repoId }).from(extensions).where(eq(extensions.id, extensionId)).get()
        ?.repoId ?? null
    );
  }

  setInstalledFrom(extensionId: string, repoId: number | null): void {
    this.db.update(extensions).set({ repoId }).where(eq(extensions.id, extensionId)).run();
    this.changes.mark('extensions');
  }
}
