import log from 'electron-log/main';

export function initLogging(): void {
  // Also exposes `electron-log/renderer` to the sandboxed renderer via an injected preload.
  log.initialize();
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.level = 'info';
  log.errorHandler.startCatching({ showDialog: false });
}

export { log };
