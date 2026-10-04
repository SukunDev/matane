/** One pointer sample: id, position in CSS px, time in ms. */
export interface PointerSample {
  id: number;
  x: number;
  y: number;
  t: number;
}

export type Gesture =
  /** One pointer moved by (dx, dy) since the last sample. */
  | { kind: 'pan'; dx: number; dy: number }
  /** Two pointers: the distance between them changed by `factor` since the last sample. */
  | { kind: 'pinch'; factor: number; x: number; y: number }
  /** A quick, mostly horizontal or vertical flick of one pointer. */
  | { kind: 'swipe'; direction: 'left' | 'right' | 'up' | 'down' }
  /** Down and up without moving. */
  | { kind: 'tap'; x: number; y: number };

export const SWIPE_DISTANCE = 60;
export const SWIPE_MS = 600;
export const TAP_SLOP = 8;

/**
 * Turns pointer events into reader gestures (docs/BRAINSTORM.md §6.1: swipe to turn, pinch to zoom, tap
 * zones). Mouse, touch and pen go through the same rules; callers decide which gestures they use.
 */
export class GestureTracker {
  private readonly pointers = new Map<number, { start: PointerSample; last: PointerSample }>();
  private pinchDistance: number | null = null;
  /** Several pointers were down during this gesture: no swipe or tap at the end. */
  private multi = false;
  /** The pointer moved past the tap slop (a drag, not a click). */
  moved = false;

  down(sample: PointerSample): void {
    if (this.pointers.size === 0) {
      this.multi = false;
      this.moved = false;
    }
    this.pointers.set(sample.id, { start: sample, last: sample });
    if (this.pointers.size >= 2) {
      this.multi = true;
      this.pinchDistance = this.distance();
    }
  }

  move(sample: PointerSample): Gesture | null {
    const pointer = this.pointers.get(sample.id);
    if (!pointer) return null;
    const previous = pointer.last;
    pointer.last = sample;
    if (Math.hypot(sample.x - pointer.start.x, sample.y - pointer.start.y) > TAP_SLOP) this.moved = true;
    if (this.pointers.size >= 2) {
      const distance = this.distance();
      if (!this.pinchDistance || !distance) return null;
      const factor = distance / this.pinchDistance;
      this.pinchDistance = distance;
      const [a, b] = [...this.pointers.values()].map((p) => p.last);
      return { kind: 'pinch', factor, x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    }
    return { kind: 'pan', dx: sample.x - previous.x, dy: sample.y - previous.y };
  }

  up(sample: PointerSample): Gesture | null {
    const pointer = this.pointers.get(sample.id);
    if (!pointer) return null;
    this.pointers.delete(sample.id);
    if (this.pointers.size < 2) this.pinchDistance = null;
    if (this.multi || this.pointers.size > 0) return null;
    const dx = sample.x - pointer.start.x;
    const dy = sample.y - pointer.start.y;
    if (!this.moved) return { kind: 'tap', x: sample.x, y: sample.y };
    if (sample.t - pointer.start.t > SWIPE_MS) return null;
    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5) {
      return { kind: 'swipe', direction: dx < 0 ? 'left' : 'right' };
    }
    if (Math.abs(dy) >= SWIPE_DISTANCE && Math.abs(dy) > Math.abs(dx) * 1.5) {
      return { kind: 'swipe', direction: dy < 0 ? 'up' : 'down' };
    }
    return null;
  }

  cancel(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinchDistance = null;
    this.multi = true;
  }

  get active(): number {
    return this.pointers.size;
  }

  private distance(): number {
    const [a, b] = [...this.pointers.values()].map((p) => p.last);
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}

export const sampleOf = (event: { pointerId: number; clientX: number; clientY: number; timeStamp: number }) => ({
  id: event.pointerId,
  x: event.clientX,
  y: event.clientY,
  t: event.timeStamp,
});

/** Zoom limits: page modes zoom into the page, the strip also narrows. */
export const PAGE_ZOOM = { min: 1, max: 4 } as const;
export const STRIP_ZOOM = { min: 0.5, max: 3 } as const;
export const ZOOM_STEP = 1.25;

export const clampZoom = (value: number, limits: { min: number; max: number }) =>
  Math.round(Math.min(Math.max(value, limits.min), limits.max) * 100) / 100;
