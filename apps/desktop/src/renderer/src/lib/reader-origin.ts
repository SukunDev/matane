import type { AnyRouter } from '@tanstack/react-router';

let origin: string | null = null;

/** Path the reader was opened from; it is the history entry just below the reader's own. */
export const readerOrigin = (): string | null => origin;

/**
 * Remembers where the reader was entered from. Chapters inside the reader replace each other, so
 * only the move from a non-reader page into the reader counts. The reader's exit button uses it to
 * step back instead of pushing the same page again (which made Back return to the reader).
 */
export function trackReaderOrigin(router: AnyRouter): void {
  router.subscribe('onResolved', ({ fromLocation, toLocation }) => {
    const reader = (path: string | undefined) => path?.startsWith('/reader/') ?? false;
    if (reader(toLocation.pathname) && fromLocation && !reader(fromLocation.pathname)) origin = fromLocation.pathname;
  });
}
