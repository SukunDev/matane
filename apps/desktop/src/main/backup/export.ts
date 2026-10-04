import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { BACKUP_FORMAT_VERSION, type Backup, type BackupChapter, type BackupManga } from '@manga-reader/shared';
import type Database from 'better-sqlite3';
import yazl from 'yazl';

/** The JSON file inside a backup archive. */
export const BACKUP_JSON = 'backup.json';

interface MangaRow {
  id: number;
  source_id: string;
  url: string;
  title: string;
  author: string | null;
  artist: string | null;
  description: string | null;
  genres_json: string;
  status: string;
  type: string | null;
  thumbnail_url: string | null;
  custom_cover_path: string | null;
  in_library: number;
  added_at: number | null;
  latest_chapter_at: number | null;
  reader_settings_json: string | null;
  scanlator_prefs_json: string | null;
  chapter_view_json: string | null;
}

interface ChapterRow {
  id: number;
  manga_id: number;
  url: string;
  name: string;
  number: number | null;
  scanlator: string | null;
  uploaded_at: number | null;
  source_order: number;
  read: number;
  read_at: number | null;
  bookmarked: number;
  last_page: number;
  total_pages: number | null;
  page_offset: number | null;
  d_format: 'cbz' | 'folder' | null;
  d_path: string | null;
  d_size: number | null;
  d_completed: number | null;
}

const parse = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

export interface CollectedBackup {
  backup: Backup;
  /** Custom cover files and their path inside the archive. */
  covers: { entry: string; file: string }[];
}

/**
 * Everything a backup holds (docs/BRAINSTORM.md §6.7): library manga with their chapters, categories,
 * history, reading sessions, tracker links, plus manga outside the library that history or
 * sessions refer to; sources, repositories, installed extensions with their preferences and
 * storage, and the app settings. Not downloads themselves, caches or secrets.
 */
