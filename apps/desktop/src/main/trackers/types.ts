import type { TrackPatch, TrackSearchResult, TrackStatus, TrackerService } from '@manga-reader/shared';

/** What a tracker holds for one manga of a user: the same fields whatever the service. */
export interface RemoteEntry {
  remoteId: string;
  remoteUrl: string | null;
  remoteTitle: string | null;
  status: TrackStatus | null;
  /** 0 to 10. */
  score: number | null;
  progress: number | null;
  startedAt: number | null;
  finishedAt: number | null;
}

/** What a login gives: the token, and (for trackers that expire it) the way to get the next one. */
export interface TrackerLogin {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds the access token lasts, when the tracker says. */
  expiresInSec: number | null;
}

export interface TrackerViewer {
  userId: string;
  username: string;
}

/** One service (AniList, …): everything the app asks of it, with the token passed in. */
export interface TrackerClient {
  readonly service: TrackerService;
  readonly name: string;
  viewer(token: string): Promise<TrackerViewer>;
  /**
   * Logs in with the tracker's own username and password, for trackers that have no browser login. The
   * password is only sent to the tracker; what is kept is the login that comes back.
   */
  loginWithPassword?(username: string, password: string): Promise<TrackerLogin>;
  /** A new login from a refresh token; only for trackers whose tokens expire. */
  refresh?(refreshToken: string): Promise<TrackerLogin>;
  search(token: string, query: string): Promise<TrackSearchResult[]>;
  /** The user's entry for a manga, or null when it is not on their list (nothing is created). */
  getEntry(token: string, remoteId: string): Promise<RemoteEntry | null>;
  /** Creates or updates the entry with the given fields; fields left out stay as they are. */
  save(token: string, remoteId: string, patch: TrackPatch): Promise<RemoteEntry>;
}

/** The token is no longer accepted (expired, revoked): the user has to connect again. */
export class TrackerAuthError extends Error {
  override name = 'TrackerAuthError';
}

/** Too many requests: try again after `retryAfterMs`. */
export class TrackerRateLimitError extends Error {
  override name = 'TrackerRateLimitError';
  constructor(
    message: string,
    readonly retryAfterMs: number,
  ) {
    super(message);
  }
}

/** The tracker answered, and the answer was no (a bad request, a missing entry): trying again will not help. */
export class TrackerRequestError extends Error {
  override name = 'TrackerRequestError';
}
