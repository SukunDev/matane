import type { IpcApi } from '@manga-reader/shared';

declare global {
  interface Window {
    api: IpcApi;
  }
}
