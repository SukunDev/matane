import type { ChaptersRepository } from '../db/repositories/chapters';
import type { LibraryRepository } from '../db/repositories/library';
import type { MangaRepository } from '../db/repositories/manga';
import type { ProgressRepository } from '../db/repositories/progress';
import type { SourceService } from '../extensions/sources';
import type { CoverStore } from '../images/covers';
import type { ImageService } from '../images/service';

export interface LibraryServiceDeps {
  library: LibraryRepository;
  manga: MangaRepository;
  chapters: ChaptersRepository;
  progress: ProgressRepository;
  sources: Pick<SourceService, 'refreshManga'>;
  images: Pick<ImageService, 'cover' | 'page'>;
  covers: CoverStore;
  log?: (message: string) => void;
}

/** Library actions that span repositories, the source and the cover store (BRAINSTORM.md §6.2). */
export class LibraryService {
  constructor(private readonly deps: LibraryServiceDeps) {}

  /** Adds a manga (details and chapters are fetched first if it was only seen in a listing). */
  async add(mangaId: number, categoryIds: readonly number[]): Promise<void> {
    const row = this.deps.manga.get(mangaId);
    if (row && row.lastUpdateCheckAt === null) {
      // Offline or a flaky source must not block adding; the next refresh fills it in.
      await this.deps.sources.refreshManga(mangaId).catch((error: unknown) => {
        this.deps.log?.(`refresh before adding manga ${mangaId} failed: ${String(error)}`);
      });
    }
    this.deps.library.add(mangaId, categoryIds);
    // Take the permanent cover copy now, while the source is reachable.
    void this.deps.images.cover(mangaId).catch(() => undefined);
  }

  async remove(mangaIds: readonly number[]): Promise<void> {
    this.deps.library.remove(mangaIds);
    for (const id of mangaIds) await this.deps.covers.drop(id);
  }

  setCategories(mangaIds: readonly number[], categoryIds: readonly number[]): void {
    this.deps.library.setCategories(mangaIds, categoryIds);
  }

  markRead(mangaIds: readonly number[], read: boolean): void {
    const ids = mangaIds.flatMap((id) => this.deps.chapters.list(id).map((c) => c.id));
    if (ids.length > 0) this.deps.progress.markRead(ids, read);
  }

  setCustomCoverFromFile(mangaId: number, path: string): Promise<void> {
    return this.deps.covers.setCustom(mangaId, path);
  }

  /** "Set as cover" from the reader: the page is already in the image cache. */
  async setCustomCoverFromPage(mangaId: number, chapterId: number, index: number): Promise<void> {
    const image = await this.deps.images.page(chapterId, index);
    if ('data' in image) await this.deps.covers.setCustomBytes(mangaId, image.data);
    else await this.deps.covers.setCustom(mangaId, image.path);
  }

  resetCover(mangaId: number): Promise<void> {
    return this.deps.covers.resetCustom(mangaId);
  }
}
