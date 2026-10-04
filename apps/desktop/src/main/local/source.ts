import { SDK_API_VERSION } from '@matane/extension-sdk';
import type { Chapter, MangaSummary } from '@matane/extension-sdk';
import type { ExtensionManifest } from '@matane/extension-sdk/manifest';
import { LOCAL_EXTENSION_ID, LOCAL_SOURCE_KEY } from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import type { NativeExtension } from '../extensions/native';
import { type LocalFiles } from './files';

/** "all": shown whatever the content languages are (`isContentVisible`). */
const manifest = (version: string): ExtensionManifest => ({
  id: LOCAL_EXTENSION_ID,
  name: 'Local files',
  version,
  apiVersion: SDK_API_VERSION,
  description: 'Manga from a folder on this computer (CBZ files or folders of images)',
  nsfw: false,
  sources: [{ key: LOCAL_SOURCE_KEY, lang: 'all', name: 'Local files' }],
});

/** The local files source as an extension of its own; `version` is the app's. */
export function createLocalExtension(files: LocalFiles, version: string): NativeExtension {
  const m = manifest(version);
  return {
    entry: {
      id: LOCAL_EXTENSION_ID,
      origin: 'builtin',
      path: '',
      bundleDir: '',
      manifest: m,
      code: '',
      error: null,
      iconPath: null,
    },
    async call(_sourceKey, method, args) {
      switch (method) {
        case '__info':
          return { baseUrl: 'local:', capabilities: ['getLatest'] };
        case '__preferences':
          return [];
        case 'getPopular':
          return files.manga('popular', Number(args[0]));
        case 'getLatest':
          return files.manga('latest', Number(args[0]));
        case 'search':
          return files.manga('search', Number(args[1]), String(args[0] ?? ''));
        case 'getMangaDetails':
          return files.details((args[0] as MangaSummary).url);
        case 'getChapters':
          return files.chapters((args[0] as MangaSummary).url);
        case 'getPages':
          return files.pages((args[0] as Chapter).url);
        default:
          throw new AppError('parse', `The local source does not implement ${method}`);
      }
    },
  };
}
