// Ambient declarations for the globals the host injects into the sandbox (BRAINSTORM.md §5.5).
// Extensions get them with `import '@manga-reader/extension-sdk/globals'` (types only).

import type { HtmlElement, HttpRequest, HttpResponse } from './http';

declare global {
  const http: {
    /** Never throws on HTTP status; check `status` yourself. */
    request<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>>;
    /** Throws `HttpError` for non-2xx responses. */
    get<T = string>(url: string, options?: Omit<HttpRequest, 'url' | 'method'>): Promise<HttpResponse<T>>;
    /** Throws `HttpError` for non-2xx responses. */
    post<T = string>(
      url: string,
      body: HttpRequest['body'],
      options?: Omit<HttpRequest, 'url' | 'method' | 'body'>,
    ): Promise<HttpResponse<T>>;
  };
  const html: {
    load(body: string, options?: { baseUrl?: string; xml?: boolean }): HtmlElement;
  };
  const storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  const prefs: {
    get<T = unknown>(key: string): T | undefined;
  };
  const log: {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
  const crypto: {
    md5(text: string): string;
    sha1(text: string): string;
    sha256(text: string): string;
  };
  const base64: { encode(text: string): string; decode(text: string): string };
  const utf8: { encode(text: string): number[]; decode(bytes: number[]): string };
  const timers: { sleep(ms: number): Promise<void> };
  /** Information about the running host, e.g. for a descriptive User-Agent. */
  const host: { appName: string; appVersion: string; apiVersion: number };
}

export {};
