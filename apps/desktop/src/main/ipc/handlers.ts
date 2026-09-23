import { BrowserWindow, app } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import { type IpcHandlers, broadcast } from './register';

export function createIpcHandlers(settings: SettingsRepository): IpcHandlers {
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

    'settings.get': () => settings.getAppSettings(),
    'settings.set': (patch) => {
      const next = settings.updateAppSettings(patch);
      broadcast('settings.changed', next);
      return next;
    },
  };
}
