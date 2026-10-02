# Backup and restore

A backup is a single file, `matane-backup-YYYY-MM-DD.zip`. It contains your library, categories, chapter read status, bookmarks and progress, history, reading statistics, per-manga reader settings, custom covers, repositories, the list of installed extensions with their settings, and the app settings.

It does **not** contain downloaded chapters (they stay in your download folder), caches, or passwords.

## Making backups

**Settings → Data & storage → Backup:**

- **Back up now** writes a backup to the backup folder.
- **Automatic backup:** daily (default), weekly or off. The last 7 automatic backups are kept; a backup that was missed while Matane was closed runs soon after it opens.
- **Backup folder:** by default inside the app data folder. A folder synced by Syncthing, Dropbox or OneDrive brings your backups to your other computers.

## Restoring

**Restore…** (or **Restore** next to a recent backup) shows what the backup holds first, then asks how:

- **Merge** (recommended): combine with what is already here. A chapter is read if it is read in either; the furthest progress wins; categories are joined; nothing is removed. App settings are only restored if you tick the box.
- **Replace:** remove the current library, then restore. Matane makes a backup of what is here now before replacing anything.

Extensions that are not installed are listed in the preview; their manga come back as "source not installed" until you install them from Extensions. Downloaded chapters are linked again when their files are still in the same place.

## Moving to a new computer

1. On the old computer: **Back up now**, copy the file over (and the download folder, if you want your downloads).
2. On the new computer: install Matane, add the same repositories, then **Restore…** with **Merge**.
