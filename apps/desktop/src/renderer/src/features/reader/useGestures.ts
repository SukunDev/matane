import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { GestureTracker, sampleOf } from './gestures';

export interface GestureHandlers {
  /** A pointer dragged by (dx, dy): mouse with the button held, or a finger. */
  onPan?: (dx: number, dy: number, pointerType: string) => void;
  /** Two fingers pinched by `factor` around (x, y) in client px. */
  onPinch?: (factor: number, x: number, y: number) => void;
  onSwipe?: (direction: 'left' | 'right' | 'up' | 'down', pointerType: string) => void;
  /** Ctrl + wheel, or a trackpad pinch: zoom by `factor` around (x, y). */
  onZoomWheel?: (factor: number, x: number, y: number) => void;
  /** Any other wheel event (not passive: it may `preventDefault`). */
  onWheel?: (event: WheelEvent) => void;
}

/**
 * Pointer gestures and the wheel on the reader's scroller (native listeners: React's wheel handler
 * is passive). Returns `wasDrag()`, true once after a drag ended, so the click it causes can be
 * ignored by tap zones.
 */
export function useGestures(target: RefObject<HTMLElement | null>, handlers: GestureHandlers): () => boolean {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const dragged = useRef(false);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const tracker = new GestureTracker();
    let pointerType = 'mouse';

    const down = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointerType = event.pointerType;
      tracker.down(sampleOf(event));
    };
    const move = (event: PointerEvent) => {
      const gesture = tracker.move(sampleOf(event));
      if (!gesture) return;
      if (gesture.kind === 'pinch') latest.current.onPinch?.(gesture.factor, gesture.x, gesture.y);
      else if (gesture.kind === 'pan' && tracker.moved) latest.current.onPan?.(gesture.dx, gesture.dy, pointerType);
    };
    const up = (event: PointerEvent) => {
      const moved = tracker.moved;
      const gesture = tracker.up(sampleOf(event));
      if (moved) dragged.current = true;
      if (gesture?.kind === 'swipe') latest.current.onSwipe?.(gesture.direction, pointerType);
    };
    const cancel = (event: PointerEvent) => tracker.cancel(event.pointerId);
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey && latest.current.onZoomWheel) {
        event.preventDefault();
        latest.current.onZoomWheel(Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
        return;
      }
      latest.current.onWheel?.(event);
    };

    element.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      element.removeEventListener('wheel', wheel);
    };
  }, [target]);

  return () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };
}
