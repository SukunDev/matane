import type Database from 'better-sqlite3';
import { primaryLanguage } from '@manga-reader/shared';

/**
 * Content languages for a profile that predates the setting (Fase 4c): the UI language, English, and
 * the languages of sources already in use (pinned, browsed, or with manga in the library), so an
 * upgrade never hides a source someone reads from.
 */
export function initialContentLanguages(sqlite: Database.Database, uiLanguage: string): string[] {
  const rows = sqlite
    .prepare(
      `SELECT DISTINCT s.lang AS lang FROM sources s
       WHERE s.pinned = 1 OR s.last_used_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM manga m WHERE m.source_id = s.id AND m.in_library = 1)`,
    )
    .all() as { lang: string }[];
  return [...new Set([primaryLanguage(uiLanguage), 'en', ...rows.map((r) => primaryLanguage(r.lang))])];
}
