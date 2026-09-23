-- Full-text search over manga for fast library search (BRAINSTORM.md §7).
-- Kept in sync with `manga` by triggers; rowid = manga.id.
CREATE VIRTUAL TABLE `manga_fts` USING fts5(title, author, genres, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER `manga_fts_after_insert` AFTER INSERT ON `manga` BEGIN
  INSERT INTO `manga_fts` (rowid, title, author, genres)
  VALUES (new.id, new.title, trim(coalesce(new.author, '') || ' ' || coalesce(new.artist, '')), new.genres_json);
END;
--> statement-breakpoint
CREATE TRIGGER `manga_fts_after_delete` AFTER DELETE ON `manga` BEGIN
  DELETE FROM `manga_fts` WHERE rowid = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `manga_fts_after_update` AFTER UPDATE OF title, author, artist, genres_json ON `manga` BEGIN
  UPDATE `manga_fts`
  SET title = new.title,
      author = trim(coalesce(new.author, '') || ' ' || coalesce(new.artist, '')),
      genres = new.genres_json
  WHERE rowid = new.id;
END;
