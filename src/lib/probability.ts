/**
 * Phase 3.7 — probability engine.
 *
 * Two complementary calculators:
 *
 *  1. **Hypergeometric (exact, closed form).** Given a deck of `N` cards
 *     containing `K` "successes" (e.g. cards in the "key" group) and a
 *     hand of `n` cards, what is `P(X >= k)`? This is the right tool for
 *     "do I have *at least one* of my finishers by turn 3?" because the
 *     events are independent draws-without-replacement and combinatorics
 *     give a clean answer.
 *
 *  2. **Monte Carlo simulator.** For everything the exact formula can't
 *     model cleanly: mulligan policy, in-game searches and draws that
 *     change the deck composition between turns, multi-group conditional
 *     probabilities (e.g. "have a finisher AND a setup card"). Default
 *     trial count is 10,000; shrinks gracefully for live UI use.
 *
 * Both calculators are pure functions, deterministic up to the RNG seed,
 * and run entirely in the browser/edge — no LLM call ever.
 *
 * **Game model assumptions.** OPTCG specifics encoded here:
 *  - Starting hand size: 5.
 *  - First-turn player is on the "draw" side; we don't model the
 *    first-turn-don't-attack rule because it doesn't affect card draws.
 *  - Draw step: 1 card per turn from turn 2 onward.
 *  - Mulligan: full re-draw of starting hand (no partial). The simulator
 *    accepts a per-key-group threshold function so callers can model
 *    "mulligan if I don't have any cost ≤2 cards" type policies.
 */

export interface CardGroup {
  /** Internal id (used as the key in the snapshot JSON). */
  id: string;
  /** UI label, e.g. "キーカード", "リソース", "フィニッシャー". */
  label: string;
  /** Card ids that belong to this group. */
  cardIds: string[];
}

export interface DeckEntry {
  cardId: string;
  count: number;
}

export interface TurnProbabilityRow {
  turn: number;
  /** Total cards drawn by *end of* this turn (post-draw step). */
  drawn: number;
  /** Map of groupId → P(at least one card from group is in hand or play). */
  probabilities: Record<string, number>;
}

export interface MonteCarloOptions {
  /** Number of simulated games. Default 10_000. */
  trials?: number;
  /**
   * Seed for the deterministic RNG. Same seed → same result. Default 42.
   * Tests fix this; the UI can vary it for animation if desired.
   */
  seed?: number;
  /** Maximum turn to simulate (inclusive). Default 7. */
  maxTurn?: number;
  /**
   * Mulligan policy: given the opening hand, return true to redraw.
   * Default: never mulligan (always keep).
   */
  shouldMulligan?: (opening: string[]) => boolean;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Hypergeometric                                                            */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * P(X = k) for X ~ Hypergeometric(N, K, n).
 *
 *  - N: deck size (50 in OPTCG)
 *  - K: number of successes in the deck
 *  - n: number of cards drawn
 *  - k: number of successes drawn
 *
 * Returns 0 outside the support (negative k, k > min(K, n), etc.).
 */
export function hypergeometricPmf(
  N: number,
  K: number,
  n: number,
  k: number,
): number {
  if (N <= 0 || K < 0 || n < 0 || k < 0) return 0;
  if (k > K || k > n) return 0;
  if (n - k > N - K) return 0;
  return (
    (binomial(K, k) * binomial(N - K, n - k)) / binomial(N, n)
  );
}

/** P(X ≥ k). */
export function hypergeometricAtLeast(
  N: number,
  K: number,
  n: number,
  k: number,
): number {
  if (k <= 0) return 1;
  let acc = 0;
  const upper = Math.min(K, n);
  for (let i = k; i <= upper; i++) {
    acc += hypergeometricPmf(N, K, n, i);
  }
  return clamp01(acc);
}

/**
 * P(at least 1 success on each of multiple disjoint groups), exact.
 *
 * For groups that overlap (the same card in two groups), the result
 * is approximate; the Monte Carlo path handles overlap exactly.
 */
export function exactProbabilityOfAll(
  deckSize: number,
  groupSizes: number[],
  drawCount: number,
): number {
  // Inclusion-exclusion across "miss group i".
  const k = groupSizes.length;
  if (k === 0) return 1;
  let total = 0;
  for (let mask = 0; mask < 1 << k; mask++) {
    let signedMissing = 0;
    let parity = 0;
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i)) {
        signedMissing += groupSizes[i];
        parity++;
      }
    }
    const missAll = hypergeometricAtLeast(
      deckSize,
      signedMissing,
      drawCount,
      0,
    );
    // Probability of drawing zero from `signedMissing` successes across `drawCount`:
    const pMissAll = hypergeometricPmf(deckSize, signedMissing, drawCount, 0);
    void missAll;
    total += (parity % 2 === 0 ? 1 : -1) * pMissAll;
  }
  return clamp01(total);
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Monte Carlo                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

