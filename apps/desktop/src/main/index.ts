import { mkdirSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { BrowserWindow, Notification, app, crashReporter, net, safeStorage, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { LEGACY_APP_NAME, moveLegacyUserData, rewriteDataPaths } from './app/legacy-data';
import { initLogging, log, setLogLevel } from './app/log';
import { debugInfo, logTail, readLicenses, scrub } from './app/debug-info';
import { HIDDEN_ARG, applyLoginItem } from './app/login-item';
import { OnlineMonitor } from './app/online';
import { APP_PERMISSIONS, denyPermissionsByDefault, restrictPermissions } from './app/permissions';
import { AppTray } from './app/tray';
import { AppUpdater, fetchGithubReleases } from './app/updater';
import { detectPackaging, updaterKindFor } from './app/packaging';
import { detectTraySupport } from './app/tray-support';
import { createMainWindow } from './app/window';
import icon from '../../resources/icon.png?asset';
import { DbChanges } from './db/changes';
import { openDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { ChaptersRepository } from './db/repositories/chapters';
import { ExtensionsRepository } from './db/repositories/extensions';
import { MangaRepository, coverColorOf, coverKeyOf, scanlatorPrefsOf } from './db/repositories/manga';
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
import { LocalFiles } from './local/files';
import { createLocalExtension } from './local/source';
import { LocalStore } from './local/store';
import { RepoService } from './extensions/repos';
import { URL_VERSIONS_KEY, UrlMigration } from './extensions/url-migration';
import { ReposRepository } from './db/repositories/repos';
import { createFetchBytes } from './network/fetch-bytes';
import { sessionFetch } from './network/electron-fetch';
import { TrackersRepository } from './db/repositories/trackers';
import { ANILIST_AUTHORIZE, createAniList } from './trackers/anilist';
import { ANILIST_LOOPBACK_PORT, anilistClientId, loopbackRedirect } from './trackers/client-ids';
import { TrackerManager } from './trackers/manager';
import { loopbackLogin } from './trackers/oauth';
import { SecretBox } from './trackers/secret';
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
import { PageMetaStore } from './images/page-meta';
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
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  LOCAL_SOURCE_ID,
  appSettingsSchema,
  contentLanguages,
  effectiveReaderSettings,
} from '@manga-reader/shared';
import { resolveDirection } from '@manga-reader/shared/chapters';
import { DiscordPresence, createDiscordClient, discordClientId } from './app/discord';
import { NetworkControl, PROXY_PASSWORD_KEY } from './network/control';
import { StatsService } from './stats/service';
import { BackupService } from './backup/service';
import { CoverColors } from './images/cover-color';

const DEV_FOLDERS_KEY = 'extensions.devFolders';
/** Settings key (not an app setting): the last version whose release notes were shown or skipped. */
const WHATS_NEW_KEY = 'app.whatsNewSeen';
const MB = 1024 * 1024;
/** Page sizes and crops kept (a few MB); the least recently read go first. */
const PAGE_META_MAX = 200_000;

// Before anything (logging, the single-instance lock, Chromium) creates the new data folder.
const legacyUserData = join(app.getPath('appData'), LEGACY_APP_NAME);
let legacyMove: boolean | Error = false;
try {
  legacyMove = moveLegacyUserData(legacyUserData, app.getPath('userData'));
} catch (error) {
  legacyMove = error instanceof Error ? error : new Error(String(error));
}

initLogging();
// Crash dumps stay on this computer (Settings → Advanced opens the folder); nothing is uploaded.
crashReporter.start({ uploadToServer: false });
registerMangaScheme();
// Before any session exists: pages of extension sessions (Cloudflare window) get no web permissions.
denyPermissionsByDefault(app);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void bootstrap();
}

/**
 * Built-in extensions: none ship, but the folder is still read (`resources/extensions` when
 * packaged, `extensions/` at the repo root in development) as a way back (ADR 0023).
 */
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
  // The app's own window may copy text; nothing else.
  restrictPermissions(session.defaultSession, APP_PERMISSIONS);

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
  setLogLevel(settings.getAppSettings().advanced.logLevel);
  // First-run setup and What's new (Phase 5c): a profile from before them counts as set up, and a
  // new profile has nothing new to read about. Tests skip the setup unless they test it.
  if (settings.getValue<unknown>('onboarding', null) === null) {
    if (!migration.fresh || process.env['MATANE_E2E_NO_ONBOARDING'] === '1') {
      settings.updateAppSettings({ onboarding: { done: true } });
    }
  }
  if (migration.fresh && settings.getValue<string | null>(WHATS_NEW_KEY, null) === null) {
    settings.setValue(WHATS_NEW_KEY, app.getVersion());
  }
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
  // Settings → Network (Phase 5d): DoH, proxy and User-Agent, before any request goes out.
  const networkControl = new NetworkControl({
    settings: () => settings.getAppSettings().network,
    network,
    defaultSession: session.defaultSession,
    store: {
      get: () => settings.getValue<string | null>(PROXY_PASSWORD_KEY, null),
      set: (value) => settings.setValue(PROXY_PASSWORD_KEY, value),
    },
    proxyLoopback: process.env['MATANE_E2E_PROXY_LOOPBACK'] === '1',
    log: (message) => log.info(message),
  });
  await networkControl.apply();
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
  // The local files source (ADR 0033) runs in main, not in the sandbox.
  const localFiles = new LocalFiles({ folder: () => settings.getAppSettings().local.folder });
  const localExtension = createLocalExtension(localFiles, app.getVersion());
  const localStore = new LocalStore({ files: localFiles, chapters: chaptersRepo, manga: mangaRepo });
  const registry = new ExtensionRegistry({
    builtinDir: builtinExtensionsDir(),
    installedDir: installedExtensionsDir,
    native: [localExtension.entry],
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
    native: [localExtension],
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
    downloads: { pages: async (chapterId) => (await localStore.pages(chapterId)) ?? downloadStore.pages(chapterId) },
    showNsfw: () => settings.getAppSettings().browse.showNsfw,
  });
  // Extension repositories and installs (docs/BRAINSTORM.md §5.8). `online` is declared further down.
  const fetchBytes = createFetchBytes((url, init) => net.fetch(url, init));
  const reposRepo = new ReposRepository(connection.db, changes);
  const repos = new RepoService({
    repo: reposRepo,
    fetchBytes,
    isOnline: () => online.isOnline(),
    intervalMs: () => settings.getAppSettings().browse.repoSyncHours * 3_600_000,
    onSynced: () => {
      if (settings.getAppSettings().browse.autoUpdateExtensions) autoUpdateExtensions();
    },
    log: (message) => extLog.warn(`repos: ${message}`),
  });
  // Updates install by themselves after a repository sync.
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
    Object.assign(globalThis, {
      __matane: {
        setOnline: (v: boolean | null) => online.override(v),
        setNetworkTestUrl: (url: string) => (networkControl.testUrl = url),
        logLevel: () => log.transports.file.level,
      },
    });
  const downloadsRepo = new DownloadsRepository(connection.db, changes);
  const downloadStore = new DownloadStore(downloadsRepo, new DownloadReader());
  const pageMeta = new PageMetaStore(connection.db);
  pageMeta.prune(PAGE_META_MAX);
  const coverColors = new CoverColors({ manga: mangaRepo, log: (message) => log.scope('images').warn(message) });
  const images = new ImageService({
    cache: imageCache,
    meta: pageMeta,
    coverColors,
    manga: mangaRepo,
    chapters: chaptersRepo,
    sources,
    covers,
    downloads: {
      page: async (chapterId, index) =>
        (await localStore.page(chapterId, index)) ?? downloadStore.page(chapterId, index),
    },
    local: { sourceId: LOCAL_SOURCE_ID, cover: (url) => localStore.cover(url) },
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
      page: (chapterId, index, view) => images.pageView(chapterId, index, view),
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
  // Trackers (ADR 0035): chapters read are sent to the trackers a manga is linked to.
  const e2e = process.env['MATANE_E2E'] !== undefined;
  const trackersLog = log.scope('trackers');
  const trackers = new TrackerManager({
    repo: new TrackersRepository(connection.db, changes),
    clients: {
      anilist: createAniList({
        fetch: sessionFetch(session.defaultSession),
        // Tests point it at a fake server.
        url: e2e ? process.env['MATANE_E2E_ANILIST_API'] : undefined,
      }),
    },
    secrets: new SecretBox(safeStorage),
    configured: () => anilistClientId() !== null,
    redirectUrl: () => loopbackRedirect(ANILIST_LOOPBACK_PORT),
    login: (_service, signal) =>
      loopbackLogin({
        port: e2e ? Number(process.env['MATANE_E2E_OAUTH_PORT'] ?? ANILIST_LOOPBACK_PORT) : ANILIST_LOOPBACK_PORT,
        authorizeUrl: (state) =>
          `${ANILIST_AUTHORIZE}?${new URLSearchParams({ client_id: anilistClientId() ?? '', response_type: 'token', state })}`,
        // Tests cannot open a browser: they read the address and play the browser's part.
        open: e2e
          ? (url) => void Object.assign((globalThis as { __matane?: object }).__matane ?? {}, { loginUrl: url })
          : (url) => shell.openExternal(url),
        onListening: (port) =>
          e2e && Object.assign((globalThis as { __matane?: object }).__matane ?? {}, { oauthPort: port }),
        signal,
      }),
    manga: mangaRepo,
    progress: progressRepo,
    incognito: () => settings.getAppSettings().incognito,
    isOnline: () => online.isOnline(),
    log: (message) => trackersLog.info(message),
  });
  progressRepo.onRead = (mangaId) => trackers.onChaptersRead(mangaId);
  online.onChange((isOnline) => {
    if (isOnline) void trackers.retry();
  });
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
      return resolveDirection(reader.direction, info.type, reader.typeDefaults) === 'rtl';
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

  // System integration (docs/BRAINSTORM.md §6.4): tray, start at login, offline.
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
  const packaging = detectPackaging({
    env: process.env,
    platform: process.platform,
    execPath: process.execPath,
    packaged: app.isPackaged,
  });
  const updaterKind = updaterKindFor(packaging, !!updateFeed);
  // Discord Rich Presence (Phase 5c): only when a Discord application id is set.
  const clientId = discordClientId();
  const presence = clientId
    ? new DiscordPresence({
        createClient: () => createDiscordClient(clientId),
        options: () => {
          const current = settings.getAppSettings();
          return { ...current.general.discord, incognito: current.incognito };
        },
        texts: () =>
          (settings.getAppSettings().language ?? app.getLocale()).startsWith('id')
            ? { reading: 'Membaca', readingManga: 'Sedang membaca manga' }
            : { reading: 'Reading', readingManga: 'Reading manga' },
        log: (message) => log.scope('discord').info(message),
      })
    : null;

  // Cover colours for library manga measured before Phase 5c, a few seconds after start and one
  // at a time (covers come from the permanent copies; offline, missing ones simply wait).
  setTimeout(() => {
    void (async () => {
      const ids = connection.sqlite.prepare('SELECT id FROM manga WHERE in_library = 1').pluck().all() as number[];
      for (const id of ids) {
        const row = mangaRepo.get(id);
        if (!row || coverColorOf(row) || !coverKeyOf(row)) continue;
        await images.cover(id).catch(() => undefined);
        await coverColors.idle();
      }
    })();
  }, 5000);

  const updaterLog = log.scope('updater');
  const appUpdater = new AppUpdater({
    kind: updaterKind,
    packaging,
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

  const settingsChanged = (patch: Partial<AppSettings>) => {
    if (patch.advanced) setLogLevel(settings.getAppSettings().advanced.logLevel);
    if (patch.general || patch.language) applySystem();
    if (patch.cacheSizeMb) void imageCache.setMaxBytes(patch.cacheSizeMb * MB);
    if (patch.general || patch.incognito !== undefined) void presence?.sync();
    if (patch.network) void networkControl.apply();
    refreshTray();
  };

  // Backup and restore (Phase 5e).
  const backups = new BackupService({
    sqlite: connection.sqlite,
    appVersion: app.getVersion(),
    settingKeys: Object.keys(DEFAULT_SETTINGS),
    settings: () => settings.getAppSettings().backup,
    defaultFolder: join(userData, 'backups'),
    customCoversDir: join(userData, 'covers', 'custom'),
    isInstalled: (extensionId) => extensions.isInstalled(extensionId),
    offered: () =>
      installer
        .available()
        .filter((e) => e.installedVersion === null)
        .map((e) => ({ repoId: e.repoId, id: e.id, name: e.name, langs: e.langs })),
    store: {
      get: (key, fallback) => settings.getValue(key, fallback),
      set: (key, value) => settings.setValue(key, value),
    },
    applySettings: (restored) => {
      const current = settings.getAppSettings();
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(restored)) {
        // The first-run state stays; the rest only when it is a valid setting.
        if (key === 'onboarding' || !(key in appSettingsSchema.shape)) continue;
        const parsed = appSettingsSchema.shape[key as keyof AppSettings].safeParse(value);
        if (parsed.success) patch[key] = parsed.data;
      }
      // Folders belong to this machine.
      if (patch['downloads'])
        patch['downloads'] = { ...(patch['downloads'] as AppSettings['downloads']), folder: current.downloads.folder };
      if (patch['backup'])
        patch['backup'] = { ...(patch['backup'] as AppSettings['backup']), folder: current.backup.folder };
      const next = settings.updateAppSettings(patch as Partial<AppSettings>);
      broadcast('settings.changed', next);
      settingsChanged(patch as Partial<AppSettings>);
    },
    restored: () => {
      changes.mark('library', 'categories', 'history', 'downloads', 'repos', 'sources', 'extensions');
      void repos.sync().catch(() => undefined);
    },
    onProgress: (progress) => broadcast('backup.progress', progress),
    log: (message) => log.scope('backup').info(message),
  });
  backups.applyAllPending();
  backups.start();

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
      images,
      paths: {
        data: userData,
        logs: dirname(log.transports.file.getFile().path),
        crashes: app.getPath('crashDumps'),
      },
      updater: appUpdater,
      diagnostics: {
        packaging,
        debugInfo: async () =>
          debugInfo(
            {
              version: app.getVersion(),
              electron: process.versions.electron,
              chrome: process.versions.chrome,
              node: process.versions.node,
              os: `${os.type()} ${os.release()}`,
              arch: process.arch,
              locale: app.getLocale(),
              packaging,
              extensions: extensions.list().map((e) => ({
                id: e.id,
                version: e.version,
                origin: e.origin,
                error: e.error,
              })),
              log: await logTail(log.transports.file.getFile().path),
            },
            (text) => scrub(text, os.homedir(), os.userInfo().username),
          ),
        licenses: () => readLicenses(join(app.getAppPath(), 'out', 'licenses.json')),
      },
      whatsNew: {
        get: () => ({
          version: app.getVersion(),
          seen: settings.getValue<string | null>(WHATS_NEW_KEY, null) === app.getVersion(),
        }),
        markSeen: () => settings.setValue(WHATS_NEW_KEY, app.getVersion()),
      },
      discord: presence !== null,
      stats: new StatsService(connection.sqlite),
      networkControl,
      readingActivity: presence
        ? {
            heartbeat: (chapterId) => {
              const chapter = chaptersRepo.get(chapterId);
              const row = chapter && mangaRepo.get(chapter.mangaId);
              if (!chapter || !row) return;
              const nsfw = extensions.get(extensionsRepo.getSource(row.sourceId)?.extensionId ?? '')?.manifest?.nsfw;
              void presence?.reading({ title: row.title, chapter: chapter.name, nsfw: nsfw !== false });
            },
            end: () => void presence?.stopped(),
          }
        : undefined,
      backups,
      trackers,
      settingsChanged,
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
  trackers.start();
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
    trackers.stop();
    tray.disable();
    updates.stop();
    repos.stop();
    downloads.shutdown();
    void downloadStore.reader.closeAll();
    sessions.end();
    backups.stop();
    void presence?.dispose();
    registry.close();
    host.dispose();
    connection.sqlite.close();
  });
}
