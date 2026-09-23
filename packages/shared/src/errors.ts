// Typed errors that survive every hop (sandbox → extension host → main → renderer). Zod-free so the
// extension host and preload can import it cheaply.

export const APP_ERROR_CODES = [
  // From the extension or its HTTP traffic
  'network',
  'http',
  'cloudflare',
  'rate_limited',
  'not_found',
  'parse',
  'extension',
  'not_implemented',
  // From the sandbox
  'timeout',
  'interrupted',
  'memory',
  // From the host plumbing
  'host_crashed',
  'cancelled',
  'not_installed',
  'unknown',
] as const;
export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export interface AppErrorData {
  code: AppErrorCode;
  message: string;
  /** HTTP status for `http` errors. */
  status?: number;
}

export class AppError extends Error {
  override name = 'AppError';

  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }

  toJSON(): AppErrorData {
    return { code: this.code, message: this.message, ...(this.status !== undefined && { status: this.status }) };
  }

  static from(data: AppErrorData): AppError {
    return new AppError(data.code, data.message, data.status);
  }
}

// Error names thrown inside extensions (SDK errors) → app codes.
const EXTENSION_ERROR_CODES: Record<string, AppErrorCode> = {
  NetworkError: 'network',
  HttpError: 'http',
  CloudflareError: 'cloudflare',
  RateLimitedError: 'rate_limited',
  NotFoundError: 'not_found',
  ParseError: 'parse',
  NotImplementedError: 'not_implemented',
};

export function codeForExtensionError(name: string | undefined): AppErrorCode {
  return (name && EXTENSION_ERROR_CODES[name]) || 'extension';
}

const isCode = (value: unknown): value is AppErrorCode =>
  typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value);

export function toAppErrorData(error: unknown): AppErrorData {
  if (error instanceof AppError) return error.toJSON();
  if (typeof error === 'object' && error !== null && isCode((error as AppErrorData).code)) {
    const { code, message, status } = error as AppErrorData;
    return { code, message: String(message), ...(typeof status === 'number' && { status }) };
  }
  if (error instanceof Error) return { code: 'unknown', message: error.message };
  return { code: 'unknown', message: String(error) };
}

// Electron only carries `message` across `ipcRenderer.invoke`, so the payload rides inside it.
const IPC_MARKER = 'AppError:';

export function encodeIpcError(error: unknown): Error {
  return new Error(`${IPC_MARKER}${JSON.stringify(toAppErrorData(error))}`);
}

/** Recovers the typed error from a rejected `ipc.invoke` (the message is prefixed by Electron). */
export function decodeIpcError(error: unknown): AppErrorData {
  const message = error instanceof Error ? error.message : String(error);
  const at = message.indexOf(IPC_MARKER);
  if (at >= 0) {
    try {
      return toAppErrorData(JSON.parse(message.slice(at + IPC_MARKER.length)));
    } catch {
      // fall through
    }
  }
  return { code: 'unknown', message };
}
