CREATE TABLE `view_hour` (
	`site_id` text NOT NULL,
	`hour` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`site_id`, `hour`),
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade
);
