-- ============================================================================
-- Grand Line — schema_v1_turso.sql
--
-- Hand-curated single-file reference for the Turso/libSQL schema described in
-- §5 of the roadmap (`~/Downloads/grand-line-roadmap.docx`, Version 1.0).
--
-- The authoritative DDL is generated from `src/db/schema.ts` via:
--     npm run db:generate
-- and lives in `drizzle/migrations/`. **This file should not be applied
-- directly** — keep it in sync as documentation. If it diverges from the
-- generated migration, the migration wins.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- §5.1 Card foundation
-- ─────────────────────────────────────────────────────────────────────────

-- card_sets — booster / starter / extra / promo metadata.
CREATE TABLE card_sets (
  code         TEXT PRIMARY KEY,            -- 'OP01', 'ST01', 'EB01', 'PRB01'
  name_ja      TEXT NOT NULL,
  name_en      TEXT,
  release_date TEXT,                        -- ISO date YYYY-MM-DD
  set_type     TEXT NOT NULL,               -- booster|starter|extra|promo
  image_url    TEXT,
  created_at   INTEGER DEFAULT (unixepoch()) NOT NULL
);

-- cards — language-independent structural data.
-- CHECK constraints encode the rules:
--   leaders must have life; leader/character must have power; events must not.
CREATE TABLE cards (
  id            TEXT PRIMARY KEY,           -- 'OP01-001'
  set_code      TEXT NOT NULL REFERENCES card_sets(code) ON DELETE RESTRICT,
  card_type     TEXT NOT NULL,              -- LEADER|CHARACTER|EVENT|STAGE|DON
  colors        TEXT NOT NULL,              -- JSON string array
  attributes    TEXT NOT NULL,              -- JSON string array
  features      TEXT NOT NULL,              -- JSON string array
  mechanics     TEXT NOT NULL,              -- JSON string array (regex-extracted)
  cost          INTEGER,
  power         INTEGER,
  counter       INTEGER,
  life          INTEGER,
  rarity        TEXT,                       -- C|UC|R|SR|SEC|L|P|TR
  has_trigger   INTEGER NOT NULL DEFAULT 0, -- boolean
  image_url_jp  TEXT,
  image_url_en  TEXT,
  created_at    INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at    INTEGER DEFAULT (unixepoch()) NOT NULL,
  CONSTRAINT ck_leader_has_life CHECK (
    card_type != 'LEADER' OR (life IS NOT NULL AND life >= 0)
  ),
  -- Counter-only characters (お玉 / 光月モモの助 / 小紫) have no printed
  -- power, so this rule covers leaders only.
  CONSTRAINT ck_leader_has_power CHECK (
    card_type != 'LEADER' OR power IS NOT NULL
  ),
  CONSTRAINT ck_event_has_no_power CHECK (
    card_type != 'EVENT' OR (power IS NULL AND life IS NULL)
  )
);
CREATE INDEX idx_cards_set  ON cards(set_code);
CREATE INDEX idx_cards_type ON cards(card_type);

-- card_translations — language-specific text + provenance.
-- `source` + `verified` are the hallucination-honesty signal surfaced in UI.
CREATE TABLE card_translations (
  card_id            TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  language           TEXT NOT NULL,         -- 'ja' | 'en' | …
  name               TEXT NOT NULL,
  effect_text        TEXT,
  effect_normalized  TEXT,                  -- lower/whitespace-normalized
  flavor_text        TEXT,
  trigger_text       TEXT,
  source             TEXT NOT NULL,         -- official_jp|official_en|ai_translated|manual
  verified           INTEGER NOT NULL DEFAULT 0,
  source_url         TEXT,
  fetched_at         INTEGER,
  ai_model_version   TEXT,                  -- e.g. 'claude-sonnet-4-6@2026-05-07'
  created_at         INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at         INTEGER DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (card_id, language)
);
CREATE INDEX idx_translations_lang   ON card_translations(language);
CREATE INDEX idx_translations_source ON card_translations(source);

-- FTS5 mirror of card_translations for free-text search (trigram tokenizer
-- handles JP without segmentation). Triggers in 0001_fts5_translations.sql
-- keep it in sync with INSERT/UPDATE/DELETE on the base table.
CREATE VIRTUAL TABLE card_translations_fts USING fts5(
  card_id           UNINDEXED,
  language          UNINDEXED,
  name,
  effect_normalized,
  flavor_text,
  trigger_text,
  tokenize = 'trigram'
);

-- ─────────────────────────────────────────────────────────────────────────
-- §5.2 Decks
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE decks (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT,
  leader_card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  name               TEXT NOT NULL,
  format             TEXT NOT NULL DEFAULT 'standard',
  notes              TEXT,
  evaluation_scores  TEXT DEFAULT (json('{}')),
  is_public          INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at         INTEGER DEFAULT (unixepoch()) NOT NULL
);
CREATE INDEX idx_decks_leader ON decks(leader_card_id);
CREATE INDEX idx_decks_user   ON decks(user_id);

