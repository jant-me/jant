CREATE TABLE `oauth_client` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_client_site_id` ON `oauth_client` (`site_id`);--> statement-breakpoint
CREATE TABLE `oauth_code` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_code_code_hash_unique` ON `oauth_code` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_oauth_code_site_id` ON `oauth_code` (`site_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_code_client_id` ON `oauth_code` (`client_id`);