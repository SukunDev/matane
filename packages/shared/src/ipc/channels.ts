// Channel names only (no zod), so the sandboxed preload can allowlist them cheaply.
export const INVOKE_CHANNELS = [
  'app.getInfo',
  'app.getLocale',
  'window.minimize',
  'window.toggleMaximize',
  'window.close',
  'window.isMaximized',
  'settings.get',
  'settings.set',
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = ['window.maximizeChanged', 'settings.changed'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];
