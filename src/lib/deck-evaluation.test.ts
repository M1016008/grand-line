import test from "node:test";
import assert from "node:assert/strict";

import { evaluateDeck, type EvalCard } from "./deck-evaluation";

function card(overrides: Partial<EvalCard>): EvalCard {
  return {
    id: "OP01-XXX",
    cardType: "CHARACTER",
    colors: ["red"],
    features: ["麦わらの一味"],
    cost: 3,
    power: 4000,
    counter: 1000,
    hasTrigger: false,
    mechanics: [],
    count: 4,
    ...overrides,
  };
}

const baselineDeck: EvalCard[] = [
  // 12 unique chars × 4 + 1 × 2 = 50 cards
  card({ id: "C1", cost: 1, power: 2000, counter: 1000 }),
  card({ id: "C2", cost: 2, power: 3000, counter: 1000 }),
  card({ id: "C3", cost: 3, power: 4000, counter: 1000 }),
  card({ id: "C4", cost: 3, power: 4000, counter: 2000 }),
  card({ id: "C5", cost: 4, power: 5000, counter: 1000 }),
  card({ id: "C6", cost: 4, power: 5000, counter: 0 }),
  card({ id: "C7", cost: 5, power: 6000, counter: 0 }),
  card({ id: "C8", cost: 5, power: 6000, counter: 1000 }),
  card({ id: "C9", cost: 6, power: 7000, counter: 0 }),
  card({ id: "C10", cost: 6, power: 7000, counter: 0 }),
  card({ id: "C11", cost: 7, power: 8000, counter: 0 }),
  card({ id: "C12", cost: 8, power: 9000, counter: 0 }),
  card({ id: "C13", cost: 1, power: 1000, counter: 2000, count: 2 }),
];

test("evaluateDeck returns scores in 0..100 for every metric", () => {
  const e = evaluateDeck(baselineDeck);
  for (const key of ["attack", "stability", "expansion", "defense", "meta"] as const) {
    const m = e[key];
    assert.ok(m.score >= 0 && m.score <= 100, `${key} score out of range: ${m.score}`);
    assert.ok(m.breakdown.length > 0, `${key} should expose breakdown`);
    const sum = m.breakdown.reduce((a, b) => a + b.contribution, 0);
    assert.ok(
      Math.abs(sum - m.score) < 0.5,
      `${key}: breakdown sum ${sum} should equal score ${m.score}`,
    );
  }
  assert.ok(e.composite >= 0 && e.composite <= 100);
});

test("attack score increases when finisher count grows", () => {
  const lowAttack = evaluateDeck(baselineDeck).attack.score;
  // Promote the cheap C1/C2 entries into 8-cost finishers — adds 4
  // finisher slots and pushes avg power up.
  const finisherHeavy = baselineDeck.map((c) =>
    c.id === "C1" || c.id === "C2"
      ? { ...c, cost: 8, power: 9000, mechanics: ["Rush"] }
      : c,
  );
  const highAttack = evaluateDeck(finisherHeavy).attack.score;
  assert.ok(highAttack > lowAttack, `${highAttack} should beat ${lowAttack}`);
});

test("stability score rewards search/draw mechanics", () => {
  const noDraw = evaluateDeck(baselineDeck).stability.score;
  const withDraw = baselineDeck.map((c, i) =>
    i < 6 ? { ...c, mechanics: ["Search", "Draw"] } : c,
  );
  const highStab = evaluateDeck(withDraw).stability.score;
  assert.ok(highStab > noDraw, `${highStab} should beat ${noDraw}`);
});

test("defense score reflects [ブロッカー] and counter density", () => {
  const naked = evaluateDeck(
    baselineDeck.map((c) => ({ ...c, counter: 0, hasTrigger: false })),
  ).defense.score;
  const fortified = evaluateDeck(
    baselineDeck.map((c) => ({
      ...c,
      counter: 1000,
      hasTrigger: true,
      mechanics: c.mechanics.concat("Blocker"),
    })),
  ).defense.score;
  assert.ok(fortified > naked, `${fortified} should beat ${naked}`);
});

test("meta score rewards multi-color and removal toolbox", () => {
  const mono = evaluateDeck(baselineDeck).meta.score;
  const richer = baselineDeck.map((c, i) => ({
    ...c,
    colors: i < 4 ? ["red", "green"] : c.colors,
    mechanics: i < 4 ? ["Banish"] : i < 8 ? ["RestOpponentCard"] : c.mechanics,
  }));
  const high = evaluateDeck(richer).meta.score;
  assert.ok(high > mono, `${high} should beat ${mono}`);
});

test("empty deck → all metrics return 0 without crashing", () => {
  const e = evaluateDeck([]);
  assert.equal(e.attack.score, 0);
  assert.equal(e.stability.score, 0);
  assert.equal(e.defense.score, 0);
  assert.equal(e.composite, 0);
});

test("evaluation is deterministic (same input → same output)", () => {
  const a = evaluateDeck(baselineDeck);
  const b = evaluateDeck(baselineDeck);
  assert.deepEqual(a, b);
});
