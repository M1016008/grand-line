/**
 * Fast heuristic CPU policy.
 *
 * Picks one action per decision point using simple priorities. Designed
 * to be cheap (~1ms per move) so AI-vs-AI bulk simulations can run
 * thousands of games quickly. Quality-wise, it's "weak intermediate"
 * — good enough to expose deck mechanics but not a serious sparring
 * partner. Phase E's MCTS layer will eat this for breakfast.
 *
 * Decision rules (priority high → low)
 * ────────────────────────────────────
 * Choice resolution (when state.pendingChoice is set):
 *   - TARGET_PICK: prefer highest-cost target (proxy for "biggest impact").
 *   - MODAL_PICK:  pick the first mode (DSL author's preferred ordering).
 *   - YES_NO:      always accept (most YES_NO prompts are upside-only).
 *
 * MAIN phase:
 *   1. Lethal: attack opp leader if they have 0 life and can win it.
 *   2. Trade: attack to KO opp characters when our attacker wins.
 *   3. Play the highest-cost affordable card.
 *   4. Attach DON to leader / strongest character.
 *   5. Attack opp leader / rested chars (chip damage).
 *   6. End turn.
 *
 * BATTLE phase (defender):
 *   - If our leader is about to die (life === 0) and a counter prevents
 *     the hit: play it.
 *   - If blocker is available and target is leader: block.
 *   - Else pass.
 *
 * MULLIGAN: keep (never redraw — placeholder, Phase E refines).
 */

import type { ChoiceResolution } from "../effects";
import type { GameAction } from "../rules";
import type { CardRegistry, GameState } from "../state";

export interface CpuPolicy {
  chooseAction(
    state: GameState,
    registry: CardRegistry,
    legal: readonly GameAction[],
  ): GameAction;
  chooseResolution(state: GameState, registry: CardRegistry): ChoiceResolution;
}

