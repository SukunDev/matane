import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  BACKUP_FORMAT_VERSION,
  type Backup,
  type BackupManga,
  type BackupPreview,
  type RestoreResult,
  backupSchema,
} from '@manga-reader/shared';
import { AppError } from '@manga-reader/shared/errors';
import type Database from 'better-sqlite3';
import { openZip, readEntry } from '../downloads/archive';
import { BACKUP_JSON } from './export';

/** Manga per transaction; between batches the event loop gets a turn (the window stays responsive). */
const BATCH = 50;
/** A backup.json larger than this is not a Matane backup. */
const MAX_JSON_BYTES = 512 * 1024 * 1024;

export interface OpenBackup {
  backup: Backup;
  /** A file from the archive (a custom cover), or null when it is not there. */
  read(entry: string): Promise<Buffer | null>;
  close(): void;
}

/**
 * Opens a backup archive and checks `backup.json` against the format (docs/BRAINSTORM.md §6.7). A file
 * that is not a backup, is damaged, or comes from a newer Matane is refused with a clear message.
 */
export async function openBackup(path: string): Promise<OpenBackup> {
  let archive: Awaited<ReturnType<typeof openZip>>;
  try {
    archive = await openZip(path);
  } catch {
    throw new AppError('parse', 'This file is not a Matane backup (it is not a zip archive)');
  }
  const { zip, entries } = archive;
  try {
    const json = entries.get(BACKUP_JSON);
    if (!json) throw new AppError('parse', 'This file is not a Matane backup (backup.json is missing)');
    if (json.uncompressedSize > MAX_JSON_BYTES) throw new AppError('parse', 'backup.json is too large');
    let raw: unknown;
    try {
      raw = JSON.parse((await readEntry(zip, json)).toString('utf8'));
    } catch {
      throw new AppError('parse', 'The backup is damaged (backup.json cannot be read)');
    }
    const version = (raw as { formatVersion?: unknown } | null)?.formatVersion;
    if (typeof version === 'number' && version > BACKUP_FORMAT_VERSION) {
      throw new AppError(
        'parse',
        `This backup was made by a newer version of Matane (format ${version}); update the app first`,
      );
    }
    const parsed = backupSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(
        'parse',
        `The backup is damaged (${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'invalid'})`,
      );
    }
    return {
      backup: parsed.data,
      read: async (entry) => {
        const found = entries.get(entry);
        return found ? readEntry(zip, found) : null;
      },
      close: () => zip.close(),
    };
  } catch (error) {
    zip.close();
    throw error;
  }
}

/** The extensions a backup's library needs that are not installed here. */
export function missingExtensions(
  backup: Backup,
  isInstalled: (extensionId: string) => boolean,
): BackupPreview['missingExtensions'] {
  const used = new Set(
    backup.data.manga
      .map((m) => backup.data.sources.find((s) => s.id === m.sourceId)?.extensionId ?? m.sourceId.split('/')[0]!)
      .filter(Boolean),
  );
  return [...used]
    .filter((id) => !isInstalled(id))
    .sort()
    .map((id) => {
      const known = backup.data.extensions.find((e) => e.id === id);
      const source = backup.data.sources.find((s) => s.extensionId === id);
      return { id, name: known?.name ?? source?.name ?? id, repoUrl: known?.repoUrl ?? null };
    });
}

export function previewBackup(
  path: string,
  backup: Backup,
  isInstalled: (extensionId: string) => boolean,
): BackupPreview {
  return {
    path,
    createdAt: backup.createdAt,
    appVersion: backup.appVersion,
    manga: backup.data.manga.length,
    inLibrary: backup.data.manga.filter((m) => m.inLibrary).length,
    categories: backup.data.categories.length,
    chaptersRead: backup.data.manga.reduce((sum, m) => sum + m.chapters.filter((c) => c.read).length, 0),
    missingExtensions: missingExtensions(backup, isInstalled),
    mihon: null,
  };
}

export interface RestoreDeps {
  sqlite: Database.Database;
  /** Where custom covers go (`userData/covers/custom`). */
  customCoversDir: string;
  isInstalled: (extensionId: string) => boolean;
  /** Keeps preferences and storage of extensions that are not installed yet. */
  pendingExtensionData: (
    extensionId: string,
    data: { prefs: Record<string, unknown>; storage: Record<string, unknown> },
  ) => void;
  /** Applies the backup's app settings (the caller keeps what belongs to this machine). */
  applySettings: (settings: Record<string, unknown>) => void;
  onProgress?: (done: number, total: number) => void;
  now?: () => number;
}

