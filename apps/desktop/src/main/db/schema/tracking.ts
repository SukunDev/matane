import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { manga } from './library';

// Trackers ship after v1; the tables exist from the start so later migrations stay additive.

export const trackerAccounts = sqliteTable('tracker_accounts', {
  service: text().primaryKey(),
  userId: text(),
  username: text(),
  /** Encrypted with Electron safeStorage. */
  tokenEncrypted: text(),
  expiresAt: integer(),
});

export const mangaTracks = sqliteTable(
  'manga_tracks',
  {
    mangaId: integer()
      .notNull()
      .references(() => manga.id, { onDelete: 'cascade' }),
    service: text().notNull(),
    remoteId: text().notNull(),
    remoteUrl: text(),
    status: text(),
    score: real(),
    progress: real(),
    startedAt: integer(),
    finishedAt: integer(),
    syncBack: integer({ mode: 'boolean' }).notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.mangaId, t.service] })],
);

export const trackerQueue = sqliteTable('tracker_queue', {
  id: integer().primaryKey({ autoIncrement: true }),
  mangaId: integer()
    .notNull()
    .references(() => manga.id, { onDelete: 'cascade' }),
  service: text().notNull(),
  payloadJson: text().notNull(),
  attempts: integer().notNull().default(0),
  nextAttemptAt: integer().notNull(),
});
