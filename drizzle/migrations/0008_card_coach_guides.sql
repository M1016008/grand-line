CREATE TABLE `card_coach_guides` (
	`card_id` text NOT NULL,
	`level` text NOT NULL,
	`guide_json` text NOT NULL,
	`source_data_hash` text NOT NULL,
	`prompt_version` text NOT NULL,
	`ai_model_version` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`card_id`, `level`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_card_coach_guides_updated_at` ON `card_coach_guides` (`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_card_coach_guides_source_hash` ON `card_coach_guides` (`source_data_hash`);
