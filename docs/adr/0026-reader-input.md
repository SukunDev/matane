# 26. Reader input: one keymap, pointer gestures, zoom per view

Status: Accepted (2026-10-01)

## Context
Phase 5 makes reader keys remappable and adds zoom, pan and touch gestures (BRAINSTORM.md §6.1). Keys used to be hard-coded in three separate `keydown` listeners (reader, page view, strip), and there was no zoom at all.

## Decision
- **Keys are actions.** `READER_ACTIONS` and `DEFAULT_KEYMAP` live in `@manga-reader/shared/reader`; a key is named by `keyId` (modifiers first, letters upper case, Shift only for named keys: `Ctrl+=`, `Shift+Space`). Settings store only the actions changed from the defaults (`reader.keymap`), so new defaults reach everyone who did not change that action.
- **One listener.** ReaderPage owns the only `keydown` listener and maps a key to an action; the view on screen lends the page actions (turn, scroll, zoom) through a ref in `ReaderKeysContext`, the reader handles the rest (chapter, full screen, menu, exit, auto-scroll). A key bound to an action is `preventDefault`ed, which also keeps Ctrl+=/−/0 from zooming the whole window.
- **"Page left/right" follow the screen**, "next/previous page" the story: in a right-to-left manga the left arrow goes forward; in the strip left/right scroll a screen up/down.
- **Gestures without a library**: a small `GestureTracker` turns pointer samples into pan, pinch, swipe and tap (unit-tested with synthetic samples); `useGestures` feeds it from native pointer and non-passive wheel listeners. Page modes use `touch-action: none` and do their own panning; the strip keeps native touch scrolling (`pan-x pan-y`) and uses pinch and Ctrl+wheel only for zoom.
- **Zoom per view**: page modes apply CSS `zoom` (1–4×) to the spread, keep the point under the cursor in place and reset on page turn; double-click zooms only in the middle zone, where a single click merely toggles the bars, so it never fights with turning pages. The strip zooms by widening the column (0.5–3×), keeping the middle of the screen in place.
- **Filters** are a CSS variable on the reader (`--reader-filter`) applied to `[data-page]` only, so bars and transition cards stay untouched.

## Consequences
- Adding a reader action means a new entry in `READER_ACTIONS`/`DEFAULT_KEYMAP`, a label, and a handler in the view or the reader.
- Pinch on a touch screen in the strip depends on the browser delivering both pointers while it scrolls natively; trackpads (Ctrl+wheel) and keys always work.