const STARTING_HAND = 5;

export function monteCarloTurnProbabilities(
  deck: DeckEntry[],
  groups: CardGroup[],
  opts: MonteCarloOptions = {},
): TurnProbabilityRow[] {
  const trials = opts.trials ?? 10_000;
  const maxTurn = opts.maxTurn ?? 7;
  const rng = mulberry32(opts.seed ?? 42);
  const shouldMulligan = opts.shouldMulligan ?? (() => false);

  // Materialize the deck as a flat id array — once.
  const cardIds: string[] = [];
  for (const e of deck) {
    for (let i = 0; i < e.count; i++) cardIds.push(e.cardId);
  }
  const N = cardIds.length;

  // For each turn, count how many simulations had >=1 card from each group.
  const hits: Record<number, Record<string, number>> = {};
  for (let t = 1; t <= maxTurn; t++) {
    hits[t] = Object.fromEntries(groups.map((g) => [g.id, 0]));
  }

  const groupSets = groups.map((g) => new Set(g.cardIds));

  for (let trial = 0; trial < trials; trial++) {
    // Shuffle a fresh copy via Fisher–Yates with the seeded RNG.
    const deckCopy = cardIds.slice();
    for (let i = N - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = deckCopy[i];
      deckCopy[i] = deckCopy[j];
      deckCopy[j] = tmp;
    }

    // Draw opening hand.
    let cursor = 0;
    let hand = deckCopy.slice(cursor, cursor + STARTING_HAND);
    cursor += STARTING_HAND;

    // Mulligan once (OPTCG: full re-draw, opening hand cards go to bottom).
    if (shouldMulligan(hand)) {
      // Put the hand at the bottom and re-draw 5.
      deckCopy.push(...hand);
      hand = deckCopy.slice(cursor, cursor + STARTING_HAND);
      cursor += STARTING_HAND;
    }

    // Walk turns, drawing 1 card per turn from turn 2 onward.
    for (let t = 1; t <= maxTurn; t++) {
      if (t >= 2 && cursor < N) {
        hand.push(deckCopy[cursor]);
        cursor++;
      }
      // Tally group hits — once a group is seen this trial, every later turn
      // counts it too (cards stay accessible once drawn).
      for (let gi = 0; gi < groups.length; gi++) {
        if (hand.some((id) => groupSets[gi].has(id))) {
          hits[t][groups[gi].id] += 1;
        }
      }
    }
  }

  const rows: TurnProbabilityRow[] = [];
  for (let t = 1; t <= maxTurn; t++) {
    const drawn = STARTING_HAND + Math.max(0, t - 1);
    const probabilities: Record<string, number> = {};
    for (const g of groups) {
      probabilities[g.id] = hits[t][g.id] / trials;
    }
    rows.push({ turn: t, drawn, probabilities });
  }
  return rows;
}

/**
 * Convenience wrapper: per-turn, per-group **exact** probabilities (no
 * mulligan, no overlap). Useful for the live UI where a 10k Monte Carlo
 * is too slow on every keystroke.
 */
export function exactTurnProbabilities(
  deckSize: number,
  groups: Array<{ id: string; size: number }>,
  maxTurn = 7,
): TurnProbabilityRow[] {
  const rows: TurnProbabilityRow[] = [];
  for (let t = 1; t <= maxTurn; t++) {
    const drawn = STARTING_HAND + Math.max(0, t - 1);
    const probabilities: Record<string, number> = {};
    for (const g of groups) {
      probabilities[g.id] = hypergeometricAtLeast(deckSize, g.size, drawn, 1);
    }
    rows.push({ turn: t, drawn, probabilities });
  }
  return rows;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* helpers                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

const FACT_CACHE = new Map<number, number>();

function factorial(n: number): number {
  if (n < 2) return 1;
  if (FACT_CACHE.has(n)) return FACT_CACHE.get(n)!;
  let acc = 1;
  for (let i = 2; i <= n; i++) acc *= i;
  FACT_CACHE.set(n, acc);
  return acc;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  if (n <= 170) {
    return factorial(n) / (factorial(k) * factorial(n - k));
  }
  // Iterative form for safety beyond Number.MAX_SAFE_INTEGER on factorial(170).
  // OPTCG decks are 50, so this branch is unreachable in practice — kept for
  // hygienic library usage outside the deck-size domain.
  let result = 1;
  const kk = Math.min(k, n - k);
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Tiny seeded PRNG; sufficient for Monte Carlo card draws. */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
