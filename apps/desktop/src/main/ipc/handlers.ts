import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { AppError } from '@manga-reader/shared/errors';
import { toChapterInfo } from '../db/repositories/chapters';
import { BrowserWindow, ClipboardItem, app, clipboard, dialog, shell } from 'electron';
import { pageFileName, toPng } from '../images/page-file';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { CategoriesRepository } from '../db/repositories/categories';
import type { HistoryRepository } from '../db/repositories/history';
import type { LibraryRepository } from '../db/repositories/library';
import type { MangaRepository } from '../db/repositories/manga';
import type { ExtensionInstaller } from '../extensions/installer';
import type { ExtensionLogs } from '../extensions/logs';
import type { RepoService } from '../extensions/repos';
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
import type { ImageService } from '../images/service';
import type { NetworkControl } from '../network/control';
import type { StatsService } from '../stats/service';
import type { TrackerManager } from '../trackers/manager';
import type { BackupService } from '../backup/service';
import type { AppLicense, AppSettings, PackageKind } from '@manga-reader/shared';
import type { ReadingService } from '../reading/service';
import { type IpcHandlers, broadcast } from './register';
import type { RequestRegistry } from './requests';

export interface IpcDeps {
  settings: SettingsRepository;
  extensions: ExtensionService;
  repos: RepoService;
  installer: ExtensionInstaller;
  extensionLogs: ExtensionLogs;
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
  imageCache: Pick<ImageCache, 'bytesOf'>;
  images: Pick<ImageService, 'preparePage' | 'pageSizes' | 'pageBytes' | 'clearCache'>;
  paths: { data: string; logs: string; crashes: string };
  updater: AppUpdater;
  /** How this copy was installed, "Copy debug info" and the third-party licenses (§10). */
  diagnostics: { packaging: PackageKind; debugInfo(): Promise<string>; licenses(): Promise<AppLicense[]> };
  /** What's new: the running version and whether its notes were seen (§6.6). */
  whatsNew: { get(): { version: string; seen: boolean }; markSeen(): void };
  stats: Pick<StatsService, 'overview' | 'clear'>;
  backups: BackupService;
  trackers: TrackerManager;
  networkControl: Pick<NetworkControl, 'info' | 'setProxyPassword' | 'test'>;
  /** Discord Rich Presence can be offered. */
  discord: boolean;
  /** Told when the reader is in use and when it closes (Discord presence). */
  readingActivity?: { heartbeat(chapterId: number): void; end(): void };
  /** After `settings.set`: tray, login item, cache size… follow. */
  settingsChanged: (patch: Partial<AppSettings>) => void;
}

/** Settings key (not an app setting): finished downloads before this time are off the Downloads page. */
const DOWNLOADS_CLEARED_KEY = 'downloads.clearedAt';

