import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import { initLogging, log } from './app/log';
import { createMainWindow } from './app/window';
import { openDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { SettingsRepository } from './db/repositories/settings';
import { createIpcHandlers } from './ipc/handlers';
import { registerIpcHandlers } from './ipc/register';

initLogging();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void bootstrap();
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

  const settings = new SettingsRepository(connection.db);
  registerIpcHandlers(createIpcHandlers(settings));

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
  app.on('will-quit', () => connection.sqlite.close());
}
