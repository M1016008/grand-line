/**
 * Filter evaluation: resolve a CardFilter expression against the game
 * state to produce the candidate set.
 *
 * Used by:
 *  - Effect resolution (`effects.ts`, Phase B) — find KO/buff/discard targets.
 *  - Legal-action enumeration (`rules.ts`) — find legal blockers/counters.
 *  - The CPU heuristic policy — query "any opp character with cost ≤ 3".
 *
 * Determinism notes
 * ─────────────────
 * Filter evaluation is pure: same state + same filter → same result.
 * `orderBy` provides a stable tie-break; without it, callers must impose
 * their own ordering before random choice or the engine's behaviour is
 * non-reproducible across seeds. Engine code never uses Array.prototype
 * sorting without a stable comparator, so the order returned here is
 * the canonical order.
 */

import type {
  CardFilter,
  CardFilterAtom,
} from "./effect-dsl";
import type {
  CardData,
  CardInstance,
  CardRegistry,
  GameState,
  PlayerState,
} from "./state";

/** A card instance enriched with controller + zone, ready for filter eval. */
export interface LocatedInstance {
  readonly instance: CardInstance;
  readonly controller: "A" | "B";
  readonly zone:
    | "hand"
    | "deck"
    | "trash"
    | "character_area"
    | "stage_area"
    | "leader"
    | "life"
    | "don_deck"
    | "don_area";
  readonly data: CardData;
  /** Effective cost (after cost mods). Undefined if cost isn't applicable. */
  readonly cost: number | undefined;
  /** Effective power (after permanent + turn mods + attached DON × 1000). */
  readonly power: number | undefined;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Enumeration: walk a player's zones and yield LocatedInstances.           */
/* ──────────────────────────────────────────────────────────────────────── */

const DON_PER_ATTACHED_POWER = 1000;

function locateLeader(
  p: PlayerState,
  registry: CardRegistry,
): LocatedInstance {
  const data = registry.get(p.leader.cardId);
  const basePower = data.power ?? 0;
  return {
    instance: p.leader,
    controller: p.id,
    zone: "leader",
    data,
    cost: undefined,
    power:
      basePower +
      p.leader.powerModTurn +
      p.leader.attachedDon * DON_PER_ATTACHED_POWER,
  };
}

function locateCharacter(
  p: PlayerState,
  ch: PlayerState["characters"][number],
  registry: CardRegistry,
): LocatedInstance {
  const data = registry.get(ch.cardId);
  const basePower = data.power ?? 0;
  return {
    instance: ch,
    controller: p.id,
    zone: "character_area",
    data,
    cost: data.cost ?? undefined,
    power:
      basePower +
      ch.powerModPermanent +
      ch.powerModTurn +
      ch.attachedDon * DON_PER_ATTACHED_POWER,
  };
}

function locateStage(p: PlayerState, registry: CardRegistry): LocatedInstance | null {
  if (!p.stage) return null;
  const data = registry.get(p.stage.cardId);
  return {
    instance: p.stage,
    controller: p.id,
    zone: "stage_area",
    data,
    cost: data.cost ?? undefined,
    power: undefined,
  };
}

function locateZone(
  p: PlayerState,
  zone: "hand" | "deck" | "trash" | "life",
  registry: CardRegistry,
): LocatedInstance[] {
  const arr =
    zone === "hand"
      ? p.hand
      : zone === "deck"
      ? p.deck
      : zone === "trash"
      ? p.trash
      : p.life;
  const out: LocatedInstance[] = [];
  for (const inst of arr) {
    const data = registry.get(inst.cardId);
    out.push({
      instance: inst,
      controller: p.id,
      zone,
      data,
      cost: data.cost ?? undefined,
      power: data.power ?? undefined,
    });
  }
  return out;
}

/** Enumerate every located instance across all zones for one player. */
export function enumeratePlayer(
  p: PlayerState,
  registry: CardRegistry,
): LocatedInstance[] {
  const out: LocatedInstance[] = [locateLeader(p, registry)];
  for (const ch of p.characters) out.push(locateCharacter(p, ch, registry));
  const stage = locateStage(p, registry);
  if (stage) out.push(stage);
  out.push(...locateZone(p, "hand", registry));
  out.push(...locateZone(p, "deck", registry));
  out.push(...locateZone(p, "trash", registry));
  out.push(...locateZone(p, "life", registry));
  return out;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Atom matcher.                                                            */
/* ──────────────────────────────────────────────────────────────────────── */

function matchesAtom(
  loc: LocatedInstance,
  atom: CardFilterAtom,
  ctx: { controller: "A" | "B"; selfInstanceId?: string },
): boolean {
  if (atom.side) {
    const wanted =
      atom.side === "self"
        ? ctx.controller
        : atom.side === "opponent"
        ? ctx.controller === "A"
          ? "B"
          : "A"
        : null;
    if (wanted !== null && loc.controller !== wanted) return false;
  }
  if (atom.zone && loc.zone !== atom.zone) return false;
  if (atom.cardType && loc.data.cardType !== atom.cardType) return false;
  if (atom.cardId && loc.data.id !== atom.cardId) return false;
  if (atom.color && !loc.data.colors.includes(atom.color)) return false;
  if (atom.feature && !loc.data.features.includes(atom.feature)) return false;
  if (atom.mechanic && !loc.data.mechanics.includes(atom.mechanic)) return false;
  if (atom.costLte != null) {
    if (loc.cost == null || loc.cost > atom.costLte) return false;
  }
  if (atom.costGte != null) {
    if (loc.cost == null || loc.cost < atom.costGte) return false;
  }
  if (atom.costEq != null) {
    if (loc.cost == null || loc.cost !== atom.costEq) return false;
  }
  if (atom.powerLte != null) {
    if (loc.power == null || loc.power > atom.powerLte) return false;
  }
  if (atom.powerGte != null) {
    if (loc.power == null || loc.power < atom.powerGte) return false;
  }
  if (atom.isSelf === true) {
    if (!ctx.selfInstanceId) return false;
    if (loc.instance.instanceId !== ctx.selfInstanceId) return false;
  }
  return true;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Public API.                                                              */
/* ──────────────────────────────────────────────────────────────────────── */

export interface FilterContext {
  /** Which player is the controller of the effect doing the matching. */
  readonly controller: "A" | "B";
  /** Instance id of the effect source (for `isSelf` filter). */
  readonly selfInstanceId?: string;
}

/** Evaluate a CardFilter against the entire game state. */
export function evaluateFilter(
  state: GameState,
  registry: CardRegistry,
  filter: CardFilter,
  ctx: FilterContext,
): LocatedInstance[] {
  const all = [
    ...enumeratePlayer(state.players.A, registry),
    ...enumeratePlayer(state.players.B, registry),
  ];

  const matchOne = (loc: LocatedInstance): boolean => {
    if (!matchesAtom(loc, filter, ctx)) return false;
    if (filter.anyOf && filter.anyOf.length > 0) {
      const anyHit = filter.anyOf.some((sub) => matchesAtom(loc, sub, ctx));
      if (!anyHit) return false;
    }
    return true;
  };

  let matches = all.filter(matchOne);

  if (filter.orderBy) {
    matches = orderMatches(matches, filter.orderBy);
  }
  return matches;
}

function orderMatches(
  matches: LocatedInstance[],
  orderBy: NonNullable<CardFilter["orderBy"]>,
): LocatedInstance[] {
  // Stable sort. Tie-break by instanceId so the order is deterministic
  // regardless of insertion order — critical for engine reproducibility.
  const cmp = (a: LocatedInstance, b: LocatedInstance): number => {
    const av =
      orderBy === "highest_cost" || orderBy === "lowest_cost"
        ? a.cost ?? -Infinity
        : a.power ?? -Infinity;
    const bv =
      orderBy === "highest_cost" || orderBy === "lowest_cost"
        ? b.cost ?? -Infinity
        : b.power ?? -Infinity;
    const dir =
      orderBy === "highest_cost" || orderBy === "highest_power" ? -1 : 1;
    if (av !== bv) return dir * (av - bv);
    return a.instance.instanceId < b.instance.instanceId ? -1 : 1;
  };
  return [...matches].sort(cmp);
}
