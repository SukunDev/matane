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
  'extensions.list',
  'extensions.loadDevFolder',
  'extensions.removeDevFolder',
  'extensions.reload',
  'extensions.preferences',
  'extensions.setPreference',
  'sources.list',
  'sources.info',
  'sources.filters',
  'sources.browse',
  'sources.resolveUrl',
  'sources.solveChallenge',
  'manga.get',
  'manga.refresh',
  'chapters.list',
  'chapter.pages',
  'requests.cancel',
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = [
  'window.maximizeChanged',
  'settings.changed',
  'db.changed',
  'cloudflare.status',
] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];
