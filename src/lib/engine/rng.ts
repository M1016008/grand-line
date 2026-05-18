/**
 * Seedable PRNG for the game engine.
 *
 * Determinism is non-negotiable: the simulation_runs / games / game_events
 * pipeline is built on the promise that re-running game N of run R from
 * the same seed produces an identical event stream. Without that:
 *
 *  - Paired-RNG ablation (the trick that makes 100-game runs
 *    statistically useful) collapses into raw variance noise.
 *  - Replay reconstruction in the UI breaks.
 *  - Test regression coverage stops being meaningful.
 *
 * We use Mulberry32 — a tiny, well-distributed 32-bit generator with no
 * external state. It's not cryptographic, but for game shuffles and AI
 * coin flips it's more than enough; the BigCrush failures it has are
 * irrelevant at our sample sizes.
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next integer in [0, max). */
  nextInt(max: number): number;
  /** Pick a uniform-random element. Returns undefined for empty arrays. */
  pick<T>(arr: readonly T[]): T | undefined;
  /** In-place Fisher-Yates shuffle. Returns the same array for chaining. */
  shuffle<T>(arr: T[]): T[];
  /** Snapshot of internal state — used for replay diagnostics. */
  state(): number;
}

/**
 * Hash a string seed into a 32-bit unsigned integer using FNV-1a.
 *
 * Lets callers use human-readable seeds like `"run-abc:game-7"` while
 * still feeding Mulberry32 a clean 32-bit value. Two callers passing
 * the same string get the same numeric seed.
 */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return h >>> 0;
}

/**
 * Derive a per-game seed string from a run's seed_base and the game
 * index. Keeping this in one helper avoids divergent conventions
 * between the scheduler, the engine and the replayer.
 */
export function gameSeed(seedBase: string, gameIndex: number): string {
  return `${seedBase}:${gameIndex}`;
}

export function createRng(seed: number | string): Rng {
  let a = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
  // Avoid the all-zero state that produces a stuck sequence.
  if (a === 0) a = 0x9e3779b9;

  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (max: number): number => {
    if (!Number.isFinite(max) || max <= 0) return 0;
    return Math.floor(next() * max);
  };

  return {
    next,
    nextInt,
    pick<T>(arr: readonly T[]): T | undefined {
      if (arr.length === 0) return undefined;
      return arr[nextInt(arr.length)];
    },
    shuffle<T>(arr: T[]): T[] {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = nextInt(i + 1);
        const tmp = arr[i]!;
        arr[i] = arr[j]!;
        arr[j] = tmp;
      }
      return arr;
    },
    state(): number {
      return a;
    },
  };
}
