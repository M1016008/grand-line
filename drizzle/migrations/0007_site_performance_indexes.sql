-- Hand-authored migration: indexes used by the public site routes.
--
-- The table sizes are still modest, but the app repeatedly loads large card
-- slices for /cards, /battle, /practice, /synergy, and deck building. These
-- covering/composite indexes keep those reads stable as new sets are scraped.

CREATE INDEX IF NOT EXISTS `idx_cards_set_id` ON `cards` (`set_code`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cards_type_set_id` ON `cards` (`card_type`, `set_code`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cards_cost_set_id` ON `cards` (`cost`, `set_code`, `id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_card_set_membership_set_card` ON `card_set_membership` (`set_code`, `card_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_restriction_pairs_a_active` ON `card_restriction_pairs` (`card_id_a`, `effective_until`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_restriction_pairs_b_active` ON `card_restriction_pairs` (`card_id_b`, `effective_until`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_synergy_ai_from_relation` ON `card_synergies` (`detected_by`, `from_card_id`, `relation_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_synergy_ai_to_relation` ON `card_synergies` (`detected_by`, `to_card_id`, `relation_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_translations_fetched_at` ON `card_translations` (`fetched_at`);
