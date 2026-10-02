import log from 'electron-log/main';

export function initLogging(): void {
  // Also exposes `electron-log/renderer` to the sandboxed renderer via an injected preload.
  log.initialize();
  log.transports.file.maxSize = 5 * 1024 * 1024;
  log.transports.file.level = 'info';
  log.errorHandler.startCatching({ showDialog: false });
}

/** The level written to the log file (Settings → Advanced); the console keeps everything. */
export function setLogLevel(level: 'error' | 'warn' | 'info' | 'debug'): void {
  log.transports.file.level = level;
}

export { log };
