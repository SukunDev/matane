import type { App, Session } from 'electron';

/**
 * Electron grants every web permission (camera, location, notifications, …) unless a handler says
 * otherwise. Matane's windows never need one, except copying text from the app's own UI.
 */
export const APP_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export type PermissionSession = Pick<
  Session,
  'setPermissionRequestHandler' | 'setPermissionCheckHandler' | 'setDevicePermissionHandler'
>;

/** Refuses every permission, device and request not in `allowed`. */
export function restrictPermissions(ses: PermissionSession, allowed: ReadonlySet<string>): void {
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
  ses.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
  ses.setDevicePermissionHandler(() => false);
}

/**
 * Every session starts with no permissions at all, so pages an extension sends the Cloudflare
 * window to (`persist:ext-<id>`) cannot ask for any. The default session (the app's own window)
 * is then given {@link APP_PERMISSIONS} with `restrictPermissions` once the app is ready. Call
 * this before `app.whenReady()`.
 */
export function denyPermissionsByDefault(app: Pick<App, 'on'>): void {
  app.on('session-created', (ses) => restrictPermissions(ses, new Set()));
}
