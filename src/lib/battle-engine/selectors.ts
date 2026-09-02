import type { TargetSpec } from "./effects";
import {
  otherPlayer,
  sideOf,
  type BattlePlayer,
  type BattleState,
  type BattleTargetRef,
  type BattleZoneCard,
} from "./state";

export function effectiveCharacterCost(zone: BattleZoneCard): number {
  return Math.max(0, (zone.card.cost ?? 0) + zone.costModifier);
}

export function effectiveCharacterPower(zone: BattleZoneCard): number {
  return Math.max(
    0,
    (zone.card.power ?? 0) + zone.powerModifier + zone.attachedDon * 1_000,
  );
}

export function effectiveLeaderPower(state: BattleState, owner: BattlePlayer): number {
  const side = sideOf(state, owner);
  return Math.max(
    0,
    (side.leader.power ?? 5_000) +
      side.leaderPowerModifier +
      side.leaderAttachedDon * 1_000,
  );
}

export function legalTargets(
  state: BattleState,
  actor: BattlePlayer,
  spec: TargetSpec,
): BattleTargetRef[] {
  const owners: BattlePlayer[] =
    spec.owner === "own"
      ? [actor]
      : spec.owner === "opponent"
        ? [otherPlayer(actor)]
        : [actor, otherPlayer(actor)];
  const targets: BattleTargetRef[] = [];

  for (const owner of owners) {
    const side = sideOf(state, owner);
    if (spec.zones.includes("leader")) {
      targets.push({
        owner,
        zone: "leader",
        instanceId: `${owner}:leader`,
        cardId: side.leader.id,
        label: `${side.leader.name} (リーダー)`,
      });
    }
    if (!spec.zones.includes("character")) continue;
    for (const zone of side.board) {
      const cost = effectiveCharacterCost(zone);
      const power = effectiveCharacterPower(zone);
      if (spec.state === "rested" && !zone.rested) continue;
      if (spec.state === "active" && zone.rested) continue;
      if (spec.maxCost !== undefined && cost > spec.maxCost) continue;
      if (spec.minCost !== undefined && cost < spec.minCost) continue;
      if (spec.maxPower !== undefined && power > spec.maxPower) continue;
      if (spec.minPower !== undefined && power < spec.minPower) continue;
      if (spec.feature && !zone.card.features.includes(spec.feature)) continue;
      if (spec.color && !zone.card.colors.includes(spec.color)) continue;
      targets.push({
        owner,
        zone: "character",
        instanceId: zone.instanceId,
        cardId: zone.card.id,
        label: `${zone.card.name} (cost ${cost} / power ${power})`,
      });
    }
  }
  return targets.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
}

export function chooseDeterministicTarget(
  state: BattleState,
  targets: BattleTargetRef[],
): BattleTargetRef | undefined {
  return [...targets].sort((a, b) => {
    const aZone = sideOf(state, a.owner).board.find((zone) => zone.instanceId === a.instanceId);
    const bZone = sideOf(state, b.owner).board.find((zone) => zone.instanceId === b.instanceId);
    const powerDelta =
      (bZone ? effectiveCharacterPower(bZone) : 0) -
      (aZone ? effectiveCharacterPower(aZone) : 0);
    if (powerDelta !== 0) return powerDelta;
    const costDelta =
      (bZone ? effectiveCharacterCost(bZone) : 0) -
      (aZone ? effectiveCharacterCost(aZone) : 0);
    return costDelta || a.instanceId.localeCompare(b.instanceId);
  })[0];
}

export function blockerTargets(
  state: BattleState,
  defender: BattlePlayer,
  isBlocker: (cardId: string) => boolean,
): BattleTargetRef[] {
  return sideOf(state, defender).board
    .filter((zone) => !zone.rested && isBlocker(zone.card.id))
    .map((zone) => ({
      owner: defender,
      zone: "character" as const,
      instanceId: zone.instanceId,
      cardId: zone.card.id,
      label: `${zone.card.name} (${effectiveCharacterPower(zone)})`,
    }));
}

export function totalCardsInSide(state: BattleState, owner: BattlePlayer): number {
  const side = sideOf(state, owner);
  return (
    side.deck.length +
    side.hand.length +
    side.lifeCards.length +
    side.board.length +
    side.trash.length
  );
}