export function createFastCpu(): CpuPolicy {
  return {
    chooseAction,
    chooseResolution,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Action selection                                                         */
/* ──────────────────────────────────────────────────────────────────────── */

function chooseAction(
  state: GameState,
  registry: CardRegistry,
  legal: readonly GameAction[],
): GameAction {
  if (legal.length === 0) {
    throw new Error("CPU asked to act but no legal actions");
  }

  // Mulligan: keep starting hand by default.
  const mulligan = legal.find(
    (a) => a.type === "MULLIGAN_DECIDE" && a.redraw === false,
  );
  if (mulligan) return mulligan;

  if (state.phase === "BATTLE") {
    return battleAction(state, registry, legal);
  }
  if (state.phase === "MAIN") {
    return mainAction(state, registry, legal);
  }
  return legal[0]!;
}

function mainAction(
  state: GameState,
  registry: CardRegistry,
  legal: readonly GameAction[],
): GameAction {
  const who = state.activePlayer;
  const opp = who === "A" ? "B" : "A";
  const oppLife = state.players[opp].life.length;

  // 1. Lethal-on-leader heuristic.
  if (oppLife === 0) {
    const lethal = legal.find(
      (a) => a.type === "DECLARE_ATTACK" && a.target.kind === "leader",
    );
    if (lethal) return lethal;
  }

  // 2. Trade: attack opp rested character we can KO.
  const koAttack = legal.find(
    (a) => a.type === "DECLARE_ATTACK" && a.target.kind === "character",
  );
  if (koAttack) return koAttack;

  // 3. Play highest-cost affordable card.
  const plays = legal.filter(
    (a) =>
      a.type === "PLAY_CHARACTER" ||
      a.type === "PLAY_EVENT" ||
      a.type === "PLAY_STAGE",
  );
  if (plays.length > 0) {
    let best: GameAction = plays[0]!;
    let bestCost = -Infinity;
    for (const p of plays) {
      const id =
        p.type === "PLAY_CHARACTER" ||
        p.type === "PLAY_EVENT" ||
        p.type === "PLAY_STAGE"
          ? p.handInstanceId
          : "";
      const card = state.players[who].hand.find((c) => c.instanceId === id);
      if (!card) continue;
      const c = registry.get(card.cardId).cost ?? 0;
      if (c > bestCost) {
        bestCost = c;
        best = p;
      }
    }
    return best;
  }

  // 4. Attach DON if we have a leader attack lined up (and active DON to spare).
  const attachLeader = legal.find(
    (a) => a.type === "ATTACH_DON" && a.target === "leader",
  );
  if (attachLeader && state.players[who].donArea.active >= 1) {
    // Only attach if there's a leader attack in our legal set — otherwise
    // wait and use DON for a play next turn.
    const leaderAttack = legal.find(
      (a) =>
        a.type === "DECLARE_ATTACK" &&
        a.attackerInstanceId === state.players[who].leader.instanceId,
    );
    if (leaderAttack) return attachLeader;
  }

  // 5. Generic attack (leader → opp leader, or chip).
  const anyAttack = legal.find((a) => a.type === "DECLARE_ATTACK");
  if (anyAttack) return anyAttack;

  // 6. Fallback: end turn.
  const end = legal.find((a) => a.type === "END_TURN");
  if (end) return end;
  return legal[0]!;
}

function battleAction(
  state: GameState,
  registry: CardRegistry,
  legal: readonly GameAction[],
): GameAction {
  const att = state.activeAttack;
  if (!att) {
    return legal.find((a) => a.type === "PASS_PHASE") ?? legal[0]!;
  }
  const defenderId = att.attacker.controller === "A" ? "B" : "A";
  const def = state.players[defenderId];

  // Will the attack hit as-is? Hit = attackerPower >= targetPower + counterValue.
  const hits = att.attackerPower >= att.targetPower + att.counterValue;

  // Lethal-on-leader check.
  const aboutToLoseLife = att.target.kind === "leader" && def.life.length === 0;

  // If we'd lose the game, throw any counter that helps.
  if (hits && aboutToLoseLife) {
    const counter = legal.find(
      (a) => a.type === "PLAY_COUNTER" && a.counterHandInstanceId,
    );
    if (counter) return counter;
    const blocker = legal.find((a) => a.type === "DECLARE_BLOCK");
    if (blocker) return blocker;
  }

  // If hit on leader and a blocker can save it (blocker has >= attacker
  // power), block.
  if (hits && att.target.kind === "leader") {
    const blockers = legal.filter(
      (a) => a.type === "DECLARE_BLOCK" && a.blockerInstanceId,
    );
    for (const b of blockers) {
      if (b.type !== "DECLARE_BLOCK" || !b.blockerInstanceId) continue;
      const ch = def.characters.find(
        (c) => c.instanceId === b.blockerInstanceId,
      );
      if (!ch) continue;
      const data = registry.get(ch.cardId);
      const blockerPower =
        (data.power ?? 0) + ch.powerModPermanent + ch.powerModTurn + ch.attachedDon * 1000;
      if (blockerPower >= att.attackerPower) {
        return b;
      }
    }
  }

  // Pass — let the hit (or miss) resolve.
  return legal.find((a) => a.type === "PASS_PHASE") ??
    legal.find(
      (a) => a.type === "PLAY_COUNTER" && a.counterHandInstanceId === null,
    ) ??
    legal[0]!;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Choice resolution                                                        */
/* ──────────────────────────────────────────────────────────────────────── */

function chooseResolution(
  state: GameState,
  registry: CardRegistry,
): ChoiceResolution {
  const c = state.pendingChoice;
  if (!c) throw new Error("CPU asked for resolution but no pendingChoice");

  if (c.kind === "YES_NO") {
    // Default to accepting (most prompts are upside).
    return { kind: "YES_NO", accept: true };
  }
  if (c.kind === "MODAL_PICK") {
    // Pick the first mode — DSL author's preferred order.
    return { kind: "MODAL_PICK", modeId: c.modeIds[0]! };
  }
  // TARGET_PICK
  const options = c.options;
  if (options.length === 0) {
    return { kind: "TARGET_PICK", picked: [] };
  }
  // Score each option by its card cost (proxy for impact).
  const scored = options
    .map((id) => ({
      id,
      score: scoreInstanceForTarget(state, registry, id),
    }))
    .sort((a, b) => b.score - a.score);
  const k = Math.min(c.maxPick, Math.max(c.minPick, 1));
  return {
    kind: "TARGET_PICK",
    picked: scored.slice(0, k).map((s) => s.id),
  };
}

function scoreInstanceForTarget(
  state: GameState,
  registry: CardRegistry,
  instanceId: string,
): number {
  for (const who of ["A", "B"] as const) {
    const p = state.players[who];
    if (instanceId === p.leader.instanceId) {
      return 100; // leader is high-priority for buffs / damage
    }
    const ch = p.characters.find((c) => c.instanceId === instanceId);
    if (ch) {
      const data = registry.get(ch.cardId);
      return (data.cost ?? 0) * 10 + (data.power ?? 0) / 100;
    }
    const hand = p.hand.find((c) => c.instanceId === instanceId);
    if (hand) {
      const data = registry.get(hand.cardId);
      return (data.cost ?? 0) * 10 + (data.counter ?? 0) / 100;
    }
    const trash = p.trash.find((c) => c.instanceId === instanceId);
    if (trash) {
      const data = registry.get(trash.cardId);
      return (data.cost ?? 0) * 10;
    }
  }
  return 0;
}
