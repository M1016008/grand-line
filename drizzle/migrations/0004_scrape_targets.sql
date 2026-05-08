CREATE TABLE `scrape_targets` (
	`set_code` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`name_ja` text NOT NULL,
	`source` text NOT NULL,
	`last_scraped_at` integer,
	`discovered_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scrape_targets_seriesId_unique` ON `scrape_targets` (`series_id`);--> statement-breakpoint
CREATE INDEX `idx_scrape_targets_source` ON `scrape_targets` (`source`);