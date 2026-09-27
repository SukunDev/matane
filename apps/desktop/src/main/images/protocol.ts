import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { toAppErrorData } from '@manga-reader/shared/errors';
import { protocol } from 'electron';
import type { CachedImage } from './cache';
import type { ServedImage } from './service';

export const MANGA_SCHEME = 'manga';

/** Must run before `app.whenReady()`. */
export function registerMangaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MANGA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ]);
}

export interface MangaProtocolRoutes {
  cover(mangaId: number): Promise<CachedImage>;
  page(chapterId: number, index: number): Promise<ServedImage>;
}

/**
 * `manga://cover/<mangaId>` → the manga's cover; `manga://page/<chapterId>/<index>` → a chapter page.
 * Pages of downloaded chapters come from the download; everything else from the image cache,
 * fetched through the extension's network on a miss.
 */
export function handleMangaProtocol(routes: MangaProtocolRoutes, log: (message: string) => void): void {
  protocol.handle(MANGA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (url.host === 'cover' && parts.length === 1 && /^\d+$/.test(parts[0]!)) {
        return serve(await routes.cover(Number(parts[0])));
      }
      if (url.host === 'page' && parts.length === 2 && parts.every((part) => /^\d+$/.test(part))) {
        return serve(await routes.page(Number(parts[0]), Number(parts[1])));
      }
      return new Response('Not found', { status: 404 });
    } catch (error) {
      const data = toAppErrorData(error);
      if (data.code !== 'not_found') log(`${request.url}: ${data.code} ${data.message}`);
      const status = data.code === 'not_found' ? 404 : data.code === 'not_installed' ? 410 : 502;
      return new Response(data.message, { status, headers: { 'x-error-code': data.code } });
    }
  });
}

function serve(image: ServedImage | CachedImage): Response {
  const body =
    'data' in image
      ? new Uint8Array(image.data)
      : (Readable.toWeb(createReadStream(image.path)) as ReadableStream<Uint8Array>);
  return new Response(body, {
    headers: {
      'content-type': image.contentType ?? 'application/octet-stream',
      'content-length': String(image.sizeBytes),
      // The URL stays the same when a source changes a cover; let the disk cache decide.
      'cache-control': 'no-cache',
    },
  });
}
