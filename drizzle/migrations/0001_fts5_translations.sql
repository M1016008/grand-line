-- Hand-authored migration: FTS5 search over card translations.
-- Drizzle does not generate SQLite virtual tables, so the index
-- and its sync triggers are managed here.
--
-- Tokenizer: trigram (handles JP without explicit segmentation; see
-- https://www.sqlite.org/fts5.html#the_trigram_tokenizer). Falls back to
-- unicode61 + remove_diacritics if your libSQL build lacks trigram.

CREATE VIRTUAL TABLE IF NOT EXISTS card_translations_fts USING fts5(
  card_id UNINDEXED,
  language UNINDEXED,
  name,
  effect_normalized,
  flavor_text,
  trigger_text,
  tokenize = 'trigram'
);
--> statement-breakpoint

-- Backfill (no-op on a fresh DB; safe to re-run).
INSERT INTO card_translations_fts (card_id, language, name, effect_normalized, flavor_text, trigger_text)
SELECT card_id, language, name, COALESCE(effect_normalized, ''), COALESCE(flavor_text, ''), COALESCE(trigger_text, '')
FROM card_translations;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS card_translations_ai AFTER INSERT ON card_translations BEGIN
  INSERT INTO card_translations_fts (card_id, language, name, effect_normalized, flavor_text, trigger_text)
  VALUES (NEW.card_id, NEW.language, NEW.name, COALESCE(NEW.effect_normalized, ''), COALESCE(NEW.flavor_text, ''), COALESCE(NEW.trigger_text, ''));
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS card_translations_ad AFTER DELETE ON card_translations BEGIN
  DELETE FROM card_translations_fts WHERE card_id = OLD.card_id AND language = OLD.language;
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS card_translations_au AFTER UPDATE ON card_translations BEGIN
  DELETE FROM card_translations_fts WHERE card_id = OLD.card_id AND language = OLD.language;
  INSERT INTO card_translations_fts (card_id, language, name, effect_normalized, flavor_text, trigger_text)
  VALUES (NEW.card_id, NEW.language, NEW.name, COALESCE(NEW.effect_normalized, ''), COALESCE(NEW.flavor_text, ''), COALESCE(NEW.trigger_text, ''));
END;
