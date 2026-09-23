import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sources } from './extensions';

export const MANGA_STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown'] as const;
export const MANGA_TYPES = ['manga', 'manhwa', 'manhua', 'comic'] as const;

export const manga = sqliteTable(
  'manga',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    sourceId: text()
      .notNull()
      .references(() => sources.id),
    /** Stable identity chosen by the extension (usually a relative path). */
    url: text().notNull(),
    title: text().notNull(),
    author: text(),
    artist: text(),
    description: text(),
    genresJson: text().notNull().default('[]'),
    status: text({ enum: MANGA_STATUSES }).notNull().default('unknown'),
    type: text({ enum: MANGA_TYPES }),
    thumbnailUrl: text(),
    coverPath: text(),
    customCoverPath: text(),
    /** Dominant cover color used to tint the detail header. */
    coverColor: text(),
    inLibrary: integer({ mode: 'boolean' }).notNull().default(false),
    addedAt: integer(),
    favoriteOrder: integer(),
    lastUpdateCheckAt: integer(),
    latestChapterAt: integer(),
    readerSettingsJson: text(),
    scanlatorPrefsJson: text(),
    chapterViewJson: text(),
    createdAt: integer().notNull(),
    updatedAt: integer().notNull(),
  },
  (t) => [uniqueIndex('manga_source_url_unique').on(t.sourceId, t.url), index('manga_in_library_idx').on(t.inLibrary)],
);

export const categories = sqliteTable('categories', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  sortOrder: integer().notNull().default(0),
  settingsJson: text(),
});

export const mangaCategories = sqliteTable(
  'manga_categories',
  {
    mangaId: integer()
      .notNull()
      .references(() => manga.id, { onDelete: 'cascade' }),
    categoryId: integer()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.mangaId, t.categoryId] }), index('manga_categories_category_idx').on(t.categoryId)],
);

export const chapters = sqliteTable(
  'chapters',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    mangaId: integer()
      .notNull()
      .references(() => manga.id, { onDelete: 'cascade' }),
    url: text().notNull(),
    name: text().notNull(),
    number: real(),
    scanlator: text(),
    uploadedAt: integer(),
    sourceOrder: integer().notNull().default(0),
    fetchedAt: integer().notNull(),
    read: integer({ mode: 'boolean' }).notNull().default(false),
    readAt: integer(),
    bookmarked: integer({ mode: 'boolean' }).notNull().default(false),
    lastPage: integer().notNull().default(0),
    totalPages: integer(),
    /** Scroll offset inside the last page, for webtoon mode. */
    pageOffset: real(),
    sourceMissing: integer({ mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    uniqueIndex('chapters_manga_url_unique').on(t.mangaId, t.url),
    index('chapters_manga_number_idx').on(t.mangaId, t.number),
    index('chapters_fetched_at_idx').on(t.fetchedAt),
  ],
);

export const pageListCache = sqliteTable('page_list_cache', {
  chapterId: integer()
    .primaryKey()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  pagesJson: text().notNull(),
  fetchedAt: integer().notNull(),
});
