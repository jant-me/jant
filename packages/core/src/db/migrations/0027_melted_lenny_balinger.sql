CREATE TABLE `site_notice` (
	`site_id` text NOT NULL,
	`key` text NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL,
	`action_label` text,
	`action_url` text,
	`expires_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`site_id`, `key`),
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_site_notice_severity" CHECK("site_notice"."severity" IN ('info', 'warn', 'urgent'))
);
--> statement-breakpoint
CREATE INDEX `idx_site_notice_site_id` ON `site_notice` (`site_id`);