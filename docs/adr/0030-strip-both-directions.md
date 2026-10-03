# 30. The strip reads on in both directions

Status: Accepted (2026-10-03)

## Context
The webtoon/vertical strip appended the next chapter but never the previous one, kept every chapter it had loaded, and the previous/next chapter keys reloaded the whole reader (a new session). After the strip had moved the URL to chapter 2, going back to the chapter the session began with did nothing, because the route took it for the same session.

## Decision
- `WebtoonView` prepends the previous chapter when the top comes into view, mirroring the append. Rows are keyed `chapterId:index`, so a row on top is kept in place by recording it (key + distance to the scroll position) before the segments change and restoring it in a layout effect (`captureAnchor`). Browser scroll anchoring is off for the strip.
- Only a window of chapters stays loaded: the one on screen and `STRIP_WINDOW` (2) on each side (`pruneSegments`). A chapter is only added at an end while the one on screen is within the window of that end, so pruning and loading never fight.
- Previous/next chapter first asks the strip (`useReaderPosition.jumpToChapter`) to scroll to a loaded chapter; only otherwise does it navigate and start a new session. First/last page act on the chapter on screen.
- The route starts a new session on any URL change that the strip did not cause (`followedChapterId`), also back to the starting chapter; the reader is keyed on a session counter.
- Paged modes (single/double) are unchanged: one chapter per page view.

## Consequences
- Progress, history and sessions already follow the chapter on screen, so nothing changes there. "Delete after read" can remove a downloaded chapter still visible above the reader; unchanged from before.
