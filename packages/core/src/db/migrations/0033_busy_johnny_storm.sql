CREATE TABLE `smart_collection` (
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
	CONSTRAINT "chk_smart_collection_format" CHECK("smart_collection"."format" IS NULL OR "smart_collection"."format" IN ('note', 'link', 'quote')),
	CONSTRAINT "chk_smart_collection_visibility" CHECK("smart_collection"."visibility" IS NULL OR "smart_collection"."visibility" IN ('public', 'featured', 'latest_hidden')),
	CONSTRAINT "chk_smart_collection_sort" CHECK("smart_collection"."sort" IN ('newest', 'oldest', 'updated', 'rating_desc')),
	CONSTRAINT "chk_smart_collection_layout" CHECK("smart_collection"."layout" IS NULL OR "smart_collection"."layout" IN ('list', 'grid')),
	CONSTRAINT "chk_smart_collection_year" CHECK("smart_collection"."year" IS NULL OR "smart_collection"."year" BETWEEN 1971 AND 9999)
);
--> statement-breakpoint
CREATE INDEX `idx_smart_collection_site_created_at` ON `smart_collection` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_smart_collection_site_collection_id` ON `smart_collection` (`site_id`,`collection_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_collection_directory_item` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`type` text NOT NULL,
	`collection_id` text,
	`smart_collection_id` text,
	`label` text,
	`url` text,
	`description` text,
	`position` text DEFAULT 'a0' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`smart_collection_id`) REFERENCES `smart_collection`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_collection_directory_item_type" CHECK("__new_collection_directory_item"."type" IN ('collection', 'smart_collection', 'divider', 'link')),
	CONSTRAINT "chk_collection_directory_item_shape" CHECK((
        "__new_collection_directory_item"."type" = 'collection'
        AND "__new_collection_directory_item"."collection_id" IS NOT NULL
        AND "__new_collection_directory_item"."smart_collection_id" IS NULL
        AND "__new_collection_directory_item"."label" IS NULL
        AND "__new_collection_directory_item"."url" IS NULL
      ) OR (
        "__new_collection_directory_item"."type" = 'smart_collection'
        AND "__new_collection_directory_item"."collection_id" IS NULL
        AND "__new_collection_directory_item"."smart_collection_id" IS NOT NULL
        AND "__new_collection_directory_item"."label" IS NULL
        AND "__new_collection_directory_item"."url" IS NULL
      ) OR (
        "__new_collection_directory_item"."type" = 'divider'
        AND "__new_collection_directory_item"."collection_id" IS NULL
        AND "__new_collection_directory_item"."smart_collection_id" IS NULL
        AND "__new_collection_directory_item"."url" IS NULL
      ) OR (
        "__new_collection_directory_item"."type" = 'link'
        AND "__new_collection_directory_item"."collection_id" IS NULL
        AND "__new_collection_directory_item"."smart_collection_id" IS NULL
        AND "__new_collection_directory_item"."label" IS NOT NULL
        AND "__new_collection_directory_item"."url" IS NOT NULL
      )),
	CONSTRAINT "chk_collection_directory_item_label" CHECK("__new_collection_directory_item"."type" NOT IN ('collection', 'smart_collection') OR "__new_collection_directory_item"."label" IS NULL),
	CONSTRAINT "chk_collection_directory_item_description" CHECK("__new_collection_directory_item"."type" = 'link' OR "__new_collection_directory_item"."description" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_collection_directory_item`("id", "site_id", "type", "collection_id", "smart_collection_id", "label", "url", "description", "position", "created_at", "updated_at") SELECT "id", "site_id", "type", "collection_id", NULL, "label", "url", "description", "position", "created_at", "updated_at" FROM `collection_directory_item`;--> statement-breakpoint
