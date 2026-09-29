import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BrowserWindow, Notification, app, net } from 'electron';
import { autoUpdater } from 'electron-updater';
import { LEGACY_APP_NAME, moveLegacyUserData, rewriteDataPaths } from './app/legacy-data';
import { initLogging, log } from './app/log';
import { HIDDEN_ARG, applyLoginItem } from './app/login-item';
import { OnlineMonitor } from './app/online';
import { AppTray } from './app/tray';
import { AppUpdater, fetchGithubReleases } from './app/updater';
import { detectTraySupport } from './app/tray-support';
import { createMainWindow } from './app/window';
import icon from '../../resources/icon.png?asset';
import { DbChanges } from './db/changes';
import { openDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { ChaptersRepository } from './db/repositories/chapters';
import { ExtensionsRepository } from './db/repositories/extensions';
import { MangaRepository, scanlatorPrefsOf } from './db/repositories/manga';
import { NO_SCANLATOR_PREFS } from '@manga-reader/shared/chapters';
import { CategoriesRepository } from './db/repositories/categories';
import { HistoryRepository } from './db/repositories/history';
import { LibraryRepository } from './db/repositories/library';
import { ProgressRepository } from './db/repositories/progress';
import { SettingsRepository } from './db/repositories/settings';
import { ExtensionHostClient } from './extensions/host-client';
import { ExtensionIcons } from './extensions/icons';
import { ExtensionInstaller } from './extensions/installer';
import { initialContentLanguages } from './extensions/content';
import { ExtensionLogs } from './extensions/logs';
import { officialKeys } from './extensions/official';
import { RepoService } from './extensions/repos';
import { URL_VERSIONS_KEY, UrlMigration } from './extensions/url-migration';
import { ReposRepository } from './db/repositories/repos';
import { createFetchBytes } from './network/fetch-bytes';
import { ExtensionRegistry } from './extensions/registry';
import { ExtensionService } from './extensions/service';
import { SourceService } from './extensions/sources';
import { createIpcHandlers } from './ipc/handlers';
import { broadcast, registerIpcHandlers } from './ipc/register';
import { RequestRegistry } from './ipc/requests';
import { ImageCache } from './images/cache';
import { CoverStore } from './images/covers';
import { handleMangaProtocol, registerMangaScheme } from './images/protocol';
import { ImageService } from './images/service';
import { MigrationService } from './library/migration';
import { LibraryService } from './library/service';
import { UpdateService } from './library/updates';
import { UpdatesRepository } from './db/repositories/updates';
import { CloudflareSolver } from './network/cloudflare';
import { ReadingService } from './reading/service';
import { SessionRecorder } from './reading/sessions';
import { NetworkManager } from './network/manager';
import { DownloadReader } from './downloads/archive';
import { DownloadAutomation } from './downloads/automation';
import { DownloadManager } from './downloads/manager';
import { DownloadStore } from './downloads/store';
import { DownloadsRepository } from './db/repositories/downloads';
import { contentLanguages, effectiveReaderSettings } from '@manga-reader/shared';
import { resolveDirection } from '@manga-reader/shared/chapters';

const DEV_FOLDERS_KEY = 'extensions.devFolders';
const MB = 1024 * 1024;

// Before anything (logging, the single-instance lock, Chromium) creates the new data folder.
const legacyUserData = join(app.getPath('appData'), LEGACY_APP_NAME);
let legacyMove: boolean | Error = false;
try {
  legacyMove = moveLegacyUserData(legacyUserData, app.getPath('userData'));
} catch (error) {
  legacyMove = error instanceof Error ? error : new Error(String(error));
}

initLogging();
registerMangaScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void bootstrap();
}

/** Built-in extensions: the repo's `extensions/*` in dev, `resources/extensions` when packaged. */
function builtinExtensionsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'extensions') : join(app.getAppPath(), '../../extensions');
}

/** Set once the tray exists; before that there is nothing to refresh. */
let appTray: AppTray | null = null;
let trayTimer: ReturnType<typeof setTimeout> | undefined;

