CREATE TABLE `card_sets` (
	`code` text PRIMARY KEY NOT NULL,
	`name_ja` text NOT NULL,
	`name_en` text,
	`release_date` text,
	`set_type` text NOT NULL,
	`image_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `card_synergies` (
	`from_card_id` text NOT NULL,
	`to_card_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`strength` real NOT NULL,
	`reasoning_ja` text,
	`reasoning_en` text,
	`detected_by` text NOT NULL,
	`ai_model_version` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`from_card_id`, `to_card_id`, `relation_type`),
	FOREIGN KEY (`from_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_synergy_strength_range" CHECK("card_synergies"."strength" >= 0 AND "card_synergies"."strength" <= 10),
	CONSTRAINT "ck_synergy_no_self_loop" CHECK("card_synergies"."from_card_id" != "card_synergies"."to_card_id")
);
--> statement-breakpoint
CREATE INDEX `idx_synergy_to` ON `card_synergies` (`to_card_id`);--> statement-breakpoint
CREATE TABLE `card_translations` (
	`card_id` text NOT NULL,
	`language` text NOT NULL,
	`name` text NOT NULL,
	`effect_text` text,
	`effect_normalized` text,
	`flavor_text` text,
	`trigger_text` text,
	`source` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`source_url` text,
	`fetched_at` integer,
	`ai_model_version` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`card_id`, `language`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_translations_lang` ON `card_translations` (`language`);--> statement-breakpoint
CREATE INDEX `idx_translations_source` ON `card_translations` (`source`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`set_code` text NOT NULL,
	`card_type` text NOT NULL,
	`colors` text NOT NULL,
	`attributes` text NOT NULL,
	`features` text NOT NULL,
	`mechanics` text NOT NULL,
	`cost` integer,
	`power` integer,
	`counter` integer,
	`life` integer,
	`rarity` text,
	`has_trigger` integer DEFAULT false NOT NULL,
	`image_url_jp` text,
	`image_url_en` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`set_code`) REFERENCES `card_sets`(`code`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_leader_has_life" CHECK(("cards"."card_type" != 'LEADER') OR ("cards"."life" IS NOT NULL AND "cards"."life" >= 0)),
	CONSTRAINT "ck_leader_or_character_has_power" CHECK(("cards"."card_type" NOT IN ('LEADER', 'CHARACTER')) OR ("cards"."power" IS NOT NULL)),
	CONSTRAINT "ck_event_has_no_power" CHECK(("cards"."card_type" != 'EVENT') OR ("cards"."power" IS NULL AND "cards"."life" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_cards_set` ON `cards` (`set_code`);--> statement-breakpoint
CREATE INDEX `idx_cards_type` ON `cards` (`card_type`);--> statement-breakpoint
CREATE TABLE `deck_cards` (
	`deck_id` text NOT NULL,
	`card_id` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`deck_id`, `card_id`),
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_deck_card_count_range" CHECK("deck_cards"."count" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE `deck_game_plans` (
	`deck_id` text PRIMARY KEY NOT NULL,
	`win_condition` text,
	`key_card_ids` text NOT NULL,
	`weakness` text,
	`matchup_notes` text DEFAULT (json('{}')),
	`ai_model_version` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `deck_probability_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`card_groups` text NOT NULL,
	`turn_probabilities` text NOT NULL,
	`monte_carlo_trials` integer DEFAULT 0 NOT NULL,
	`engine_version` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_probsnap_deck` ON `deck_probability_snapshots` (`deck_id`);--> statement-breakpoint
CREATE TABLE `deck_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`scenario_type` text NOT NULL,
	`prior_probability` real,
	`summary` text,
	`turn_by_turn` text NOT NULL,
	`ai_model_version` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scenario_deck` ON `deck_scenarios` (`deck_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_scenario_deck_type` ON `deck_scenarios` (`deck_id`,`scenario_type`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`leader_card_id` text NOT NULL,
	`name` text NOT NULL,
	`format` text DEFAULT 'standard' NOT NULL,
	`notes` text,
	`evaluation_scores` text DEFAULT (json('{}')),
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`leader_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_decks_leader` ON `decks` (`leader_card_id`);--> statement-breakpoint
CREATE INDEX `idx_decks_user` ON `decks` (`user_id`);--> statement-breakpoint
CREATE TABLE `meta_decks` (
	`id` text PRIMARY KEY NOT NULL,
	`leader_card_id` text NOT NULL,
	`archetype_name` text NOT NULL,
	`archetype_family` text NOT NULL,
	`win_condition` text,
	`typical_cards` text NOT NULL,
	`strong_against` text NOT NULL,
	`weak_against` text NOT NULL,
	`source_url` text,
	`tournament_name` text,
	`tournament_date` text,
	`placement` text,
	`region` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`leader_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_meta_leader` ON `meta_decks` (`leader_card_id`);--> statement-breakpoint
CREATE INDEX `idx_meta_family` ON `meta_decks` (`archetype_family`);--> statement-breakpoint
CREATE TABLE `tournaments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region` text NOT NULL,
	`country` text,
	`city` text,
	`venue` text,
	`event_date` text NOT NULL,
	`event_tier` text DEFAULT 'other' NOT NULL,
	`registration_url` text,
	`official_url` text,
	`source_site` text NOT NULL,
	`raw` text DEFAULT (json('{}')),
	`last_fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tournaments_region_date` ON `tournaments` (`region`,`event_date`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_tournaments_source_id` ON `tournaments` (`source_site`,`id`);