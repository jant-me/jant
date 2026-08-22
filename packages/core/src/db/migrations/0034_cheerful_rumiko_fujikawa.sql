-- `updated` was a fourth smart collection order until `newest` came to mean the
-- same thing. The rebuild below narrows the CHECK to three, so any row still
-- naming it has to be moved first or the copy fails on its own constraint.
UPDATE `smart_collection` SET `sort` = 'newest' WHERE `sort` = 'updated';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_smart_collection` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`format` text,
	`year` integer,
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
	CONSTRAINT "chk_smart_collection_format" CHECK("__new_smart_collection"."format" IS NULL OR "__new_smart_collection"."format" IN ('note', 'link', 'quote')),
	CONSTRAINT "chk_smart_collection_visibility" CHECK("__new_smart_collection"."visibility" IS NULL OR "__new_smart_collection"."visibility" IN ('public', 'featured', 'latest_hidden')),
	CONSTRAINT "chk_smart_collection_sort" CHECK("__new_smart_collection"."sort" IN ('newest', 'oldest', 'rating_desc')),
	CONSTRAINT "chk_smart_collection_layout" CHECK("__new_smart_collection"."layout" IS NULL OR "__new_smart_collection"."layout" IN ('list', 'grid')),
	CONSTRAINT "chk_smart_collection_year" CHECK("__new_smart_collection"."year" IS NULL OR "__new_smart_collection"."year" BETWEEN 1971 AND 9999)
);
--> statement-breakpoint
INSERT INTO `__new_smart_collection`("id", "site_id", "title", "description", "format", "year", "collection_id", "media", "has_title", "has_replies", "visibility", "sort", "layout", "created_at", "updated_at") SELECT "id", "site_id", "title", "description", "format", "year", "collection_id", "media", "has_title", "has_replies", "visibility", "sort", "layout", "created_at", "updated_at" FROM `smart_collection`;--> statement-breakpoint
DROP TABLE `smart_collection`;--> statement-breakpoint
ALTER TABLE `__new_smart_collection` RENAME TO `smart_collection`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_smart_collection_site_created_at` ON `smart_collection` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_smart_collection_site_collection_id` ON `smart_collection` (`site_id`,`collection_id`);