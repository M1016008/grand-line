/**
 * Grand Line — Drizzle schema (libSQL/SQLite)
 *
 * Mirrors the data model in `~/Downloads/grand-line-roadmap.docx` §5.
 * The hand-authored SQL counterpart lives at `drizzle/schema_v1_turso.sql`
 * (kept in sync as a human-readable reference).
 *
 * Conventions
 *  - Snake_case column names via `casing: "snake_case"` in drizzle config.
 *  - JSON arrays/objects stored as TEXT through `text({ mode: "json" })`.
 *  - `cards.id` is the human-readable `OP01-001` style identifier.
 *  - `card_translations` is keyed by (card_id, language) and tracks
 *    `source` + `verified` so the UI can render a hallucination-honest badge.
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/* ──────────────────────────────────────────────────────────────────────── */
/* §5.1 Card foundation                                                     */
/* ──────────────────────────────────────────────────────────────────────── */

export const cardSets = sqliteTable("card_sets", {
  /** Set code, e.g. `OP01`, `ST01`, `EB01`, `PRB01`. */
  code: text().primaryKey(),
  nameJa: text().notNull(),
  nameEn: text(),
  /** ISO date string (YYYY-MM-DD). */
  releaseDate: text(),
  /** booster | starter | extra | promo */
  setType: text({ enum: ["booster", "starter", "extra", "promo"] }).notNull(),
  imageUrl: text(),
  createdAt: integer({ mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const cards = sqliteTable(
  "cards",
  {
    /** `OP01-001` style id. */
    id: text().primaryKey(),
    setCode: text()
      .notNull()
      .references(() => cardSets.code, { onDelete: "restrict" }),
    cardType: text({
      enum: ["LEADER", "CHARACTER", "EVENT", "STAGE", "DON"],
    }).notNull(),

    /** JSON string array, e.g. `["red", "yellow"]`. */
    colors: text({ mode: "json" }).$type<string[]>().notNull(),
    /** Logical attribute tags (slash, strike, ranged, special, wisdom). */
    attributes: text({ mode: "json" }).$type<string[]>().notNull(),
    /** Free-text feature tags (麦わらの一味, 王下七武海, etc.). */
    features: text({ mode: "json" }).$type<string[]>().notNull(),
    /** Normalized rule keywords (DON!!アクティブ化, ブロッカー, etc.). */
    mechanics: text({ mode: "json" }).$type<string[]>().notNull(),

    cost: integer(),
    power: integer(),
    counter: integer(),
    life: integer(),

    rarity: text({
      enum: ["C", "UC", "R", "SR", "SEC", "L", "P", "TR"],
    }),
    hasTrigger: integer({ mode: "boolean" }).notNull().default(false),

    imageUrlJp: text(),
    imageUrlEn: text(),

    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_cards_set").on(t.setCode),
    index("idx_cards_type").on(t.cardType),
    /* Hallucination-related rule constraints. */
    check(
      "ck_leader_has_life",
      sql`(${t.cardType} != 'LEADER') OR (${t.life} IS NOT NULL AND ${t.life} >= 0)`,
    ),
    // Leaders always print a power. Characters do *not*: OPTCG has
    // counter-only characters (お玉 / 光月モモの助 / 小紫 etc.) with no
    // printed power. So the rule is leader-only.
    check(
      "ck_leader_has_power",
      sql`(${t.cardType} != 'LEADER') OR (${t.power} IS NOT NULL)`,
    ),
    check(
      "ck_event_has_no_power",
      sql`(${t.cardType} != 'EVENT') OR (${t.power} IS NULL AND ${t.life} IS NULL)`,
    ),
  ],
);

/**
 * Discoverable Bandai dropdown entries. Acts as a runtime extension of the
 * static `SERIES_PARAM` table in `src/scrapers/bandai-jp/fetch.ts`: the
 * "discover new sets" flow inserts new rows here when Bandai adds a pack
 * that isn't yet in our hardcoded list, so the user can click-to-scrape
 * without editing source.
 *
 * `set_code` is the human-facing label (e.g. "OP16"); `series_id` is the
 * value Bandai's `<select id="series">` uses (e.g. "550116"). Both are
 * unique. `last_scraped_at` is null until the user (or a cron) actually
 * runs the per-set scraper.
 */
export const scrapeTargets = sqliteTable(
  "scrape_targets",
  {
    setCode: text().primaryKey(),
    seriesId: text().notNull().unique(),
    nameJa: text().notNull(),
    /** 'static' = mirrored from SERIES_PARAM; 'discovered' = found by discover. */
    source: text({ enum: ["static", "discovered"] }).notNull(),
    lastScrapedAt: integer({ mode: "timestamp" }),
    discoveredAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("idx_scrape_targets_source").on(t.source)],
);

/**
 * Banned / restricted cards as published on
 * https://www.onepiece-cardgame.com/news/restriction.html.
 *
 * `max_copies` semantics:
 *   0 = banned (cannot include in deck at all)
 *   1 = restricted to 1 copy
 *   2-3 = restricted to N copies
 * Anything not present in this table follows the default rule (≤ 4 copies).
 *
 * One row per card per regulation revision. The "current" row for a card
 * is the one with `effective_until IS NULL`. The deck-rules validator
 * only consults current rows.
 */
export const cardRestrictions = sqliteTable(
  "card_restrictions",
  {
    cardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** ISO date (YYYY-MM-DD) when this restriction took effect. */
    effectiveFrom: text().notNull(),
    /** ISO date when superseded; null if currently active. */
    effectiveUntil: text(),
    maxCopies: integer().notNull(),
    reason: text(),
    sourceUrl: text().notNull(),
    fetchedAt: integer({ mode: "timestamp" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.effectiveFrom] }),
    index("idx_restrictions_active").on(t.cardId, t.effectiveUntil),
    check(
      "ck_restrictions_max_copies_range",
      sql`${t.maxCopies} >= 0 AND ${t.maxCopies} <= 4`,
    ),
  ],
);

/**
 * Banned card pairs ("禁止ペア"): A and B cannot appear together in the
 * same deck, even though each one alone is legal. Stored normalized so
 * card_id_a always precedes card_id_b alphabetically — this avoids
 * double-row representations of the same pair.
 */
export const cardRestrictionPairs = sqliteTable(
  "card_restriction_pairs",
  {
    cardIdA: text()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    cardIdB: text()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    effectiveFrom: text().notNull(),
    effectiveUntil: text(),
    sourceUrl: text().notNull(),
    fetchedAt: integer({ mode: "timestamp" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cardIdA, t.cardIdB, t.effectiveFrom] }),
    index("idx_restriction_pairs_b").on(t.cardIdB),
    check("ck_restriction_pair_ordered", sql`${t.cardIdA} < ${t.cardIdB}`),
  ],
);

/**
 * Many-to-many between `cards` and `card_sets`.
 *
 * `cards.set_code` records the canonical owning set (derived from the id
 * prefix — `OP01-001` always belongs to `OP01`). But cards are routinely
 * reprinted: an OP01-001 might also appear in a PRB02 best-of pack, an
 * EB04 anniversary set, etc. The id stays the same; the set membership
 * grows. Without a join table, filtering by `set_code = 'PRB02'` would
 * only show cards with PRB02-prefixed ids, which misses the bulk of the
 * pack's actual contents.
 *
 * The scraper is responsible for inserting one row per (card, scraped
 * set) pair when it finds a reprint. The canonical (card, owning set)
 * row is also inserted so the join is complete on its own.
 */
export const cardSetMembership = sqliteTable(
  "card_set_membership",
  {
    cardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    setCode: text()
      .notNull()
      .references(() => cardSets.code, { onDelete: "restrict" }),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.setCode] }),
    index("idx_card_set_membership_set").on(t.setCode),
  ],
);

