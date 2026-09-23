import type { HttpRequest, HttpResponse } from '@manga-reader/extension-sdk';
import type { ExtensionManifest } from '@manga-reader/extension-sdk/manifest';

/** Methods the extension host serves (main → host). */
export type HostMethods = {
  call(params: {
    extensionId: string;
    sourceKey: string;
    method: string;
    args: unknown[];
    /** Stored preference values; the host fills in defaults. */
    prefs: Record<string, unknown>;
  }): unknown;
  unload(params: { extensionId: string }): void;
  stats(params: Record<string, never>): { extensionId: string; memoryBytes: number }[];
};

export type StorageOp = 'get' | 'set' | 'remove';

/** Methods main serves to the extension host (host → main). */
export type MainMethods = {
  /** The host loads runtimes lazily and asks for the bundle when first needed. */
  getExtension(params: { extensionId: string }): { code: string; manifest: ExtensionManifest };
  http(params: { extensionId: string; request: HttpRequest }): HttpResponse;
  storage(params: { extensionId: string; op: StorageOp; key: string; value?: unknown }): unknown;
  log(params: { extensionId: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string }): void;
};

export interface HostInfo {
  appName: string;
  appVersion: string;
}
