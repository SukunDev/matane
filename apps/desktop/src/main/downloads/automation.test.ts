import { type ChapterInfo, DEFAULT_SETTINGS, type DownloadSettings, type MangaInfo } from '@manga-reader/shared';
import { NO_SCANLATOR_PREFS } from '@manga-reader/shared/chapters';
import { describe, expect, it, vi } from 'vitest';
import type { ChapterRow } from '../db/repositories/chapters';
import type { DownloadRow } from '../db/repositories/downloads';
import { DownloadAutomation, chaptersAhead, chaptersToDelete } from './automation';

let nextId = 1;
const ch = (number: number | null, extra: Partial<ChapterInfo> = {}): ChapterInfo => ({
  id: nextId++,
  mangaId: 1,
  url: `c${nextId}`,
  name: `Ch. ${number}`,
  number,
  scanlator: 'A',
  uploadedAt: null,
  sourceOrder: 0,
  read: false,
  readAt: null,
  bookmarked: false,
  lastPage: 0,
  totalPages: null,
  pageOffset: null,
  sourceMissing: false,
  ...extra,
});
/** Source order: newest first. */
const newestFirst = (chapters: ChapterInfo[]) => [...chapters].reverse();
const ids = (chapters: ChapterInfo[]) => chapters.map((c) => c.id);

describe('chaptersAhead', () => {
  it('takes the next unread chapters, skipping read ones and picking one version per number', () => {
    const c1 = ch(1, { read: true });
    const c2 = ch(2);
    const c3 = ch(3, { read: true });
    const c4a = ch(4, { scanlator: 'A' });
    const c4b = ch(4, { scanlator: 'B' });
    const c5 = ch(5);
    const c6 = ch(6);
    const list = newestFirst([c1, c2, c3, c4a, c4b, c5, c6]);
    expect(ids(chaptersAhead(list, c1, 2))).toEqual([c2.id, c4a.id]);
    expect(ids(chaptersAhead(list, c1, 2, { hidden: [], priority: ['B'] }))).toEqual([c2.id, c4b.id]);
    expect(ids(chaptersAhead(list, c5, 5))).toEqual([c6.id]);
    expect(chaptersAhead(list, c6, 2)).toEqual([]);
    expect(chaptersAhead(list, c1, 0)).toEqual([]);
  });

  it('skips chapters the source dropped', () => {
    const c1 = ch(1);
    const c2 = ch(2, { sourceMissing: true });
    const c3 = ch(3);
    expect(ids(chaptersAhead(newestFirst([c1, c2, c3]), c1, 1))).toEqual([c3.id]);
  });
});

describe('chaptersToDelete', () => {
  const keep = { delay: 0, keepBookmarked: true };

  it('deletes the finished chapter right away without a delay', () => {
    const c1 = ch(1, { read: true });
    const c2 = ch(2, { read: true });
    expect(ids(chaptersToDelete(newestFirst([c1, c2]), c2, keep))).toEqual([c2.id]);
  });

  it('waits until N later chapters are read', () => {
    const c1 = ch(1, { read: true });
    const c2 = ch(2, { read: true });
    const c3 = ch(3, { read: true });
    const list = newestFirst([c1, c2, c3, ch(4)]);
    expect(ids(chaptersToDelete(list, c3, { ...keep, delay: 2 }))).toEqual([c1.id]);
    expect(chaptersToDelete(list, c2, { ...keep, delay: 2 })).toEqual([]);
  });

  it('does not delete when a chapter in between is still unread (chapters were skipped)', () => {
    const c1 = ch(1, { read: true });
    const c2 = ch(2);
    const c3 = ch(3, { read: true });
    expect(chaptersToDelete(newestFirst([c1, c2, c3]), c3, { ...keep, delay: 2 })).toEqual([]);
  });

  it('counts versions of one number as one chapter and deletes every read version', () => {
    const c1a = ch(1, { read: true, scanlator: 'A' });
    const c1b = ch(1, { read: true, scanlator: 'B' });
    const c2 = ch(2, { read: true });
    const list = newestFirst([c1a, c1b, c2]);
    expect(ids(chaptersToDelete(list, c2, { ...keep, delay: 1 })).sort()).toEqual([c1a.id, c1b.id].sort());
  });

  it('keeps bookmarked chapters when asked to', () => {
    const c1 = ch(1, { read: true, bookmarked: true });
    expect(chaptersToDelete([c1], c1, keep)).toEqual([]);
    expect(ids(chaptersToDelete([c1], c1, { ...keep, keepBookmarked: false }))).toEqual([c1.id]);
  });
});

