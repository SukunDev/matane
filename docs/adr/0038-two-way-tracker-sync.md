# 38. Two-way tracker sync

Status: Accepted (2026-10-06)

## Context
Until now trackers only received what was read here ([0035](0035-trackers.md)). A manga read on a phone, or an entry edited on the tracker's website, never came back. The sync has to bring it back without ping-pong: what a tracker says must never be sent to it again as if it were news, and a change made here that is still waiting to be sent must not be overwritten by an older answer.

## Decision
- **One pure rule, `reconcile()`** (`trackers/reconcile.ts`), given what is read here, what the link held after the last sync, the tracker's entry now, and whether a change is queued. Progress only moves forward, on both sides: a tracker that is ahead gets its chapters marked read here; one that is behind gets an update (status to "reading" unless it is completed, a start date if it has none; a completed entry is never touched). Status, score and dates are the tracker's: they are taken over into the link, never sent back. When a change made here is still queued, nothing is decided for that link; the queue goes first.
- **No bounce.** Chapters a tracker said were read are marked with `ProgressRepository.markReadUpTo`, which does not tell `onRead`, so they are never queued for the tracker. Even if it did, the entry already holds that number and nothing is sent for it (progress never lowers).
- **A count, not a chapter.** A tracker holds a number. It is matched with the chapter numbers (up to that number); a manga whose chapters have none counts the oldest chapters. A number beyond the chapters that exist marks all that exist and is looked at again next time, which changes nothing.
- **When:** a minute or so after the app opens (20 s), when a check of the library or a category ran to its end (not for one manga, not cancelled), and with **Sync now** (all trackers, one tracker in Settings → Tracking, or one manga in its dialog). Automatic runs fail quietly and wait for the next trigger; the manual one says what went wrong (offline, a login that expired). A sync sends what is queued first, runs one at a time, and stops asking a tracker that does not answer (the other trackers go on).
- **Off switches** keep chapters from being marked read here: per link (`manga_tracks.syncBack`, only kept here, in backups) and per tracker (`settings.tracking.pull`, on unless switched off). They do not stop reading from being sent, which is the point of tracking.
- **Incognito** still blocks sending, also from a sync: what was read then is not reported. Bringing chapters in is allowed: it only changes this library.
- An entry deleted on the tracker is skipped; the link stays so the user can unlink it.

## Consequences
- Reading on two devices keeps both lists right as long as the library sees the tracker's number again at the next sync.
- The cost is one `getEntry` per linked manga and tracker per sync (AniList and MyAnimeList allow plenty; a long library makes the first sync slow, one request at a time).
- A tracker that lowers a progress on purpose (the user resets an entry to read again) is brought forward again by what was read here: progress never lowers on either side.
- Importing links from a Mihon backup is not part of this.
