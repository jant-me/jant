ALTER TABLE `post` ADD `quiet_reply` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `post` ADD `thread_updated_at` integer;--> statement-breakpoint
CREATE INDEX `idx_post_site_root_thread_updated` ON `post` (`site_id`,`thread_updated_at`,`id`) WHERE "post"."reply_to_id" IS NULL AND "post"."status" = 'published';