export function createIpcHandlers({
  settings,
  extensions,
  repos,
  installer,
  extensionLogs,
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
  images,
  paths,
  updater,
  diagnostics,
  whatsNew,
  discord,
  stats,
  backups,
  trackers,
  networkControl,
  readingActivity,
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
      packaging: diagnostics.packaging,
      discord,
    }),
    'app.whatsNew': () => whatsNew.get(),
    'app.whatsNewSeen': () => whatsNew.markSeen(),
    'app.getLocale': () => app.getLocale(),
    'app.isOnline': () => online.isOnline(),
    'app.tray': () => traySupport(),
    'app.openPath': async ({ which }) => {
      const folder = which === 'data' ? paths.data : which === 'crashes' ? paths.crashes : paths.logs;
      await mkdir(folder, { recursive: true });
      const error = await shell.openPath(folder);
      if (error) throw new AppError('unknown', error);
    },
    'app.copyDebugInfo': async () => {
      const text = await diagnostics.debugInfo();
      clipboard.writeText(text);
      return text;
    },
    'app.licenses': () => diagnostics.licenses(),
    'storage.info': () => ({
      pageCacheBytes: imageCache.bytesOf('page'),
      browseCoverBytes: imageCache.bytesOf('browse_cover'),
      downloadBytes: downloadsRepo.stats().totalBytes,
      dataPath: paths.data,
      logPath: paths.logs,
    }),
    'storage.clearCache': ({ kind }) => images.clearCache(kind),
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

    'repos.list': () => repos.list(),
    'repos.add': ({ url, confirmUnverified }) => repos.add(url, confirmUnverified),
    'repos.remove': ({ repoId }) => repos.remove(repoId),
    'repos.sync': (input) => repos.sync(input?.repoId),
    'repos.trustKey': ({ repoId }) => repos.trustKey(repoId),
    'extensions.available': () => installer.available(),
    'extensions.prepareInstall': ({ repoId, extensionId }) => installer.prepare(repoId, extensionId),
    'extensions.install': async ({ token }) => {
      const entry = await installer.install(token);
      // Preferences a restored backup kept for it (docs/BRAINSTORM.md §6.7).
      backups.applyPending(entry.id);
      return entry;
    },
    'extensions.cancelInstall': ({ token }) => installer.cancel(token),
    'extensions.updateAll': () => installer.updateAll(),
    'extensions.uninstall': ({ extensionId }) => installer.uninstall(extensionId),
    'extensions.logs': ({ extensionId }) => extensionLogs.list(extensionId),
    'extensions.clearLogs': ({ extensionId }) => extensionLogs.clear(extensionId),

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
    'reader.preparePage': ({ chapterId, index, crop }) => images.preparePage(chapterId, index, crop),
    'reader.pageSizes': ({ chapterId, crop }) => images.pageSizes(chapterId, crop),
    'reader.savePage': async ({ chapterId, index }, event) => {
      const chapter = chapters.get(chapterId);
      const row = chapter && manga.get(chapter.mangaId);
      if (!chapter || !row) throw new AppError('not_found', `Chapter ${chapterId} not found`);
      const { bytes, contentType } = await images.pageBytes(chapterId, index);
      const options: Electron.SaveDialogOptions = {
        defaultPath: join(app.getPath('downloads'), pageFileName(row.title, chapter.name, index, contentType)),
      };
      const window = windowOf(event);
      const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return null;
      await writeFile(picked.filePath, bytes);
      return picked.filePath;
    },
    'reader.copyPage': async ({ chapterId, index }) => {
      const { bytes } = await images.pageBytes(chapterId, index);
      const png = new Blob([new Uint8Array(await toPng(bytes))], { type: 'image/png' });
      await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    },

    'progress.save': (input) => reading.saveProgress(input),
    'chapters.markRead': ({ chapterIds, read }) => reading.markRead(chapterIds, read),
    'chapters.markPreviousRead': ({ chapterId }) => reading.markPreviousRead(chapterId),
    'manga.continue': ({ mangaId }) => reading.continueTarget(mangaId),
    'reading.heartbeat': ({ chapterId }) => {
      reading.heartbeat(chapterId);
      readingActivity?.heartbeat(chapterId);
    },
    'reading.end': () => {
      reading.endSession();
      readingActivity?.end();
    },
    'history.list': (input) => history.list(input ?? {}),
    'history.remove': ({ mangaId }) => history.remove(mangaId),
    'history.clear': () => history.clear(),
    'backup.create': async (_input, event) => {
      const folder = backups.folder();
      await mkdir(folder, { recursive: true });
      const options: Electron.SaveDialogOptions = {
        defaultPath: join(folder, backups.defaultName()),
        filters: [{ name: 'Matane backup', extensions: ['zip'] }],
      };
      const window = windowOf(event);
      const picked = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return null;
      await backups.create(picked.filePath);
      return picked.filePath;
    },
    'backup.list': () => backups.list(),
    'backup.pick': async (_input, event) => {
      const options: Electron.OpenDialogOptions = {
        properties: ['openFile'],
        defaultPath: backups.folder(),
        filters: [
          { name: 'Matane or Mihon backup', extensions: ['zip', 'tachibk', 'gz'] },
          { name: 'All files', extensions: ['*'] },
        ],
      };
      const window = windowOf(event);
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    'backup.preview': ({ path }) => backups.preview(path),
    'backup.restore': (input) =>
      backups.restore(input.path, { mode: input.mode, settings: input.settings, sourceMap: input.sourceMap }),
    'backup.chooseFolder': async (_input, event) => {
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: backups.folder(),
      };
      const window = windowOf(event);
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const folder = picked.canceled ? null : (picked.filePaths[0] ?? null);
      if (!folder) return null;
      const next = settings.updateAppSettings({ backup: { ...settings.getAppSettings().backup, folder } });
      broadcast('settings.changed', next);
      return folder;
    },
    'backup.openFolder': async () => {
      await mkdir(backups.folder(), { recursive: true });
      const error = await shell.openPath(backups.folder());
      if (error) throw new AppError('unknown', error);
    },
    'local.chooseFolder': async (_input, event) => {
      const current = settings.getAppSettings().local.folder;
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory'],
        ...(current ? { defaultPath: current } : {}),
      };
      const window = windowOf(event);
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      const folder = picked.canceled ? null : (picked.filePaths[0] ?? null);
      if (!folder) return null;
      broadcast('settings.changed', settings.updateAppSettings({ local: { folder } }));
      return folder;
    },
    'local.openFolder': async () => {
      const folder = settings.getAppSettings().local.folder;
      if (!folder) throw new AppError('not_found', 'No local folder is chosen');
      const error = await shell.openPath(folder);
      if (error) throw new AppError('unknown', error);
    },
    'trackers.list': () => trackers.list(),
    'trackers.connect': ({ service }) => trackers.connect(service),
    'trackers.cancelConnect': ({ service }) => trackers.cancelConnect(service),
    'trackers.setToken': ({ service, token }) => trackers.setToken(service, token),
    'trackers.disconnect': ({ service }) => trackers.disconnect(service),
    'trackers.search': ({ service, query }) => trackers.search(service, query),
    'trackers.tracks': ({ mangaId }) => trackers.tracks(existing(mangaId)),
    'trackers.link': (input) => trackers.link({ ...input, mangaId: existing(input.mangaId) }),
    'trackers.unlink': ({ mangaId, service }) => trackers.unlink(existing(mangaId), service),
    'trackers.update': ({ mangaId, service, patch }) => trackers.update(existing(mangaId), service, patch),
    'trackers.retry': () => trackers.retry(),
    'stats.overview': ({ range }) => stats.overview(range),
    'stats.clear': () => stats.clear(),
    'network.info': () => networkControl.info(),
    'network.setProxyPassword': ({ password }) => networkControl.setProxyPassword(password),
    'network.test': () => networkControl.test(),

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
