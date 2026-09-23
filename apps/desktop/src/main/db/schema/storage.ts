import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { chapters } from './library';

export const DOWNLOAD_STATUSES = ['queued', 'downloading', 'paused', 'error', 'done'] as const;
export const DOWNLOAD_FORMATS = ['cbz', 'folder'] as const;
export const IMAGE_CACHE_KINDS = ['page', 'browse_cover'] as const;

export const downloads = sqliteTable(
  'downloads',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    chapterId: integer()
      .notNull()
      .unique()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    status: text({ enum: DOWNLOAD_STATUSES }).notNull().default('queued'),
    queueOrder: integer().notNull().default(0),
    pagesDone: integer().notNull().default(0),
    pagesTotal: integer(),
    error: text(),
    format: text({ enum: DOWNLOAD_FORMATS }).notNull().default('cbz'),
    path: text(),
    sizeBytes: integer(),
    createdAt: integer().notNull(),
    completedAt: integer(),
  },
  (t) => [index('downloads_status_order_idx').on(t.status, t.queueOrder)],
);

export const imageCache = sqliteTable(
  'image_cache',
  {
    key: text().primaryKey(),
    kind: text({ enum: IMAGE_CACHE_KINDS }).notNull(),
    path: text().notNull(),
    sizeBytes: integer().notNull(),
    contentType: text(),
    width: integer(),
    height: integer(),
    segments: integer().notNull().default(1),
    variantsJson: text(),
    lastAccessAt: integer().notNull(),
  },
  (t) => [index('image_cache_last_access_idx').on(t.lastAccessAt)],
);