describe('DownloadAutomation', () => {
  function setup(options: { settings?: Partial<DownloadSettings>; inLibrary?: boolean; categoryIds?: number[] } = {}) {
    const chapters = [ch(1, { read: true }), ch(2), ch(3), ch(4)];
    const rows = newestFirst(chapters).map((c) => ({ ...c, mangaId: 7 }) as unknown as ChapterRow);
    const enqueueAuto = vi.fn(() => true);
    const deleteDownloads = vi.fn(async () => undefined);
    const automation = new DownloadAutomation({
      settings: () => ({ ...DEFAULT_SETTINGS.downloads, ...options.settings }),
      manga: {
        info: () =>
          ({ inLibrary: options.inLibrary ?? true, categoryIds: options.categoryIds ?? [] }) as unknown as MangaInfo,
      },
      chapters: { get: () => undefined, list: () => rows },
      downloads: {
        rowsForChapters: (chapterIds) =>
          chapterIds.map((chapterId) => ({ chapterId, status: 'done' }) as unknown as DownloadRow),
      },
      manager: { enqueueAuto, delete: deleteDownloads },
      scanlatorPrefs: () => NO_SCANLATOR_PREFS,
    });
    return { chapters, automation, enqueueAuto, deleteDownloads };
  }

  it('queues the next chapters once per chapter opened, for library manga only', () => {
    const { chapters, automation, enqueueAuto } = setup();
    automation.onProgress({ mangaId: 7, chapterId: chapters[1]!.id, finished: false });
    automation.onProgress({ mangaId: 7, chapterId: chapters[1]!.id, finished: false });
    expect(enqueueAuto).toHaveBeenCalledTimes(1);
    expect(enqueueAuto).toHaveBeenCalledWith([chapters[2]!.id, chapters[3]!.id]);

    const outside = setup({ inLibrary: false });
    outside.automation.onProgress({ mangaId: 7, chapterId: outside.chapters[1]!.id, finished: false });
    const off = setup({ settings: { ahead: 0 } });
    off.automation.onProgress({ mangaId: 7, chapterId: off.chapters[1]!.id, finished: false });
    expect(outside.enqueueAuto).not.toHaveBeenCalled();
    expect(off.enqueueAuto).not.toHaveBeenCalled();
  });

  it('deletes a finished chapter when the rule is on and the manga is not in an excluded category', async () => {
    const rule = { enabled: true, delay: 0, keepBookmarked: true, excludeCategoryIds: [5] };
    const on = setup({ settings: { ahead: 0, deleteAfterRead: rule } });
    on.automation.onProgress({ mangaId: 7, chapterId: on.chapters[0]!.id, finished: true });
    await vi.waitFor(() => expect(on.deleteDownloads).toHaveBeenCalledWith([on.chapters[0]!.id]));

    const excluded = setup({ settings: { ahead: 0, deleteAfterRead: rule }, categoryIds: [5] });
    excluded.automation.onProgress({ mangaId: 7, chapterId: excluded.chapters[0]!.id, finished: true });
    const off = setup({ settings: { ahead: 0 } });
    off.automation.onProgress({ mangaId: 7, chapterId: off.chapters[0]!.id, finished: true });
    await new Promise((r) => setTimeout(r, 5));
    expect(excluded.deleteDownloads).not.toHaveBeenCalled();
    expect(off.deleteDownloads).not.toHaveBeenCalled();
  });
});
