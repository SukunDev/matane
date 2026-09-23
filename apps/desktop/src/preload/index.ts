import type { IpcApi } from '@manga-reader/shared';
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@manga-reader/shared/ipc/channels';
import { type IpcRendererEvent, contextBridge, ipcRenderer } from 'electron';

const invokeChannels = new Set<string>(INVOKE_CHANNELS);
const eventChannels = new Set<string>(EVENT_CHANNELS);

const api: IpcApi = {
  invoke: ((channel: string, input?: unknown) => {
    if (!invokeChannels.has(channel)) return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
    return ipcRenderer.invoke(channel, input);
  }) as IpcApi['invoke'],
  on: ((channel: string, listener: (payload: unknown) => void) => {
    if (!eventChannels.has(channel)) throw new Error(`Unknown IPC event: ${channel}`);
    const handler = (_event: IpcRendererEvent, payload: unknown): void => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }) as IpcApi['on'],
};

contextBridge.exposeInMainWorld('api', api);
