# 18. Chapter bookmarks only, like Mihon

Status: Accepted (2026-09-24)

## Context
docs/BRAINSTORM.md §6.3 first planned two kinds of bookmarks: chapter bookmarks and page bookmarks with a note, shown in a "Bookmarks" tab on the manga page and on a global Bookmarks page. Phase 2c built both; in review the owner preferred Mihon's simpler model.

## Decision
- Only **chapter bookmarks** (`chapters.bookmarked`): a toggle in the reader's top bar and on every chapter row (also the row menu and multi-select), a "Bookmarked" filter on the chapter list, and a "Bookmarked" library filter (manga with at least one bookmarked chapter).
- No page bookmarks, no Bookmarks tab and no global Bookmarks page (nor its sidebar entry). The `page_bookmarks` table is dropped in migration `0002_drop_page_bookmarks`.
- Migration carries chapter bookmarks by chapter number; backups (Phase 5) include them with the chapters.

## Consequences
- Less UI and one table fewer; the reader's bookmark icon has a single meaning.
- Page bookmarks can come back later as a separate feature if users ask for them.