/**
 * Allowed `card_translations.source` values:
 *  - `official_jp`  — pulled from バンダイ公式 (日本語)
 *  - `official_en`  — pulled from Bandai America / SG / etc.
 *  - `ai_translated` — produced by Claude; **must** be flagged unverified
 *  - `manual`       — hand-typed by Yoshio for triage
 */
export type CardTranslationSource =
  | "official_jp"
  | "official_en"
  | "ai_translated"
  | "manual";

export const cardTranslations = sqliteTable(
  "card_translations",
  {
    cardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** ISO 639-1 language tag — `ja`, `en`, etc. */
    language: text().notNull(),

    name: text().notNull(),
    /** Effect block as printed (newlines preserved). */
    effectText: text(),
    /** Lower-cased, whitespace-normalized form for FTS / regex extraction. */
    effectNormalized: text(),
    flavorText: text(),
    triggerText: text(),

    source: text({
      enum: ["official_jp", "official_en", "ai_translated", "manual"],
    })
      .$type<CardTranslationSource>()
      .notNull(),
    /** 0 = needs human review, 1 = approved. */
    verified: integer({ mode: "boolean" }).notNull().default(false),
    sourceUrl: text(),
    fetchedAt: integer({ mode: "timestamp" }),
    /** Free-text trail of the AI model + prompt revision when source = ai_translated. */
    aiModelVersion: text(),

    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.language] }),
    index("idx_translations_lang").on(t.language),
    index("idx_translations_source").on(t.source),
  ],
);

