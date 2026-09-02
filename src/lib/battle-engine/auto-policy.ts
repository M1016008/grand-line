import { cpuSkillRank, type CpuSkill } from "@/lib/practice-log";
import type { BattleEffectRegistry } from "./effect-registry";
import type { EffectAction } from "./effects";
import {
  effectiveCharacterPower,
  effectiveLeaderPower,
} from "./selectors";
import {
  DEFAULT_BATTLE_CONFIG,
  otherPlayer,
  sideOf,
  type BattlePlayer,
  type BattleState,
  type BattleTargetRef,
  type PendingDefenseChoice,
  type PendingEffectChoice,
  type PendingSearchChoice,
  type PendingTriggerChoice,
} from "./state";

export interface AutoBattlePolicy {
  readonly skill: CpuSkill;
  choosePlayableCard(
    state: BattleState,
    actor: BattlePlayer,
    registry: BattleEffectRegistry,
  ): number | null;
  chooseDonTarget(state: BattleState, actor: BattlePlayer): string | null;
  orderAttackers(
    state: BattleState,
    actor: BattlePlayer,
  ): Array<{ kind: "leader" | "character"; instanceId: string }>;
  chooseAttackTarget(
    state: BattleState,
    actor: BattlePlayer,
    targets: BattleTargetRef[],
  ): string;
  chooseEffectTarget(
    state: BattleState,
    pending: PendingEffectChoice,
  ): string | null;
  chooseSearch(
    state: BattleState,
    pending: PendingSearchChoice,
  ): number | null;
  activateTrigger(
    state: BattleState,
    pending: PendingTriggerChoice,
  ): boolean;
  chooseBlocker(
    state: BattleState,
    pending: PendingDefenseChoice,
  ): string | null;
  chooseCounterCard(
    state: BattleState,
    pending: PendingDefenseChoice,
  ): number | null;
}

export function createAutoBattlePolicy(skill: CpuSkill): AutoBattlePolicy {
  const rank = cpuSkillRank(skill);
  return {
    skill,
    choosePlayableCard(state, actor, registry) {
      const side = sideOf(state, actor);
      const availableDon = Math.max(0, side.donTotal - side.donRested);
      const candidates = side.hand
        .map((card, index) => ({ card, index }))
        .filter(({ card }) => (card.cost ?? 0) <= availableDon)
        .filter(({ card }) => {
          if (card.cardType === "LEADER") return false;
          if (card.cardType === "CHARACTER") {
            return side.board.length < DEFAULT_BATTLE_CONFIG.boardLimit;
          }
          if (card.cardType === "EVENT") {
            return registry
              .get(card.id)
              .effects.some((effect) => effect.trigger === "main");
          }
          return card.cardType === "STAGE";
        });
      if (candidates.length === 0) return null;
      candidates.sort((a, b) => {
        const scoreDelta =
          playableScore(b.card, availableDon, rank) -
          playableScore(a.card, availableDon, rank);
        return scoreDelta || a.card.id.localeCompare(b.card.id) || a.index - b.index;
      });
      return candidates[0]?.index ?? null;
    },
    chooseDonTarget(state, actor) {
      const side = sideOf(state, actor);
      if (side.donRested >= side.donTotal) return null;
      const readyAttackers = side.board
        .filter((zone) => !zone.rested)
        .sort(
          (a, b) =>
            effectiveCharacterPower(b) - effectiveCharacterPower(a) ||
            a.instanceId.localeCompare(b.instanceId),
        );
      if (rank >= 4 && readyAttackers[0]) return readyAttackers[0].instanceId;
      return `${actor}:leader`;
    },
    orderAttackers(state, actor) {
      const side = sideOf(state, actor);
      const characters = side.board
        .filter((zone) => !zone.rested)
        .sort(
          (a, b) =>
            effectiveCharacterPower(b) - effectiveCharacterPower(a) ||
            a.instanceId.localeCompare(b.instanceId),
        )
        .map((zone) => ({ kind: "character" as const, instanceId: zone.instanceId }));
      return rank >= 4
        ? [...characters, { kind: "leader", instanceId: `${actor}:leader` }]
        : [{ kind: "leader", instanceId: `${actor}:leader` }, ...characters];
    },
    chooseAttackTarget(state, actor, targets) {
      const leader = targets.find((target) => target.zone === "leader");
      if (rank <= 2) return (leader ?? targets[0]).instanceId;
      const rested = targets
        .filter((target) => target.zone === "character")
        .sort((a, b) => targetValue(state, b) - targetValue(state, a));
      return (rested[0] ?? leader ?? targets[0]).instanceId;
    },
    chooseEffectTarget(state, pending) {
      const beneficial = beneficialTargets(pending.actor, pending.action, pending.legalTargets);
      if (pending.action.target.optional && beneficial.length === 0) return null;
      const targets = beneficial.length > 0 ? beneficial : pending.legalTargets;
      return [...targets]
        .sort((a, b) => targetValue(state, b) - targetValue(state, a))[0]
        ?.instanceId ?? null;
    },
    chooseSearch(_state, pending) {
      if (pending.legalChoices.length === 0) return null;
      if (pending.action.optional && rank === 1) return null;
      return [...pending.legalChoices]
        .sort(
          (a, b) =>
            cardValue(b.card, rank) - cardValue(a.card, rank) ||
            a.card.id.localeCompare(b.card.id) ||
            a.lookedIndex - b.lookedIndex,
        )[0]?.lookedIndex ?? null;
    },
    activateTrigger(state, pending) {
      return pending.effect.actions.every((action) =>
        isClearlyBeneficialTriggerAction(state, pending.defender, action),
      );
    },
    chooseBlocker(state, pending) {
      if (rank === 1 || pending.blockerOptions.length === 0) return null;
      const defense = targetPower(state, pending.target);
      if (pending.attackPower < defense) return null;
      if (pending.target.zone === "character" && rank < 4) return null;
      return [...pending.blockerOptions]
        .sort((a, b) => targetValue(state, a) - targetValue(state, b))[0]
        ?.instanceId ?? null;
    },
    chooseCounterCard(state, pending) {
      if (rank === 1) return null;
      const needed = Math.max(
        0,
        pending.attackPower -
          targetPower(state, pending.target) -
          pending.counterPower +
          1_000,
      );
      if (needed === 0) return null;
      const maxCards = rank >= 5 ? Number.POSITIVE_INFINITY : rank >= 4 ? 3 : 1;
      const candidates = sideOf(state, pending.defender).hand
        .map((card, index) => ({ index, value: card.counter ?? 0, id: card.id }))
        .filter((entry) => entry.value > 0);
      const selected = minimumCounterSubset(candidates, needed, maxCards);
      return selected[0]?.index ?? null;
    },
  };
}

