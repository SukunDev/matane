-- Extension repositories (Fase 4b): the accepted index and signature are kept; trust is a key, not a flag.
ALTER TABLE `extension_repos` DROP COLUMN `trusted`;--> statement-breakpoint
ALTER TABLE `extension_repos` ADD `index_json` text;--> statement-breakpoint
ALTER TABLE `extension_repos` ADD `signature` text;--> statement-breakpoint
ALTER TABLE `extension_repos` ADD `last_error` text;
