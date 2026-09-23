import { AppError, type AppErrorData, toAppErrorData } from '@manga-reader/shared/errors';

// Minimal request/response RPC over a message port. Used in both directions between main and the
// extension host, so both sides can call each other (main → call, host → http/storage).

export type RpcMessage =
  | { kind: 'request'; id: number; method: string; params: unknown }
  | { kind: 'response'; id: number; result?: unknown; error?: AppErrorData };

export interface RpcTransport {
  send(message: RpcMessage): void;
  /** Returns an unsubscribe function. */
  listen(handler: (message: RpcMessage) => void): () => void;
}

/** `{ method: (params) => result }` */
export type RpcMethods = Record<string, (params: never) => unknown>;
type Params<M extends RpcMethods, K extends keyof M> = Parameters<M[K]>[0];
type Result<M extends RpcMethods, K extends keyof M> = Awaited<ReturnType<M[K]>>;

export type RpcHandlers<M extends RpcMethods> = { [K in keyof M]: (params: Params<M, K>) => unknown };

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class RpcPeer<Local extends RpcMethods, Remote extends RpcMethods> {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly unlisten: () => void;
  private closed: AppError | null = null;

  constructor(
    private readonly transport: RpcTransport,
    private readonly handlers: RpcHandlers<Local>,
  ) {
    this.unlisten = transport.listen((message) => this.onMessage(message));
  }

  request<K extends keyof Remote & string>(
    method: K,
    params: Params<Remote, K>,
    options: { timeoutMs?: number } = {},
  ): Promise<Result<Remote, K>> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve: resolve as (value: unknown) => void, reject };
      if (options.timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new AppError('timeout', `${method} did not answer within ${options.timeoutMs} ms`));
        }, options.timeoutMs);
      }
      this.pending.set(id, entry);
      this.transport.send({ kind: 'request', id, method, params });
    });
  }

  /** Rejects everything in flight (e.g. the other process died) and stops listening. */
  close(error: AppError): void {
    if (this.closed) return;
    this.closed = error;
    this.unlisten();
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  private onMessage(message: RpcMessage): void {
    if (message.kind === 'response') {
      const entry = this.pending.get(message.id);
      if (!entry) return; // timed out or cancelled
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(AppError.from(message.error));
      else entry.resolve(message.result);
      return;
    }
    const handler = this.handlers[message.method as keyof Local];
    const reply = (response: Omit<Extract<RpcMessage, { kind: 'response' }>, 'kind' | 'id'>) => {
      if (!this.closed) this.transport.send({ kind: 'response', id: message.id, ...response });
    };
    if (!handler) {
      reply({ error: { code: 'unknown', message: `Unknown RPC method ${message.method}` } });
      return;
    }
    Promise.resolve()
      .then(() => handler(message.params as never))
      .then(
        (result) => reply({ result }),
        (error: unknown) => reply({ error: toAppErrorData(error) }),
      );
  }
}
