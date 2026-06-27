import test from "node:test";
import assert from "node:assert/strict";

import type { CardListItem } from "./cards";
import type { PracticeDeck } from "./practice-sim";
import { trainPracticeDeck } from "./practice-training";

function card(overrides: Partial<CardListItem>): CardListItem {
  return {
    id: "C0",
    setCode: "TST",
    cardType: "CHARACTER",
    name: "Test Card",
    colors: ["red"],
    features: ["crew"],
    attributes: [],
    cost: 3,
    power: 4000,
    counter: 1000,
    life: null,
    rarity: null,
    hasTrigger: false,
    imageUrlJp: null,
    mechanics: [],
    source: "manual",
    verified: true,
    ...overrides,
  };
}

const leader = card({
  id: "L1",
  cardType: "LEADER",
  name: "Red Leader",
  cost: null,
  power: 5000,
  counter: null,
  life: 5,
});

const mainCards = Array.from({ length: 13 }, (_, index) =>
  card({
    id: `C${index + 1}`,
    name: `Main ${index + 1}`,
    cost: (index % 6) + 1,
    power: 2000 + index * 500,
    counter: index % 3 === 0 ? 2000 : 1000,
  }),
);

const entries = mainCards.map((entry, index) => ({
  card: entry,
  count: index === 12 ? 2 : 4,
}));

const upgradePool = Array.from({ length: 8 }, (_, index) =>
  card({
    id: `U${index + 1}`,
    name: `Upgrade ${index + 1}`,
    cost: 3,
    power: 6000 + index * 500,
    counter: 1000,
    mechanics: index % 2 === 0 ? ["Rush"] : ["Draw"],
  }),
);

const offColorUpgrade = card({
  id: "G1",
  name: "Green Upgrade",
  colors: ["green"],
  power: 12000,
});

function deck(id: string): PracticeDeck {
  return {
    id,
    name: id,
    leader,
    entries,
    source: "generated",
    totalCards: 50,
  };
}

test("trainPracticeDeck evaluates swaps for the focused card only", () => {
  const result = trainPracticeDeck({
    targetDeck: deck("target"),
    opponentDeck: deck("opponent"),
    pool: [leader, ...mainCards, ...upgradePool, offColorUpgrade],
    games: 4,
    candidateGames: 2,
    seed: 7,
    cpuSkill: "level1",
    focusCardIds: ["C13"],
    candidateLimit: 3,
  });

  assert.deepEqual(result.focusCardIds, ["C13"]);
  assert.equal(Object.hasOwn(result.baseline, "replays"), false);
  assert.equal(result.candidates.length, 3);
  assert.ok(result.candidates.every((candidate) => candidate.removeCardId === "C13"));
  assert.ok(result.candidates.every((candidate) => candidate.addCardId !== "G1"));
  assert.ok(result.candidates.every((candidate) => candidate.games === 2));
});

test("trainPracticeDeck respects the requested candidate limit", () => {
  const result = trainPracticeDeck({
    targetDeck: deck("target"),
    opponentDeck: deck("opponent"),
    pool: [leader, ...mainCards, ...upgradePool],
    games: 2,
    candidateGames: 1,
    seed: 11,
    cpuSkill: "level5",
    focusCardIds: ["C13"],
    candidateLimit: 2,
  });

  assert.equal(result.candidates.length, 2);
});
