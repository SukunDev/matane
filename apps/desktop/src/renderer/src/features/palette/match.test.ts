import { describe, expect, it } from 'vitest';
import { matches } from './match';

describe('palette matching', () => {
  it('matches word starts, in any case and without accents', () => {
    expect(matches('Settings › Reader', 'set rea')).toBe(true);
    expect(matches('Settings › Reader', 'reader')).toBe(true);
    expect(matches('Check for updates', 'UPD')).toBe(true);
    expect(matches('Café Löwe', 'cafe lowe')).toBe(true);
  });

  it('does not match inside words or with an extra word', () => {
    expect(matches('Downloads', 'load')).toBe(false);
    expect(matches('History', 'history extra')).toBe(false);
  });

  it('matches everything with an empty query', () => {
    expect(matches('Anything', '  ')).toBe(true);
  });
});
