# 33. Local files source

Status: Accepted (2026-10-04)

## Context
Readers keep manga on disk too: CBZ files from other apps, scans, their own downloads. Mihon has a "Local source" for this. Matane's sources are extensions in a QuickJS sandbox ([0003](0003-quickjs-extension-sandbox.md)) that never touch the disk, so a sandboxed extension cannot be the answer, and a separate "open a file" mode would not get progress, history, categories, the reader settings and the update check that a source gets.

## Decision
- **A source of its own, native, in main.** `local` is an extension with one source (`local/files`) that implements the `Source` calls in TypeScript (`apps/desktop/src/main/local/`), registered with the same registry and `ExtensionService` as every extension (`NativeExtension`, origin `builtin`, no bundle). `ExtensionService.call` hands its calls to the native extension instead of the host; image transforms and url migrations do not apply to it. Its id cannot be taken by a bundle.
- **Layout.** `<folder>/<manga>/<chapter>`, where a chapter is a `.cbz` or `.zip` file or a sub-folder of images; images right in the manga folder are one chapter (a one-shot). `cover.jpg|png|webp` is the cover, else the first page of the first chapter. `ComicInfo.xml` (next to the chapters, or inside the first archive) fills in title, author, artist, summary, genres and "manga". Chapters are in natural order. `.cbr`, `.rar` and `.7z` are not read.
- **Urls are relative to the folder** (`<manga>`, `<manga>/<chapter>`), so moving or re-choosing the folder keeps library, history and backups valid ([0029](0029-backup-and-restore.md)).
- **Reading reuses the download reader.** Pages come from `DownloadReader` (random access in a CBZ, file by file in a folder), served ahead of the network like downloads ([0019](0019-download-format.md)): `LocalStore` answers the page list and page bytes for local chapters, and `ImageService` reads covers from disk. Nothing is downloaded or cached for them, and download actions are hidden (and refused in main) for local manga.
- **Nothing outside the folder.** Every path goes through `safeJoin`: no `..`, no absolute paths, and symlinks that lead outside are refused (and left out of listings). Hidden entries are skipped; `ComicInfo.xml` is limited to 256 KB.
- **Setting.** `local.folder` (Settings → Browse & extensions → Local files), `null` until chosen; the source then says so. The source's language is `all`, so content-language filters never hide it. Cover urls `local:cover/<manga>?m=<mtime>` are accepted by the manifest validator; only this source reads them.

## Consequences
- The local source is browsed, searched, added to the library, updated (a new file shows up after a refresh or the library update check), read and backed up like any other source.
- No web page: "Open in browser" is hidden.
- A library moved to another computer shows its local manga as unreadable until the folder is chosen there.
- Native sources are a new, deliberately small seam; extensions stay sandboxed.
