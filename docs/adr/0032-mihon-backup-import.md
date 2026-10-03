# 32. Importing Mihon/Tachiyomi backups: sources matched by Mihon id or name, merge only

Status: Accepted (2026-10-04)

## Context
People coming from Mihon or Tachiyomi have a library in a `.tachibk` file. Matane's own backup (ADR 0029) is a different format, and its sources are different: a Matane source is `<extensionId>/<key>`, a Mihon source is a Long.

## Decision
- **Format**: a `.tachibk` is gzip around a protobuf `Backup` message. A small decoder in `main/backup/mihon.ts` reads the fields Matane has a place for (manga, chapters, history, categories, source names) and skips the rest; no dependency. The format is recognised by content (a zip is a Matane backup, anything else is tried as Mihon), not by extension, and an unpacked protobuf file works too. Mihon leaves default values out of the file, so an absent `favorite` means true.
- **Sources**: Mihon's source id is the first 8 bytes of `MD5("<name in lower case>/<lang>/<versionId>")` as a positive Long. Each installed source's id is computed that way (version ids 1–10) and compared; a source whose id is not found but whose name (any case) is shared by exactly one installed source matches by name. The restore dialog lists every source of the backup with a dropdown (installed sources, or "Skip"), pre-filled with the match, so the user can fix or add matches. Manga whose source is skipped are not imported and are listed in the summary. For a source nothing installed matches, the dialog offers an **Install** button when a repository has an extension that looks like it (the same rules applied to the extension's name and languages, ignoring a "Tachiyomi: " prefix; a name shared by several extensions is not guessed). Installing opens the usual install dialog, and the preview matches again afterwards. Only sources of installed extensions can be a target: a manga needs a source row, and Matane cannot know the extension id of one that is not installed.
- **URLs are taken as they are.** A port of an extension that keeps the site's paths matches directly; one that does not will show its new chapters apart from the imported ones. Matching by chapter number on refresh was left out.
- **Conversion**: the file becomes an ordinary `Backup` object and goes through `restoreBackup` (merge, batches, progress, idempotent). Favourites go into the library, the others come in as history entries (`inLibrary = false`). Status: ongoing, completed (also "publishing finished"), cancelled, hiatus; "licensed" becomes unknown. Chapter number −1 becomes none. Mihon keeps no time for "read": a read chapter gets the time of its history entry, else the latest history time of the manga, else the import time. Each history entry gives the manga's history (the newest) and, when it has a reading time, one reading session ending at `lastRead` (so statistics fill in; the same file imported again adds nothing).
- **Merge only**: no "Replace", no app settings. Categories are matched by name; a manga's categories come from Mihon's category `order` values.
- **Not imported**: trackers (not in the app yet), extension repositories (their signing keys differ), preferences and app settings, reader mode, scanlator exclusions.

## Consequences
- Importing is only as good as the match between the user's installed extensions and the sources in the backup; the unmatched ones are reported, not lost, and a second import after installing more extensions fills in the rest.
- The preview and restore API carry the source list and a `sourceMap` (`BackupPreview.mihon`, `backup.restore`); the restore result has `unmatched`.
