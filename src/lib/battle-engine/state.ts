import type { CardListItem } from "@/lib/cards";
import type { CpuSkill } from "@/lib/practice-log";
import type { EffectAction, TriggeredEffect } from "./effects";

export type BattlePlayer = "player" | "opponent";
export type BattleWinner = BattlePlayer;

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
  return {
    ...state,
    log: [...state.log, ...lines].slice(-DEFAULT_BATTLE_CONFIG.logLimit),
  };
}