function playableScore(
  card: { id: string; cost: number | null; power: number | null; counter: number | null; mechanics: string[] },
  availableDon: number,
  rank: number,
): number {
  const cost = card.cost ?? 0;
  if (rank === 1) return -cost * 100 - (card.power ?? 0) / 1_000;
  const curveFit = 20 - Math.abs(availableDon - cost) * (rank >= 4 ? 4 : 2);
  const power = (card.power ?? 0) / 1_000;
  const utility = card.mechanics.filter((mechanic) =>
    ["Rush", "Blocker", "Draw", "Search", "OnPlay"].includes(mechanic),
  ).length * rank;
  const counterReserve = rank >= 4 ? -((card.counter ?? 0) / 1_000) : 0;
  return curveFit + power + utility + counterReserve;
}

function cardValue(
  card: { cost: number | null; power: number | null; counter: number | null; mechanics: string[] },
  rank: number,
): number {
  return (
    (card.cost ?? 0) * 2 +
    (card.power ?? 0) / 1_000 +
    (card.counter ?? 0) / 1_000 +
    card.mechanics.length * Math.max(1, rank - 2)
  );
}

function targetPower(state: BattleState, target: BattleTargetRef): number {
  if (target.zone === "leader") return effectiveLeaderPower(state, target.owner);
  const zone = sideOf(state, target.owner).board.find(
    (entry) => entry.instanceId === target.instanceId,
  );
  return zone ? effectiveCharacterPower(zone) : 0;
}

function targetValue(state: BattleState, target: BattleTargetRef): number {
  if (target.zone === "leader") return sideOf(state, target.owner).lifeCards.length * 10_000;
  const zone = sideOf(state, target.owner).board.find(
    (entry) => entry.instanceId === target.instanceId,
  );
  return zone
    ? effectiveCharacterPower(zone) + (zone.card.cost ?? 0) * 1_000
    : 0;
}

function beneficialTargets(
  actor: BattlePlayer,
  action: Extract<EffectAction, { target: unknown }>,
  targets: BattleTargetRef[],
): BattleTargetRef[] {
  if (["ko", "return_to_hand", "return_to_deck", "rest"].includes(action.type)) {
    return targets.filter((target) => target.owner === otherPlayer(actor));
  }
  if (action.type === "activate") {
    return targets.filter((target) => target.owner === actor);
  }
  if (action.type === "power_modifier" || action.type === "cost_modifier") {
    return targets.filter((target) =>
      action.amount >= 0
        ? target.owner === actor
        : target.owner === otherPlayer(actor),
    );
  }
  return [];
}

function isClearlyBeneficialTriggerAction(
  _state: BattleState,
  actor: BattlePlayer,
  action: EffectAction,
): boolean {
  if (["draw", "search", "play_self", "add_life"].includes(action.type)) return true;
  if (action.type === "take_life") return false;
  if (!("target" in action)) return false;
  if (["ko", "return_to_hand", "return_to_deck", "rest"].includes(action.type)) {
    return action.target.owner !== "own";
  }
  if (action.type === "activate") return action.target.owner !== "opponent";
  if (action.type === "power_modifier" || action.type === "cost_modifier") {
    return action.amount >= 0
      ? action.target.owner !== "opponent"
      : action.target.owner !== "own";
  }
  void actor;
  return !action.target.optional;
}

function minimumCounterSubset(
  candidates: Array<{ index: number; value: number; id: string }>,
  needed: number,
  maxCards: number,
): Array<{ index: number; value: number; id: string }> {
  const ordered = [...candidates].sort(
    (a, b) => a.value - b.value || a.id.localeCompare(b.id) || a.index - b.index,
  );
  const sums = new Map<number, typeof ordered>([[0, []]]);
  for (const candidate of ordered) {
    for (const [sum, chosen] of [...sums.entries()].sort((a, b) => b[0] - a[0])) {
      if (chosen.length >= maxCards) continue;
      const nextSum = sum + candidate.value;
      const next = [...chosen, candidate];
      const current = sums.get(nextSum);
      if (!current || next.length < current.length) sums.set(nextSum, next);
    }
  }
  return (
    [...sums.entries()]
      .filter(([sum]) => sum >= needed)
      .sort(
        (a, b) =>
          a[0] - b[0] ||
          a[1].length - b[1].length ||
          a[1].map((entry) => entry.id).join("|").localeCompare(
            b[1].map((entry) => entry.id).join("|"),
          ),
      )[0]?.[1] ?? []
  );
}
