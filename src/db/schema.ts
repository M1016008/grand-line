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
    check(
      "ck_leader_or_character_has_power",
      sql`(${t.cardType} NOT IN ('LEADER', 'CHARACTER')) OR (${t.power} IS NOT NULL)`,
    ),
    check(
      "ck_event_has_no_power",
      sql`(${t.cardType} != 'EVENT') OR (${t.power} IS NULL AND ${t.life} IS NULL)`,
    ),
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
