/**
 * Headless game runner: drives a complete game via two CpuPolicy
 * objects. Returns the final state plus the full event stream — what
 * the analytics layer needs to compute winrate / trigger counts / KO
 * histories.
 *
 * Determinism contract
 * ────────────────────
 * `runGame(config)` is bit-for-bit reproducible given identical:
 *   - config.seed
 *   - config.deckA / deckB (including card order is irrelevant — the
 *     interpreter sorts internally to a canonical order)
 *   - the CpuPolicy objects (their decisions must be pure functions of
 *     state; the built-in `fast` CPU satisfies this)
 *
 * This guarantee is what makes paired-RNG ablation analysis usable on
 * 100-game samples.
 */

import type { CpuPolicy } from "./cpu/fast";
import { type DeckList, initGame } from "./init";
import {
  applyAction,
  getLegalActions,
  isGameOver,
  type ApplyResult,
  type GameAction,
} from "./rules";
import type {
  CardRegistry,
  EngineEvent,
  GameState,
} from "./state";

export interface RunGameConfig {
  readonly registry: CardRegistry;
  readonly deckA: DeckList;
  readonly deckB: DeckList;
  readonly seed: string;
  readonly goFirst: "A" | "B";
  readonly cpuA: CpuPolicy;
  readonly cpuB: CpuPolicy;
  /** Safety cap: abort with TIMEOUT if a game runs longer than this many turns. */
  readonly maxTurns?: number;
  /** Max actions taken across the whole game (defensive against infinite loops). */
  readonly maxActions?: number;
}

export interface RunGameResult {
  readonly finalState: GameState;
  readonly events: ReadonlyArray<EngineEvent>;
  /** Sequence of actions taken — useful for replay reconstruction. */
  readonly actions: ReadonlyArray<{ readonly actor: "A" | "B"; readonly action: GameAction }>;
}

export function runGame(config: RunGameConfig): RunGameResult {
  const {
    registry,
    cpuA,
    cpuB,
    maxTurns = 30,
    maxActions = 5000,
  } = config;

  let state = initGame({
    registry,
    deckA: config.deckA,
    deckB: config.deckB,
    seed: config.seed,
    goFirst: config.goFirst,
  });
  const events: EngineEvent[] = [];
  const actions: { actor: "A" | "B"; action: GameAction }[] = [];

  for (let step = 0; step < maxActions; step++) {
    if (isGameOver(state)) break;
    if (state.turn > maxTurns) {
      // Timeout: declare a draw (no winner override on existing winner).
      state = {
        ...state,
        winner: state.winner ?? "DRAW",
        endCondition: state.endCondition ?? "TIMEOUT",
        phase: "GAME_OVER",
      };
      break;
    }

    // Decide which CPU acts. Priority:
    //   - If pendingChoice is set, the chooser's CPU answers.
    //   - Otherwise the active player's CPU acts.
    let actor: "A" | "B";
    let action: GameAction;
    if (state.pendingChoice) {
      actor = state.pendingChoice.chooser;
      const cpu = actor === "A" ? cpuA : cpuB;
      const resolution = cpu.chooseResolution(state, registry);
      action = { type: "RESOLVE_CHOICE", resolution };
    } else if (state.phase === "MULLIGAN") {
      // Mulligan: each undecided player acts in turn.
      const undecided: "A" | "B" = !state.players.A.didMulligan ? "A" : "B";
      actor = undecided;
      const cpu = actor === "A" ? cpuA : cpuB;
      const legal = getLegalActions(state, registry).filter(
        (a) => a.type === "MULLIGAN_DECIDE" && a.player === actor,
      );
      action = cpu.chooseAction(state, registry, legal);
    } else if (state.phase === "BATTLE") {
      // Defender acts during BATTLE.
      const attacker = state.activeAttack?.attacker.controller ?? state.activePlayer;
      actor = attacker === "A" ? "B" : "A";
      const cpu = actor === "A" ? cpuA : cpuB;
      const legal = getLegalActions(state, registry);
      action = cpu.chooseAction(state, registry, legal);
    } else {
      actor = state.activePlayer;
      const cpu = actor === "A" ? cpuA : cpuB;
      const legal = getLegalActions(state, registry);
      action = cpu.chooseAction(state, registry, legal);
    }

    const result: ApplyResult = applyAction(state, action, registry);
    state = result.state;
    events.push(...result.events);
    actions.push({ actor, action });
  }

  if (!isGameOver(state) && state.turn <= (maxTurns ?? 30)) {
    // Action cap hit without game end — mark TIMEOUT.
    state = {
      ...state,
      winner: state.winner ?? "DRAW",
      endCondition: state.endCondition ?? "TIMEOUT",
      phase: "GAME_OVER",
    };
  }

  return { finalState: state, events, actions };
}
