CREATE TABLE `thread_collection` (
	`site_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`pinned_at` integer,
	PRIMARY KEY(`site_id`, `thread_id`, `collection_id`),
	FOREIGN KEY (`site_id`) REFERENCES `site`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_thread_collection_site_collection_id` ON `thread_collection` (`site_id`,`collection_id`);--> statement-breakpoint
CREATE INDEX `idx_thread_collection_site_collection_created_thread` ON `thread_collection` (`site_id`,`collection_id`,`created_at`,`thread_id`);--> statement-breakpoint
INSERT INTO `thread_collection` (
	`site_id`,
	`thread_id`,
	`collection_id`,
	`created_at`,
	`position`,
	`pinned_at`
)
SELECT
	`post_collection`.`site_id`,
	`post`.`thread_id`,
	`post_collection`.`collection_id`,
	MAX(`post_collection`.`created_at`),
	MIN(`post_collection`.`position`),
	MAX(`post_collection`.`pinned_at`)
FROM `post_collection`
INNER JOIN `post`
	ON `post`.`site_id` = `post_collection`.`site_id`
	AND `post`.`id` = `post_collection`.`post_id`
GROUP BY
	`post_collection`.`site_id`,
	`post`.`thread_id`,
	`post_collection`.`collection_id`;--> statement-breakpoint
DROP TABLE `post_collection`;
