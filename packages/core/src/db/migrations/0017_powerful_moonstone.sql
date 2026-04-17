CREATE TABLE `github_app_installation` (
	`installation_id` text NOT NULL,
	`site_id` text NOT NULL,
	`account_login` text NOT NULL,
	`account_type` text NOT NULL,
	`account_avatar_url` text DEFAULT '' NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`installation_id`, `site_id`),
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_github_app_installation_account_type" CHECK("github_app_installation"."account_type" IN ('User', 'Organization'))
);
--> statement-breakpoint
CREATE INDEX `github_app_installation_by_installation` ON `github_app_installation` (`installation_id`);--> statement-breakpoint
CREATE INDEX `github_app_installation_by_site` ON `github_app_installation` (`site_id`);