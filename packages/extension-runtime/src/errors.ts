export type RuntimeErrorCode =
  /** The extension threw (or rejected) — `extensionError` holds its name/message/status. */
  | 'extension'
  /** Synchronous code ran longer than the CPU budget. */
  | 'interrupted'
  /** The call took longer than its time budget (including network waits). */
  | 'timeout'
  /** The runtime hit its memory limit. */
  | 'memory'
  /** The runtime was disposed while the call was running. */
  | 'disposed';

export interface SerializedExtensionError {
  name: string;
  message: string;
  status?: number;
}

export class ExtensionRuntimeError extends Error {
  override name = 'ExtensionRuntimeError';
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly extensionError?: SerializedExtensionError,
  ) {
    super(message);
  }
}

/** Errors that host functions throw on purpose (visible to the extension by `name`). */
export class HostError extends Error {
  constructor(
    override readonly name: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
