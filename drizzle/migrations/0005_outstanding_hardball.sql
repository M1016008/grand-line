CREATE TABLE `card_playstyles` (
	`card_id` text PRIMARY KEY NOT NULL,
	`when_to_play_ja` text NOT NULL,
	`shines_in_ja` text NOT NULL,
	`vs_opponent_ja` text NOT NULL,
	`ai_model_version` text NOT NULL,
	`generated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
