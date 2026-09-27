import { mkdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
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
import type { UpdateService } from '../library/updates';
import type { OnlineMonitor } from '../app/online';
import type { AppUpdater } from '../app/updater';
import type { TraySupport } from '../app/tray-support';
import type { ImageCache } from '../images/cache';
import type { AppSettings } from '@manga-reader/shared';
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
  /** The download folder in effect. */
  downloadFolder: () => string;
  updates: UpdateService;
  online: Pick<OnlineMonitor, 'isOnline'>;
  traySupport: () => TraySupport;
  imageCache: Pick<ImageCache, 'bytesOf' | 'clear'>;
  paths: { data: string; logs: string };
  updater: AppUpdater;
  /** After `settings.set`: tray, login item, cache size… follow. */
  settingsChanged: (patch: Partial<AppSettings>) => void;
}

/** Settings key (not an app setting): finished downloads before this time are off the Downloads page. */
const DOWNLOADS_CLEARED_KEY = 'downloads.clearedAt';

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
  downloadFolder,
  updates,
  online,
  traySupport,
  imageCache,
  paths,
  updater,
  settingsChanged,
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
    'app.isOnline': () => online.isOnline(),
    'app.tray': () => traySupport(),
    'app.openPath': async ({ which }) => {
      const error = await shell.openPath(which === 'data' ? paths.data : paths.logs);
      if (error) throw new AppError('unknown', error);
    },
    'storage.info': () => ({
      pageCacheBytes: imageCache.bytesOf('page'),
      browseCoverBytes: imageCache.bytesOf('browse_cover'),
      downloadBytes: downloadsRepo.stats().totalBytes,
      dataPath: paths.data,
      logPath: paths.logs,
    }),
    'storage.clearCache': ({ kind }) => imageCache.clear(kind),
    'updater.status': () => updater.getStatus(),
    'updater.check': () => updater.check(),
    'updater.download': () => updater.download(),
    'updater.install': () => updater.install(),
    'updater.openRelease': () => shell.openExternal(updater.getStatus().releaseUrl),

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
      if (patch.downloads) downloads.settingsChanged();
      settingsChanged(patch);
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
    'downloads.list': (input) =>
      downloadsRepo.list({
        mangaId: input?.mangaId,
        completedAfter: input?.listed ? settings.getValue<number>(DOWNLOADS_CLEARED_KEY, 0) : undefined,
      }),
    'downloads.stats': () => downloadsRepo.stats(),
    'downloads.pause': (input) => downloads.pause(input?.ids),
    'downloads.resume': (input) => downloads.resume(input?.ids),
    'downloads.cancel': ({ ids }) => downloads.cancel(ids),
    'downloads.retry': ({ ids }) => downloads.retry(ids),
    'downloads.reorder': ({ ids }) => downloads.reorder(ids),
    'downloads.delete': ({ chapterIds }) => downloads.delete(chapterIds),
    'downloads.clearCompleted': () => {
      settings.setValue(DOWNLOADS_CLEARED_KEY, Date.now());
      downloadsRepo.touch();
    },
    'downloads.folder': () => downloadFolder(),
    'downloads.pickFolder': async (_input, event) => {
      const window = windowOf(event);
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: downloadFolder(),
      };
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    'downloads.setFolder': async ({ folder, move }) => {
      if (!isAbsolute(folder)) throw new AppError('unknown', 'The download folder must be an absolute path');
      const target = resolve(folder);
      const commit = () => {
        const next = settings.updateAppSettings({
          downloads: { ...settings.getAppSettings().downloads, folder: target },
        });
        broadcast('settings.changed', next);
      };
      if (move && target !== resolve(downloadFolder())) {
        await downloads.moveTo(target, (progress) => broadcast('downloads.moveProgress', progress), commit);
      } else {
        commit();
        downloads.settingsChanged();
      }
    },
    'downloads.openFolder': async (input) => {
      const path = input?.chapterId === undefined ? null : downloadsRepo.byChapter(input.chapterId)?.path;
      if (path) {
        shell.showItemInFolder(path);
        return;
      }
      const folder = downloadFolder();
      await mkdir(folder, { recursive: true });
      const error = await shell.openPath(folder);
      if (error) throw new AppError('unknown', error);
    },
    'updates.check': ({ scope }) => updates.check(scope),
    'updates.cancel': () => updates.cancel(),
    'updates.list': (input) => updates.list(input?.categoryId),
    'updates.status': () => updates.status(),
    'updates.markSeen': () => updates.markSeen(),
    'categories.setAutoDownload': ({ id, value }) => categories.setAutoDownload(id, value),
    'migration.findCandidates': ({ mangaId, targets, requestId }) =>
      requests.run(requestId, (signal) => migration.findCandidates(mangaId, targets, signal)),
    'migration.run': ({ items, options }) =>
      migration.run(items, options, (progress) => broadcast('migration.progress', progress)),
    'chapters.setBookmarked': ({ chapterIds, bookmarked }) => chapters.setBookmarked(chapterIds, bookmarked),
  };
}