/** Rebuilds the tray menu (status lines) at most once a second. */
function refreshTray(): void {
  if (!appTray?.enabled || trayTimer) return;
  trayTimer = setTimeout(() => {
    trayTimer = undefined;
    appTray?.refresh();
  }, 1000);
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const userData = app.getPath('userData');
  mkdirSync(userData, { recursive: true });
  if (legacyMove instanceof Error) log.error(`Could not move ${legacyUserData} to ${userData}`, legacyMove);
  const connection = openDatabase(join(userData, 'data.db'));
  if (legacyMove === true) {
    const paths = rewriteDataPaths(connection.sqlite, legacyUserData, userData);
    log.info(`Moved the data folder from ${legacyUserData} to ${userData}`, { paths });
  }
  const migration = await runMigrations(connection, {
    // `drizzle/` sits next to package.json both in dev and inside the packaged app.
    migrationsFolder: join(app.getAppPath(), 'drizzle'),
    backupDir: join(userData, 'backups', 'db'),
  });
  if (migration.applied > 0) log.info('Applied database migrations', migration);

  const changes = new DbChanges((tags) => {
    broadcast('db.changed', { tags });
    if (tags.includes('downloads')) refreshTray();
  });
  const settings = new SettingsRepository(connection.db);
  // Content languages arrived in 4c: keep the sources an existing profile already uses visible
  // (a fresh profile keeps the default, which follows the UI language).
  if (settings.getValue<unknown>('browse', null) === null) {
    const uiLanguage = settings.getAppSettings().language ?? app.getLocale();
    const languages = initialContentLanguages(connection.sqlite, uiLanguage);
    const browse = settings.getAppSettings().browse;
    const byDefault = contentLanguages(browse, uiLanguage);
    if (languages.some((l) => !byDefault.includes(l))) settings.updateAppSettings({ browse: { ...browse, languages } });
  }
  const extensionsRepo = new ExtensionsRepository(connection.db, changes);
  const mangaRepo = new MangaRepository(connection.db, changes);
  const chaptersRepo = new ChaptersRepository(connection.db, changes);

  const network = new NetworkManager(new CloudflareSolver((status) => broadcast('cloudflare.status', status)));
  const extLog = log.scope('ext');
  const extensionLogs = new ExtensionLogs((extensionId, entry) => broadcast('extensions.log', { extensionId, entry }));

  // The service answers the host's requests and the host client carries the service's calls;
  // the closures below bind to consts declared further down.
  const host: ExtensionHostClient = new ExtensionHostClient({
    entry: join(__dirname, 'extension-host.js'),
    handlers: {
      getExtension: (params) => extensions.mainHandlers.getExtension(params),
      http: (params) => extensions.mainHandlers.http(params),
      storage: (params) => extensions.mainHandlers.storage(params),
      log: (params) => extensions.mainHandlers.log(params),
    },
    env: { MR_APP_NAME: app.getName(), MR_APP_VERSION: app.getVersion() },
    log: (level, message) => extLog[level](message),
  });
  const installedExtensionsDir = join(userData, 'extensions');
  const registry = new ExtensionRegistry({
    builtinDir: builtinExtensionsDir(),
    installedDir: installedExtensionsDir,
    devFolders: () => settings.getValue<string[]>(DEV_FOLDERS_KEY, []),
    onDevChange: (extensionId) => {
      extLog.info(`Dev extension ${extensionId} changed on disk, reloading`);
      void extensions.reload(extensionId).catch((error: unknown) => extLog.error('Reload failed', error));
    },
  });
  const extensions: ExtensionService = new ExtensionService({
    registry,
    repo: extensionsRepo,
    host,
    network,
    devFolders: {
      get: () => settings.getValue<string[]>(DEV_FOLDERS_KEY, []),
      set: (folders) => settings.setValue(DEV_FOLDERS_KEY, folders),
    },
    log: (extensionId, level, message) => extLog[level](`[${extensionId}] ${message}`),
    record: (extensionId, level, kind, message) => extensionLogs.append(extensionId, level, kind, message),
    onReload: (ids) => {
      for (const id of ids) sources.clearCache(id);
      // An update may change how urls look (migrateUrl).
      void urlMigration.run();
    },
  });
  const sources: SourceService = new SourceService({
    extensions,
    extensionsRepo,
    manga: mangaRepo,
    chapters: chaptersRepo,
    // Declared further down; only used once requests arrive.
    downloads: { pages: (chapterId) => downloadStore.pages(chapterId) },
    showNsfw: () => settings.getAppSettings().browse.showNsfw,
  });
  // Extension repositories and installs (BRAINSTORM.md §5.8). `online` is declared further down.
  const fetchBytes = createFetchBytes((url, init) => net.fetch(url, init));
  const reposRepo = new ReposRepository(connection.db, changes);
  const repos = new RepoService({
    repo: reposRepo,
    fetchBytes,
    officialKeys: () => officialKeys(),
    isOnline: () => online.isOnline(),
    intervalMs: () => settings.getAppSettings().browse.repoSyncHours * 3_600_000,
    onSynced: () => {
      if (settings.getAppSettings().browse.autoUpdateExtensions) autoUpdateExtensions();
    },
    log: (message) => extLog.warn(`repos: ${message}`),
  });
  // Updates that reach no new site install by themselves (the others wait for the user).
  let autoUpdating: Promise<void> | null = null;
  const autoUpdateExtensions = () => {
    autoUpdating ??= installer
      .updateAll()
      .then((result) => {
        if (result.updated.length > 0) extLog.info('Updated extensions by themselves', result.updated);
        for (const failed of result.failed) extLog.warn(`Automatic update of ${failed.id} failed: ${failed.message}`);
      })
      .catch((error: unknown) => extLog.error('Automatic extension updates failed', error))
      .finally(() => (autoUpdating = null));
  };
  const installer = new ExtensionInstaller({
    dir: installedExtensionsDir,
    repos,
    fetchBytes,
    extensions,
    origin: { get: (id) => reposRepo.installedFrom(id), set: (id, repoId) => reposRepo.setInstalledFrom(id, repoId) },
    forget: (id) => extensionsRepo.remove(id),
    clearSession: async (id) => {
      const ses = network.sessionFor(id);
      await ses.clearStorageData();
      await ses.clearCache();
    },
    log: (message) => extLog.info(message),
  });
  const extensionIcons = new ExtensionIcons({
    installedIcon: (id) => extensions.get(id)?.iconPath ?? null,
    repos,
    fetchBytes,
  });
  await installer.recover();
  const installed = await extensions.init();
  const urlMigration = new UrlMigration({
    sqlite: connection.sqlite,
    store: {
      get: () => settings.getValue<Record<string, string>>(URL_VERSIONS_KEY, {}),
      set: (value) => settings.setValue(URL_VERSIONS_KEY, value),
    },
    installed: () =>
      extensions
        .list()
        .filter((e) => e.error === null)
        .map((e) => ({ id: e.id, version: e.version, sourceKeys: e.sourceIds.map((id) => id.split('/')[1]!) })),
    supports: async (sourceId) =>
      (await sources.info(sourceId).catch(() => ({ capabilities: [] as string[] }))).capabilities.includes(
        'migrateUrl',
      ),
    migrate: (extensionId, sourceKey, items, fromVersion) =>
      extensions.migrateUrls(extensionId, sourceKey, items, fromVersion),
    record: (extensionId, level, message) => {
      extLog[level](`[${extensionId}] ${message}`);
      extensionLogs.append(extensionId, level, 'call', message);
    },
    changed: () => changes.mark('library', 'history', 'updates', 'downloads'),
  });
  void urlMigration.run().then((results) => {
    if (results.length > 0) extLog.info('Migrated extension urls', results);
  });
  extLog.info(
    'Extensions',
    installed.map((e) => `${e.id}@${e.version} (${e.origin}${e.error ? `, error: ${e.error}` : ''})`),
  );

  const covers = new CoverStore(join(userData, 'covers'), mangaRepo);
  const imageCache = new ImageCache(
    connection.db,
    join(userData, 'cache', 'images'),
    settings.getAppSettings().cacheSizeMb * MB,
  );
  // Tests force a network state (MATANE_E2E_OFFLINE) and flip it through `globalThis.__matane`.
  const online = new OnlineMonitor(() => net.isOnline());
  if (process.env['MATANE_E2E_OFFLINE'] === '1') online.override(false);
  if (process.env['MATANE_E2E'])
    Object.assign(globalThis, { __matane: { setOnline: (v: boolean | null) => online.override(v) } });
  const downloadsRepo = new DownloadsRepository(connection.db, changes);
  const downloadStore = new DownloadStore(downloadsRepo, new DownloadReader());
  const images = new ImageService({
    cache: imageCache,
    manga: mangaRepo,
    chapters: chaptersRepo,
    sources,
    covers,
    downloads: downloadStore,
    log: (message) => log.scope('images').warn(message),
    fetcher: {
      fetchImage: (extensionId, url, headers) => {
        const manifest = extensions.get(extensionId)?.manifest;
        if (!manifest) return Promise.reject(new Error(`Extension ${extensionId} is not loaded`));
        return network.fetchImage(manifest, url, headers);
      },
    },
  });
  const imageLog = log.scope('images');
  handleMangaProtocol(
    {
      cover: (mangaId) => images.cover(mangaId),
      page: (chapterId, index) => images.page(chapterId, index),
      extensionIcon: (id) => extensionIcons.installed(id),
      repoIcon: (repoId, id) => extensionIcons.repo(repoId, id),
    },
    (message) => imageLog.warn(message),
  );

  const downloadFolder = () => settings.getAppSettings().downloads.folder ?? join(app.getPath('documents'), 'Matane');
  const scanlatorPrefs = (mangaId: number) => {
    const row = mangaRepo.get(mangaId);
    return row ? scanlatorPrefsOf(row) : NO_SCANLATOR_PREFS;
  };
  const historyRepo = new HistoryRepository(connection.db, changes);
  const progressRepo = new ProgressRepository(connection.db, changes);
  const libraryRepo = new LibraryRepository(connection.db, changes);
  const downloads = new DownloadManager({
    repo: downloadsRepo,
    store: downloadStore,
    manga: mangaRepo,
    chapters: chaptersRepo,
    source: (sourceId) => extensionsRepo.getSource(sourceId),
    pages: async (chapterId) => (await sources.pages(chapterId)).pages,
    pageBytes: (chapterId, index) => images.pageBytes(chapterId, index),
    settings: () => {
      const current = settings.getAppSettings().downloads;
      return {
        folder: downloadFolder(),
        format: current.format,
        parallel: current.parallel,
        limitBytes: current.limitGb === null ? null : current.limitGb * 1024 ** 3,
      };
    },
    rightToLeft: (mangaId) => {
      const info = mangaRepo.info(mangaId);
      if (!info) return false;
      const reader = effectiveReaderSettings(settings.getAppSettings().reader, info.readerSettings);
      return resolveDirection(reader.direction, info.type) === 'rtl';
    },
    webUrl: (mangaId) => sources.webUrl(mangaId),
    onProgress: (progress) => {
      broadcast('downloads.progress', progress);
      refreshTray();
    },
    log: (message) => log.scope('downloads').warn(message),
  });
  const downloadAutomation = new DownloadAutomation({
    settings: () => settings.getAppSettings().downloads,
    manga: mangaRepo,
    chapters: chaptersRepo,
    downloads: downloadsRepo,
    manager: downloads,
    scanlatorPrefs,
    log: (message) => log.scope('downloads').warn(message),
  });
  const library = new LibraryService({
    library: libraryRepo,
    manga: mangaRepo,
    chapters: chaptersRepo,
    progress: progressRepo,
    sources,
    images,
    covers,
    log: (message) => log.scope('library').warn(message),
  });
  const sourceMigration = new MigrationService({
    manga: mangaRepo,
    chapters: chaptersRepo,
    progress: progressRepo,
    history: historyRepo,
    library: libraryRepo,
    libraryService: library,
    sources,
    covers,
    images,
    transaction: (work) => connection.sqlite.transaction(work)(),
    log: (message) => log.scope('migration').warn(message),
  });
  const categoriesRepo = new CategoriesRepository(connection.db, changes);
  const updates = new UpdateService({
    repo: new UpdatesRepository(connection.db),
    settings: () => settings.getAppSettings().updates,
    store: {
      get: (key, fallback) => settings.getValue(key, fallback),
      set: (key, value) => settings.setValue(key, value),
    },
    refresh: (mangaId, signal, metadata) => sources.refreshManga(mangaId, signal, { metadata }),
    chapters: (mangaId) => chaptersRepo.list(mangaId),
    hiddenScanlators: (mangaId) => scanlatorPrefs(mangaId).hidden,
    categories: () => categoriesRepo.settings(),
    enqueueAuto: (chapterIds) => downloads.enqueueAuto(chapterIds),
    notify: ({ title, body }) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body });
      notification.on('click', () => {
        showWindow();
        broadcast('app.navigate', { to: '/updates' });
      });
      notification.show();
    },
    language: () => settings.getAppSettings().language ?? app.getLocale(),
    isOnline: () => online.isOnline(),
    focused: () => BrowserWindow.getFocusedWindow() !== null,
    onProgress: (progress) => {
      broadcast('updates.progress', progress);
      refreshTray();
    },
    changed: () => changes.mark('updates'),
    log: (message) => log.scope('updates').warn(message),
  });
  const sessions = new SessionRecorder(connection.db);
  const reading = new ReadingService({
    progress: progressRepo,
    history: historyRepo,
    sessions,
    chapters: chaptersRepo,
    scanlatorPrefs,
    incognito: () => settings.getAppSettings().incognito,
    onProgress: (event) => downloadAutomation.onProgress(event),
  });

  // System integration (BRAINSTORM.md §6.4): tray, start at login, offline.
  const language = () => settings.getAppSettings().language ?? app.getLocale();
  const traySupport = await detectTraySupport();
  let quitting = false;
  const tray = new AppTray({
    iconPath: icon,
    language,
    status: () => ({ downloads: downloadsRepo.stats(), update: updates.status().progress, online: online.isOnline() }),
    open: () => showWindow(),
    checkUpdates: () => updates.check({ kind: 'all' }),
    pauseDownloads: () => downloads.pause(),
    resumeDownloads: () => downloads.resume(),
    quit: () => app.quit(),
  });
  appTray = tray;
  const applySystem = () => {
    const { general } = settings.getAppSettings();
    if (general.closeToTray && traySupport.available) tray.enable();
    else tray.disable();
    tray.refresh();
    void applyLoginItem(
      {
        platform: process.platform,
        command: {
          executable: process.env['APPIMAGE'] ?? process.execPath,
          args: app.isPackaged ? [] : [app.getAppPath()],
        },
        setLoginItemSettings: (value) => app.setLoginItemSettings(value),
      },
      general,
    ).catch((error: unknown) => log.warn('Could not update the login item', error));
  };
  online.onChange((isOnline) => {
    log.info(isOnline ? 'Back online' : 'Offline');
    broadcast('app.online', isOnline);
    void downloads.setOnline(isOnline);
    // A check that came due while offline runs now.
    if (isOnline) updates.tick();
    refreshTray();
  });

  // App updates (ADR 0021). MATANE_UPDATE_FEED points at a local generic feed for testing.
  const updateFeed = process.env['MATANE_UPDATE_FEED'];
  const updaterKind =
    !app.isPackaged && !updateFeed
      ? 'none'
      : process.platform === 'linux'
        ? process.env['APPIMAGE']
          ? 'auto'
          : 'notify'
        : process.platform === 'win32' && !process.env['PORTABLE_EXECUTABLE_DIR']
          ? 'auto'
          : 'notify';
  const updaterLog = log.scope('updater');
  const appUpdater = new AppUpdater({
    kind: updaterKind,
    version: app.getVersion(),
    settings: () => settings.getAppSettings().updater,
    autoUpdater: () => {
      autoUpdater.logger = updaterLog;
      if (updateFeed) autoUpdater.setFeedURL({ provider: 'generic', url: updateFeed });
      return autoUpdater;
    },
    fetchReleases: () =>
      fetchGithubReleases(async (url) => {
        const response = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
        if (!response.ok) throw new Error(`GitHub releases: HTTP ${response.status}`);
        return response.json();
      }),
    isOnline: () => online.isOnline(),
    notify: ({ title, body }) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title, body });
      notification.on('click', () => {
        showWindow();
        broadcast('app.navigate', { to: '/settings/about' });
      });
      notification.show();
    },
    language,
    onStatus: (status) => broadcast('updater.changed', status),
    log: (message) => updaterLog.warn(message),
  });

  registerIpcHandlers(
    createIpcHandlers({
      settings,
      extensions,
      repos,
      installer,
      extensionLogs,
      sources,
      chapters: chaptersRepo,
      network,
      requests: new RequestRegistry(),
      reading,
      history: historyRepo,
      library,
      libraryRepo,
      categories: categoriesRepo,
      updates,
      manga: mangaRepo,
      migration: sourceMigration,
      downloads,
      downloadsRepo,
      downloadFolder,
      online,
      traySupport: () => traySupport,
      imageCache,
      paths: { data: userData, logs: dirname(log.transports.file.getFile().path) },
      updater: appUpdater,
      settingsChanged: (patch) => {
        if (patch.general || patch.language) applySystem();
        if (patch.cacheSizeMb) void imageCache.setMaxBytes(patch.cacheSizeMb * MB);
        refreshTray();
      },
    }),
  );

  applySystem();
  const { general } = settings.getAppSettings();
  // Started at login with "start hidden": stay in the tray, if there is one.
  const startHidden =
    process.argv.includes(HIDDEN_ARG) && general.startHidden && general.closeToTray && traySupport.available;
  const windowOptions = { hideOnClose: () => !quitting && tray.enabled };
  let mainWindow = createMainWindow(settings, { ...windowOptions, hidden: startHidden });
  function showWindow(): void {
    if (mainWindow.isDestroyed()) mainWindow = createMainWindow(settings, windowOptions);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  if (!online.isOnline()) void downloads.setOnline(false);
  downloads.start(settings.getAppSettings().downloads.resumeOnStart);
  updates.start();
  repos.start();
  online.start();
  appUpdater.start();

  app.on('second-instance', () => showWindow());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(settings, windowOptions);
    else showWindow();
  });
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', () => {
    appUpdater.stop();
    online.stop();
    tray.disable();
    updates.stop();
    repos.stop();
    downloads.shutdown();
    void downloadStore.reader.closeAll();
    sessions.end();
    registry.close();
    host.dispose();
    connection.sqlite.close();
  });
}
