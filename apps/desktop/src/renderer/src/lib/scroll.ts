import { useRouterState } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef } from 'react';

// One entry per history entry (not per URL), so Back restores the position the user left.
const positions = new Map<string, number>();
const MAX_ENTRIES = 100;
// The restored content (virtualized rows, lazy pages) may need a few frames before it is tall enough.
const MAX_ATTEMPTS = 45;

/**
 * Keeps a scroll container's position per history entry: leaving a list for a manga and coming
 * back lands on the same spot. `ready` says the content is rendered (restoring earlier would clamp).
 */
export function useScrollRestoration(element: HTMLElement | null, ready: boolean): void {
  const key = useRouterState({ select: (state) => state.location.state.__TSR_key ?? state.location.href });
  const restoring = useRef(false);
  const restoredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!element) return;
    const onScroll = () => {
      if (restoring.current) return;
      positions.delete(key);
      positions.set(key, element.scrollTop);
      if (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value as string);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [element, key]);

  useLayoutEffect(() => {
    if (!element || !ready || restoredFor.current === key) return;
    restoredFor.current = key;
    const target = positions.get(key) ?? 0;
    if (target === 0) return;
    restoring.current = true;
    let frame = 0;
    let attempts = 0;
    const apply = () => {
      element.scrollTop = target;
      attempts += 1;
      if (Math.abs(element.scrollTop - target) < 1 || attempts >= MAX_ATTEMPTS) {
        restoring.current = false;
        return;
      }
      frame = requestAnimationFrame(apply);
    };
    apply();
    return () => {
      cancelAnimationFrame(frame);
      restoring.current = false;
    };
  }, [element, ready, key]);
}