/* ──────────────────────────────────────────────────────────────────────── */
/* §5.2 Decks                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

export const decks = sqliteTable(
  "decks",
  {
    id: text().primaryKey(),
    /** Future-proof: nullable for personal-only mode, FK once auth lands. */
    userId: text(),
    leaderCardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    name: text().notNull(),
    /** standard | proxy | preview etc. */
    format: text().notNull().default("standard"),
    notes: text(),
    /** {attack, stability, expansion, defense, meta} 0-100 each. */
    evaluationScores: text({ mode: "json" })
      .$type<Record<string, number>>()
      .default(sql`(json('{}'))`),
    isPublic: integer({ mode: "boolean" }).notNull().default(false),

    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_decks_leader").on(t.leaderCardId),
    index("idx_decks_user").on(t.userId),
  ],
);

export const deckCards = sqliteTable(
  "deck_cards",
  {
    deckId: text()
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    cardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    /** 1..4 per OP TCG rules. */
    count: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.deckId, t.cardId] }),
    check("ck_deck_card_count_range", sql`${t.count} BETWEEN 1 AND 4`),
  ],
);

/* ──────────────────────────────────────────────────────────────────────── */
/* §5.3 Synergies, probability, scenarios                                   */
/* ──────────────────────────────────────────────────────────────────────── */

export type SynergyRelationType =
  | "leader_direct"
  | "feature_chain"
  | "tempo_combo"
  | "defense_combo"
  | "resource_engine"
  | "finisher"
  | "anti_meta"
  | "other";

export const cardSynergies = sqliteTable(
  "card_synergies",
  {
    fromCardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    toCardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    relationType: text({
      enum: [
        "leader_direct",
        "feature_chain",
        "tempo_combo",
        "defense_combo",
        "resource_engine",
        "finisher",
        "anti_meta",
        "other",
      ],
    })
      .$type<SynergyRelationType>()
      .notNull(),
    /** 0–10 inclusive. */
    strength: real().notNull(),
    reasoningJa: text(),
    reasoningEn: text(),
    /** rule | ai */
    detectedBy: text({ enum: ["rule", "ai"] }).notNull(),
    aiModelVersion: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({
      columns: [t.fromCardId, t.toCardId, t.relationType],
    }),
    index("idx_synergy_to").on(t.toCardId),
    check(
      "ck_synergy_strength_range",
      sql`${t.strength} >= 0 AND ${t.strength} <= 10`,
    ),
    check(
      "ck_synergy_no_self_loop",
      sql`${t.fromCardId} != ${t.toCardId}`,
    ),
  ],
);

