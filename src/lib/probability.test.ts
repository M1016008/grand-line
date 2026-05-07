import test from "node:test";
import assert from "node:assert/strict";

import {
  exactTurnProbabilities,
  hypergeometricAtLeast,
  hypergeometricPmf,
  monteCarloTurnProbabilities,
  type CardGroup,
  type DeckEntry,
} from "./probability";

/* ──────────────────────────────────────────────────────────────────────── */
/* Hypergeometric — closed form                                              */
/* ──────────────────────────────────────────────────────────────────────── */

test("hypergeometricPmf — sanity case (50, 4, 5, 1)", () => {
  // Probability of drawing exactly 1 of a 4-of in opening hand of 5
  // from 50 cards. Closed form: C(4,1)*C(46,4)/C(50,5) = 4*163185/2118760
  // ≈ 0.3081.
  const p = hypergeometricPmf(50, 4, 5, 1);
  assert.ok(Math.abs(p - 0.3081) < 0.001, `expected ≈0.3081, got ${p}`);
});

test("hypergeometricAtLeast(50,4,5,1) ≈ 0.3530", () => {
  // P(at least 1 copy of a 4-of in opening 5)
  // = 1 - P(0) = 1 - C(46,5)/C(50,5) ≈ 0.3530.
  // (Often misremembered as ≈0.40 — that figure is for n=7, not n=5.)
  const p = hypergeometricAtLeast(50, 4, 5, 1);
  assert.ok(Math.abs(p - 0.3530) < 0.001, `expected ≈0.3530, got ${p}`);
});

test("hypergeometricAtLeast — degenerate cases", () => {
  assert.equal(hypergeometricAtLeast(50, 0, 5, 1), 0);
  assert.equal(hypergeometricAtLeast(50, 4, 0, 1), 0);
  assert.equal(hypergeometricAtLeast(50, 4, 5, 0), 1);
  assert.equal(hypergeometricAtLeast(50, 50, 5, 1), 1);
});

test("PMF sums to 1 over its support", () => {
  let acc = 0;
  for (let k = 0; k <= 4; k++) acc += hypergeometricPmf(50, 4, 5, k);
  assert.ok(Math.abs(acc - 1) < 1e-9, `sum should be 1, got ${acc}`);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Monte Carlo                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

const CARDS_4_KEY: DeckEntry[] = [
  { cardId: "K1", count: 4 }, // 4 key cards
  ...Array.from({ length: 23 }, (_, i) => ({
    cardId: `F${i}`,
    count: 2,
  })), // 46 filler cards (23 * 2 = 46)
];

const KEY_GROUP: CardGroup = {
  id: "key",
  label: "Key",
  cardIds: ["K1"],
};

test("Monte Carlo agrees with closed form within ±2 σ for 10k trials", () => {
  const rows = monteCarloTurnProbabilities(CARDS_4_KEY, [KEY_GROUP], {
    trials: 10_000,
    seed: 42,
  });
  // Turn 1 = 5 cards drawn, exact = 0.3982.
  const turn1 = rows.find((r) => r.turn === 1)!;
  const mc = turn1.probabilities.key;
  const exact = hypergeometricAtLeast(50, 4, 5, 1);
  // 2σ for a 0.4 proportion across 10k trials ≈ 0.0098.
  assert.ok(
    Math.abs(mc - exact) < 0.015,
    `MC ${mc.toFixed(4)} vs exact ${exact.toFixed(4)} should differ by <0.015`,
  );
});

test("Monte Carlo is deterministic under fixed seed", () => {
  const a = monteCarloTurnProbabilities(CARDS_4_KEY, [KEY_GROUP], {
    trials: 500,
    seed: 7,
  });
  const b = monteCarloTurnProbabilities(CARDS_4_KEY, [KEY_GROUP], {
    trials: 500,
    seed: 7,
  });
  assert.deepEqual(a, b);
});

test("monotonicity: P(have key) grows turn-over-turn", () => {
  const rows = monteCarloTurnProbabilities(CARDS_4_KEY, [KEY_GROUP], {
    trials: 2_000,
    seed: 1,
  });
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      rows[i].probabilities.key >= rows[i - 1].probabilities.key - 1e-9,
      `turn ${rows[i].turn} (${rows[i].probabilities.key}) should ≥ turn ${rows[i - 1].turn} (${rows[i - 1].probabilities.key})`,
    );
  }
});

test("mulligan policy reduces dead hands", () => {
  const noMulli = monteCarloTurnProbabilities(CARDS_4_KEY, [KEY_GROUP], {
    trials: 5_000,
    seed: 11,
  });
  const withMulli = monteCarloTurnProbabilities(CARDS_4_KEY, [KEY_GROUP], {
    trials: 5_000,
    seed: 11,
    shouldMulligan: (hand) => !hand.includes("K1"),
  });
  const a = noMulli[0].probabilities.key;
  const b = withMulli[0].probabilities.key;
  assert.ok(b > a, `mulligan should help: with=${b} vs without=${a}`);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Convenience: exactTurnProbabilities (live UI path)                       */
/* ──────────────────────────────────────────────────────────────────────── */

test("exactTurnProbabilities turn 1 matches hypergeometricAtLeast directly", () => {
  const rows = exactTurnProbabilities(50, [{ id: "key", size: 4 }], 1);
  const exact = hypergeometricAtLeast(50, 4, 5, 1);
  assert.ok(Math.abs(rows[0].probabilities.key - exact) < 1e-9);
});

test("exactTurnProbabilities approaches 1 as turns go up for any non-empty group", () => {
  const rows = exactTurnProbabilities(50, [{ id: "key", size: 4 }], 30);
  // By turn 30 we'd have drawn 5 + 29 = 34 cards from 50.
  // P(none of 4 in 34 draws) = C(46,34)/C(50,34) = 16!*46!/(12!*50!)
  //   = 16*15*14*13 / (50*49*48*47) ≈ 0.00790
  // → P(≥1) ≈ 0.992. The asymptote is monotone but doesn't hit 0.999
  // until ~turn 35 with these parameters.
  const last = rows[rows.length - 1].probabilities.key;
  assert.ok(last > 0.99, `expected >0.99, got ${last.toFixed(4)}`);
});
