CREATE TABLE `extension_prefs` (
	`extension_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	PRIMARY KEY(`extension_id`, `key`),
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `extension_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`name` text,
	`public_key` text,
	`trusted` integer DEFAULT false NOT NULL,
	`last_fetched_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extension_repos_url_unique` ON `extension_repos` (`url`);--> statement-breakpoint
CREATE TABLE `extension_storage` (
	`extension_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	PRIMARY KEY(`extension_id`, `key`),
	FOREIGN KEY (`extension_id`) REFERENCES `extensions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`api_version` integer NOT NULL,
	`repo_id` integer,
	`nsfw` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `extension_repos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`extension_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`lang` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sources_extension_key_unique` ON `sources` (`extension_id`,`key`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`settings_json` text
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manga_id` integer NOT NULL,
	`url` text NOT NULL,
	`name` text NOT NULL,
	`number` real,
	`scanlator` text,
	`uploaded_at` integer,
	`source_order` integer DEFAULT 0 NOT NULL,
	`fetched_at` integer NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`read_at` integer,
	`bookmarked` integer DEFAULT false NOT NULL,
	`last_page` integer DEFAULT 0 NOT NULL,
	`total_pages` integer,
	`page_offset` real,
	`source_missing` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`manga_id`) REFERENCES `manga`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_manga_url_unique` ON `chapters` (`manga_id`,`url`);--> statement-breakpoint
CREATE INDEX `chapters_manga_number_idx` ON `chapters` (`manga_id`,`number`);--> statement-breakpoint
CREATE INDEX `chapters_fetched_at_idx` ON `chapters` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `manga` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`artist` text,
	`description` text,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`type` text,
	`thumbnail_url` text,
	`cover_path` text,
	`custom_cover_path` text,
	`cover_color` text,
	`in_library` integer DEFAULT false NOT NULL,
	`added_at` integer,
	`favorite_order` integer,
	`last_update_check_at` integer,
	`latest_chapter_at` integer,
	`reader_settings_json` text,
	`scanlator_prefs_json` text,
	`chapter_view_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manga_source_url_unique` ON `manga` (`source_id`,`url`);--> statement-breakpoint
CREATE INDEX `manga_in_library_idx` ON `manga` (`in_library`);--> statement-breakpoint
CREATE TABLE `manga_categories` (
	`manga_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	PRIMARY KEY(`manga_id`, `category_id`),
	FOREIGN KEY (`manga_id`) REFERENCES `manga`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `manga_categories_category_idx` ON `manga_categories` (`category_id`);--> statement-breakpoint
CREATE TABLE `page_list_cache` (
	`chapter_id` integer PRIMARY KEY NOT NULL,
	`pages_json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `history` (
	`manga_id` integer PRIMARY KEY NOT NULL,
	`chapter_id` integer NOT NULL,
	`read_at` integer NOT NULL,
	FOREIGN KEY (`manga_id`) REFERENCES `manga`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `page_bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chapter_id` integer NOT NULL,
	`page_index` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_bookmarks_chapter_page_unique` ON `page_bookmarks` (`chapter_id`,`page_index`);--> statement-breakpoint
CREATE TABLE `reading_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manga_id` integer NOT NULL,
	`chapter_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`active_ms` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`manga_id`) REFERENCES `manga`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reading_sessions_started_at_idx` ON `reading_sessions` (`started_at`);--> statement-breakpoint
CREATE TABLE `downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chapter_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`queue_order` integer DEFAULT 0 NOT NULL,
	`pages_done` integer DEFAULT 0 NOT NULL,
	`pages_total` integer,
	`error` text,
	`format` text DEFAULT 'cbz' NOT NULL,
	`path` text,
	`size_bytes` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `downloads_chapterId_unique` ON `downloads` (`chapter_id`);--> statement-breakpoint
CREATE INDEX `downloads_status_order_idx` ON `downloads` (`status`,`queue_order`);--> statement-breakpoint
CREATE TABLE `image_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_type` text,
	`width` integer,
	`height` integer,
	`segments` integer DEFAULT 1 NOT NULL,
	`variants_json` text,
	`last_access_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `image_cache_last_access_idx` ON `image_cache` (`last_access_at`);--> statement-breakpoint
CREATE TABLE `manga_tracks` (
	`manga_id` integer NOT NULL,
	`service` text NOT NULL,
	`remote_id` text NOT NULL,
	`remote_url` text,
	`status` text,
	`score` real,
	`progress` real,
	`started_at` integer,
	`finished_at` integer,
	`sync_back` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`manga_id`, `service`),
	FOREIGN KEY (`manga_id`) REFERENCES `manga`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tracker_accounts` (
	`service` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`username` text,
	`token_encrypted` text,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `tracker_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manga_id` integer NOT NULL,
	`service` text NOT NULL,
	`payload_json` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	FOREIGN KEY (`manga_id`) REFERENCES `manga`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
