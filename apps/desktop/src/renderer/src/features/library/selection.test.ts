import { describe, expect, it } from 'vitest';
import { EMPTY_SELECTION, select, visibleSelection } from './selection';

const order = [10, 20, 30, 40, 50];

describe('select', () => {
  it('toggles single items and moves the anchor', () => {
    let s = select(EMPTY_SELECTION, order, 20, 'toggle');
    s = select(s, order, 40, 'toggle');
    expect([...s.ids]).toEqual([20, 40]);
    s = select(s, order, 20, 'toggle');
    expect([...s.ids]).toEqual([40]);
    expect(s.anchor).toBe(20);
  });

  it('adds the range from the anchor in either direction', () => {
    const s = select(select(EMPTY_SELECTION, order, 40, 'toggle'), order, 20, 'range');
    expect([...s.ids].sort()).toEqual([20, 30, 40]);
    expect(s.anchor).toBe(40);
  });

  it('treats Shift without an anchor as a toggle', () => {
    expect([...select(EMPTY_SELECTION, order, 30, 'range').ids]).toEqual([30]);
  });

  it('keeps only listed ids, in list order', () => {
    const s = { ids: new Set([50, 99, 10]), anchor: null };
    expect(visibleSelection(s, order)).toEqual([10, 50]);
  });
});
