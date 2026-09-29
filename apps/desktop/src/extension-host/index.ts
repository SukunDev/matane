// Entry point of the extension host utilityProcess (ADR 0003). It only runs QuickJS runtimes; all
// network, storage and logging go back to main over the parent port.
import { AppError } from '@manga-reader/shared/errors';
import { ExtensionHost } from './host';
import type { HostMethods, MainMethods } from './protocol';
import { type RpcMessage, RpcPeer } from './rpc';

const SWEEP_INTERVAL_MS = 60_000;

const port = process.parentPort;
if (!port) throw new Error('The extension host must run as an Electron utilityProcess');

const appName = process.env['MR_APP_NAME'] ?? 'Matane';
const appVersion = process.env['MR_APP_VERSION'] ?? '0.0.0';

// The host needs the peer and the peer needs the host's handlers; the closures bind late.
const peer: RpcPeer<HostMethods, MainMethods> = new RpcPeer(
  {
    send: (message) => port.postMessage(message),
    listen: (handler) => {
      const listener = (event: Electron.MessageEvent) => handler(event.data as RpcMessage);
      port.on('message', listener);
      return () => port.off('message', listener);
    },
  },
  {
    call: (params) => host.handlers.call(params),
    transformImage: (params) => host.handlers.transformImage(params),
    migrateUrls: (params) => host.handlers.migrateUrls(params),
    unload: (params) => host.handlers.unload(params),
    stats: (params) => host.handlers.stats(params),
  },
);
const host: ExtensionHost = new ExtensionHost(peer, { appName, appVersion });

setInterval(() => host.sweep(), SWEEP_INTERVAL_MS).unref();

process.on('uncaughtException', (error) => {
  // Report and keep serving; a broken runtime is disposed on its next failure.
  void peer
    .request('log', { extensionId: '(host)', level: 'error', message: String(error.stack ?? error) })
    .catch(() => undefined);
});
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof AppError ? reason.message : String(reason);
  void peer.request('log', { extensionId: '(host)', level: 'error', message }).catch(() => undefined);
});
