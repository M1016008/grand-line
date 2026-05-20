CREATE TABLE `practice_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`cpu_skill` text NOT NULL,
	`rules_version` text NOT NULL,
	`player_leader_id` text NOT NULL,
	`opponent_leader_id` text NOT NULL,
	`game_count` integer NOT NULL,
	`summary_metrics` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_practice_runs_created` ON `practice_runs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_practice_runs_matchup` ON `practice_runs` (`player_leader_id`,`opponent_leader_id`,`cpu_skill`);
--> statement-breakpoint
CREATE TABLE `practice_games` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seed` integer NOT NULL,
	`first_player` text NOT NULL,
	`winner` text NOT NULL,
	`reason` text NOT NULL,
	`turns` integer NOT NULL,
	`player_life` integer NOT NULL,
	`opponent_life` integer NOT NULL,
	`player_deck_snapshot` text NOT NULL,
	`opponent_deck_snapshot` text NOT NULL,
	`summary_metrics` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `practice_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_practice_games_run` ON `practice_games` (`run_id`);
--> statement-breakpoint
CREATE INDEX `idx_practice_games_winner` ON `practice_games` (`winner`);
--> statement-breakpoint
CREATE INDEX `idx_practice_games_first_player` ON `practice_games` (`first_player`);
--> statement-breakpoint
CREATE TABLE `practice_events` (
	`game_id` text NOT NULL,
	`event_index` integer NOT NULL,
	`type` text NOT NULL,
	`turn` integer NOT NULL,
	`side` text,
	`payload` text NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`game_id`, `event_index`),
	FOREIGN KEY (`game_id`) REFERENCES `practice_games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_practice_events_type` ON `practice_events` (`type`);
--> statement-breakpoint
CREATE INDEX `idx_practice_events_game_turn` ON `practice_events` (`game_id`,`turn`);
