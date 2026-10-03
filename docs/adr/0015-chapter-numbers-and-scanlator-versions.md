# 15. Read status per chapter number, one version per number

Status: Accepted (2026-09-24)

## Context
Sources often list the same chapter several times, once per scanlation group (Example Source: Kage no Jitsuryokusha has six groups; chapter 82 exists by two of them). Mihon shows every version but counts them separately, so reading one version leaves the others "unread" and the unread badge inflates. Navigation ("next chapter", "continue reading") must also pick *one* version (BRAINSTORM.md §6.2).

## Decision
- **Read status is per chapter number.** Marking a chapter read or unread marks every chapter with the same `number` in that manga, in one transaction. Unread counts, "reading" filters and the library badge count distinct numbers (chapters without a number count one by one).
- **One version per number when moving on** (`pickVersion` in `packages/shared/src/chapters.ts`, used by the reader, the webtoon strip, "continue reading" in main, and migration):
  1. the highest group in the manga's scanlator priority (`scanlator_prefs_json.priority`), if any released it;
  2. else the group of the chapter read before;
  3. else the newest upload (source order breaks ties).
- **Hidden groups** (`scanlator_prefs_json.hidden`, "" = no group) disappear from the chapter list, unread counts (SQL `json_each`), history's "has unread" flag, "continue reading" and navigation.
- A priority only exists once the user reorders groups; hiding groups alone keeps rule 2–3.

## Consequences
- The rules live in one Zod-free module shared by main and renderer, with unit tests for every step.
- Migration carries read status and chapter bookmarks by number to every version in the new source.
- Library queries join a `hidden` CTE; with 1,000 manga / 50,000 chapters `library.list` stays around 70–80 ms.
