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
 *  - **TS escape hatch.** Effects that can't be expressed cleanly get a
 *    handler module in `src/lib/engine/card-handlers/<cardId>.ts`. The
 *    DSL doesn't need to be Turing-complete to be useful, but it does
 *    need to be expressive enough that the escape hatch is rare.
 *
 * Coverage philosophy
 * ───────────────────
 * Phase B targets the three initial decks (黒イム / 黒クロコダイル /
 * 紫エネル). New tags are added as needed, but each addition requires
 * matching engine support + tests. Never stub a tag and "implement
 * later" — that's exactly the silent-bug failure mode that destroys
 * MCTS quality.
 *
 * Expressiveness added in 0.1.0
 * ─────────────────────────────
 *  - Filters can OR multiple atom clauses (`anyOf`).
 *  - Filters can self-reference the effect's source card (`isSelf`).
 *  - Filters can sort candidates and pick the extremum (`orderBy`).
 *  - Targets can be "up to N" / "all" / fixed count.
 *  - Actions can be wrapped in `if` for mid-sequence conditionals.
 *  - Actions can offer the controller a `choose_one` modal selection.
 *  - Power buffs can scale by a card count (e.g. +1000 per 黒キャラ).
 *  - Conditions can reference what happened *this turn*
 *    (`controllerPlayedThisTurn`, `koOccurredThisTurn`).
 */

import { z } from "zod";

export const DSL_VERSION = "0.1.0";

/* ──────────────────────────────────────────────────────────────────────── */
/* Common references                                                        */
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

/* ──────────────────────────────────────────────────────────────────────── */
/* Filters — describe a set of cards in a zone.                             */
/*                                                                          */
/* A `CardFilter` is an atom of clauses, AND-combined, optionally combined  */
/* with an `anyOf` array of atoms (OR-combined within itself, then AND'd    */
/* with the surrounding atom). Example:                                     */
/*                                                                          */
/*   { side: "opponent", anyOf: [{ costLte: 3 }, { feature: "海軍" }] }     */
/*   ⇒ "opponent's card with (cost ≤ 3 OR feature includes 海軍)".          */
/*                                                                          */
/* Nesting deeper than one level is intentionally unsupported in v0.1.0.    */
/* If a card truly needs it, the TS handler escape hatch is the answer.     */
/* ──────────────────────────────────────────────────────────────────────── */

const CardFilterAtom = z
  .object({
    side: SideRef.optional(),
    zone: ZoneRef.optional(),
    cardType: CardTypeRef.optional(),
    /** Exact card id match (rare; usually use feature/mechanic tag). */
    cardId: z.string().optional(),
    /** Color string ("red", "black", etc.) — matches if card has the color. */
    color: z.string().optional(),
    /** Feature tag like "麦わらの一味". */
    feature: z.string().optional(),
    /** Mechanic / keyword tag like "ブロッカー". */
    mechanic: z.string().optional(),
    /** Cost comparison. */
    costLte: z.number().int().optional(),
    costGte: z.number().int().optional(),
    costEq: z.number().int().optional(),
    /** Power comparison (only meaningful for cards with power). */
    powerLte: z.number().int().optional(),
    powerGte: z.number().int().optional(),
    /**
     * When true, the filter matches only the card whose effect is
     * resolving. Engine substitutes the effect's source instance at
     * resolution time. Useful for "give this character +2000" style.
     */
    isSelf: z.boolean().optional(),
  })
  .strict();

export type CardFilterAtom = z.infer<typeof CardFilterAtom>;

const CardFilter = CardFilterAtom.extend({
  /** OR-combined atoms; AND'd with the surrounding flat clauses. */
  anyOf: z.array(CardFilterAtom).min(1).optional(),
  /**
   * Tie-break / sort policy when more candidates exist than `count`
   * targets are needed. Defaults to engine-controller's free choice.
   */
  orderBy: z
    .enum([
      "highest_cost",
      "lowest_cost",
      "highest_power",
      "lowest_power",
    ])
    .optional(),
}).strict();

