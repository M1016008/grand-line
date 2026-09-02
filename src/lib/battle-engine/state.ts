import type { CardListItem } from "@/lib/cards";
import type { CpuSkill } from "@/lib/practice-log";
import type { EffectAction, TriggeredEffect } from "./effects";

export type BattlePlayer = "player" | "opponent";
export type BattleWinner = BattlePlayer;
export type BattleChoiceMode = "interactive" | "deferred";

export interface BattleZoneCard {
  instanceId: string;
  card: CardListItem;
  rested: boolean;
  playedTurn: number;
  attachedDon: number;
  powerModifier: number;
  costModifier: number;
}

export interface BattleSide {
  deckName: string;
  leader: CardListItem;
  deck: CardListItem[];
  hand: CardListItem[];
  lifeCards: CardListItem[];
  /** Character area only. Stage cards never enter this collection. */
  board: BattleZoneCard[];
  /** The single dedicated Stage area defined by the official rules. */
  stage?: BattleZoneCard;
  trash: CardListItem[];
  donTotal: number;
  donRested: number;
  donDeck: number;
  leaderRested: boolean;
  leaderAttachedDon: number;
  leaderPowerModifier: number;
}

export interface BattleTargetRef {
  owner: BattlePlayer;
  zone: "character" | "leader";
  instanceId: string;
  cardId: string;
  label: string;
}

export interface PendingEffectChoice {
  type: "effect_target";
  actor: BattlePlayer;
  sourceCardId: string;
  sourceName: string;
  action: Extract<EffectAction, { target: unknown }>;
  remainingActions: EffectAction[];
  legalTargets: BattleTargetRef[];
  trigger: TriggeredEffect["trigger"];
}

export interface PendingAttackTargetChoice {
  type: "attack_target";
  attacker: BattlePlayer;
  attackerKind: "leader" | "character";
  attackerInstanceId: string;
  legalTargets: BattleTargetRef[];
  cpuSkill: CpuSkill;
}

export interface SearchChoiceEntry {
  lookedIndex: number;
  card: CardListItem;
}

export interface PendingSearchChoice {
  type: "search";
  actor: BattlePlayer;
  sourceCardId: string;
  sourceName: string;
  action: Extract<EffectAction, { type: "search" }>;
  remainingActions: EffectAction[];
  trigger: TriggeredEffect["trigger"];
  legalChoices: SearchChoiceEntry[];
}

export interface PendingDefenseChoice {
  type: "defense";
  attacker: BattlePlayer;
  defender: BattlePlayer;
  attackerName: string;
  attackPower: number;
  target: BattleTargetRef;
  blockerOptions: BattleTargetRef[];
  selectedBlocker?: BattleTargetRef;
  counterPower: number;
}

export interface AttackContext {
  attacker: BattlePlayer;
  defender: BattlePlayer;
  attackerIdentity:
    | { kind: "leader"; instanceId: string }
    | { kind: "character"; instanceId: string };
  attackerName: string;
  attackPower: number;
  target: BattleTargetRef;
  cpuSkill: CpuSkill;
}

export interface CpuAttackQueue {
  cpuSkill: CpuSkill;
  attacks: Array<
    | { kind: "leader"; instanceId: "opponent:leader" }
    | { kind: "character"; instanceId: string }
  >;
}

export interface PendingTriggerChoice {
  type: "trigger";
  defender: BattlePlayer;
  revealedCard: CardListItem;
  effect: TriggeredEffect;
}

export type PendingChoice =
  | PendingEffectChoice
  | PendingAttackTargetChoice
  | PendingSearchChoice
  | PendingDefenseChoice
  | PendingTriggerChoice;

export interface BattleState {
  seed: number;
  turn: number;
  activePlayer: BattlePlayer;
  /** Defaults to player for legacy interactive states. */
  firstPlayer?: BattlePlayer;
  /** Personal turns begun by each side. Headless games always populate this. */
  turnsTaken?: Record<BattlePlayer, number>;
  /** Interactive preserves Player prompts; deferred exposes every choice to a policy. */
  choiceMode?: BattleChoiceMode;
  /** A zero limit disables human-readable logs for high-volume headless runs. */
  logLimit?: number;
  player: BattleSide;
  opponent: BattleSide;
  log: string[];
  pending?: PendingChoice;
  queuedAttack?: AttackContext;
  cpuAttackQueue?: CpuAttackQueue;
  winner?: BattleWinner;
  sequence: number;
}

export interface BattleEngineConfig {
  boardLimit: number;
  logLimit: number;
}

export const DEFAULT_BATTLE_CONFIG: BattleEngineConfig = {
  boardLimit: 5,
  logLimit: 80,
};

export function otherPlayer(player: BattlePlayer): BattlePlayer {
  return player === "player" ? "opponent" : "player";
}

export function sideOf(state: BattleState, player: BattlePlayer): BattleSide {
  return state[player];
}

export function withSide(
  state: BattleState,
  player: BattlePlayer,
  side: BattleSide,
): BattleState {
  return { ...state, [player]: side };
}

export function appendBattleLog(state: BattleState, ...lines: string[]): BattleState {
  const limit = state.logLimit ?? DEFAULT_BATTLE_CONFIG.logLimit;
  if (limit <= 0 || lines.length === 0) return state;
  return {
    ...state,
    log: [...state.log, ...lines].slice(-limit),
  };
}

export function personalTurnsTaken(
  state: BattleState,
  player: BattlePlayer,
): number {
  return state.turnsTaken?.[player] ?? state.turn;
}

/**
 * Comprehensive Rules loss processing: a player loses as soon as their deck
 * contains zero cards, rather than when a later draw fails.
 */
export function resolveDeckOut(
  state: BattleState,
  owner: BattlePlayer,
): BattleState {
  if (state.winner || sideOf(state, owner).deck.length > 0) return state;
  const label = owner === "player" ? "あなた" : "CPU";
  return appendBattleLog(
    {
      ...state,
      winner: otherPlayer(owner),
      pending: undefined,
      queuedAttack: undefined,
      cpuAttackQueue: undefined,
    },
    `→ ${label}のデッキが0枚になり敗北`,
  );
}
