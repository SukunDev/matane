import type { RegisteredExtension } from './registry';

/**
 * An extension implemented in main instead of the QuickJS sandbox (the local files source needs
 * the disk, which a sandboxed extension never gets). It answers the same `call`s a bundle would.
 */
export interface NativeExtension {
  /** The registry entry: origin `builtin`, an in-code manifest and no bundle. */
  entry: RegisteredExtension;
  call(sourceKey: string, method: string, args: unknown[]): Promise<unknown>;
}
