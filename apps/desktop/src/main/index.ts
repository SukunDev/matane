import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import { LEGACY_APP_NAME, moveLegacyUserData, rewriteDataPaths } from './app/legacy-data';
import { initLogging, log } from './app/log';
import { createMainWindow } from './app/window';
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
import { CloudflareSolver } from './network/cloudflare';
import { ReadingService } from './reading/service';
import { SessionRecorder } from './reading/sessions';
import { NetworkManager } from './network/manager';

const DEV_FOLDERS_KEY = 'extensions.devFolders';
/** BRAINSTORM.md §6.5; becomes a setting with the Data & storage section. */
const IMAGE_CACHE_BYTES = 1024 * 1024 * 1024;

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

  const changes = new DbChanges((tags) => broadcast('db.changed', { tags }));
  const settings = new SettingsRepository(connection.db);
  const extensionsRepo = new ExtensionsRepository(connection.db, changes);
  const mangaRepo = new MangaRepository(connection.db, changes);
  const chaptersRepo = new ChaptersRepository(connection.db, changes);

  const network = new NetworkManager(new CloudflareSolver((status) => broadcast('cloudflare.status', status)));
  const extLog = log.scope('ext');

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
  const registry = new ExtensionRegistry({
    builtinDir: builtinExtensionsDir(),
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
    onReload: (ids) => {
      for (const id of ids) sources.clearCache(id);
    },
  });
  const sources: SourceService = new SourceService({
    extensions,
    extensionsRepo,
    manga: mangaRepo,
    chapters: chaptersRepo,
  });
  const installed = await extensions.init();
  extLog.info(
    'Extensions',
    installed.map((e) => `${e.id}@${e.version} (${e.origin}${e.error ? `, error: ${e.error}` : ''})`),
  );

  const covers = new CoverStore(join(userData, 'covers'), mangaRepo);
  const images = new ImageService({
    cache: new ImageCache(connection.db, join(userData, 'cache', 'images'), IMAGE_CACHE_BYTES),
    manga: mangaRepo,
    chapters: chaptersRepo,
    sources,
    covers,
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
    { cover: (mangaId) => images.cover(mangaId), page: (chapterId, index) => images.page(chapterId, index) },
    (message) => imageLog.warn(message),
  );

  const historyRepo = new HistoryRepository(connection.db, changes);
  const progressRepo = new ProgressRepository(connection.db, changes);
  const libraryRepo = new LibraryRepository(connection.db, changes);
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
  const sessions = new SessionRecorder(connection.db);
  const reading = new ReadingService({
    progress: progressRepo,
    history: historyRepo,
    sessions,
    chapters: chaptersRepo,
    scanlatorPrefs: (mangaId) => {
      const row = mangaRepo.get(mangaId);
      return row ? scanlatorPrefsOf(row) : NO_SCANLATOR_PREFS;
    },
    incognito: () => settings.getAppSettings().incognito,
  });

  registerIpcHandlers(
    createIpcHandlers({
      settings,
      extensions,
      sources,
      chapters: chaptersRepo,
      network,
      requests: new RequestRegistry(),
      reading,
      history: historyRepo,
      library,
      libraryRepo,
      categories: new CategoriesRepository(connection.db, changes),
      manga: mangaRepo,
      migration: sourceMigration,
    }),
  );

  let mainWindow = createMainWindow(settings);

  app.on('second-instance', () => {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow(settings);
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('will-quit', () => {
    sessions.end();
    registry.close();
    host.dispose();
    connection.sqlite.close();
  });
}
