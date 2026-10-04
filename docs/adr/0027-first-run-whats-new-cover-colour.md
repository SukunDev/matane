# 27. First run, What's new and cover colours

Status: Accepted (2026-10-01)

## Context
Phase 5 adds a first-run setup, release notes after an update, and a detail header tinted by the cover (docs/BRAINSTORM.md §6.6). Each needs to tell a new profile from an upgraded one, or to remember something about a cover that can change.

## Decision
- **New or upgraded profile**: `runMigrations` reports `fresh` when the database had no migration applied before this start. That is the only signal; nothing is guessed from the library.
- **First-run setup**: the app setting `onboarding.done`. On a start without it, an upgraded profile is marked done; a new one is sent to `/onboarding` by the `_app` route guard. Every step saves as it goes, so "Skip setup" or quitting halfway loses nothing. Tests set `MATANE_E2E_NO_ONBOARDING=1` (except the onboarding test).
- **What's new**: a plain settings key `app.whatsNewSeen` (not an app setting) holds the last version whose notes were shown or skipped. A new profile starts with the running version; an upgraded one without the key sees the notes once. The notes are `CHANGELOG.md`, bundled (`?raw`) and read by version from its `## <version> — <date>` sections (the format `release.yml` already uses); a version without a section shows nothing and counts as seen.
- **Cover colour**: `manga.cover_color` stores `#rrggbb <cover key>`; the colour counts only while the cover key (custom cover path or source URL) is still the one on screen, so a new cover needs no reset hook. It is measured in main when a cover is served (one at a time, in the background) and for library manga a few seconds after start. The colour is the most prominent hue among the cover's colourful pixels (48 px thumbnail, 24 hue bins weighted by chroma), so white backgrounds and black line art do not win; a cover without colour gives no tint.
- **Tint**: the renderer turns the colour into the header's `--app-accent`/`--app-on-accent` (the theme is `@theme inline`, so utilities read those directly): pastel on dark flavors with crust text, deep on Latte with base text, lightness moved until the contrast is at least 4.5:1.

## Consequences
- A profile copied from another machine counts as upgraded (its database has migrations), which is what its owner expects.
- Release notes must be in `CHANGELOG.md` under the exact version before tagging, or What's new stays silent for that version.
