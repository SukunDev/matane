import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { chapters, manga } from './library';

/** One row per manga; deleting history never touches `reading_sessions` (statistics). */
export const history = sqliteTable('history', {
  mangaId: integer()
    .primaryKey()
    .references(() => manga.id, { onDelete: 'cascade' }),
  chapterId: integer()
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  readAt: integer().notNull(),
});

export const readingSessions = sqliteTable(
  'reading_sessions',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    mangaId: integer()
      .notNull()
      .references(() => manga.id, { onDelete: 'cascade' }),
    chapterId: integer()
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    startedAt: integer().notNull(),
    endedAt: integer(),
    activeMs: integer().notNull().default(0),
  },
  (t) => [index('reading_sessions_started_at_idx').on(t.startedAt)],
);

export const pageBookmarks = sqliteTable(
  'page_bookmarks',
  {
    id: integer().primaryKey({ autoIncrement: true }),
    chapterId: integer()
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    pageIndex: integer().notNull(),
    note: text(),
    createdAt: integer().notNull(),
  },
  (t) => [uniqueIndex('page_bookmarks_chapter_page_unique').on(t.chapterId, t.pageIndex)],
);
