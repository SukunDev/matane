import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Extension repositories (BRAINSTORM.md §5.8, ADR 0022). */
export const extensionRepos = sqliteTable('extension_repos', {
  id: integer().primaryKey({ autoIncrement: true }),
  /** Base URL, ending in "/". */
  url: text().notNull().unique(),
  name: text(),
  /** A key the user chose to trust for this repository ("trust this key"), `ed25519:…`. */
  publicKey: text(),
  /** Exact bytes of the last accepted `index.json` and its signature (trust is re-checked from these). */
  indexJson: text(),
  signature: text(),
  lastFetchedAt: integer(),
  lastError: text(),
});

export const extensions = sqliteTable('extensions', {
  /** Stable extension id without language, e.g. "example". */
  id: text().primaryKey(),
  name: text().notNull(),
  version: text().notNull(),
  apiVersion: integer().notNull(),
  repoId: integer().references(() => extensionRepos.id, { onDelete: 'set null' }),
  nsfw: integer({ mode: 'boolean' }).notNull().default(false),
  enabled: integer({ mode: 'boolean' }).notNull().default(true),
  installedAt: integer().notNull(),
  updatedAt: integer().notNull(),
});

export const extensionStorage = sqliteTable(
  'extension_storage',
  {
    extensionId: text()
      .notNull()
      .references(() => extensions.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    valueJson: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.extensionId, t.key] })],
);

export const extensionPrefs = sqliteTable(
  'extension_prefs',
  {
    extensionId: text()
      .notNull()
      .references(() => extensions.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    valueJson: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.extensionId, t.key] })],
);

/**
 * Sources outlive their extension on purpose (no FK), so library entries keep a reference
 * and can be shown as "source not installed". See BRAINSTORM.md §7.
 */
export const sources = sqliteTable(
  'sources',
  {
    /** `<extensionId>/<key>`, e.g. "example/en". */
    id: text().primaryKey(),
    extensionId: text().notNull(),
    key: text().notNull(),
    name: text().notNull(),
    lang: text().notNull(),
    pinned: integer({ mode: 'boolean' }).notNull().default(false),
    lastUsedAt: integer(),
  },
  (t) => [uniqueIndex('sources_extension_key_unique').on(t.extensionId, t.key)],
);