export type CardFilter = z.infer<typeof CardFilter>;

/* ──────────────────────────────────────────────────────────────────────── */
/* Target count: fixed N | "up to N" | "all".                               */
/* ──────────────────────────────────────────────────────────────────────── */

const TargetCount = z.union([
  z.number().int().positive(),
  z
    .object({
      upTo: z.number().int().positive(),
      min: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.literal("all"),
]);

export type TargetCount = z.infer<typeof TargetCount>;

/* ──────────────────────────────────────────────────────────────────────── */
/* Scaling values — "X per matching card in zone Z".                        */
/*                                                                          */
/* Used by PowerBuff (and only PowerBuff for now) so a single effect can    */
/* express "+1000 per 黒キャラ" without exploding into a `for_each` shape.  */
/* Add to other actions as the need arises.                                 */
/* ──────────────────────────────────────────────────────────────────────── */

const ScaledInt = z
  .object({
    base: z.number().int(),
    perCardMatching: CardFilterAtom,
    in: ZoneRef,
    side: SideRef.optional(),
    /** Multiplier applied to the matched count. Defaults to 1. */
    multiplier: z.number().int().optional(),
    /** Upper bound on the contribution from scaling (the base is unaffected). */
    cap: z.number().int().nonnegative().optional(),
  })
  .strict();

const IntOrScaled = z.union([z.number().int(), ScaledInt]);

export type IntOrScaled = z.infer<typeof IntOrScaled>;

/* ──────────────────────────────────────────────────────────────────────── */
/* Atomic effect actions — non-recursive subset.                            */
/* ──────────────────────────────────────────────────────────────────────── */

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
    count: TargetCount.optional(),
  })
  .strict();