const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value));

/**
 * Restores a backup (docs/BRAINSTORM.md §6.7). "merge" combines: read = either, progress = the furthest,
 * categories = both, history = the newest, bookmarks = either; what is set here wins over the
 * backup for per-manga settings and metadata. "replace" removes the library first (the caller has
 * backed it up). Runs in batches of transactions with a turn for the event loop in between.
 */
export async function restoreBackup(
  open: OpenBackup,
  options: { mode: 'merge' | 'replace'; settings: boolean },
  deps: RestoreDeps,
): Promise<Omit<RestoreResult, 'safetyBackup'>> {
  const { sqlite } = deps;
  const now = deps.now ?? Date.now;
  const { backup } = open;
  const result: Omit<RestoreResult, 'safetyBackup'> = {
    manga: { added: 0, updated: 0 },
    chapters: { added: 0, updated: 0 },
    categories: 0,
    covers: 0,
    downloads: 0,
    repos: 0,
    settings: false,
    failed: [],
    missingExtensions: missingExtensions(backup, deps.isInstalled),
    unmatched: [],
  };

  if (options.mode === 'replace') {
    sqlite.transaction(() => {
      // Chapters, history, sessions, links, tracks and download records go with the manga.
      sqlite.prepare('DELETE FROM manga').run();
      sqlite.prepare('DELETE FROM categories').run();
    })();
  }

  // Sources, repositories, categories, extension data: small, one transaction.
  const categoryIds = new Map<string, number>();
  sqlite.transaction(() => {
    const insertSource = sqlite.prepare(
      `INSERT INTO sources (id, extension_id, key, name, lang, pinned, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET pinned = max(pinned, excluded.pinned),
         last_used_at = max(coalesce(last_used_at, 0), coalesce(excluded.last_used_at, 0))`,
    );
    for (const s of backup.data.sources) {
      insertSource.run(s.id, s.extensionId, s.key, s.name, s.lang, s.pinned ? 1 : 0, s.lastUsedAt);
    }
    for (const repo of backup.data.repos) {
      const added = sqlite
        .prepare('INSERT INTO extension_repos (url, name, public_key) VALUES (?, ?, ?) ON CONFLICT(url) DO NOTHING')
        .run(repo.url, repo.name, repo.publicKey);
      result.repos += added.changes;
    }
    for (const row of sqlite.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]) {
      categoryIds.set(row.name, row.id);
    }
    let order = (sqlite.prepare('SELECT coalesce(max(sort_order), -1) AS m FROM categories').get() as { m: number }).m;
    for (const category of [...backup.data.categories].sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (categoryIds.has(category.name)) continue;
      const id = Number(
        sqlite
          .prepare('INSERT INTO categories (name, sort_order, settings_json) VALUES (?, ?, ?)')
          .run(category.name, ++order, json(category.settings)).lastInsertRowid,
      );
      categoryIds.set(category.name, id);
      result.categories++;
    }
    for (const extension of backup.data.extensions) {
      const installed = sqlite.prepare('SELECT 1 FROM extensions WHERE id = ?').get(extension.id) !== undefined;
      if (!installed) {
        deps.pendingExtensionData(extension.id, { prefs: extension.prefs, storage: extension.storage });
        continue;
      }
      for (const [table, values] of [
        ['extension_prefs', extension.prefs],
        ['extension_storage', extension.storage],
      ] as const) {
        const statement = sqlite.prepare(
          `INSERT INTO ${table} (extension_id, key, value_json) VALUES (?, ?, ?)
           ON CONFLICT(extension_id, key) DO ${options.mode === 'replace' ? 'UPDATE SET value_json = excluded.value_json' : 'NOTHING'}`,
        );
        for (const [key, value] of Object.entries(values)) statement.run(extension.id, key, JSON.stringify(value));
      }
    }
  })();

  const total = backup.data.manga.length;
  for (let start = 0; start < total; start += BATCH) {
    const batch = backup.data.manga.slice(start, start + BATCH);
    const covers: { mangaId: number; entry: string }[] = [];
    sqlite.transaction(() => {
      for (const manga of batch) {
        try {
          const cover = restoreManga(sqlite, manga, categoryIds, result, now());
          if (cover) covers.push(cover);
        } catch (error) {
          result.failed.push({ title: manga.title, message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    for (const cover of covers) {
      const bytes = await open.read(cover.entry);
      if (!bytes) continue;
      await mkdir(deps.customCoversDir, { recursive: true });
      const target = join(deps.customCoversDir, `${cover.mangaId}-${now()}${extname(cover.entry) || '.png'}`);
      await writeFile(target, bytes);
      sqlite.prepare('UPDATE manga SET custom_cover_path = ? WHERE id = ?').run(target, cover.mangaId);
      result.covers++;
    }
    deps.onProgress?.(Math.min(start + BATCH, total), total);
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (options.settings && Object.keys(backup.data.settings).length > 0) {
    deps.applySettings(backup.data.settings);
    result.settings = true;
  }
  return result;
}

interface LocalChapter {
  id: number;
  url: string;
  read: number;
  read_at: number | null;
  bookmarked: number;
  last_page: number;
  total_pages: number | null;
  page_offset: number | null;
}

/** One manga and everything under it; returns its custom cover to copy when it gets one. */
function restoreManga(
  sqlite: Database.Database,
  manga: BackupManga,
  categoryIds: Map<string, number>,
  result: Omit<RestoreResult, 'safetyBackup'>,
  now: number,
): { mangaId: number; entry: string } | null {
  const existing = sqlite
    .prepare('SELECT id, custom_cover_path FROM manga WHERE source_id = ? AND url = ?')
    .get(manga.sourceId, manga.url) as { id: number; custom_cover_path: string | null } | undefined;
  let mangaId: number;
  if (existing) {
    mangaId = existing.id;
    // Metadata here is the fresher one; the backup only fills gaps. Being in the library wins.
    sqlite
      .prepare(
        `UPDATE manga SET
           in_library = max(in_library, ?),
           added_at = coalesce(added_at, ?),
           author = coalesce(author, ?), artist = coalesce(artist, ?), description = coalesce(description, ?),
           type = coalesce(type, ?), thumbnail_url = coalesce(thumbnail_url, ?),
           latest_chapter_at = max(coalesce(latest_chapter_at, 0), coalesce(?, 0)),
           reader_settings_json = coalesce(reader_settings_json, ?),
           scanlator_prefs_json = coalesce(scanlator_prefs_json, ?),
           chapter_view_json = coalesce(chapter_view_json, ?),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        manga.inLibrary ? 1 : 0,
        manga.addedAt,
        manga.author,
        manga.artist,
        manga.description,
        manga.type,
        manga.thumbnailUrl,
        manga.latestChapterAt,
        json(manga.readerSettings),
        json(manga.scanlatorPrefs),
        json(manga.chapterView),
        now,
        mangaId,
      );
    result.manga.updated++;
  } else {
    mangaId = Number(
      sqlite
        .prepare(
          `INSERT INTO manga (source_id, url, title, author, artist, description, genres_json, status, type, thumbnail_url,
             in_library, added_at, latest_chapter_at, reader_settings_json, scanlator_prefs_json, chapter_view_json,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          manga.sourceId,
          manga.url,
          manga.title,
          manga.author,
          manga.artist,
          manga.description,
          JSON.stringify(manga.genres),
          ['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown'].includes(manga.status) ? manga.status : 'unknown',
          ['manga', 'manhwa', 'manhua', 'comic'].includes(manga.type ?? '') ? manga.type : null,
          manga.thumbnailUrl,
          manga.inLibrary ? 1 : 0,
          manga.addedAt,
          manga.latestChapterAt,
          json(manga.readerSettings),
          json(manga.scanlatorPrefs),
          json(manga.chapterView),
          now,
          now,
        ).lastInsertRowid,
    );
    result.manga.added++;
  }

  const link = sqlite.prepare('INSERT OR IGNORE INTO manga_categories (manga_id, category_id) VALUES (?, ?)');
  for (const name of manga.categories) {
    const categoryId = categoryIds.get(name);
    if (categoryId !== undefined) link.run(mangaId, categoryId);
  }

  const local = new Map(
    (
      sqlite
        .prepare(
          'SELECT id, url, read, read_at, bookmarked, last_page, total_pages, page_offset FROM chapters WHERE manga_id = ?',
        )
        .all(mangaId) as LocalChapter[]
    ).map((c) => [c.url, c]),
  );
  const insertChapter = sqlite.prepare(
    `INSERT INTO chapters (manga_id, url, name, number, scanlator, uploaded_at, source_order, fetched_at, read, read_at,
       bookmarked, last_page, total_pages, page_offset)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateChapter = sqlite.prepare(
    `UPDATE chapters SET read = ?, read_at = ?, bookmarked = ?, last_page = ?, total_pages = ?, page_offset = ? WHERE id = ?`,
  );
  const insertDownload = sqlite.prepare(
    `INSERT OR IGNORE INTO downloads (chapter_id, status, format, path, size_bytes, created_at, completed_at, pages_done)
     VALUES (?, 'done', ?, ?, ?, ?, ?, 0)`,
  );
  const chapterIds = new Map<string, number>();
  for (const chapter of manga.chapters) {
    const here = local.get(chapter.url);
    let chapterId: number;
    if (!here) {
      chapterId = Number(
        insertChapter.run(
          mangaId,
          chapter.url,
          chapter.name,
          chapter.number,
          chapter.scanlator,
          chapter.uploadedAt,
          chapter.sourceOrder,
          now,
          chapter.read ? 1 : 0,
          chapter.read ? (chapter.readAt ?? now) : null,
          chapter.bookmarked ? 1 : 0,
          chapter.lastPage,
          chapter.totalPages,
          chapter.pageOffset,
        ).lastInsertRowid,
      );
      result.chapters.added++;
    } else {
      chapterId = here.id;
      const read = here.read === 1 || chapter.read;
      // The furthest position: a later page, or further into the same page.
      const further =
        chapter.lastPage > here.last_page ||
        (chapter.lastPage === here.last_page && (chapter.pageOffset ?? 0) > (here.page_offset ?? 0));
      const next = {
        read: read ? 1 : 0,
        readAt: read ? (here.read_at ?? chapter.readAt ?? now) : null,
        bookmarked: here.bookmarked === 1 || chapter.bookmarked ? 1 : 0,
        lastPage: further ? chapter.lastPage : here.last_page,
        totalPages: here.total_pages ?? chapter.totalPages,
        pageOffset: further ? chapter.pageOffset : here.page_offset,
      };
      const changed =
        next.read !== here.read ||
        next.bookmarked !== here.bookmarked ||
        next.lastPage !== here.last_page ||
        next.pageOffset !== here.page_offset ||
        next.totalPages !== here.total_pages;
      if (changed) {
        updateChapter.run(
          next.read,
          next.readAt,
          next.bookmarked,
          next.lastPage,
          next.totalPages,
          next.pageOffset,
          chapterId,
        );
        result.chapters.updated++;
      }
    }
    chapterIds.set(chapter.url, chapterId);
    if (chapter.download && existsSync(chapter.download.path)) {
      const added = insertDownload.run(
        chapterId,
        chapter.download.format,
        chapter.download.path,
        chapter.download.sizeBytes,
        now,
        chapter.download.completedAt ?? now,
      );
      result.downloads += added.changes;
    }
  }

  if (manga.history) {
    const chapterId = chapterIds.get(manga.history.chapterUrl);
    if (chapterId !== undefined) {
      sqlite
        .prepare(
          `INSERT INTO history (manga_id, chapter_id, read_at) VALUES (?, ?, ?)
           ON CONFLICT(manga_id) DO UPDATE SET chapter_id = excluded.chapter_id, read_at = excluded.read_at
           WHERE excluded.read_at > history.read_at`,
        )
        .run(mangaId, chapterId, manga.history.readAt);
    }
  }
  if (manga.sessions.length > 0) {
    const known = new Set(
      (
        sqlite.prepare('SELECT chapter_id, started_at FROM reading_sessions WHERE manga_id = ?').all(mangaId) as {
          chapter_id: number;
          started_at: number;
        }[]
      ).map((s) => `${s.chapter_id}:${s.started_at}`),
    );
    const insertSession = sqlite.prepare(
      'INSERT INTO reading_sessions (manga_id, chapter_id, started_at, ended_at, active_ms) VALUES (?, ?, ?, ?, ?)',
    );
    for (const session of manga.sessions) {
      const chapterId = chapterIds.get(session.chapterUrl);
      if (chapterId === undefined || known.has(`${chapterId}:${session.startedAt}`)) continue;
      insertSession.run(mangaId, chapterId, session.startedAt, session.endedAt, session.activeMs);
    }
  }
  const insertTrack = sqlite.prepare(
    `INSERT OR IGNORE INTO manga_tracks (manga_id, service, remote_id, remote_url, remote_title, status, score, progress,
       started_at, finished_at, sync_back) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const track of manga.tracks) {
    insertTrack.run(
      mangaId,
      track.service,
      track.remoteId,
      track.remoteUrl,
      track.remoteTitle,
      track.status,
      track.score,
      track.progress,
      track.startedAt,
      track.finishedAt,
      track.syncBack ? 1 : 0,
    );
  }

  // A custom cover from the backup only where there is none here.
  return manga.customCover && !existing?.custom_cover_path ? { mangaId, entry: manga.customCover } : null;
}
