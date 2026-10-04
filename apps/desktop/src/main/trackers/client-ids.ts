/**
 * The app registrations Matane logs in with. A client id is public (it is part of the address the
 * browser opens); a tracker without one cannot log in and says so in Settings → Tracking. The
 * `MATANE_*_CLIENT_ID` variables override them for tests, and set but empty switch one off.
 *
 * Client *secrets* are never kept here: the login uses the implicit grant, which needs none.
 */
export const ANILIST_CLIENT_ID: string | null = '52734';

export const anilistClientId = (env: NodeJS.ProcessEnv = process.env): string | null =>
  'MATANE_ANILIST_CLIENT_ID' in env ? env['MATANE_ANILIST_CLIENT_ID'] || null : ANILIST_CLIENT_ID;

/**
 * Where AniList sends the browser after login: the redirect URL registered for the app. It is fixed,
 * so a port that is taken makes the login fail with a message instead of working some other way.
 */
export const ANILIST_LOOPBACK_PORT = 47653;
export const loopbackRedirect = (port: number) => `http://127.0.0.1:${port}/callback`;
