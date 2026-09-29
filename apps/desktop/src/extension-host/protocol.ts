import type { MigratedUrls, RawImageTransform } from '@manga-reader/extension-runtime';
import type { HttpRequest, HttpResponse, Page, UrlKind } from '@manga-reader/extension-sdk';
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
  /** `transformImage` with the fetched bytes (sent as binary, not JSON). */
  transformImage(params: {
    extensionId: string;
    sourceKey: string;
    page: Page;
    bytes: Uint8Array;
    prefs: Record<string, unknown>;
  }): RawImageTransform;
  migrateUrls(params: {
    extensionId: string;
    sourceKey: string;
    items: { url: string; kind: UrlKind }[];
    fromVersion: string;
    prefs: Record<string, unknown>;
  }): MigratedUrls;
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
