CREATE TABLE `__keep_collection_directory_item` AS SELECT * FROM `collection_directory_item`;--> statement-breakpoint
CREATE TABLE `__keep_nav_item` AS SELECT * FROM `nav_item`;--> statement-breakpoint
CREATE TABLE `__keep_path_registry` AS SELECT * FROM `path_registry`;--> statement-breakpoint
DELETE FROM `collection_directory_item`;--> statement-breakpoint
DELETE FROM `nav_item`;--> statement-breakpoint
DELETE FROM `path_registry`;--> statement-breakpoint
CREATE TABLE `__new_smart_collection` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`match_mode` text DEFAULT 'all' NOT NULL,
	`format` text,
	`year` text,
	`collection_id` text,
	`media` text,
	`has_title` integer,
	`has_replies` integer,
	`visibility` text,
	`sort` text DEFAULT 'newest' NOT NULL,
	`layout` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_smart_collection_match_mode" CHECK("__new_smart_collection"."match_mode" IN ('all', 'any')),
	CONSTRAINT "chk_smart_collection_format" CHECK("__new_smart_collection"."format" IS NULL OR "__new_smart_collection"."format" IN ('note', 'link', 'note,link', 'quote', 'note,quote', 'link,quote', 'note,link,quote')),
	CONSTRAINT "chk_smart_collection_visibility" CHECK("__new_smart_collection"."visibility" IS NULL OR "__new_smart_collection"."visibility" IN ('public', 'featured', 'public,featured', 'latest_hidden', 'public,latest_hidden', 'featured,latest_hidden', 'public,featured,latest_hidden')),
	CONSTRAINT "chk_smart_collection_sort" CHECK("__new_smart_collection"."sort" IN ('newest', 'oldest', 'rating_desc')),
	CONSTRAINT "chk_smart_collection_layout" CHECK("__new_smart_collection"."layout" IS NULL OR "__new_smart_collection"."layout" IN ('list', 'grid')),
	CONSTRAINT "chk_smart_collection_year" CHECK("__new_smart_collection"."year" IS NULL OR trim("__new_smart_collection"."year") <> '')
);
--> statement-breakpoint
INSERT INTO `__new_smart_collection`("id", "site_id", "title", "description", "match_mode", "format", "year", "collection_id", "media", "has_title", "has_replies", "visibility", "sort", "layout", "created_at", "updated_at") SELECT "id", "site_id", "title", "description", 'all', "format", CAST("year" AS TEXT), "collection_id", "media", "has_title", "has_replies", "visibility", "sort", "layout", "created_at", "updated_at" FROM `smart_collection`;--> statement-breakpoint
DROP TABLE `smart_collection`;--> statement-breakpoint
ALTER TABLE `__new_smart_collection` RENAME TO `smart_collection`;--> statement-breakpoint
CREATE INDEX `idx_smart_collection_site_created_at` ON `smart_collection` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_smart_collection_site_collection_id` ON `smart_collection` (`site_id`,`collection_id`);--> statement-breakpoint
INSERT INTO `collection_directory_item` ("id", "site_id", "type", "collection_id", "smart_collection_id", "label", "url", "description", "position", "created_at", "updated_at") SELECT `id`, `site_id`, `type`, `collection_id`, `smart_collection_id`, `label`, `url`, `description`, `position`, `created_at`, `updated_at` FROM `__keep_collection_directory_item`;--> statement-breakpoint
INSERT INTO `nav_item` ("id", "site_id", "type", "system_key", "collection_id", "smart_collection_id", "post_id", "label", "url", "placement", "position", "created_at", "updated_at") SELECT `id`, `site_id`, `type`, `system_key`, `collection_id`, `smart_collection_id`, `post_id`, `label`, `url`, `placement`, `position`, `created_at`, `updated_at` FROM `__keep_nav_item`;--> statement-breakpoint
INSERT INTO `path_registry` ("id", "site_id", "path", "kind", "post_id", "collection_id", "smart_collection_id", "redirect_to_path", "redirect_type", "archive_query", "created_at", "updated_at") SELECT `id`, `site_id`, `path`, `kind`, `post_id`, `collection_id`, `smart_collection_id`, `redirect_to_path`, `redirect_type`, `archive_query`, `created_at`, `updated_at` FROM `__keep_path_registry`;--> statement-breakpoint
DROP TABLE `__keep_collection_directory_item`;--> statement-breakpoint
DROP TABLE `__keep_nav_item`;--> statement-breakpoint
DROP TABLE `__keep_path_registry`;
