import { describe, expect, it } from 'vitest';
import { ExtensionLogs, LOG_LINES_KEPT } from './logs';

describe('ExtensionLogs', () => {
  it('keeps the last lines per extension and reports each one', () => {
    const seen: string[] = [];
    const logs = new ExtensionLogs(
      (id, entry) => seen.push(`${id}:${entry.message}`),
      () => 7,
    );
    for (let i = 0; i < LOG_LINES_KEPT + 20; i++) logs.append('a', 'info', 'log', `line ${i}`);
    logs.append('b', 'error', 'call', 'x'.repeat(3000));

    const a = logs.list('a');
    expect(a).toHaveLength(LOG_LINES_KEPT);
    expect(a[0]?.message).toBe('line 20');
    expect(a.at(-1)).toMatchObject({ message: `line ${LOG_LINES_KEPT + 19}`, level: 'info', at: 7 });
    expect(logs.list('b')[0]?.message).toHaveLength(2001);
    expect(seen).toHaveLength(LOG_LINES_KEPT + 21);
    // Sequence numbers keep increasing across extensions.
    expect(logs.list('b')[0]!.seq).toBeGreaterThan(a.at(-1)!.seq);

    logs.clear('a');
    expect(logs.list('a')).toEqual([]);
  });
});
