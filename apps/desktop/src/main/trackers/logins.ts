import { ANILIST_AUTHORIZE } from './anilist';
import { loopbackRedirect } from './client-ids';
import { type MalClient, malAuthorizeUrl, newCodeVerifier } from './mal';
import { loopbackAuthorize } from './oauth';
import type { TrackerLogin } from './types';

/** What a login needs from the app: where to listen, how to open the browser, and a way to watch. */
export interface LoginContext {
  port: number;
  open: (url: string) => Promise<void> | void;
  onListening?: (port: number) => void;
  signal: AbortSignal;
}

/** AniList's implicit grant: the token comes straight back in the redirect. */
export async function anilistLogin(context: LoginContext, clientId: string): Promise<TrackerLogin> {
  const params = await loopbackAuthorize({
    ...context,
    // AniList's documentation does not say that it returns `state`: checked only when it does.
    requireState: false,
    authorizeUrl: (state) =>
      `${ANILIST_AUTHORIZE}?${new URLSearchParams({ client_id: clientId, response_type: 'token', state })}`,
  });
  const seconds = Number(params['expires_in']);
  return {
    accessToken: params['access_token']!,
    refreshToken: null,
    expiresInSec: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
  };
}

/** MyAnimeList's code flow with PKCE: the redirect brings a code, which is exchanged for the tokens. */
export async function malLogin(context: LoginContext, clientId: string, client: MalClient): Promise<TrackerLogin> {
  const verifier = newCodeVerifier();
  let redirectUri = '';
  const params = await loopbackAuthorize({
    ...context,
    requireState: true,
    authorizeUrl: (state, port) => {
      redirectUri = loopbackRedirect(port);
      return malAuthorizeUrl({ clientId, verifier, state, redirectUri });
    },
  });
  return client.exchange(params['code']!, verifier, redirectUri);
}