const PowerBuffAction = z
  .object({
    op: z.literal("power_buff"),
    target: CardFilter,
    /** Magnitude (positive or negative). May be a scaled value. */
    delta: IntOrScaled,
    /** "turn" = wears off in End phase. "permanent" = stays. */
    duration: z.enum(["turn", "permanent"]),
    count: TargetCount.optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const CostModAction = z
  .object({
    op: z.literal("cost_mod"),
    target: CardFilter,
    delta: z.number().int(),
    duration: z.enum(["turn", "permanent"]),
    count: TargetCount.optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const RestAction = z
  .object({
    op: z.literal("rest"),
    target: CardFilter,
    count: TargetCount.optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const ActivateAction = z
  .object({
    op: z.literal("activate"),
    target: CardFilter,
    count: TargetCount.optional(),
    chooser: Chooser.optional(),
  })
  .strict();

const MoveAction = z
  .object({
    op: z.literal("move"),
    source: CardFilter,
    destination: ZoneRef,
    count: TargetCount.optional(),
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
    count: TargetCount.optional(),
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

/* ──────────────────────────────────────────────────────────────────────── */
/* Conditional / structural actions — recursive subset.                     */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Conditions evaluated mid-sequence at action resolution time.
 * Superset of `TriggerCondition`: adds turn-history checks that only
 * make sense once the engine starts executing actions.
 */
const ActionCondition = z
  .object({
    /** ≥N DON in controller's don_area at this moment. */
    minDonInArea: z.number().int().nonnegative().optional(),
    /** Controller's life count is in [min, max]. */
    lifeBetween: z
      .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
      .optional(),
    /** ≥N cards matching `filter` exist in controller's trash. */
    trashCount: z
      .object({
        filter: CardFilterAtom,
        gte: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    /** Controller has played ≥N cards matching `filter` this turn. */
    controllerPlayedThisTurn: z
      .object({
        filter: CardFilterAtom,
        gte: z.number().int().positive(),
      })
      .strict()
      .optional(),
    /** Controller has KO'd ≥N opposing cards matching `filter` this turn. */
    koOccurredThisTurn: z
      .object({
        filter: CardFilterAtom,
        gte: z.number().int().positive(),
        side: SideRef.optional(),
      })
      .strict()
      .optional(),
    /** Controller's leader has attacked this turn. */
    leaderAttackedThisTurn: z.boolean().optional(),
    /** Free-text label for handler-side gating (avoid unless necessary). */
    custom: z.string().optional(),
  })
  .strict();

export type ActionCondition = z.infer<typeof ActionCondition>;

/* The discriminated union is non-recursive. The three recursive actions
 * (if / choose_one / for_each) declare their own .then/.actions fields
 * with `z.lazy` so we can fold them in. */

const IfAction: z.ZodType<{
  op: "if";
  condition: ActionCondition;
  then: EffectAction[];
  else?: EffectAction[];
}> = z.lazy(() =>
  z
    .object({
      op: z.literal("if"),
      condition: ActionCondition,
      then: z.array(EffectAction).min(1),
      else: z.array(EffectAction).min(1).optional(),
    })
    .strict(),
);

const ChooseOneAction: z.ZodType<{
  op: "choose_one";
  chooser?: "controller" | "opponent" | "random";
  modes: Array<{ id: string; label?: string; actions: EffectAction[] }>;
}> = z.lazy(() =>
  z
    .object({
      op: z.literal("choose_one"),
      chooser: Chooser.optional(),
      modes: z
        .array(
          z
            .object({
              id: z.string().min(1),
              label: z.string().optional(),
              actions: z.array(EffectAction).min(1),
            })
            .strict(),
        )
        .min(2),
    })
    .strict(),
);

/**
 * Repeat `actions` once per card matching `filter` in `zone`. Inner
 * actions do *not* see the per-iteration card; if you need that, use
 * a multi-target action (`count: "all"`) instead.
 */
const ForEachAction: z.ZodType<{
  op: "for_each";
  filter: CardFilterAtom;
  zone: z.infer<typeof ZoneRef>;
  side?: z.infer<typeof SideRef>;
  actions: EffectAction[];
  /** Cap on iterations (defensive against unbounded scaling). */
  cap?: number;
}> = z.lazy(() =>
  z
    .object({
      op: z.literal("for_each"),
      filter: CardFilterAtom,
      zone: ZoneRef,
      side: SideRef.optional(),
      actions: z.array(EffectAction).min(1),
      cap: z.number().int().positive().optional(),
    })
    .strict(),
);

/* ──────────────────────────────────────────────────────────────────────── */
/* The full EffectAction union.                                             */
/* ──────────────────────────────────────────────────────────────────────── */

const NonRecursiveAction = z.discriminatedUnion("op", [
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

export type NonRecursiveAction = z.infer<typeof NonRecursiveAction>;

export type EffectAction =
  | NonRecursiveAction
  | {
      op: "if";
      condition: ActionCondition;
      then: EffectAction[];
      else?: EffectAction[];
    }
  | {
      op: "choose_one";
      chooser?: "controller" | "opponent" | "random";
      modes: Array<{ id: string; label?: string; actions: EffectAction[] }>;
    }
  | {
      op: "for_each";
      filter: CardFilterAtom;
      zone: z.infer<typeof ZoneRef>;
      side?: z.infer<typeof SideRef>;
      actions: EffectAction[];
      cap?: number;
    };

export const EffectAction: z.ZodType<EffectAction> = z.lazy(() =>
  z.union([NonRecursiveAction, IfAction, ChooseOneAction, ForEachAction]),
);

/* ──────────────────────────────────────────────────────────────────────── */
/* Triggers (when the effect fires) + the wrapper schema for a whole card.  */
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

/** Trigger-time condition (a subset of `ActionCondition` semantics). */
const TriggerCondition = ActionCondition;

const TriggeredEffect = z
  .object({
    on: TriggerEvent,
    /** Optional cost paid by the controller to use the effect. */
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
