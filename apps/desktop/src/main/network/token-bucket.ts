import { AppError } from '@manga-reader/shared/errors';

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Per-extension rate limit (manifest `rateLimit`): `capacity` requests, refilled evenly over `perMs`.
 * Waiters are served first-in, first-out; an aborted waiter leaves the queue.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly capacity: number,
    private readonly perMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
  }

  take(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new AppError('cancelled', 'Request cancelled'));
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(new AppError('cancelled', 'Request cancelled'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queue.push(waiter);
      this.drain();
    });
  }

  private refill(): void {
    const now = this.now();
    const elapsed = now - this.lastRefill;
    this.lastRefill = now;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.capacity) / this.perMs);
  }

  private drain(): void {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const waiter = this.queue.shift()!;
      if (waiter.onAbort) waiter.signal?.removeEventListener('abort', waiter.onAbort);
      waiter.resolve();
    }
    if (this.queue.length > 0 && this.timer === undefined) {
      const wait = Math.ceil(((1 - this.tokens) * this.perMs) / this.capacity);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.drain();
      }, wait);
    }
  }
}
