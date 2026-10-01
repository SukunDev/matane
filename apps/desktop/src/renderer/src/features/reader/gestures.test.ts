import { describe, expect, it } from 'vitest';
import { GestureTracker, STRIP_ZOOM, clampZoom } from './gestures';
import { keyParts } from './keymap';
import { cssFilter } from './filters';

const at = (id: number, x: number, y: number, t: number) => ({ id, x, y, t });

describe('GestureTracker', () => {
  it('sees a quick horizontal flick as a swipe, a slow one as a drag', () => {
    const quick = new GestureTracker();
    quick.down(at(1, 300, 200, 0));
    expect(quick.move(at(1, 250, 205, 50))).toEqual({ kind: 'pan', dx: -50, dy: 5 });
    expect(quick.up(at(1, 200, 210, 120))).toEqual({ kind: 'swipe', direction: 'left' });

    const slow = new GestureTracker();
    slow.down(at(1, 300, 200, 0));
    slow.move(at(1, 200, 200, 400));
    expect(slow.up(at(1, 100, 200, 900))).toBeNull();
    expect(slow.moved).toBe(true);
  });

  it('needs enough distance and a clear direction', () => {
    const short = new GestureTracker();
    short.down(at(1, 100, 100, 0));
    short.move(at(1, 140, 100, 30));
    expect(short.up(at(1, 140, 100, 60))).toBeNull();

    const diagonal = new GestureTracker();
    diagonal.down(at(1, 100, 100, 0));
    diagonal.move(at(1, 180, 170, 30));
    expect(diagonal.up(at(1, 180, 170, 60))).toBeNull();

    const down = new GestureTracker();
    down.down(at(1, 100, 100, 0));
    down.move(at(1, 105, 200, 30));
    expect(down.up(at(1, 105, 200, 60))).toEqual({ kind: 'swipe', direction: 'down' });
  });

  it('reports a press without movement as a tap', () => {
    const tracker = new GestureTracker();
    tracker.down(at(1, 100, 100, 0));
    tracker.move(at(1, 103, 102, 40));
    expect(tracker.up(at(1, 103, 102, 80))).toEqual({ kind: 'tap', x: 103, y: 102 });
    expect(tracker.moved).toBe(false);
  });

  it('turns two fingers moving apart into a pinch, never a swipe or tap', () => {
    const tracker = new GestureTracker();
    tracker.down(at(1, 100, 100, 0));
    tracker.down(at(2, 200, 100, 5));
    const pinch = tracker.move(at(2, 300, 100, 30));
    expect(pinch).toEqual({ kind: 'pinch', factor: 2, x: 200, y: 100 });
    expect(tracker.move(at(1, 200, 100, 40))).toMatchObject({ kind: 'pinch', factor: 0.5 });
    expect(tracker.up(at(2, 300, 100, 60))).toBeNull();
    expect(tracker.up(at(1, 200, 100, 70))).toBeNull();
    // The next gesture starts fresh.
    tracker.down(at(3, 0, 0, 100));
    expect(tracker.up(at(3, 0, 0, 120))).toMatchObject({ kind: 'tap' });
  });

  it('ignores pointers it never saw go down', () => {
    const tracker = new GestureTracker();
    expect(tracker.move(at(9, 1, 1, 1))).toBeNull();
    expect(tracker.up(at(9, 1, 1, 1))).toBeNull();
  });
});

describe('reader helpers', () => {
  it('keeps zoom within limits, rounded', () => {
    expect(clampZoom(0.1, STRIP_ZOOM)).toBe(0.5);
    expect(clampZoom(1.23456, STRIP_ZOOM)).toBe(1.23);
    expect(clampZoom(9, STRIP_ZOOM)).toBe(3);
  });

  it('shows keys as chips', () => {
    expect(keyParts('Ctrl++')).toEqual(['Ctrl', '+']);
    expect(keyParts('Ctrl+=')).toEqual(['Ctrl', '=']);
    expect(keyParts('Shift+Space')).toEqual(['Shift', 'Space']);
    expect(keyParts('ArrowLeft')).toEqual(['←']);
  });

  it('builds the CSS filter, none when nothing changes', () => {
    expect(cssFilter({ brightness: 100, contrast: 100, grayscale: false, invert: false, warm: 0 })).toBe('none');
    expect(cssFilter({ brightness: 80, contrast: 120, grayscale: true, invert: true, warm: 30 })).toBe(
      'brightness(80%) contrast(120%) grayscale(1) invert(1) sepia(30%)',
    );
  });
});
