PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_view_count` (
	`site_id` text NOT NULL,
	`day` text NOT NULL,
	`page` text NOT NULL,
	`referrer` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`site_id`, `day`, `page`, `referrer`),
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_view_count`("site_id", "day", "page", "referrer", "count") SELECT "site_id", "day", "page", "referrer", SUM("count") FROM `view_count` GROUP BY "site_id", "day", "page", "referrer";--> statement-breakpoint
DROP TABLE `view_count`;--> statement-breakpoint
ALTER TABLE `__new_view_count` RENAME TO `view_count`;--> statement-breakpoint
PRAGMA foreign_keys=ON;