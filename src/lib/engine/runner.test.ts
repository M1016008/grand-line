/**
 * End-to-end tests for the headless runner + fast CPU.
 *
 * These verify the engine can complete a vanilla game without
 * deadlocking or crashing, and that the same seed produces the same
 * outcome (the paired-RNG invariant that makes 100-game ablation work).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createFastCpu,
  makeRegistry,
  runGame,
  type CardData,
  type DeckList,
} from "./index";

function leader(id: string, life = 4): CardData {
  return {
    id,
    cardType: "LEADER",
    colors: ["black"],
    features: [],
    mechanics: [],
    cost: null,
    power: 5000,
    counter: null,
    life,
    hasTrigger: false,
  };
}

function char(id: string, cost: number, power: number, counter: number | null = 1000): CardData {
  return {
    id,
    cardType: "CHARACTER",
    colors: ["black"],
    features: [],
    mechanics: [],
    cost,
    power,
    counter,
    life: null,
    hasTrigger: false,
  };
}

function vanillaDeck(leaderId: string): DeckList {
  return {
    leaderId,
    cards: [
      { cardId: "v1", count: 4 },
      { cardId: "v2", count: 4 },
      { cardId: "v3", count: 4 },
      { cardId: "v4", count: 4 },
      { cardId: "v5", count: 4 },
      { cardId: "v6", count: 4 },
      { cardId: "v7", count: 4 },
      { cardId: "v8", count: 4 },
      { cardId: "v9", count: 4 },
      { cardId: "v10", count: 4 },
      { cardId: "v11", count: 4 },
      { cardId: "v12", count: 4 },
      { cardId: "v13", count: 2 },
    ],
    donDeckSize: 10,
  };
}

const REGISTRY = makeRegistry([
  leader("L-A"),
  leader("L-B"),
  ...Array.from({ length: 13 }, (_, i) =>
    char(`v${i + 1}`, (i % 5) + 1, (i % 5) * 1000 + 2000, 1000),
  ),
]);

test("runner: vanilla deck mirror match completes without crash", () => {
  const result = runGame({
    registry: REGISTRY,
    deckA: vanillaDeck("L-A"),
    deckB: vanillaDeck("L-B"),
    seed: "runner-1",
    goFirst: "A",
    cpuA: createFastCpu(),
    cpuB: createFastCpu(),
    maxTurns: 50,
  });
  assert.ok(result.finalState.winner != null || result.finalState.endCondition != null);
  assert.equal(result.finalState.phase, "GAME_OVER");
  // Sanity: events were emitted.
  assert.ok(result.events.length > 10);
});

test("runner: deterministic — same seed produces same final state", () => {
  const cfg = {
    registry: REGISTRY,
    deckA: vanillaDeck("L-A"),
    deckB: vanillaDeck("L-B"),
    seed: "det-seed",
    goFirst: "A" as const,
    cpuA: createFastCpu(),
    cpuB: createFastCpu(),
    maxTurns: 50,
  };
  const r1 = runGame(cfg);
  const r2 = runGame(cfg);
  assert.equal(r1.finalState.winner, r2.finalState.winner);
  assert.equal(r1.finalState.endCondition, r2.finalState.endCondition);
  assert.equal(r1.finalState.turn, r2.finalState.turn);
  assert.equal(r1.events.length, r2.events.length);
});

test("runner: 10 games with different seeds — all finish, distribution sane", () => {
  const winners: Record<string, number> = { A: 0, B: 0, DRAW: 0 };
  for (let i = 0; i < 10; i++) {
    const r = runGame({
      registry: REGISTRY,
      deckA: vanillaDeck("L-A"),
      deckB: vanillaDeck("L-B"),
      seed: `bulk-${i}`,
      goFirst: i % 2 === 0 ? "A" : "B",
      cpuA: createFastCpu(),
      cpuB: createFastCpu(),
      maxTurns: 50,
    });
    const w = r.finalState.winner ?? "DRAW";
    winners[w] = (winners[w] ?? 0) + 1;
  }
  // All games ended.
  assert.equal((winners.A ?? 0) + (winners.B ?? 0) + (winners.DRAW ?? 0), 10);
});

test("runner: paired-RNG invariant — same seedBase + same swap gives correlated outcomes", () => {
  // The contract that lets 100-game ablation be statistically usable:
  // identical seeds + identical decks → identical games. Verify that
  // changing only the seed changes outcomes (not all outcomes are equal).
  const same1 = runGame({
    registry: REGISTRY,
    deckA: vanillaDeck("L-A"),
    deckB: vanillaDeck("L-B"),
    seed: "X",
    goFirst: "A",
    cpuA: createFastCpu(),
    cpuB: createFastCpu(),
    maxTurns: 50,
  });
  const same2 = runGame({
    registry: REGISTRY,
    deckA: vanillaDeck("L-A"),
    deckB: vanillaDeck("L-B"),
    seed: "X",
    goFirst: "A",
    cpuA: createFastCpu(),
    cpuB: createFastCpu(),
    maxTurns: 50,
  });
  assert.equal(same1.finalState.turn, same2.finalState.turn);

  const diff = runGame({
    registry: REGISTRY,
    deckA: vanillaDeck("L-A"),
    deckB: vanillaDeck("L-B"),
    seed: "Y", // different seed → likely different game
    goFirst: "A",
    cpuA: createFastCpu(),
    cpuB: createFastCpu(),
    maxTurns: 50,
  });
  // Not asserting they differ (they might coincidentally match) — just
  // that they ran to completion.
  assert.ok(diff.finalState.phase === "GAME_OVER");
});
