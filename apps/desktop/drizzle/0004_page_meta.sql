CREATE TABLE `page_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`crop_left` integer,
	`crop_top` integer,
	`crop_width` integer,
	`crop_height` integer,
	`accessed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `page_meta_accessed_idx` ON `page_meta` (`accessed_at`);--> statement-breakpoint
ALTER TABLE `image_cache` DROP COLUMN `width`;--> statement-breakpoint
ALTER TABLE `image_cache` DROP COLUMN `height`;--> statement-breakpoint
ALTER TABLE `image_cache` DROP COLUMN `segments`;--> statement-breakpoint
ALTER TABLE `image_cache` DROP COLUMN `variants_json`;