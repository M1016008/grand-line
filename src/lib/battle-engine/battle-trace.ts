import {
  sideOf,
  type BattlePlayer,
  type BattleState,
} from "./state";

export type BattleTraceMode = "none" | "summary" | "full";

export type BattleTraceEventType =
  | "battle_start"
  | "turn_start"
  | "play_card"
  | "don_attach"
  | "attack_declared"
  | "attack_target"
  | "effect_target"
  | "search_choice"
  | "trigger_choice"
  | "blocker_choice"
  | "counter_used"
  | "attack_resolved"
  | "turn_end"
  | "game_end"
  | "guard";

export interface RulesBattleStats {
  cardsPlayed: number;
  attacksDeclared: number;
  leaderAttacks: number;
  characterAttacks: number;
  damageDealt: number;
  blockersUsed: number;
  counterCardsUsed: number;
  counterPowerUsed: number;
  triggersRevealed: number;
  triggersActivated: number;
  triggersDeclined: number;
  searchesResolved: number;
  donAttached: number;
  donSpent: number;
  deckOut: number;
  supportedEffectsResolved: number;
  partialEffectsEncountered: number;
  unsupportedEffectsEncountered: number;
}

export interface HeadlessSideSummary {
  deck: number;
  hand: number;
  life: number;
  characters: number;
  stage: number;
  trash: number;
  /** A revealed Life card awaiting a Trigger decision. */
  resolving: number;
  donTotal: number;
  donRested: number;
}

export interface HeadlessStateSummary {
  turn: number;
  activePlayer: BattlePlayer;
  winner?: BattlePlayer;
  player: HeadlessSideSummary;
  opponent: HeadlessSideSummary;
}

export interface BattleTraceEvent {
  index: number;
  type: BattleTraceEventType;
  turn: number;
  actor?: BattlePlayer;
  cardId?: string;
  targetId?: string;
  details?: Record<string, string | number | boolean | null>;
  state?: HeadlessStateSummary;
}

export interface BattleTraceRecorder {
  readonly events: BattleTraceEvent[] | undefined;
  push(
    type: BattleTraceEventType,
    state: BattleState,
    input?: Omit<BattleTraceEvent, "index" | "type" | "turn" | "state">,
  ): void;
}

export function emptyRulesBattleStats(): RulesBattleStats {
  return {
    cardsPlayed: 0,
    attacksDeclared: 0,
    leaderAttacks: 0,
    characterAttacks: 0,
    damageDealt: 0,
    blockersUsed: 0,
    counterCardsUsed: 0,
    counterPowerUsed: 0,
    triggersRevealed: 0,
    triggersActivated: 0,
    triggersDeclined: 0,
    searchesResolved: 0,
    donAttached: 0,
    donSpent: 0,
    deckOut: 0,
    supportedEffectsResolved: 0,
    partialEffectsEncountered: 0,
    unsupportedEffectsEncountered: 0,
  };
}

export function summarizeBattleState(state: BattleState): HeadlessStateSummary {
  return {
    turn: state.turn,
    activePlayer: state.activePlayer,
    winner: state.winner,
    player: summarizeSide(state, "player"),
    opponent: summarizeSide(state, "opponent"),
  };
}

export function createBattleTraceRecorder(
  mode: BattleTraceMode,
): BattleTraceRecorder {
  const events: BattleTraceEvent[] | undefined = mode === "none" ? undefined : [];
  return {
    events,
    push(type, state, input = {}) {
      if (!events) return;
      if (mode === "summary" && !SUMMARY_EVENTS.has(type)) return;
      events.push({
        index: events.length,
        type,
        turn: state.turn,
        ...input,
        state: summarizeBattleState(state),
      });
    },
  };
}

const SUMMARY_EVENTS = new Set<BattleTraceEventType>([
  "battle_start",
  "turn_start",
  "turn_end",
  "game_end",
  "guard",
]);

function summarizeSide(
  state: BattleState,
  owner: BattlePlayer,
): HeadlessSideSummary {
  const side = sideOf(state, owner);
  return {
    deck: side.deck.length,
    hand: side.hand.length,
    life: side.lifeCards.length,
    characters: side.board.length,
    stage: side.stage ? 1 : 0,
    trash: side.trash.length,
    resolving:
      state.pending?.type === "trigger" && state.pending.defender === owner ? 1 : 0,
    donTotal: side.donTotal,
    donRested: side.donRested,
  };
}
