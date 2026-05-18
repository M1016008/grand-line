/**
 * Effect DSL — declarative One Piece TCG card-effect schema.
 *
 * Why a DSL instead of plain TypeScript per card?
 *
 *  - **AI-draftable, human-verifiable.** AGENTS.md forbids letting an AI
 *    invent card facts. But Claude can safely *draft* DSL JSON from the
 *    verified `card_translations.effectText`, which a human then approves
 *    by flipping `card_effects.verified` to 1. The DSL surface is small
 *    enough to review at a glance.
 *  - **Data-driven coverage.** Loading a new card during play is a single
 *    DB read; there's no recompile or feature flag.
 *  - **Zod-checked at load time.** Malformed effects fail loudly the
 *    moment they're loaded, not silently mid-game.
 *  - **TS escape hatch.** Effects that can't be expressed cleanly (e.g.
 *    紫エネル "神の裁き" with conditional cascading) get a handler module
 *    instead. The DSL doesn't need to be Turing-complete to be useful.
 *
 * Coverage philosophy
 * ───────────────────
 * Phase B targets the three initial decks (黒イム / 黒クロコダイル /
 * 紫エネル). New tags are added as needed, but each addition requires
 * matching engine support + tests. Never stub a tag and "implement
 * later" — that's exactly the silent-bug failure mode that destroys
 * MCTS quality.
 */

import { z } from "zod";

export const DSL_VERSION = "0.1.0";

/* ──────────────────────────────────────────────────────────────────────── */
/* Filters: how a tag selects card instances on the field, in hand, etc.    */
/* ──────────────────────────────────────────────────────────────────────── */

const SideRef = z.enum(["self", "opponent", "any"]);
const ZoneRef = z.enum([
  "hand",
  "deck",
  "trash",
  "character_area",
  "stage_area",
  "leader",
  "life",
  "don_deck",
  "don_area",
]);

const CardTypeRef = z.enum([
  "LEADER",
  "CHARACTER",
  "EVENT",
  "STAGE",
  "DON",
]);

/**
 * Filter expression: an AND-conjunction of optional clauses. Designed to
 * be flat — nested OR is intentionally unsupported in v0.1.0; if a card
 * needs it, use a TS handler. Keeping the DSL flat keeps reviews trivial.
 */
const CardFilter = z
  .object({
    side: SideRef.optional(),
    zone: ZoneRef.optional(),
    cardType: CardTypeRef.optional(),
    /** Match cards with this exact id (rare; usually use feature tag). */
    cardId: z.string().optional(),
    /** Color string ("red", "black", etc.) — matches if card has the color. */
    color: z.string().optional(),
    /** Feature tag like "麦わらの一味". */
    feature: z.string().optional(),
    /** Trait tag like "ブロッカー". */
    mechanic: z.string().optional(),
    /** Cost comparison. */
    costLte: z.number().int().optional(),
    costGte: z.number().int().optional(),
    costEq: z.number().int().optional(),
    /** Power comparison (only meaningful for cards with power). */
    powerLte: z.number().int().optional(),
    powerGte: z.number().int().optional(),
  })
  .strict();

export type CardFilter = z.infer<typeof CardFilter>;

/* ──────────────────────────────────────────────────────────────────────── */
/* Atomic effect actions. Order-of-evaluation in a sequence matters and is */
/* preserved exactly — engine resolves left-to-right.                       */
/* ──────────────────────────────────────────────────────────────────────── */

/** Who picks the target / discard / etc.? Defaults to the effect's controller. */
const Chooser = z.enum(["controller", "opponent", "random"]);

const DrawAction = z
  .object({
    op: z.literal("draw"),
    count: z.number().int().positive(),
    /** Who draws. Defaults to controller. */
    target: SideRef.optional(),
  })
  .strict();

const DiscardAction = z
  .object({
    op: z.literal("discard"),
    from: SideRef,
    count: z.number().int().positive(),
    chooser: Chooser.optional(),
    /** Optional additional filter on which hand cards qualify. */
    filter: CardFilter.optional(),
  })
  .strict();

const SearchAction = z
  .object({
    op: z.literal("search"),
    zone: ZoneRef,
    /** How many cards from the top of the zone to look at. */
    look: z.number().int().positive(),
    /** How many to take. The rest go back in the documented order. */
    take: z.number().int().nonnegative(),
    filter: CardFilter.optional(),
    /** Where the taken cards end up. */
    destination: ZoneRef,
    /** What happens to the unchosen cards. Defaults to bottom-of-deck. */
    leftoverDestination: z
      .enum(["deck_bottom", "deck_top_shuffled", "trash", "deck_shuffled"])
      .optional(),
  })
  .strict();

const KoAction = z
  .object({
    op: z.literal("ko"),
    target: CardFilter,
    chooser: Chooser.optional(),
    /** Number of distinct targets, defaults to 1. */
    count: z.number().int().positive().optional(),
  })
  .strict();

