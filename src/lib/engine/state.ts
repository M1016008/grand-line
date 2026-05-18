/**
 * Immutable game-state model for the One Piece TCG engine.
 *
 * Design notes
 * ────────────
 * - **Immutable by convention.** All updates go through `applyEvent` (in
 *   `rules.ts`, added in Phase A-2), which returns a fresh state. MCTS
 *   relies on cheap branching; mutating shared state would break that.
 * - **`readonly` everywhere.** Forces callers through the event-driven
 *   API and lets the TS compiler catch accidental mutation.
 * - **String card-instance ids.** A deck can hold four copies of the
 *   same printed card. We assign each physical copy a stable
 *   `instanceId` ("OP01-001#0", "#1", ...) at deck-load time so attached
 *   DON, KO history, and triggers can reference *the specific copy*
 *   without ambiguity.
 * - **Hash-friendly.** `hashState` (Phase A-2) walks this structure in a
 *   canonical order; downstream MCTS uses the result as a transposition
 *   table key.
 * - **Turn-scoped memory in `turnLog`.** Many OPTCG cards condition on
 *   what happened *this turn* ("if you played a 黒 card this turn",
 *   "if your leader has attacked this turn"). `turnLog` captures those
 *   events as they happen and is wiped at the start of each turn.
 *
 * Zone layout (OPTCG official):
 *
 *   ┌─ Life cards (face-down, drawn into hand when leader takes damage)
 *   ├─ Leader area (exactly 1 card)
 *   ├─ Character area (0..5 character cards)
 *   ├─ Stage area (0..1 stage card)
 *   ├─ DON!! deck (supplies 1-2 DON per turn, max 10 in play)
 *   ├─ Active DON / Rested DON (attached or in DON area)
 *   ├─ Main deck (50 cards)
 *   ├─ Hand
 *   └─ Trash
 */

import type { TriggeredEffect } from "./effect-dsl";

/** A single instance of a card in play. Multiple copies → multiple instances. */
export interface CardInstance {
  readonly instanceId: string;
  readonly cardId: string;
}

/** A character on the field. Tracks attached DON and turn-scoped flags. */
export interface CharacterOnField extends CardInstance {
  /** Rested = exhausted, can't attack/block. Active = ready. */
  readonly state: "active" | "rested";
  /** Number of DON cards attached for power boosts and effect costs. */
  readonly attachedDon: number;
  /** Permanent power modifiers from effects (additive). */
  readonly powerModPermanent: number;
  /** Power buffs that end on the current turn's End phase. */
  readonly powerModTurn: number;
  /** True for the turn it entered play — affects attack legality (rush etc.). */
  readonly playedThisTurn: boolean;
  /** Granted blocker keyword (from effects). Printed blocker comes from the card. */
  readonly hasBlockerGranted: boolean;
  /** Granted rush keyword. */
  readonly hasRushGranted: boolean;
}

/** A stage card in play. Stages are mostly passive but track activation flags. */
export interface StageOnField extends CardInstance {
  readonly activatedThisTurn: boolean;
}

/** The leader. Always exactly one, with attached DON and a turn-resets counter. */
export interface LeaderOnField extends CardInstance {
  readonly state: "active" | "rested";
  readonly attachedDon: number;
  readonly powerModTurn: number;
}

/** Per-player state. Mirrored for A and B. */
export interface PlayerState {
  /** "A" or "B" — the persistent player identifier. */
  readonly id: "A" | "B";
  readonly leader: LeaderOnField;
  readonly characters: readonly CharacterOnField[];
  readonly stage: StageOnField | null;

  /** Face-down life cards. Top of array = top of the stack. */
  readonly life: readonly CardInstance[];
  /** Top of array = top of the deck (next draw). */
  readonly deck: readonly CardInstance[];
  readonly hand: readonly CardInstance[];
  readonly trash: readonly CardInstance[];

  /** DON!! supply pile, top-of-array = next to flow into DON area. */
  readonly donDeck: readonly CardInstance[];
  /** Free DON in the DON area: { active, rested }. */
  readonly donArea: { readonly active: number; readonly rested: number };

  /** Has the player taken their once-per-turn don attach this main phase? */
  readonly didAttachDonThisTurn: boolean;
  /** Has the player executed a mulligan? (Set during setup.) */
  readonly didMulligan: boolean;
}

export type Phase =
  | "SETUP"
  | "MULLIGAN"
  | "REFRESH"
  | "DRAW"
  | "DON"
  | "MAIN"
  | "BATTLE"
  | "END"
  | "GAME_OVER";

/** Stack frame for in-resolution effects (triggers, counters). */
export interface PendingEffect {
  readonly source: "ON_PLAY" | "ON_KO" | "WHEN_ATTACKING" | "WHEN_ATTACKED" | "TRIGGER" | "COUNTER";
  readonly sourceInstanceId: string;
  /** The triggered effect payload — typed against the Effect DSL. */
  readonly effect: TriggeredEffect;
  readonly controller: "A" | "B";
}

