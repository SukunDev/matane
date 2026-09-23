// Typed errors that cross the sandbox boundary by `name` (BRAINSTORM.md §5.5).

export class ExtensionError extends Error {
  override name = 'ExtensionError';
}
export class NetworkError extends ExtensionError {
  override name = 'NetworkError';
}
export class HttpError extends ExtensionError {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    message = `HTTP ${status}`,
  ) {
    super(message);
  }
}
export class CloudflareError extends ExtensionError {
  override name = 'CloudflareError';
}
export class RateLimitedError extends ExtensionError {
  override name = 'RateLimitedError';
}
export class NotFoundError extends ExtensionError {
  override name = 'NotFoundError';
}
export class ParseError extends ExtensionError {
  override name = 'ParseError';
}

export const EXTENSION_ERROR_NAMES = [
  'ExtensionError',
  'NetworkError',
  'HttpError',
  'CloudflareError',
  'RateLimitedError',
  'NotFoundError',
  'ParseError',
] as const;
export type ExtensionErrorName = (typeof EXTENSION_ERROR_NAMES)[number];