export function collectBackup(
  sqlite: Database.Database,
  options: { appVersion: string; settingKeys: readonly string[]; now?: number },
): CollectedBackup {
  const mangaRows = sqlite
    .prepare(
      `SELECT * FROM manga WHERE in_library = 1
         OR id IN (SELECT manga_id FROM history)
         OR id IN (SELECT DISTINCT manga_id FROM reading_sessions)
       ORDER BY id`,
    )
    .all() as MangaRow[];
  const ids = new Set(mangaRows.map((m) => m.id));

  const chaptersByManga = new Map<number, ChapterRow[]>();
  const chapterRows = sqlite
    .prepare(
      `SELECT c.*, d.format AS d_format, d.path AS d_path, d.size_bytes AS d_size, d.completed_at AS d_completed
       FROM chapters c LEFT JOIN downloads d ON d.chapter_id = c.id AND d.status = 'done'
       ORDER BY c.manga_id, c.source_order, c.id`,
    )
    .iterate() as IterableIterator<ChapterRow>;
  for (const row of chapterRows) {
    if (!ids.has(row.manga_id)) continue;
    let list = chaptersByManga.get(row.manga_id);
    if (!list) chaptersByManga.set(row.manga_id, (list = []));
    list.push(row);
  }

  const categories = sqlite
    .prepare('SELECT id, name, sort_order, settings_json FROM categories ORDER BY sort_order')
    .all() as {
    id: number;
    name: string;
    sort_order: number;
    settings_json: string | null;
  }[];
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const categoriesOf = new Map<number, string[]>();
  for (const link of sqlite.prepare('SELECT manga_id, category_id FROM manga_categories').all() as {
    manga_id: number;
    category_id: number;
  }[]) {
    const name = categoryName.get(link.category_id);
    if (!name || !ids.has(link.manga_id)) continue;
    categoriesOf.set(link.manga_id, [...(categoriesOf.get(link.manga_id) ?? []), name]);
  }

  const history = new Map(
    (
      sqlite.prepare('SELECT manga_id, chapter_id, read_at FROM history').all() as {
        manga_id: number;
        chapter_id: number;
        read_at: number;
      }[]
    ).map((h) => [h.manga_id, h]),
  );
  const sessionsOf = new Map<
    number,
    { chapter_id: number; started_at: number; ended_at: number | null; active_ms: number }[]
  >();
  for (const session of sqlite
    .prepare('SELECT manga_id, chapter_id, started_at, ended_at, active_ms FROM reading_sessions ORDER BY id')
    .iterate() as IterableIterator<{
    manga_id: number;
    chapter_id: number;
    started_at: number;
    ended_at: number | null;
    active_ms: number;
  }>) {
    let list = sessionsOf.get(session.manga_id);
    if (!list) sessionsOf.set(session.manga_id, (list = []));
    list.push(session);
  }
  const tracksOf = new Map<number, BackupManga['tracks']>();
  for (const track of sqlite.prepare('SELECT * FROM manga_tracks').all() as {
    manga_id: number;
    service: string;
    remote_id: string;
    remote_url: string | null;
    status: string | null;
    score: number | null;
    progress: number | null;
    started_at: number | null;
    finished_at: number | null;
    sync_back: number;
  }[]) {
    tracksOf.set(track.manga_id, [
      ...(tracksOf.get(track.manga_id) ?? []),
      {
        service: track.service,
        remoteId: track.remote_id,
        remoteUrl: track.remote_url,
        status: track.status,
        score: track.score,
        progress: track.progress,
        startedAt: track.started_at,
        finishedAt: track.finished_at,
        syncBack: track.sync_back === 1,
      },
    ]);
  }

  const covers: CollectedBackup['covers'] = [];
  const manga: BackupManga[] = mangaRows.map((row) => {
    const chapters = chaptersByManga.get(row.id) ?? [];
    const urlOf = new Map(chapters.map((c) => [c.id, c.url]));
    const entry = history.get(row.id);
    const sessions = (sessionsOf.get(row.id) ?? []).filter((s) => urlOf.has(s.chapter_id));
    // Outside the library only the chapters history and sessions point at are kept.
    const needed = new Set([entry?.chapter_id, ...sessions.map((s) => s.chapter_id)]);
    const kept = row.in_library === 1 ? chapters : chapters.filter((c) => needed.has(c.id));
    let customCover: string | null = null;
    if (row.custom_cover_path) {
      customCover = `covers/${row.id}-${basename(row.custom_cover_path)}`;
      covers.push({ entry: customCover, file: row.custom_cover_path });
    }
    const genres = parse(row.genres_json);
    return {
      sourceId: row.source_id,
      url: row.url,
      title: row.title,
      author: row.author,
      artist: row.artist,
      description: row.description,
      genres: Array.isArray(genres) ? genres.filter((g): g is string => typeof g === 'string') : [],
      status: row.status,
      type: row.type,
      thumbnailUrl: row.thumbnail_url,
      inLibrary: row.in_library === 1,
      addedAt: row.added_at,
      latestChapterAt: row.latest_chapter_at,
      readerSettings: parse(row.reader_settings_json),
      scanlatorPrefs: parse(row.scanlator_prefs_json),
      chapterView: parse(row.chapter_view_json),
      categories: categoriesOf.get(row.id) ?? [],
      customCover,
      chapters: kept.map((c): BackupChapter => ({
        url: c.url,
        name: c.name,
        number: c.number,
        scanlator: c.scanlator,
        uploadedAt: c.uploaded_at,
        sourceOrder: c.source_order,
        read: c.read === 1,
        readAt: c.read_at,
        bookmarked: c.bookmarked === 1,
        lastPage: c.last_page,
        totalPages: c.total_pages,
        pageOffset: c.page_offset,
        download:
          c.d_format && c.d_path
            ? { format: c.d_format, path: c.d_path, sizeBytes: c.d_size, completedAt: c.d_completed }
            : null,
      })),
      history:
        entry && urlOf.has(entry.chapter_id)
          ? { chapterUrl: urlOf.get(entry.chapter_id)!, readAt: entry.read_at }
          : null,
      sessions: sessions.map((s) => ({
        chapterUrl: urlOf.get(s.chapter_id)!,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        activeMs: s.active_ms,
      })),
      tracks: tracksOf.get(row.id) ?? [],
    };
  });

  const sources = (
    sqlite.prepare('SELECT * FROM sources ORDER BY id').all() as {
      id: string;
      extension_id: string;
      key: string;
      name: string;
      lang: string;
      pinned: number;
      last_used_at: number | null;
    }[]
  ).map((s) => ({
    id: s.id,
    extensionId: s.extension_id,
    key: s.key,
    name: s.name,
    lang: s.lang,
    pinned: s.pinned === 1,
    lastUsedAt: s.last_used_at,
  }));
  const repos = (
    sqlite.prepare('SELECT url, name, public_key FROM extension_repos ORDER BY id').all() as {
      url: string;
      name: string | null;
      public_key: string | null;
    }[]
  ).map((r) => ({ url: r.url, name: r.name, publicKey: r.public_key }));
  const keyValues = (table: 'extension_prefs' | 'extension_storage', extensionId: string) =>
    Object.fromEntries(
      (
        sqlite.prepare(`SELECT key, value_json FROM ${table} WHERE extension_id = ?`).all(extensionId) as {
          key: string;
          value_json: string;
        }[]
      ).map((row) => [row.key, parse(row.value_json)]),
    );
  const extensions = (
    sqlite
      .prepare(
        `SELECT e.id, e.name, e.version, r.url AS repo_url FROM extensions e
       LEFT JOIN extension_repos r ON r.id = e.repo_id ORDER BY e.id`,
      )
      .all() as { id: string; name: string; version: string; repo_url: string | null }[]
  ).map((e) => ({
    id: e.id,
    name: e.name,
    version: e.version,
    repoUrl: e.repo_url,
    prefs: keyValues('extension_prefs', e.id),
    storage: keyValues('extension_storage', e.id),
  }));
  const settings = Object.fromEntries(
    (
      sqlite
        .prepare(`SELECT key, value_json FROM settings WHERE key IN (${options.settingKeys.map(() => '?').join(',')})`)
        .all(...options.settingKeys) as { key: string; value_json: string }[]
    ).map((row) => [row.key, parse(row.value_json)]),
  );

  return {
    backup: {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: options.appVersion,
      createdAt: options.now ?? Date.now(),
      data: {
        sources,
        categories: categories.map((c) => ({
          name: c.name,
          sortOrder: c.sort_order,
          settings: parse(c.settings_json),
        })),
        manga,
        repos,
        extensions,
        settings,
      },
    },
    covers,
  };
}

/**
 * Writes the archive next to `target` and renames it into place, so a crash never leaves a
 * half-written backup under the real name. Covers that vanished are left out.
 */
export async function writeBackup(target: string, collected: CollectedBackup): Promise<number> {
  const temp = `${target}.${process.pid}.tmp`;
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(collected.backup)), BACKUP_JSON, { compress: true });
  for (const cover of collected.covers) {
    const exists = await stat(cover.file).then(
      (info) => info.isFile(),
      () => false,
    );
    if (exists) zip.addFile(cover.file, cover.entry, { compress: false });
  }
  zip.end();
  try {
    await pipeline(zip.outputStream, createWriteStream(temp));
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return (await stat(target)).size;
}