/** A live attack declaration awaiting resolution. */
export interface ActiveAttack {
  readonly attacker: { readonly controller: "A" | "B"; readonly instanceId: string };
  readonly target:
    | { readonly kind: "leader"; readonly controller: "A" | "B" }
    | { readonly kind: "character"; readonly controller: "A" | "B"; readonly instanceId: string };
  /** DON-pumped power at declaration time, before counters. */
  readonly attackerPower: number;
  readonly targetPower: number;
  /** Counter values added so far during the counter step. */
  readonly counterValue: number;
  /** Blocker assigned, if any. */
  readonly blocker: { readonly controller: "A" | "B"; readonly instanceId: string } | null;
}

/**
 * Per-turn event memory. Reset to empty at TURN_START.
 *
 * Many OPTCG cards condition on "this turn"-scoped facts:
 *   - "If you played a 黒 card this turn, ..." → `plays`
 *   - "If your leader attacked this turn, ..." → `leaderAttacked`
 *   - "For each DON used this turn, ..." → `donUsed`
 *   - "If you KO'd an opponent character this turn, ..." → `kos`
 *
 * Keep this as flat data; complex queries are evaluated in rules.ts.
 */
export interface TurnLog {
  readonly plays: ReadonlyArray<{
    readonly controller: "A" | "B";
    readonly cardId: string;
    readonly instanceId: string;
  }>;
  readonly kos: ReadonlyArray<{
    /** Owner of the KO'd card (i.e. whose character was KO'd). */
    readonly owner: "A" | "B";
    /** Who caused the KO. */
    readonly byController: "A" | "B";
    readonly cardId: string;
    readonly instanceId: string;
  }>;
  readonly attacks: ReadonlyArray<{
    readonly attackerController: "A" | "B";
    readonly attackerInstanceId: string;
    readonly targetKind: "leader" | "character";
  }>;
  /** DON cards spent (attached or paid as cost) by each player this turn. */
  readonly donUsed: { readonly A: number; readonly B: number };
  /** Attack count this turn per player. */
  readonly attackCount: { readonly A: number; readonly B: number };
  /** Set true once that player's leader has declared at least one attack. */
  readonly leaderAttacked: { readonly A: boolean; readonly B: boolean };
}

export const EMPTY_TURN_LOG: TurnLog = {
  plays: [],
  kos: [],
  attacks: [],
  donUsed: { A: 0, B: 0 },
  attackCount: { A: 0, B: 0 },
  leaderAttacked: { A: false, B: false },
};

/** The complete observable game state. */
export interface GameState {
  /** Engine semver — bumped on breaking changes to this schema. */
  readonly engineVersion: string;
  /** Cryptographic seed used to derive RNG and shuffle decks. */
  readonly rngSeed: string;
  /** Game-progress markers. */
  readonly turn: number;
  readonly phase: Phase;
  readonly activePlayer: "A" | "B";
  readonly goFirst: "A" | "B";
  /** A and B player states. */
  readonly players: { readonly A: PlayerState; readonly B: PlayerState };
  /** Stack of effects waiting to resolve. */
  readonly pendingEffects: readonly PendingEffect[];
  /** The current attack, if BATTLE phase mid-resolution. */
  readonly activeAttack: ActiveAttack | null;
  /** Memory of events that happened during the current turn (reset on TURN_START). */
  readonly turnLog: TurnLog;
  /** Set when the game has ended; reason for end. */
  readonly winner: "A" | "B" | "DRAW" | null;
  readonly endCondition:
    | "LIFE_OUT"
    | "DECK_OUT"
    | "EFFECT"
    | "TIMEOUT"
    | "ERROR"
    | null;
  /** Monotonic event counter — matches `game_events.seq` in the DB. */
  readonly eventSeq: number;
}

/** Engine events. Mirrors `game_events.event_type` strings. Phase A-2 will extend. */
export type EngineEventType =
  | "GAME_START"
  | "MULLIGAN_DECIDE"
  | "TURN_START"
  | "PHASE_CHANGE"
  | "DRAW"
  | "DON_GAIN"
  | "DON_ATTACH"
  | "DON_DETACH"
  | "CARD_PLAYED"
  | "EFFECT_TRIGGERED"
  | "EFFECT_RESOLVED"
  | "ATTACK_DECLARED"
  | "BLOCK_DECLARED"
  | "COUNTER_PLAYED"
  | "TRIGGER_REVEALED"
  | "DAMAGE_DEALT"
  | "LIFE_LOST"
  | "CHARACTER_KO"
  | "CARD_DRAWN_TO_TRASH"
  | "GAME_END";

export interface EngineEvent {
  readonly seq: number;
  readonly turn: number;
  readonly phase: Phase;
  readonly actor: "A" | "B" | "SYSTEM";
  readonly type: EngineEventType;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Helpers used by both rules.ts and analytics.                             */
/* ──────────────────────────────────────────────────────────────────────── */

/** Build a stable instance id from a card id and a per-deck running index. */
export function makeInstanceId(cardId: string, index: number): string {
  return `${cardId}#${index}`;
}

/** Other player. */
export function opponent(p: "A" | "B"): "A" | "B" {
  return p === "A" ? "B" : "A";
}

/** Read-only accessor for the player whose turn it currently is. */
export function activePlayer(state: GameState): PlayerState {
  return state.players[state.activePlayer];
}

export function defendingPlayer(state: GameState): PlayerState {
  return state.players[opponent(state.activePlayer)];
}
