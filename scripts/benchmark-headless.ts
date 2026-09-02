import type { CardListItem } from "../src/lib/cards";
import type { PracticeDeck } from "../src/lib/practice-sim";
import { runHeadlessBatch } from "../src/lib/battle-engine/headless-runner";

for (const games of [100, 500, 2_000]) {
  const playerDeck = makeDeck("player");
  const opponentDeck = makeDeck("opponent");
  const cards = [
    playerDeck.leader,
    opponentDeck.leader,
    ...playerDeck.entries.map((entry) => entry.card),
    ...opponentDeck.entries.map((entry) => entry.card),
  ];
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = runHeadlessBatch({
    playerDeck,
    opponentDeck,
    cards,
    games,
    seed: 9_301,
    alternateFirstPlayer: true,
    maxTurns: 12,
  });
  const elapsedMs = performance.now() - started;
  const heapDeltaMb = (process.memoryUsage().heapUsed - before) / 1_048_576;
  console.log(
    JSON.stringify({
      games,
      elapsedMs: Math.round(elapsedMs * 10) / 10,
      gamesPerSecond: Math.round((games / elapsedMs) * 100_000) / 100,
      heapDeltaMb: Math.round(heapDeltaMb * 100) / 100,
      outcomes: result.outcomes,
    }),
  );
}

function makeDeck(side: "player" | "opponent"): PracticeDeck {
  const leader = makeCard(`${side}-leader`, `${side} leader`, {
    cardType: "LEADER",
    cost: null,
    power: 5_000,
    life: 5,
  });
  const cards = Array.from({ length: 13 }, (_, index) =>
    makeCard(`${side}-${index}`, `${side} card ${index}`, {
      cost: (index % 6) + 1,
      power: ((index % 6) + 2) * 1_000,
      counter: index % 2 === 0 ? 1_000 : 2_000,
    }),
  );
  return {
    id: side,
    name: side,
    leader,
    entries: cards.map((card, index) => ({ card, count: index < 11 ? 4 : 3 })),
    source: "generated",
    totalCards: 50,
  };
}

function makeCard(
  id: string,
  name: string,
  overrides: Partial<CardListItem>,
): CardListItem {
  return {
    id,
    name,
    cardType: "CHARACTER",
    setCode: "BENCH",
    colors: ["red"],
    attributes: [],
    features: [],
    mechanics: [],
    cost: 1,
    power: 2_000,
    counter: 1_000,
    life: null,
    rarity: null,
    hasTrigger: false,
    imageUrlJp: null,
    effectText: null,
    triggerText: null,
    source: "official_jp",
    verified: true,
    ...overrides,
  };
}
