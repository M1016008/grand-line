CREATE TABLE `card_set_membership` (
	`card_id` text NOT NULL,
	`set_code` text NOT NULL,
	PRIMARY KEY(`card_id`, `set_code`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_code`) REFERENCES `card_sets`(`code`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_card_set_membership_set` ON `card_set_membership` (`set_code`);
--> statement-breakpoint
-- Backfill: every existing card is already a member of its canonical set.
-- Reprints across other sets (e.g. OP01-001 also appearing in PRB02) are
-- picked up by re-running the scraper after this migration is applied.
INSERT INTO `card_set_membership` (`card_id`, `set_code`)
SELECT `id`, `set_code` FROM `cards`
WHERE NOT EXISTS (
  SELECT 1 FROM `card_set_membership` m
  WHERE m.`card_id` = `cards`.`id` AND m.`set_code` = `cards`.`set_code`
);