/**
 * Public engine API barrel.
 *
 * Phase A-1 exports: state types, the Effect DSL, the seedable RNG.
 * Rules execution (`rules.ts`) lands in Phase A-2, the heuristic CPU
 * (`cpu/fast.ts`) in Phase C, and MCTS (`cpu/strong.ts`) in Phase E.
 *
 * Anything imported from `src/lib/engine/...` outside this barrel is
 * fair game internally, but downstream callers (CLI, route handlers,
 * analytics) should only consume what's re-exported here so the
 * surface area stays small.
 */

export const ENGINE_VERSION = "0.1.0-alpha";

export * from "./state";
export * from "./effect-dsl";
export {
  createRng,
  gameSeed,
  hashSeed,
  type Rng,
} from "./rng";
