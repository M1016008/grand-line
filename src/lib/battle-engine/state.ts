import type { CardListItem } from "@/lib/cards";
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
  board: BattleZoneCard[];
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
  action: EffectAction;
  remainingActions: EffectAction[];
  legalTargets: BattleTargetRef[];
  trigger: TriggeredEffect["trigger"];
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
}

export interface PendingTriggerChoice {
  type: "trigger";
  defender: BattlePlayer;
  revealedCard: CardListItem;
  effect: TriggeredEffect;
}

export type PendingChoice =
  | PendingEffectChoice
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
  resumePlayerTurn?: boolean;
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
