CREATE TABLE `view_count` (
	`site_id` text NOT NULL,
	`day` text NOT NULL,
	`page` text NOT NULL,
	`referrer` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`site_id`, `day`, `page`, `referrer`),
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