/**
 * Per-card "playstyle" — kid-friendly scenario descriptions generated by
 * Claude. One row per card, three short paragraphs:
 *   - whenToPlayJa: いつ使うか
 *   - shinesInJa: どこで強さを発揮するか
 *   - vsOpponentJa: 対戦中の使い方
 *
 * Scope is intentionally bounded: only LEADERs + cards whose effect text
 * is non-trivial enough to be worth describing (driven by the
 * `ai:playstyle` CLI's pool selector). Vanilla counter cards aren't
 * generated for — their description would be redundant with the stats.
 */
export const cardPlaystyles = sqliteTable("card_playstyles", {
  cardId: text()
    .primaryKey()
    .references(() => cards.id, { onDelete: "cascade" }),
  whenToPlayJa: text().notNull(),
  shinesInJa: text().notNull(),
  vsOpponentJa: text().notNull(),
  aiModelVersion: text().notNull(),
  generatedAt: integer({ mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Snapshot of probability calculations for a deck. */
export const deckProbabilitySnapshots = sqliteTable(
  "deck_probability_snapshots",
  {
    id: text().primaryKey(),
    deckId: text()
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    /** {groupName: cardIds[]} */
    cardGroups: text({ mode: "json" })
      .$type<Record<string, string[]>>()
      .notNull(),
    /** {turn: {groupName: probability}} */
    turnProbabilities: text({ mode: "json" })
      .$type<Record<string, Record<string, number>>>()
      .notNull(),
    /** monte_carlo trial count (0 means closed-form only). */
    monteCarloTrials: integer().notNull().default(0),
    engineVersion: text().notNull(),
    generatedAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("idx_probsnap_deck").on(t.deckId)],
);

export type ScenarioType =
  | "ideal"
  | "plan_b"
  | "plan_c"
  | "vs_rush"
  | "vs_control"
  | "vs_mirror"
  | "vs_combo";

/** AI-generated scenario per deck. */
export const deckScenarios = sqliteTable(
  "deck_scenarios",
  {
    id: text().primaryKey(),
    deckId: text()
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    scenarioType: text({
      enum: [
        "ideal",
        "plan_b",
        "plan_c",
        "vs_rush",
        "vs_control",
        "vs_mirror",
        "vs_combo",
      ],
    })
      .$type<ScenarioType>()
      .notNull(),
    /** 0..1 prior probability. */
    priorProbability: real(),
    summary: text(),
    /** Array of {turn, action, reasoning, referenced_card_ids[]}. */
    turnByTurn: text({ mode: "json" })
      .$type<
        Array<{
          turn: number;
          action: string;
          reasoning?: string;
          referencedCardIds?: string[];
        }>
      >()
      .notNull(),
    aiModelVersion: text().notNull(),
    generatedAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_scenario_deck").on(t.deckId),
    uniqueIndex("uq_scenario_deck_type").on(t.deckId, t.scenarioType),
  ],
);

/** Top-level game-plan summary distilled from scenarios. */
export const deckGamePlans = sqliteTable("deck_game_plans", {
  deckId: text()
    .primaryKey()
    .references(() => decks.id, { onDelete: "cascade" }),
  winCondition: text(),
  keyCardIds: text({ mode: "json" }).$type<string[]>().notNull(),
  weakness: text(),
  /** Map of opponent archetype → adjustment notes. */
  matchupNotes: text({ mode: "json" })
    .$type<Record<string, string>>()
    .default(sql`(json('{}'))`),
  aiModelVersion: text().notNull(),
  updatedAt: integer({ mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/* ──────────────────────────────────────────────────────────────────────── */
/* §5.3b Game engine — Effect DSL, simulations, replays, drills             */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Machine-readable card effect, stored as a JSON DSL validated at runtime
 * by Zod (`src/lib/engine/effect-dsl.ts`).
 *
 * Kept in a separate table from `cards` so that effect implementation can
 * evolve independently from the canonical card facts. A card without a
 * row here is treated as **unplayable** by the engine — that protects
 * against the rules engine silently executing partially-modelled cards.
 *
 * `is_vanilla = 1` is an explicit declaration that the card has no
 * triggered ability and no activated effect; the engine can run it
 * without consulting the DSL. `has_ts_handler = 1` flags cards whose
 * effect exceeds the DSL's expressive power and is implemented as
 * TypeScript code in `src/lib/engine/card-handlers/<id>.ts`.
 *
 * `verified = 0` rows must NOT be loaded by the engine in scoring runs;
 * they are draft data for human review.
 */
export const cardEffects = sqliteTable(
  "card_effects",
  {
    cardId: text()
      .primaryKey()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** JSON payload validated against the Effect DSL Zod schema. */
    dslJson: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    /** DSL schema version (semver) so we can migrate later. */
    dslVersion: text().notNull(),
    isVanilla: integer({ mode: "boolean" }).notNull().default(false),
    hasTsHandler: integer({ mode: "boolean" }).notNull().default(false),
    /** 0 = draft, 1 = human-approved and engine-safe. */
    verified: integer({ mode: "boolean" }).notNull().default(false),
    authoredBy: text({ enum: ["human", "ai_draft"] }).notNull(),
    aiModelVersion: text(),
    notes: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_card_effects_verified").on(t.verified),
    /* A card cannot simultaneously be vanilla AND have a TS handler. */
    check(
      "ck_card_effects_vanilla_xor_handler",
      sql`NOT (${t.isVanilla} = 1 AND ${t.hasTsHandler} = 1)`,
    ),
  ],
);

/**
 * A batch of N games run with a fixed configuration. The basic unit of
 * analysis: ablation, mulligan accuracy, matchup win-rate are all
 * computed against a single `simulation_runs` row.
 *
 * `seed_base` enables paired-RNG comparisons: when running an ablation
 * (deck X vs deck X-with-one-swap), two runs sharing the same seed_base
 * generate identical RNG sequences per game_index, so observed win-rate
 * differences are attributable to the swap rather than draw variance.
 */
export const simulationRuns = sqliteTable(
  "simulation_runs",
  {
    id: text().primaryKey(),
    leaderAId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    leaderBId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    /** Reference to a stored deck; nullable for ad-hoc deck lists. */
    deckAId: text().references(() => decks.id, { onDelete: "set null" }),
    deckBId: text().references(() => decks.id, { onDelete: "set null" }),
    /** Snapshot of the deck list at run time (defensive against deck edits). */
    deckASnapshotJson: text({ mode: "json" })
      .$type<Array<{ cardId: string; count: number }>>()
      .notNull(),
    deckBSnapshotJson: text({ mode: "json" })
      .$type<Array<{ cardId: string; count: number }>>()
      .notNull(),
    nGames: integer().notNull(),
    seedBase: text().notNull(),
    cpuAMode: text({
      enum: ["fast", "strong", "coach", "human"],
    }).notNull(),
    cpuBMode: text({
      enum: ["fast", "strong", "coach", "human"],
    }).notNull(),
    /** Ablation: card whose copies were swapped out in deck A. */
    ablationTargetCardId: text().references(() => cards.id, {
      onDelete: "set null",
    }),
    ablationReplacementCardId: text().references(() => cards.id, {
      onDelete: "set null",
    }),
    engineVersion: text().notNull(),
    notes: text(),
    /** Pre-computed summary (winrate, avg turns, etc.) for fast UI. */
    summaryJson: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .default(sql`(json('{}'))`),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    finishedAt: integer({ mode: "timestamp" }),
  },
  (t) => [
    index("idx_sim_runs_leaders").on(t.leaderAId, t.leaderBId),
    index("idx_sim_runs_created").on(t.createdAt),
    check("ck_sim_runs_n_games_positive", sql`${t.nGames} > 0`),
  ],
);

/**
 * A single completed game inside a simulation_run. `rng_seed` is derived
 * deterministically from `simulation_runs.seed_base` + `game_index` so a
 * game can be re-run bit-for-bit identically.
 */
export const games = sqliteTable(
  "games",
  {
    id: text().primaryKey(),
    runId: text()
      .notNull()
      .references(() => simulationRuns.id, { onDelete: "cascade" }),
    gameIndex: integer().notNull(),
    rngSeed: text().notNull(),
    goFirst: text({ enum: ["A", "B"] }).notNull(),
    winner: text({ enum: ["A", "B", "DRAW"] }),
    endCondition: text({
      enum: ["LIFE_OUT", "DECK_OUT", "EFFECT", "TIMEOUT", "ERROR"],
    }),
    turns: integer(),
    /** Compact end-state snapshot for replay UI without re-running events. */
    finalStateJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    startedAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    finishedAt: integer({ mode: "timestamp" }),
  },
  (t) => [
    index("idx_games_run").on(t.runId),
    uniqueIndex("uq_games_run_index").on(t.runId, t.gameIndex),
  ],
);

/**
 * Per-event replay log. Replaying the engine over the events of a game
 * (in `seq` order, starting from the rng_seed) must reproduce the final
 * state exactly — this is the bedrock determinism guarantee that makes
 * paired-RNG ablation analysis trustworthy.
 *
 * `state_hash` is a content hash of the post-event GameState, used by
 * the MCTS transposition table to recognize equivalent positions across
 * different play orderings.
 */
export const gameEvents = sqliteTable(
  "game_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    gameId: text()
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    /** 0-indexed sequence number within the game (replay order). */
    seq: integer().notNull(),
    turn: integer().notNull(),
    /** REFRESH / DRAW / DON / MAIN / BATTLE / END / SETUP / MULLIGAN */
    phase: text().notNull(),
    actor: text({ enum: ["A", "B", "SYSTEM"] }).notNull(),
    /** Structured event tag — see EngineEvent union in src/lib/engine. */
    eventType: text().notNull(),
    payloadJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    stateHash: text(),
  },
  (t) => [
    index("idx_events_game_seq").on(t.gameId, t.seq),
    index("idx_events_event_type").on(t.eventType),
    uniqueIndex("uq_events_game_seq").on(t.gameId, t.seq),
  ],
);

/**
 * Denormalized card-level event stream for fast analytics queries.
 * A subset of `game_events` (the ones that touch a specific card),
 * exploded into a flat shape so the analytics layer can avoid JSON
 * parsing on hot paths like "ablation deltas across 100 games".
 */
export const cardPlays = sqliteTable(
  "card_plays",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    gameId: text()
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    turn: integer().notNull(),
    actor: text({ enum: ["A", "B"] }).notNull(),
    cardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    action: text({
      enum: [
        "PLAY",
        "ACTIVATE",
        "COUNTER",
        "TRIGGER",
        "ATTACH_DON",
        "ATTACK",
        "BLOCK",
        "KO",
        "DRAW",
        "DISCARD",
      ],
    }).notNull(),
    /** Free-text outcome tag (e.g. "killed_opp_5cost", "blocked_lethal"). */
    outcome: text(),
  },
  (t) => [
    index("idx_card_plays_card").on(t.cardId, t.action),
    index("idx_card_plays_game_turn").on(t.gameId, t.turn),
  ],
);

/**
 * Pre-computed analysis aggregates so dashboards don't recompute on
 * every page load. `breakdown_json` lets a single metric carry
 * arbitrarily-nested groupings (per matchup, per turn, per card).
 */
export const analysisResults = sqliteTable(
  "analysis_results",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    runId: text()
      .notNull()
      .references(() => simulationRuns.id, { onDelete: "cascade" }),
    /** winrate | mulligan_keep_score | go_first_advantage | card_contribution_delta | trigger_success_rate | ... */
    metric: text().notNull(),
    breakdownJson: text({ mode: "json" }).$type<Record<string, unknown>>(),
    value: real(),
    computedAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_analysis_run_metric").on(t.runId, t.metric),
  ],
);

/**
 * A "position drill" — a frozen mid-game GameState the user is asked to
 * find the best play in. Generated either by sampling a real game state
 * (`source = generated`) or hand-authored (`source = curated`).
 */
export const drills = sqliteTable(
  "drills",
  {
    id: text().primaryKey(),
    leaderCardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    donCount: integer().notNull(),
    handCount: integer().notNull(),
    /** Serialized GameState — see src/lib/engine/state.ts. */
    stateSnapshotJson: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    /** Engine-derived optimal play (action sequence), if pre-computed. */
    optimalPlayJson: text({ mode: "json" })
      .$type<Record<string, unknown>>(),
    /** Claude's natural-language explanation of why the optimal play is optimal. */
    claudeRationale: text(),
    difficulty: text({ enum: ["easy", "normal", "hard"] }),
    source: text({ enum: ["generated", "curated"] }).notNull(),
    aiModelVersion: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_drills_leader").on(t.leaderCardId),
    index("idx_drills_don_hand").on(t.donCount, t.handCount),
  ],
);

export const drillAttempts = sqliteTable(
  "drill_attempts",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    drillId: text()
      .notNull()
      .references(() => drills.id, { onDelete: "cascade" }),
    userPlayJson: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    score: real(),
    claudeFeedback: text(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("idx_drill_attempts_drill").on(t.drillId)],
);

/* ──────────────────────────────────────────────────────────────────────── */
/* §5.4 Meta decks (opponent analysis input)                                */
/* ──────────────────────────────────────────────────────────────────────── */

export const metaDecks = sqliteTable(
  "meta_decks",
  {
    id: text().primaryKey(),
    leaderCardId: text()
      .notNull()
      .references(() => cards.id, { onDelete: "restrict" }),
    archetypeName: text().notNull(),
    /** rush | control | combo | mid_range | toolbox | other */
    archetypeFamily: text({
      enum: [
        "rush",
        "control",
        "combo",
        "mid_range",
        "toolbox",
        "other",
      ],
    }).notNull(),
    winCondition: text(),
    /** Card IDs that materially define the archetype. */
    typicalCards: text({ mode: "json" }).$type<string[]>().notNull(),
    strongAgainst: text({ mode: "json" }).$type<string[]>().notNull(),
    weakAgainst: text({ mode: "json" }).$type<string[]>().notNull(),
    sourceUrl: text(),
    tournamentName: text(),
    tournamentDate: text(),
    placement: text(),
    region: text({
      enum: ["jp", "us", "eu", "au", "mx", "cn", "tw", "kr", "sg", "other"],
    }),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("idx_meta_leader").on(t.leaderCardId),
    index("idx_meta_family").on(t.archetypeFamily),
  ],
);

/* ──────────────────────────────────────────────────────────────────────── */
/* §5.5 Tournaments                                                         */
/* ──────────────────────────────────────────────────────────────────────── */

export const tournaments = sqliteTable(
  "tournaments",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    region: text({
      enum: ["jp", "us", "eu", "au", "mx", "cn", "tw", "kr", "sg", "other"],
    }).notNull(),
    country: text(),
    city: text(),
    venue: text(),
    eventDate: text().notNull(),
    /** flight | regional | national | worlds | store | online | other */
    eventTier: text({
      enum: [
        "flight",
        "regional",
        "national",
        "worlds",
        "store",
        "online",
        "other",
      ],
    })
      .notNull()
      .default("other"),
    registrationUrl: text(),
    officialUrl: text(),
    sourceSite: text().notNull(),
    /** Free-text JSON of any extra fields the scraper picked up. */
    raw: text({ mode: "json" })
      .$type<Record<string, unknown>>()
      .default(sql`(json('{}'))`),
    lastFetchedAt: integer({ mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("idx_tournaments_region_date").on(t.region, t.eventDate),
    uniqueIndex("uq_tournaments_source_id").on(t.sourceSite, t.id),
  ],
);
