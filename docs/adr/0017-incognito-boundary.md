# 17. What incognito does and does not record

Status: Accepted (2026-09-24)

## Context
Incognito mode (BRAINSTORM.md §6.3) must reliably leave no reading trace, without every renderer call site having to remember it, and without surprising users who explicitly change their data while it is on.

## Decision
- The boundary is enforced **once, in main**, in `ReadingService`: while the `incognito` setting is on, `progress.save`, history updates and reading sessions (heartbeats) are dropped. The renderer keeps sending them unchanged.
- **Not recorded:** reading position (`last_page`, `page_offset`, `total_pages`), automatic "read" on the last page, history, reading sessions (statistics). A session that was open ends at the reader's next heartbeat.
- **Still applied:** explicit edits — mark read/unread, mark previous as read, chapter bookmarks, library and category changes, covers, per-manga settings, migration. They are the user's own actions, not reading activity.
- The setting persists across restarts, and is always visible when on: a labelled pill in the title bar and the reader's top bar, and a banner on the History page.

## Consequences
- A unit test checks the database (no progress, history or session rows while incognito); E2E tests check history and chapter progress through IPC, and the Phase 2c live check read the database of a real session.
- Page images read in incognito still enter the image cache; the cache is not considered reading history.
