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
    if (!reader(toLocation.pathname) || !fromLocation) return;
    if (!reader(fromLocation.pathname)) origin = fromLocation.pathname;
    // Any other reader → reader move (the URL edited by hand, Back/Forward) leaves a reader entry
    // below this one, so stepping back would not leave the reader. Chapter changes inside the
    // reader replace, which keeps the history index; a hand-edited hash resets it to 0.
    else if (toLocation.state.__TSR_index !== fromLocation.state.__TSR_index) origin = null;
  });
}
