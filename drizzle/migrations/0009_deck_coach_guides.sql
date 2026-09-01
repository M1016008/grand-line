CREATE TABLE `deck_coach_guides` (
	`deck_id` text NOT NULL,
	`level` text NOT NULL,
	`deck_hash` text NOT NULL,
	`source_data_hash` text NOT NULL,
	`guide_json` text NOT NULL,
	`prompt_version` text NOT NULL,
	`ai_model_version` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`deck_id`, `level`),
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_deck_coach_guides_updated_at` ON `deck_coach_guides` (`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_deck_coach_guides_deck_hash` ON `deck_coach_guides` (`deck_hash`);
--> statement-breakpoint
CREATE INDEX `idx_deck_coach_guides_source_hash` ON `deck_coach_guides` (`source_data_hash`);
