import { z } from 'zod';

// Backup file format (BRAINSTORM.md §6.7, ADR 0029): `matane-backup-YYYY-MM-DD….zip` holding
// `backup.json` (this schema) and `covers/` (custom covers). Everything is referred to by natural
// keys (source id + url), never by database ids, so a backup restores into any profile.

/** Bump on every change of the structure; readers keep accepting every older version. */
export const BACKUP_FORMAT_VERSION = 1;

const time = z.number().int().nonnegative();
const nullableTime = time.nullable().catch(null);

export const backupChapterSchema = z.object({
  url: z.string().min(1),
  name: z.string(),
  number: z.number().nullable().catch(null),
  scanlator: z.string().nullable().catch(null),
  uploadedAt: nullableTime,
  sourceOrder: z.number().int().catch(0),
  read: z.boolean().catch(false),
  readAt: nullableTime,
  bookmarked: z.boolean().catch(false),
  lastPage: z.number().int().nonnegative().catch(0),
  totalPages: z.number().int().positive().nullable().catch(null),
  pageOffset: z.number().min(0).max(1).nullable().catch(null),
  /** A finished download: linked again on restore when the file is still there. */
  download: z
    .object({
      format: z.enum(['cbz', 'folder']),
      path: z.string().min(1),
      sizeBytes: z.number().int().nonnegative().nullable().catch(null),
      completedAt: nullableTime,
    })
    .nullable()
    .catch(null),
});
export type BackupChapter = z.infer<typeof backupChapterSchema>;

export const backupMangaSchema = z.object({
  sourceId: z.string().min(1),
  url: z.string().min(1),
  title: z.string(),
  author: z.string().nullable().catch(null),
  artist: z.string().nullable().catch(null),
  description: z.string().nullable().catch(null),
  genres: z.array(z.string()).catch([]),
  status: z.string().catch('unknown'),
  type: z.string().nullable().catch(null),
  thumbnailUrl: z.string().nullable().catch(null),
  inLibrary: z.boolean().catch(false),
  addedAt: nullableTime,
  latestChapterAt: nullableTime,
  /** Kept as stored; checked again by the app when used. */
  readerSettings: z.unknown().nullable().catch(null),
  scanlatorPrefs: z.unknown().nullable().catch(null),
  chapterView: z.unknown().nullable().catch(null),
  /** Category names. */
  categories: z.array(z.string()).catch([]),
  /** Path of the custom cover inside the archive (`covers/…`). */
  customCover: z.string().nullable().catch(null),
  chapters: z.array(backupChapterSchema),
  /** The history entry: the chapter last read and when. */
  history: z.object({ chapterUrl: z.string(), readAt: time }).nullable().catch(null),
  sessions: z
    .array(z.object({ chapterUrl: z.string(), startedAt: time, endedAt: nullableTime, activeMs: time }))
    .catch([]),
  /** Tracker links, never with tokens. */
  tracks: z
    .array(
      z.object({
        service: z.string(),
        remoteId: z.string(),
        remoteUrl: z.string().nullable().catch(null),
        status: z.string().nullable().catch(null),
        score: z.number().nullable().catch(null),
        progress: z.number().nullable().catch(null),
        startedAt: nullableTime,
        finishedAt: nullableTime,
        syncBack: z.boolean().catch(true),
      }),
    )
    .catch([]),
});
export type BackupManga = z.infer<typeof backupMangaSchema>;

export const backupSchema = z.object({
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  appVersion: z.string(),
  createdAt: time,
  data: z.object({
    sources: z.array(
      z.object({
        id: z.string().min(1),
        extensionId: z.string().min(1),
        key: z.string(),
        name: z.string(),
        lang: z.string(),
        pinned: z.boolean().catch(false),
        lastUsedAt: nullableTime,
      }),
    ),
    categories: z.array(
      z.object({
        name: z.string().min(1),
        sortOrder: z.number().int().catch(0),
        settings: z.unknown().nullable().catch(null),
      }),
    ),
    manga: z.array(backupMangaSchema),
    repos: z.array(
      z.object({
        url: z.string().min(1),
        name: z.string().nullable().catch(null),
        publicKey: z.string().nullable().catch(null),
      }),
    ),
    extensions: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string(),
        version: z.string(),
        /** The repository it was installed from, when there is one. */
        repoUrl: z.string().nullable().catch(null),
        prefs: z.record(z.string(), z.unknown()).catch({}),
        storage: z.record(z.string(), z.unknown()).catch({}),
      }),
    ),
    /** App settings (every key of AppSettings that was stored). */
    settings: z.record(z.string(), z.unknown()).catch({}),
  }),
});
export type Backup = z.infer<typeof backupSchema>;

/** What a backup holds, shown before restoring it. */
export const backupPreviewSchema = z.object({
  path: z.string(),
  createdAt: z.number(),
  appVersion: z.string(),
  manga: z.number(),
  inLibrary: z.number(),
  categories: z.number(),
  chaptersRead: z.number(),
  /** Extensions its sources need that are not installed here. */
  missingExtensions: z.array(z.object({ id: z.string(), name: z.string(), repoUrl: z.string().nullable() })),
  /** A Mihon/Tachiyomi backup (`.tachibk`): its sources and what they matched here. Null for a Matane backup. */
  mihon: z
    .object({
      sources: z.array(
        z.object({
          /** The source's Long id in the backup (a string: it does not fit a double). */
          id: z.string(),
          name: z.string().nullable(),
          manga: z.number(),
          inLibrary: z.number(),
          /** The installed source it matched by itself, or null (the user picks one or skips it). */
          matchedSourceId: z.string().nullable(),
          /** When nothing is installed for it: an extension in the user's repositories that looks like it. */
          offer: z.object({ repoId: z.number(), extensionId: z.string(), name: z.string() }).nullable(),
        }),
      ),
    })
    .nullable(),
});
export type BackupPreview = z.infer<typeof backupPreviewSchema>;

export const restoreResultSchema = z.object({
  manga: z.object({ added: z.number(), updated: z.number() }),
  chapters: z.object({ added: z.number(), updated: z.number() }),
  categories: z.number(),
  covers: z.number(),
  downloads: z.number(),
  repos: z.number(),
  settings: z.boolean(),
  /** Entries that could not be restored, with why. */
  failed: z.array(z.object({ title: z.string(), message: z.string() })),
  /** The automatic backup taken before "Replace" wiped the data. */
  safetyBackup: z.string().nullable(),
  missingExtensions: backupPreviewSchema.shape.missingExtensions,
  /** Mihon sources that were skipped (none matched or picked), with how many manga that left out. */
  unmatched: z.array(z.object({ name: z.string().nullable(), manga: z.number() })),
});
export type RestoreResult = z.infer<typeof restoreResultSchema>;

export const backupFileSchema = z.object({
  path: z.string(),
  name: z.string(),
  sizeBytes: z.number(),
  modifiedAt: z.number(),
  /** Written by the automatic backup (rotated: the last 7 are kept). */
  auto: z.boolean(),
});
export type BackupFile = z.infer<typeof backupFileSchema>;

export const backupProgressSchema = z.object({
  phase: z.enum(['writing', 'reading', 'restoring']),
  done: z.number(),
  total: z.number(),
});
export type BackupProgress = z.infer<typeof backupProgressSchema>;
