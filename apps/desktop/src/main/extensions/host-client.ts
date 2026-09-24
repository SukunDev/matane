import { AppError } from '@manga-reader/shared/errors';
import { type UtilityProcess, utilityProcess } from 'electron';
import type { HostMethods, MainMethods } from '../../extension-host/protocol';
import { type RpcHandlers, type RpcMessage, RpcPeer } from '../../extension-host/rpc';
import type { HostCaller } from './service';

export interface HostClientOptions {
  /** Built extension host entry (out/main/extension-host.js). */
  entry: string;
  handlers: RpcHandlers<MainMethods>;
  env: Record<string, string>;
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Tells the app the host went away (so it can drop per-process state). */
  onExit?: (code: number) => void;
}

const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES = 5;

/**
 * Owns the extension host utilityProcess. It starts lazily on the first call and is restarted on the
 * next call after a crash; calls in flight when it dies fail with `host_crashed` (the UI stays up).
 */
export class ExtensionHostClient implements HostCaller {
  private child: UtilityProcess | undefined;
  private peer: RpcPeer<MainMethods, HostMethods> | undefined;
  private crashes: number[] = [];
  private disposed = false;

  constructor(private readonly options: HostClientOptions) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  request: HostCaller['request'] = (method, params, options) => {
    try {
      return this.ensure().request(method, params, options);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  dispose(): void {
    this.disposed = true;
    this.peer?.close(new AppError('cancelled', 'Extension host stopped'));
    this.child?.kill();
    this.child = undefined;
    this.peer = undefined;
  }

  private ensure(): RpcPeer<MainMethods, HostMethods> {
    if (this.disposed) throw new AppError('cancelled', 'Extension host stopped');
    if (this.peer) return this.peer;

    const recent = this.crashes.filter((at) => Date.now() - at < CRASH_WINDOW_MS);
    this.crashes = recent;
    if (recent.length >= MAX_CRASHES) {
      throw new AppError('host_crashed', 'The extension host keeps crashing; try again in a minute');
    }

    const child = utilityProcess.fork(this.options.entry, [], {
      serviceName: 'Matane Extension Host',
      stdio: 'pipe',
      env: { ...process.env, ...this.options.env },
    });
    child.stdout?.on('data', (chunk: Buffer) => this.options.log('info', chunk.toString().trimEnd()));
    child.stderr?.on('data', (chunk: Buffer) => this.options.log('warn', chunk.toString().trimEnd()));

    const peer = new RpcPeer<MainMethods, HostMethods>(
      {
        send: (message) => child.postMessage(message),
        listen: (handler) => {
          const listener = (message: RpcMessage) => handler(message);
          child.on('message', listener);
          return () => child.off('message', listener);
        },
      },
      this.options.handlers,
    );

    child.once('exit', (code) => {
      if (this.child === child) {
        this.child = undefined;
        this.peer = undefined;
      }
      peer.close(new AppError('host_crashed', `The extension host stopped unexpectedly (exit code ${code})`));
      if (!this.disposed) {
        this.crashes.push(Date.now());
        this.options.log('error', `Extension host exited with code ${code}; it restarts on the next call`);
        this.options.onExit?.(code);
      }
    });

    child.once('spawn', () => this.options.log('info', `Extension host started (pid ${child.pid})`));
    this.child = child;
    this.peer = peer;
    return peer;
  }
}
