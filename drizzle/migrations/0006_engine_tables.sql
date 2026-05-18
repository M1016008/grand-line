CREATE TABLE `analysis_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`metric` text NOT NULL,
	`breakdown_json` text,
	`value` real,
	`computed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `simulation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_run_metric` ON `analysis_results` (`run_id`,`metric`);--> statement-breakpoint
CREATE TABLE `card_effects` (
	`card_id` text PRIMARY KEY NOT NULL,
	`dsl_json` text NOT NULL,
	`dsl_version` text NOT NULL,
	`is_vanilla` integer DEFAULT false NOT NULL,
	`has_ts_handler` integer DEFAULT false NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`authored_by` text NOT NULL,
	`ai_model_version` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_card_effects_vanilla_xor_handler" CHECK(NOT ("card_effects"."is_vanilla" = 1 AND "card_effects"."has_ts_handler" = 1))
);
--> statement-breakpoint
CREATE INDEX `idx_card_effects_verified` ON `card_effects` (`verified`);--> statement-breakpoint
CREATE TABLE `card_plays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`turn` integer NOT NULL,
	`actor` text NOT NULL,
	`card_id` text NOT NULL,
	`action` text NOT NULL,
	`outcome` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_card_plays_card` ON `card_plays` (`card_id`,`action`);--> statement-breakpoint
CREATE INDEX `idx_card_plays_game_turn` ON `card_plays` (`game_id`,`turn`);--> statement-breakpoint
CREATE TABLE `drill_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`drill_id` text NOT NULL,
	`user_play_json` text NOT NULL,
	`score` real,
	`claude_feedback` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`drill_id`) REFERENCES `drills`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_drill_attempts_drill` ON `drill_attempts` (`drill_id`);--> statement-breakpoint
CREATE TABLE `drills` (
	`id` text PRIMARY KEY NOT NULL,
	`leader_card_id` text NOT NULL,
	`don_count` integer NOT NULL,
	`hand_count` integer NOT NULL,
	`state_snapshot_json` text NOT NULL,
	`optimal_play_json` text,
	`claude_rationale` text,
	`difficulty` text,
	`source` text NOT NULL,
	`ai_model_version` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`leader_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_drills_leader` ON `drills` (`leader_card_id`);--> statement-breakpoint
CREATE INDEX `idx_drills_don_hand` ON `drills` (`don_count`,`hand_count`);--> statement-breakpoint
CREATE TABLE `game_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`seq` integer NOT NULL,
	`turn` integer NOT NULL,
	`phase` text NOT NULL,
	`actor` text NOT NULL,
	`event_type` text NOT NULL,
	`payload_json` text,
	`state_hash` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_events_game_seq` ON `game_events` (`game_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_events_event_type` ON `game_events` (`event_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_events_game_seq` ON `game_events` (`game_id`,`seq`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`game_index` integer NOT NULL,
	`rng_seed` text NOT NULL,
	`go_first` text NOT NULL,
	`winner` text,
	`end_condition` text,
	`turns` integer,
	`final_state_json` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `simulation_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_games_run` ON `games` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_games_run_index` ON `games` (`run_id`,`game_index`);--> statement-breakpoint
CREATE TABLE `simulation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`leader_a_id` text NOT NULL,
	`leader_b_id` text NOT NULL,
	`deck_a_id` text,
	`deck_b_id` text,
	`deck_a_snapshot_json` text NOT NULL,
	`deck_b_snapshot_json` text NOT NULL,
	`n_games` integer NOT NULL,
	`seed_base` text NOT NULL,
	`cpu_a_mode` text NOT NULL,
	`cpu_b_mode` text NOT NULL,
	`ablation_target_card_id` text,
	`ablation_replacement_card_id` text,
	`engine_version` text NOT NULL,
	`notes` text,
	`summary_json` text DEFAULT (json('{}')),
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`leader_a_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`leader_b_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`deck_a_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deck_b_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ablation_target_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ablation_replacement_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_sim_runs_n_games_positive" CHECK("simulation_runs"."n_games" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_sim_runs_leaders` ON `simulation_runs` (`leader_a_id`,`leader_b_id`);--> statement-breakpoint
CREATE INDEX `idx_sim_runs_created` ON `simulation_runs` (`created_at`);