/**
 * Public engine API barrel.
 *
 * Phase A-1 exports: state types, the Effect DSL, the seedable RNG.
 * Phase A-2 adds: init, rules (applyAction / getLegalActions), filters.
 * The CPU layer (`cpu/fast.ts`) lands in Phase C; MCTS in Phase E.
 *
 * Anything imported from `src/lib/engine/...` outside this barrel is
 * fair game internally, but downstream callers (CLI, route handlers,
 * analytics) should only consume what's re-exported here so the
 * surface area stays small.
 */

export { ENGINE_VERSION } from "./version";

export * from "./state";
export * from "./effect-dsl";
export {
  createRng,
  gameSeed,
  hashSeed,
  type Rng,
} from "./rng";

export {
  initGame,
  type DeckList,
  type InitConfig,
} from "./init";

export {
  applyAction,
  getLegalActions,
  isGameOver,
  type ApplyResult,
  type AttackTarget,
  type GameAction,
} from "./rules";

export {
  evaluateFilter,
  enumeratePlayer,
  type FilterContext,
  type LocatedInstance,
} from "./filters";

export {
  applyChoiceResolution,
  enqueueTriggeredEffect,
  evaluateCondition,
  processPendingEffects,
  resumeAfterChoice,
  type ChoiceResolution,
  type EffectResult,
  type ModalPickResolution,
  type TargetPickResolution,
  type YesNoResolution,
} from "./effects";
