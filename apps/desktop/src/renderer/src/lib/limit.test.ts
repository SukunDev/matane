import { describe, expect, it } from 'vitest';
import { createLimiter } from './limit';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createLimiter', () => {
  it('runs at most N tasks at once, in order', async () => {
    const limit = createLimiter(2);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, i) =>
      limit(async () => {
        started.push(i);
        await gate.promise;
        return i;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    gates[0]!.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[1]!.resolve();
    gates[2]!.resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2]);
  });

  it('never goes over the limit when a slot is handed over', async () => {
    const limit = createLimiter(1);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    };
    const runs = [limit(task), limit(task)];
    await tick();
    runs.push(limit(task)); // arrives while the first slot is being handed over
    await Promise.all(runs);
    expect(peak).toBe(1);
  });

  it('drops a waiting task when its signal aborts', async () => {
    const limit = createLimiter(1);
    const gate = deferred();
    const first = limit(() => gate.promise);
    const controller = new AbortController();
    let ran = false;
    const second = limit(async () => {
      ran = true;
    }, controller.signal);
    controller.abort();
    await expect(second).rejects.toBeDefined();
    gate.resolve();
    await first;
    await limit(async () => undefined);
    expect(ran).toBe(false);
  });
});
