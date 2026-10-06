/**
 * The app registrations Matane logs in with. A client id is public (it is part of the address the
 * browser opens); a tracker without one cannot log in and says so in Settings → Tracking. The
 * `MATANE_*_CLIENT_ID` variables override them for tests, and set but empty switch one off.
 *
 * Client *secrets* are never kept here: AniList's implicit grant and MyAnimeList's PKCE need none.
 */
export const ANILIST_CLIENT_ID: string | null = '52734';
/** MyAnimeList: an app of type "other" with the redirect URL shown in Settings → Tracking (`http://127.0.0.1:47654/callback`). */
export const MAL_CLIENT_ID: string | null = '48c2a705d9d1222c537cb382cff07717';

export const anilistClientId = (env: NodeJS.ProcessEnv = process.env): string | null =>
  'MATANE_ANILIST_CLIENT_ID' in env ? env['MATANE_ANILIST_CLIENT_ID'] || null : ANILIST_CLIENT_ID;

export const malClientId = (env: NodeJS.ProcessEnv = process.env): string | null =>
  'MATANE_MAL_CLIENT_ID' in env ? env['MATANE_MAL_CLIENT_ID'] || null : MAL_CLIENT_ID;

/**
 * Kitsu's password login needs an app id and secret, which Kitsu publishes for exactly this and which
 * every open-source Kitsu client uses (the same values as Mihon's). They identify an app to Kitsu;
 * they protect no account, and nothing of anyone's is kept here.
 */
export const KITSU_CLIENT_ID = 'dd031b32d2f56c990b1425efe6c42ad847e7fe3ab46bf1299f05ecd856bdb7dd';
export const KITSU_CLIENT_SECRET = '54d7307928f63414defd96399fc31ba847961ceaecef3a5fd93144e960c0e151';

/**
 * Where AniList sends the browser after login: the redirect URL registered for the app. It is fixed,
 * so a port that is taken makes the login fail with a message instead of working some other way.
 */
export const ANILIST_LOOPBACK_PORT = 47653;
export const MAL_LOOPBACK_PORT = 47654;
export const loopbackRedirect = (port: number) => `http://127.0.0.1:${port}/callback`;