CREATE TABLE deck_cards (
  deck_id  TEXT NOT NULL REFERENCES decks(id)  ON DELETE CASCADE,
  card_id  TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  count    INTEGER NOT NULL,
  PRIMARY KEY (deck_id, card_id),
  CONSTRAINT ck_deck_card_count_range CHECK (count BETWEEN 1 AND 4)
);

-- ─────────────────────────────────────────────────────────────────────────
-- §5.3 Synergies, probability, scenarios
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE card_synergies (
  from_card_id      TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  to_card_id        TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  relation_type     TEXT NOT NULL,
  strength          REAL NOT NULL,
  reasoning_ja      TEXT,
  reasoning_en      TEXT,
  detected_by       TEXT NOT NULL,           -- rule | ai
  ai_model_version  TEXT,
  created_at        INTEGER DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (from_card_id, to_card_id, relation_type),
  CONSTRAINT ck_synergy_strength_range CHECK (strength BETWEEN 0 AND 10),
  CONSTRAINT ck_synergy_no_self_loop   CHECK (from_card_id != to_card_id)
);
CREATE INDEX idx_synergy_to ON card_synergies(to_card_id);

CREATE TABLE deck_probability_snapshots (
  id                  TEXT PRIMARY KEY,
  deck_id             TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_groups         TEXT NOT NULL,         -- {groupName: cardIds[]}
  turn_probabilities  TEXT NOT NULL,         -- {turn: {groupName: probability}}
  monte_carlo_trials  INTEGER NOT NULL DEFAULT 0,
  engine_version      TEXT NOT NULL,
  generated_at        INTEGER DEFAULT (unixepoch()) NOT NULL
);
CREATE INDEX idx_probsnap_deck ON deck_probability_snapshots(deck_id);

CREATE TABLE deck_scenarios (
  id                 TEXT PRIMARY KEY,
  deck_id            TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  scenario_type      TEXT NOT NULL,
  prior_probability  REAL,
  summary            TEXT,
  turn_by_turn       TEXT NOT NULL,
  ai_model_version   TEXT NOT NULL,
  generated_at       INTEGER DEFAULT (unixepoch()) NOT NULL
);
CREATE INDEX        idx_scenario_deck      ON deck_scenarios(deck_id);
CREATE UNIQUE INDEX uq_scenario_deck_type  ON deck_scenarios(deck_id, scenario_type);

CREATE TABLE deck_game_plans (
  deck_id           TEXT PRIMARY KEY REFERENCES decks(id) ON DELETE CASCADE,
  win_condition     TEXT,
  key_card_ids      TEXT NOT NULL,
  weakness          TEXT,
  matchup_notes     TEXT DEFAULT (json('{}')),
  ai_model_version  TEXT NOT NULL,
  updated_at        INTEGER DEFAULT (unixepoch()) NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- §5.4 Meta decks (input for opponent analysis)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE meta_decks (
  id                 TEXT PRIMARY KEY,
  leader_card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
  archetype_name     TEXT NOT NULL,
  archetype_family   TEXT NOT NULL,         -- rush|control|combo|mid_range|toolbox|other
  win_condition      TEXT,
  typical_cards      TEXT NOT NULL,         -- JSON array of card ids
  strong_against     TEXT NOT NULL,         -- JSON array of archetype names
  weak_against       TEXT NOT NULL,
  source_url         TEXT,
  tournament_name    TEXT,
  tournament_date    TEXT,
  placement          TEXT,
  region             TEXT,
  created_at         INTEGER DEFAULT (unixepoch()) NOT NULL
);
CREATE INDEX idx_meta_leader ON meta_decks(leader_card_id);
CREATE INDEX idx_meta_family ON meta_decks(archetype_family);

-- ─────────────────────────────────────────────────────────────────────────
-- §5.5 Tournaments
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE tournaments (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  region            TEXT NOT NULL,           -- jp|us|eu|au|mx|cn|tw|kr|sg|other
  country           TEXT,
  city              TEXT,
  venue             TEXT,
  event_date        TEXT NOT NULL,
  event_tier        TEXT NOT NULL DEFAULT 'other',
  registration_url  TEXT,
  official_url      TEXT,
  source_site       TEXT NOT NULL,
  raw               TEXT DEFAULT (json('{}')),
  last_fetched_at   INTEGER NOT NULL
);
CREATE INDEX        idx_tournaments_region_date ON tournaments(region, event_date);
CREATE UNIQUE INDEX uq_tournaments_source_id    ON tournaments(source_site, id);
