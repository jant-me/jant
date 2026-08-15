ALTER TABLE `post` ADD `language` text;--> statement-breakpoint
ALTER TABLE `post` ADD `translation_group_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_post_site_translation_group_language` ON `post` (`site_id`,`translation_group_id`,`language`) WHERE "post"."translation_group_id" IS NOT NULL;