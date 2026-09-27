import { AppError } from '@manga-reader/shared/errors';

export interface FetchBytesOptions {
  maxBytes: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Fetches a whole (small) file; null on 404. Used for repository indexes, archives and icons. */
export type FetchBytes = (url: string, options: FetchBytesOptions) => Promise<Buffer | null>;

/**
 * A `FetchBytes` over any fetch (Electron's `net.fetch` in the app): revalidates caches, gives up
 * after a timeout, and stops reading as soon as the body is larger than allowed.
 */
export function createFetchBytes(fetchImpl: (url: string, init: RequestInit) => Promise<Response>): FetchBytes {
  return async (url, { maxBytes, signal, timeoutMs = 30_000 }) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        cache: 'no-cache',
        redirect: 'follow',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw new AppError('cancelled', 'Cancelled');
      if (timeout.aborted) throw new AppError('timeout', `${url}: no answer after ${timeoutMs / 1000} s`);
      throw new AppError('network', `${url}: ${(error as Error).message}`);
    }
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError('http', `${url}: HTTP ${response.status}`, response.status);
    }
    const tooLarge = () => new AppError('repo', `${url} is larger than ${Math.round(maxBytes / 1024)} KB`);
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      await response.body?.cancel();
      throw tooLarge();
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw tooLarge();
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('network', `${url}: ${(error as Error).message}`);
    }
    return Buffer.concat(chunks);
  };
}
