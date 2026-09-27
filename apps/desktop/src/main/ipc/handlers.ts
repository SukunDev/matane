import { AppError } from '@manga-reader/shared/errors';
import { toChapterInfo } from '../db/repositories/chapters';
import { BrowserWindow, app, dialog, shell } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { CategoriesRepository } from '../db/repositories/categories';
import type { HistoryRepository } from '../db/repositories/history';
import type { LibraryRepository } from '../db/repositories/library';
import type { MangaRepository } from '../db/repositories/manga';
import type { ExtensionService } from '../extensions/service';
import type { SourceService } from '../extensions/sources';
import type { NetworkManager } from '../network/manager';
import type { LibraryService } from '../library/service';
import type { DownloadsRepository } from '../db/repositories/downloads';
import type { DownloadManager } from '../downloads/manager';
import type { MigrationService } from '../library/migration';
import type { ReadingService } from '../reading/service';
import { type IpcHandlers, broadcast } from './register';
import type { RequestRegistry } from './requests';

export interface IpcDeps {
  settings: SettingsRepository;
  extensions: ExtensionService;
  sources: SourceService;
  chapters: ChaptersRepository;
  network: NetworkManager;
  requests: RequestRegistry;
  reading: ReadingService;
  history: HistoryRepository;
  library: LibraryService;
  libraryRepo: LibraryRepository;
  categories: CategoriesRepository;
  manga: MangaRepository;
  migration: MigrationService;
  downloads: DownloadManager;
  downloadsRepo: DownloadsRepository;
}

