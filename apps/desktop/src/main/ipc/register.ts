import {
  EVENT_CHANNELS,
  type EventChannel,
  type EventPayload,
  INVOKE_CHANNELS,
  type InvokeChannel,
  type InvokeInput,
  type InvokeOutput,
  invokeContract,
} from '@manga-reader/shared';
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from 'electron';
import { z } from 'zod';

export type IpcHandlers = {
  [C in InvokeChannel]: (
    input: InvokeInput<C>,
    event: IpcMainInvokeEvent,
  ) => InvokeOutput<C> | Promise<InvokeOutput<C>>;
};

/** Only our own renderer (dev server or packaged file) may call into main. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  if (!url) return false;
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  return url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl));
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  for (const channel of INVOKE_CHANNELS) {
    const schema = invokeContract[channel].input;
    const handler = handlers[channel] as (input: unknown, event: IpcMainInvokeEvent) => unknown;
    ipcMain.handle(channel, async (event, raw: unknown) => {
      if (!isTrustedSender(event)) throw new Error(`Rejected IPC call to ${channel} from untrusted sender`);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new Error(`Invalid input for ${channel}: ${z.prettifyError(parsed.error)}`);
      return handler(parsed.data, event);
    });
  }
}

export function broadcast<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
  if (!(EVENT_CHANNELS as readonly string[]).includes(channel)) return;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}
