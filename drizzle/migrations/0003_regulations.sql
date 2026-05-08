CREATE TABLE `card_restriction_pairs` (
	`card_id_a` text NOT NULL,
	`card_id_b` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_until` text,
	`source_url` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`card_id_a`, `card_id_b`, `effective_from`),
	FOREIGN KEY (`card_id_a`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id_b`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_restriction_pair_ordered" CHECK("card_restriction_pairs"."card_id_a" < "card_restriction_pairs"."card_id_b")
);
--> statement-breakpoint
CREATE INDEX `idx_restriction_pairs_b` ON `card_restriction_pairs` (`card_id_b`);--> statement-breakpoint
CREATE TABLE `card_restrictions` (
	`card_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`effective_until` text,
	`max_copies` integer NOT NULL,
	`reason` text,
	`source_url` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `effective_from`),
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ck_restrictions_max_copies_range" CHECK("card_restrictions"."max_copies" >= 0 AND "card_restrictions"."max_copies" <= 4)
);
--> statement-breakpoint
CREATE INDEX `idx_restrictions_active` ON `card_restrictions` (`card_id`,`effective_until`);