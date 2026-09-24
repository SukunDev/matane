import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import type Database from 'better-sqlite3';

/** The app was called "MangaReader" before it became Matane; its data folder carried that name. */
export const LEGACY_APP_NAME = 'MangaReader';

/** Chromium's per-run lock files; they belong to whichever instance created them. */
const isLockFile = (name: string) => name.startsWith('Singleton') || name === 'lockfile';

/**
 * Moves the old data folder to the new one, once. Runs before anything writes to `to` (logging,
 * the single-instance lock, Chromium), so usually it's a plain rename. Returns whether it moved.
 */
export function moveLegacyUserData(from: string, to: string): boolean {
  if (from === to || !existsSync(join(from, 'data.db')) || existsSync(join(to, 'data.db'))) return false;
  if (!existsSync(to)) {
    renameSync(from, to);
    return true;
  }
  // `to` exists without a database (an earlier launch got that far): move what isn't there yet.
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (!isLockFile(name) && !existsSync(join(to, name))) renameSync(join(from, name), join(to, name));
  }
  try {
    rmdirSync(from);
  } catch {
    // Leftovers (lock files, names that existed in both) stay in the old folder.
  }
  return true;
}

/** Columns that store absolute paths inside the data folder. */
const PATH_COLUMNS = [
  ['manga', 'cover_path'],
  ['manga', 'custom_cover_path'],
  ['image_cache', 'path'],
  ['downloads', 'path'],
] as const;

/** Points stored file paths at the moved data folder. */
export function rewriteDataPaths(sqlite: Database.Database, from: string, to: string): number {
  const oldPrefix = from.endsWith(sep) ? from : from + sep;
  const newPrefix = to.endsWith(sep) ? to : to + sep;
  let changed = 0;
  sqlite.transaction(() => {
    for (const [table, column] of PATH_COLUMNS) {
      changed += sqlite
        .prepare(
          `UPDATE ${table} SET ${column} = @newPrefix || substr(${column}, length(@oldPrefix) + 1)
           WHERE substr(${column}, 1, length(@oldPrefix)) = @oldPrefix`,
        )
        .run({ oldPrefix, newPrefix }).changes;
    }
  })();
  return changed;
}