const PowerBuffAction = z
  .object({
    op: z.literal("power_buff"),
    target: CardFilter,
    /** Positive or negative integer (e.g. +1000, -2000). */
    delta: z.number().int(),
    /** "turn" = wears off in End phase. "permanent" = stays. */
    duration: z.enum(["turn", "permanent"]),
    /** Number of distinct targets. */
    count: z.number().int().positive().optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const CostModAction = z
  .object({
    op: z.literal("cost_mod"),
    target: CardFilter,
    delta: z.number().int(),
    duration: z.enum(["turn", "permanent"]),
    count: z.number().int().positive().optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const RestAction = z
  .object({
    op: z.literal("rest"),
    target: CardFilter,
    count: z.number().int().positive().optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const ActivateAction = z
  .object({
    op: z.literal("activate"),
    target: CardFilter,
    count: z.number().int().positive().optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const MoveAction = z
  .object({
    op: z.literal("move"),
    source: CardFilter,
    destination: ZoneRef,
    count: z.number().int().positive().optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const AttachDonAction = z
  .object({
    op: z.literal("attach_don"),
    target: CardFilter,
    count: z.number().int().positive(),
    /** Source of the DON: most commonly "don_area" (free DON). */
    source: z.enum(["don_area", "don_deck"]).optional(),
  })
  .strict();

const PlayFromTrashAction = z
  .object({
    op: z.literal("play_from_trash"),
    filter: CardFilter,
    /** Cost reduction applied for this play, if any. */
    costMod: z.number().int().optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const LifeDamageAction = z
  .object({
    op: z.literal("life_damage"),
    target: SideRef,
    count: z.number().int().positive(),
  })
  .strict();

const GiveKeywordAction = z
  .object({
    op: z.literal("give_keyword"),
    target: CardFilter,
    keyword: z.enum(["blocker", "rush", "double_attack", "banish"]),
    duration: z.enum(["turn", "permanent"]),
    count: z.number().int().positive().optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const RevealAction = z
  .object({
    op: z.literal("reveal"),
    zone: ZoneRef,
    count: z.number().int().positive(),
    target: SideRef,
  })
  .strict();

/** Discriminated union of all atomic actions. */
export const EffectAction = z.discriminatedUnion("op", [
  DrawAction,
  DiscardAction,
  SearchAction,
  KoAction,
  PowerBuffAction,
  CostModAction,
  RestAction,
  ActivateAction,
  MoveAction,
  AttachDonAction,
  PlayFromTrashAction,
  LifeDamageAction,
  GiveKeywordAction,
  RevealAction,
]);

export type EffectAction = z.infer<typeof EffectAction>;

/* ──────────────────────────────────────────────────────────────────────── */
/* Triggers (when the effect fires) + the wrapper schema for a whole card. */
/* ──────────────────────────────────────────────────────────────────────── */

export const TriggerEvent = z.enum([
  /** Played from hand (paid the cost). */
  "ON_PLAY",
  /** This card is KO'd. */
  "ON_KO",
  /** This card declares an attack. */
  "WHEN_ATTACKING",
  /** This card is attacked. */
  "WHEN_ATTACKED",
  /** Card is revealed from life via the TRIGGER mechanic. */
  "TRIGGER",
  /** Played from hand as a counter during the counter step. */
  "COUNTER",
  /** Player activates a Main effect (stage activation, etc.). */
  "ACTIVATE_MAIN",
]);

/** A condition that must be true at trigger time for the effect to fire. */
const TriggerCondition = z
  .object({
    /** Only fires when ≥N DON in don_area at trigger time. */
    minDonInArea: z.number().int().nonnegative().optional(),
    /** Only fires when controller's life is in [min, max]. */
    lifeBetween: z
      .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
      .optional(),
    /** Only fires when N cards of given filter exist in trash. */
    trashCount: z
      .object({
        filter: CardFilter,
        gte: z.number().int().nonnegative(),
      })
      .optional(),
    /** Generic feature flag for handler-side gating (rare). */
    custom: z.string().optional(),
  })
  .strict();

const TriggeredEffect = z
  .object({
    on: TriggerEvent,
    /** Optional cost paid by the controller to use the effect (DON, etc.). */
    cost: z
      .object({
        attachedDonRequired: z.number().int().nonnegative().optional(),
        donFromArea: z.number().int().nonnegative().optional(),
        restThis: z.boolean().optional(),
      })
      .strict()
      .optional(),
    condition: TriggerCondition.optional(),
    /** Once-per-turn / once-per-game cap. */
    limit: z.enum(["once_per_turn", "once_per_game", "unlimited"]).optional(),
    /** Resolution sequence — atomic actions in order. */
    actions: z.array(EffectAction).min(1),
  })
  .strict();

/** Root effect schema attached to a single card. */
export const CardEffectDsl = z
  .object({
    /** DSL semver — must match DSL_VERSION at runtime. */
    version: z.string(),
    /** Card id this DSL describes — redundant with FK but helpful for diffs. */
    cardId: z.string(),
    /** Free-text label for review/debugging — usually a short JP summary. */
    summary: z.string().optional(),
    /** Zero or more triggered effects on this card. */
    effects: z.array(TriggeredEffect),
  })
  .strict();

export type CardEffectDsl = z.infer<typeof CardEffectDsl>;
export type TriggeredEffect = z.infer<typeof TriggeredEffect>;
export type TriggerEventName = z.infer<typeof TriggerEvent>;

/* ──────────────────────────────────────────────────────────────────────── */
/* Public helpers — load / validate.                                        */
/* ──────────────────────────────────────────────────────────────────────── */

export interface ParsedCardEffect {
  readonly dsl: CardEffectDsl;
  readonly isVanilla: boolean;
}

/** Parse and validate a stored DSL payload. Throws on invalid shape. */
export function parseCardEffectDsl(payload: unknown): ParsedCardEffect {
  const dsl = CardEffectDsl.parse(payload);
  if (dsl.version !== DSL_VERSION) {
    throw new Error(
      `effect-dsl version mismatch: payload=${dsl.version}, runtime=${DSL_VERSION}`,
    );
  }
  return { dsl, isVanilla: dsl.effects.length === 0 };
}
