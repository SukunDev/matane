# 36. MyAnimeList: the code flow with PKCE, and logins that are renewed

Status: Accepted (2026-10-04)

## Context
AniList ([0035](0035-trackers.md)) gives a token that lasts a year and needs no renewal. MyAnimeList's OAuth2 is different: an authorization **code** is exchanged for an access token and a **refresh token** (verified against MyAnimeList's own authorization guide: PKCE with only the `plain` method, no client secret for an app of type "other", loopback redirects allowed, access and refresh tokens valid for 31 days at the time of writing). The request details (a `PUT` of a form to `/manga/{id}/my_list_status`, dates as `yyyy-MM-dd`, a search of at least 3 letters) were checked against Mihon's open client, since the API reference page cannot be fetched whole.

## Decision
- **One loopback, two flows.** `loopbackAuthorize` resolves with whatever the redirect carried: the `access_token` of the implicit grant (through the fragment-forwarding page) or the `code` of the code flow (straight in `/callback?code=…`). The `state` is always required for the code flow, which sends it back. `logins.ts` holds the two flows: `anilistLogin`, and `malLogin`, which makes the PKCE verifier (the challenge is the verifier, as `plain` says), opens the address with the port the server really listens on as `redirect_uri`, and exchanges the code.
- **Credentials are an access token and, when there is one, a refresh token**, sealed together as JSON in the same column. A login stored as a bare token (before refresh existed) is still read. `TrackerClient.refresh` exists only for trackers that need it.
- **Renewed before use.** A token that runs out within a minute is renewed first; a token the tracker refuses is renewed once and the request repeated; only a refused refresh token (or a second refusal) marks the login expired and drops the refresh token, so nothing retries until a new login. Many requests at once share one renewal. A renewal that fails for another reason (no network) keeps the login. An expired access token is not "expired" in Settings while a refresh token can make the next.
- **No secret.** `client_secret` is never sent or stored; a test checks that the token request carries none. MyAnimeList's client id is a build setting (`client-ids.ts`, `null` until one is registered, `MATANE_MAL_CLIENT_ID` for tests): without it the tracker says so in Settings → Tracking and cannot connect.
- **Fields MyAnimeList cannot take.** Scores are whole numbers (0 removes one), and a date cannot be cleared through the API, so a cleared date is left out of the update.

## Consequences
- A third kind of tracker (Kitsu's password grant with refresh, MangaUpdates' session token) fits the same manager: `refresh` is optional.
- The search needs three letters, as MyAnimeList does; the dialog shows its message for shorter titles.
- Until a client id is registered the code flow is tested end to end only against a fake MyAnimeList.
