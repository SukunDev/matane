import { toChapterInfo } from '../db/repositories/chapters';
import { BrowserWindow, app, dialog } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import type { ChaptersRepository } from '../db/repositories/chapters';
import type { ExtensionService } from '../extensions/service';
import type { SourceService } from '../extensions/sources';
import type { NetworkManager } from '../network/manager';
import { type IpcHandlers, broadcast } from './register';
import type { RequestRegistry } from './requests';

export interface IpcDeps {
  settings: SettingsRepository;
  extensions: ExtensionService;
  sources: SourceService;
  chapters: ChaptersRepository;
  network: NetworkManager;
  requests: RequestRegistry;
}

export function createIpcHandlers({
  settings,
  extensions,
  sources,
  chapters,
  network,
  requests,
}: IpcDeps): IpcHandlers {
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
    'chapters.list': ({ mangaId }) => chapters.list(mangaId).map(toChapterInfo),
    'chapter.pages': ({ chapterId, requestId }) =>
      requests.run(requestId, (signal) => sources.pages(chapterId, signal)),
    'requests.cancel': ({ requestId }) => requests.cancel(requestId),
  };
}
