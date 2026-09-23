import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import { initLogging, log } from './app/log';
import { createMainWindow } from './app/window';
import { DbChanges } from './db/changes';
import { openDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { ChaptersRepository } from './db/repositories/chapters';
import { ExtensionsRepository } from './db/repositories/extensions';
import { MangaRepository } from './db/repositories/manga';
import { SettingsRepository } from './db/repositories/settings';
import { ExtensionHostClient } from './extensions/host-client';
import { ExtensionRegistry } from './extensions/registry';
import { ExtensionService } from './extensions/service';
import { SourceService } from './extensions/sources';
import { createIpcHandlers } from './ipc/handlers';
import { broadcast, registerIpcHandlers } from './ipc/register';
import { RequestRegistry } from './ipc/requests';
import { CloudflareSolver } from './network/cloudflare';
import { NetworkManager } from './network/manager';

const DEV_FOLDERS_KEY = 'extensions.devFolders';

initLogging();

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
  const connection = openDatabase(join(userData, 'data.db'));
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

  registerIpcHandlers(
    createIpcHandlers({
      settings,
      extensions,
      sources,
      chapters: chaptersRepo,
      network,
      requests: new RequestRegistry(),
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
    registry.close();
    host.dispose();
    connection.sqlite.close();
  });
}