export function createIpcHandlers({
  settings,
  extensions,
  sources,
  chapters,
  network,
  requests,
  reading,
  history,
  library,
  libraryRepo,
  categories,
  manga,
  migration,
  downloads,
  downloadsRepo,
}: IpcDeps): IpcHandlers {
  const existing = (mangaId: number) => {
    if (!manga.get(mangaId)) throw new AppError('not_found', `Manga ${mangaId} not found`);
    return mangaId;
  };
  const windowOf = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender);

  return {
    'app.getInfo': () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
    }),
    'app.getLocale': () => app.getLocale(),

    'window.minimize': (_input, event) => {
      windowOf(event)?.minimize();
    },
    'window.toggleMaximize': (_input, event) => {
      const window = windowOf(event);
      if (!window) return false;
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      return window.isMaximized();
    },
    'window.close': (_input, event) => {
      windowOf(event)?.close();
    },
    'window.isMaximized': (_input, event) => windowOf(event)?.isMaximized() ?? false,
    'window.toggleFullScreen': (input, event) => {
      const window = windowOf(event);
      if (!window) return false;
      window.setFullScreen(input?.value ?? !window.isFullScreen());
      return window.isFullScreen();
    },

    'settings.get': () => settings.getAppSettings(),
    'settings.set': (patch) => {
      const next = settings.updateAppSettings(patch);
      broadcast('settings.changed', next);
      return next;
    },

    'extensions.list': () => extensions.list(),
    'extensions.loadDevFolder': async (input, event) => {
      let path = input?.path;
      if (!path) {
        const window = windowOf(event);
        const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] };
        const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
        if (picked.canceled || !picked.filePaths[0]) return null;
        path = picked.filePaths[0];
      }
      return extensions.addDevFolder(path);
    },
    'extensions.removeDevFolder': ({ path }) => extensions.removeDevFolder(path),
    'extensions.reload': (input) => extensions.reload(input?.extensionId),
    'extensions.preferences': ({ extensionId }) => extensions.preferences(extensionId),
    'extensions.setPreference': ({ extensionId, key, value }) => extensions.setPreference(extensionId, key, value),

    'sources.list': () => sources.list(),
    'sources.info': ({ sourceId }) => sources.info(sourceId),
    'sources.filters': ({ sourceId }) => sources.filters(sourceId),
    'sources.browse': ({ requestId, ...input }) => requests.run(requestId, (signal) => sources.browse(input, signal)),
    'sources.setPinned': ({ sourceId, pinned }) => sources.setPinned(sourceId, pinned),
    'sources.resolveUrl': ({ url }) => sources.resolveUrl(url),
    'sources.solveChallenge': async ({ sourceId }) => {
      const source = sources.source(sourceId);
      const { baseUrl } = await sources.info(sourceId);
      await network.solveVisible(source.extensionId, baseUrl);
      return true;
    },

    'manga.get': ({ mangaId }) => sources.getManga(mangaId),
    'manga.refresh': ({ mangaId, requestId }) =>
      requests.run(requestId, (signal) => sources.refreshManga(mangaId, signal)),
    'manga.openInBrowser': async ({ mangaId }) => {
      await shell.openExternal(await sources.webUrl(mangaId));
    },
    'chapters.list': ({ mangaId }) => chapters.list(mangaId).map(toChapterInfo),
    'chapter.get': ({ chapterId }) => {
      const chapter = chapters.get(chapterId);
      if (!chapter) throw new AppError('not_found', `Chapter ${chapterId} not found`);
      return toChapterInfo(chapter);
    },
    'chapter.pages': ({ chapterId, requestId }) =>
      requests.run(requestId, (signal) => sources.pages(chapterId, signal)),
    'requests.cancel': ({ requestId }) => requests.cancel(requestId),

    'progress.save': (input) => reading.saveProgress(input),
    'chapters.markRead': ({ chapterIds, read }) => reading.markRead(chapterIds, read),
    'chapters.markPreviousRead': ({ chapterId }) => reading.markPreviousRead(chapterId),
    'manga.continue': ({ mangaId }) => reading.continueTarget(mangaId),
    'reading.heartbeat': ({ chapterId }) => reading.heartbeat(chapterId),
    'reading.end': () => reading.endSession(),
    'history.list': (input) => history.list(input ?? {}),
    'history.remove': ({ mangaId }) => history.remove(mangaId),
    'history.clear': () => history.clear(),

    'library.list': (input) => libraryRepo.list(input),
    'library.counts': () => libraryRepo.counts(),
    'library.add': ({ mangaId, categoryIds }) => library.add(mangaId, categoryIds),
    'library.remove': ({ mangaIds }) => library.remove(mangaIds),
    'library.setCategories': ({ mangaIds, categoryIds }) => library.setCategories(mangaIds, categoryIds),
    'library.markRead': ({ mangaIds, read }) => library.markRead(mangaIds, read),
    'categories.list': () => categories.list(),
    'categories.create': ({ name }) => categories.create(name),
    'categories.rename': ({ id, name }) => categories.rename(id, name),
    'categories.delete': ({ id }) => categories.delete(id),
    'categories.reorder': ({ ids }) => categories.reorder(ids),
    'manga.setCustomCover': async ({ mangaId, from }, event) => {
      if (from.kind === 'page') {
        await library.setCustomCoverFromPage(mangaId, from.chapterId, from.index);
        return true;
      }
      const window = windowOf(event);
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }],
      };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const path = picked.filePaths[0];
      if (picked.canceled || !path) return false;
      await library.setCustomCoverFromFile(mangaId, path);
      return true;
    },
    'manga.resetCover': ({ mangaId }) => library.resetCover(mangaId),
    'manga.findDuplicates': ({ mangaId }) => libraryRepo.findDuplicates(mangaId),
    'manga.setReaderSettings': ({ mangaId, settings }) => manga.setReaderSettings(existing(mangaId), settings),
    'manga.setScanlatorPrefs': ({ mangaId, prefs }) => manga.setScanlatorPrefs(existing(mangaId), prefs),
    'manga.setChapterView': ({ mangaId, view }) => manga.setChapterView(existing(mangaId), view),
    'downloads.enqueue': ({ chapterIds }) => downloads.enqueue(chapterIds),
    'downloads.list': (input) => downloadsRepo.list(input ?? {}),
    'downloads.stats': () => downloadsRepo.stats(),
    'downloads.pause': (input) => downloads.pause(input?.ids),
    'downloads.resume': (input) => downloads.resume(input?.ids),
    'downloads.cancel': ({ ids }) => downloads.cancel(ids),
    'downloads.retry': ({ ids }) => downloads.retry(ids),
    'downloads.reorder': ({ ids }) => downloads.reorder(ids),
    'downloads.delete': ({ chapterIds }) => downloads.delete(chapterIds),
    'migration.findCandidates': ({ mangaId, targets, requestId }) =>
      requests.run(requestId, (signal) => migration.findCandidates(mangaId, targets, signal)),
    'migration.run': ({ items, options }) =>
      migration.run(items, options, (progress) => broadcast('migration.progress', progress)),
    'chapters.setBookmarked': ({ chapterIds, bookmarked }) => chapters.setBookmarked(chapterIds, bookmarked),
  };
}
