# 37. Password logins: Kitsu and MangaUpdates

Status: Accepted (2026-10-06)

## Context
AniList and MyAnimeList log in through the browser ([0035](0035-trackers.md), [0036](0036-mal-code-flow-and-refresh.md)). Kitsu and MangaUpdates do not offer that to apps like Matane: Kitsu uses OAuth's password grant, MangaUpdates a login call that returns a session token. Both were checked against Mihon's open clients (Kitsu's GraphQL queries and mutations, MangaUpdates' endpoints and list ids); Kitsu's own API documentation and schema could not be fetched (Kitsu answers scripts with a Cloudflare challenge, which was not worked around).

## Decision
- **A second login kind.** `TrackerClient.loginWithPassword` marks a tracker that logs in with a username and password; `TrackerInfo.login` says `browser` or `password` (and `redirectUrl` is null for the latter). Settings → Tracking shows a username and password form instead of Connect. The password goes through `trackers.connectWithPassword` to the tracker and nowhere else: it is not stored, not logged, and the form empties it as soon as it was used, whatever the answer. What is kept is the login that comes back, sealed like any other. A wrong password is the user's to fix (a plain error, not "login expired"); a refresh token that stops working is `TrackerAuthError`, as before.
- **Kitsu** (`kitsu.ts`) speaks GraphQL (`https://kitsu.app/api/graphql`) with a Bearer token from `https://kitsu.app/api/oauth/token` (password and refresh grants, renewed by the machinery of 0036). The grant needs an app id and secret, which Kitsu publishes for this and every open-source Kitsu client uses; they are in `client-ids.ts` with a comment that says so (they identify an app and protect no account). Kitsu's mutations take the whole entry, so `save` first reads the entry (`findMangaById { myLibraryEntry }`), merges the patch over it and creates (`create`, no dates) or updates it; dates are written into the query as literals, so the date scalar's name never has to be known, and `null` clears one. Ratings are 2 to 20 (halves of a 10-point scale). Statuses: `CURRENT`, `PLANNED`, `COMPLETED`, `ON_HOLD`, `DROPPED`.
- **MangaUpdates** (`mangaupdates.ts`) logs in with `PUT /v1/account/login` and keeps the `session_token` (no expiry, no refresh: a refused session means a new login). A manga is on one of its lists (0 reading, 1 wish, 2 complete, 3 unfinished, 4 on hold), progress is the chapter of that list entry, and the rating (1 to 10, in tenths) is a separate call (`PUT`, or `DELETE` to remove it). It has no dates, so they are ignored.
- **A Cloudflare challenge is an error, not a puzzle.** Kitsu is behind one. A request that is answered with `cf-mitigated: challenge` fails with a message that says so, and the update is retried later like any failure.

## Consequences
- Four trackers behind one manager; two ways to log in; one queue.
- Not tried against the real services: the clients are tested against fakes built from the sources above. In particular, whether Kitsu's challenge lets Electron's network stack through, the exact name of Kitsu's update input (`id`), and MangaUpdates' answer to a wrong password are assumptions to confirm on first use.
- Kitsu entries cost two requests per update (read, then write); the queue sends few.
