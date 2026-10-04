/**
 * At most `max` tasks at a time; the rest wait in order. A finished task hands its slot straight to
 * the next waiting one. A task whose signal aborts while it waits never starts (global search:
 * 5 sources at once, docs/BRAINSTORM.md §6.2).
 */
export function createLimiter(max: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
  return async function limit<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (running < max) {
      running++;
    } else {
      await new Promise<void>((resolve, reject) => {
        const start = () => {
          signal?.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          waiting.splice(waiting.indexOf(start), 1);
          reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        waiting.push(start);
        signal?.addEventListener('abort', cancel, { once: true });
      });
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
}
