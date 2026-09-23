/**
 * Cancellable renderer requests. The renderer tags slow calls with a `requestId` and sends
 * `requests.cancel` when TanStack Query aborts (the query was unmounted or superseded).
 */
export class RequestRegistry {
  private readonly controllers = new Map<string, AbortController>();

  async run<T>(requestId: string | undefined, work: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
    if (!requestId) return work(undefined);
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    try {
      return await work(controller.signal);
    } finally {
      if (this.controllers.get(requestId) === controller) this.controllers.delete(requestId);
    }
  }

  cancel(requestId: string): void {
    this.controllers.get(requestId)?.abort();
    this.controllers.delete(requestId);
  }
}