DROP TABLE `collection_directory_item`;--> statement-breakpoint
ALTER TABLE `__new_collection_directory_item` RENAME TO `collection_directory_item`;--> statement-breakpoint
CREATE INDEX `idx_collection_directory_item_site_collection_id` ON `collection_directory_item` (`site_id`,`collection_id`);--> statement-breakpoint
CREATE INDEX `idx_collection_directory_item_site_smart_collection_id` ON `collection_directory_item` (`site_id`,`smart_collection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_collection_directory_item_site_position` ON `collection_directory_item` (`site_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_collection_directory_item_site_collection_once` ON `collection_directory_item` (`site_id`,`collection_id`) WHERE "collection_directory_item"."type" = 'collection' AND "collection_directory_item"."collection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_collection_directory_item_site_smart_collection_once` ON `collection_directory_item` (`site_id`,`smart_collection_id`) WHERE "collection_directory_item"."type" = 'smart_collection' AND "collection_directory_item"."smart_collection_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_nav_item` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`type` text DEFAULT 'link' NOT NULL,
	`system_key` text,
	`collection_id` text,
	`smart_collection_id` text,
	`post_id` text,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`placement` text DEFAULT 'header' NOT NULL,
	`position` text DEFAULT 'a0' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`smart_collection_id`) REFERENCES `smart_collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_nav_item_type" CHECK("__new_nav_item"."type" IN ('link', 'system', 'collection', 'smart_collection', 'page')),
	CONSTRAINT "chk_nav_item_placement" CHECK("__new_nav_item"."placement" IN ('header', 'more')),
	CONSTRAINT "chk_nav_item_shape" CHECK((
        "__new_nav_item"."type" = 'link'
        AND "__new_nav_item"."system_key" IS NULL
        AND "__new_nav_item"."collection_id" IS NULL
        AND "__new_nav_item"."smart_collection_id" IS NULL
        AND "__new_nav_item"."post_id" IS NULL
      ) OR (
        "__new_nav_item"."type" = 'system'
        AND "__new_nav_item"."system_key" IS NOT NULL
        AND "__new_nav_item"."collection_id" IS NULL
        AND "__new_nav_item"."smart_collection_id" IS NULL
        AND "__new_nav_item"."post_id" IS NULL
      ) OR (
        "__new_nav_item"."type" = 'collection'
        AND "__new_nav_item"."system_key" IS NULL
        AND "__new_nav_item"."collection_id" IS NOT NULL
        AND "__new_nav_item"."smart_collection_id" IS NULL
        AND "__new_nav_item"."post_id" IS NULL
      ) OR (
        "__new_nav_item"."type" = 'smart_collection'
        AND "__new_nav_item"."system_key" IS NULL
        AND "__new_nav_item"."collection_id" IS NULL
        AND "__new_nav_item"."smart_collection_id" IS NOT NULL
        AND "__new_nav_item"."post_id" IS NULL
      ) OR (
        "__new_nav_item"."type" = 'page'
        AND "__new_nav_item"."system_key" IS NULL
        AND "__new_nav_item"."collection_id" IS NULL
        AND "__new_nav_item"."smart_collection_id" IS NULL
        AND "__new_nav_item"."post_id" IS NOT NULL
      ))
);
--> statement-breakpoint
INSERT INTO `__new_nav_item`("id", "site_id", "type", "system_key", "collection_id", "smart_collection_id", "post_id", "label", "url", "placement", "position", "created_at", "updated_at") SELECT "id", "site_id", "type", "system_key", "collection_id", NULL, "post_id", "label", "url", "placement", "position", "created_at", "updated_at" FROM `nav_item`;--> statement-breakpoint
DROP TABLE `nav_item`;--> statement-breakpoint
ALTER TABLE `__new_nav_item` RENAME TO `nav_item`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_nav_item_site_position` ON `nav_item` (`site_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_nav_item_site_system_key` ON `nav_item` (`site_id`,`system_key`) WHERE "nav_item"."system_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_nav_item_site_collection_id` ON `nav_item` (`site_id`,`collection_id`) WHERE "nav_item"."collection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_nav_item_site_smart_collection_id` ON `nav_item` (`site_id`,`smart_collection_id`) WHERE "nav_item"."smart_collection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_nav_item_site_post_id` ON `nav_item` (`site_id`,`post_id`) WHERE "nav_item"."post_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_path_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`post_id` text,
	`collection_id` text,
	`smart_collection_id` text,
	`redirect_to_path` text,
	`redirect_type` integer,
	`archive_query` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`smart_collection_id`) REFERENCES `smart_collection`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_path_registry_kind" CHECK("__new_path_registry"."kind" IN ('slug', 'alias', 'redirect', 'archive')),
	CONSTRAINT "chk_path_registry_shape" CHECK((
        "__new_path_registry"."kind" IN ('slug', 'alias')
        AND (
          ("__new_path_registry"."post_id" IS NOT NULL AND "__new_path_registry"."collection_id" IS NULL AND "__new_path_registry"."smart_collection_id" IS NULL)
          OR ("__new_path_registry"."post_id" IS NULL AND "__new_path_registry"."collection_id" IS NOT NULL AND "__new_path_registry"."smart_collection_id" IS NULL)
          OR ("__new_path_registry"."post_id" IS NULL AND "__new_path_registry"."collection_id" IS NULL AND "__new_path_registry"."smart_collection_id" IS NOT NULL)
        )
        AND "__new_path_registry"."redirect_to_path" IS NULL
        AND "__new_path_registry"."redirect_type" IS NULL
        AND "__new_path_registry"."archive_query" IS NULL
      ) OR (
        "__new_path_registry"."kind" = 'redirect'
        AND "__new_path_registry"."post_id" IS NULL
        AND "__new_path_registry"."collection_id" IS NULL
        AND "__new_path_registry"."smart_collection_id" IS NULL
        AND "__new_path_registry"."redirect_to_path" IS NOT NULL
        AND "__new_path_registry"."redirect_type" IN (301, 302)
        AND "__new_path_registry"."archive_query" IS NULL
      ) OR (
        "__new_path_registry"."kind" = 'archive'
        AND "__new_path_registry"."post_id" IS NULL
        AND "__new_path_registry"."collection_id" IS NULL
        AND "__new_path_registry"."smart_collection_id" IS NULL
        AND "__new_path_registry"."redirect_to_path" IS NULL
        AND "__new_path_registry"."redirect_type" IS NULL
        AND "__new_path_registry"."archive_query" IS NOT NULL
      ))
);
--> statement-breakpoint
INSERT INTO `__new_path_registry`("id", "site_id", "path", "kind", "post_id", "collection_id", "smart_collection_id", "redirect_to_path", "redirect_type", "archive_query", "created_at", "updated_at") SELECT "id", "site_id", "path", "kind", "post_id", "collection_id", NULL, "redirect_to_path", "redirect_type", "archive_query", "created_at", "updated_at" FROM `path_registry`;--> statement-breakpoint
DROP TABLE `path_registry`;--> statement-breakpoint
ALTER TABLE `__new_path_registry` RENAME TO `path_registry`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_path_registry_site_path` ON `path_registry` (`site_id`,`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_path_registry_site_post_slug` ON `path_registry` (`site_id`,`post_id`) WHERE "path_registry"."kind" = 'slug' AND "path_registry"."post_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_path_registry_site_collection_slug` ON `path_registry` (`site_id`,`collection_id`) WHERE "path_registry"."kind" = 'slug' AND "path_registry"."collection_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_path_registry_site_smart_collection_slug` ON `path_registry` (`site_id`,`smart_collection_id`) WHERE "path_registry"."kind" = 'slug' AND "path_registry"."smart_collection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_path_registry_site_post_id` ON `path_registry` (`site_id`,`post_id`);--> statement-breakpoint
CREATE INDEX `idx_path_registry_site_collection_id` ON `path_registry` (`site_id`,`collection_id`);--> statement-breakpoint
CREATE INDEX `idx_path_registry_site_smart_collection_id` ON `path_registry` (`site_id`,`smart_collection_id`);