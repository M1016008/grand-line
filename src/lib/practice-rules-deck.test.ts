import assert from "node:assert/strict";
import test from "node:test";

import type { CardListItem } from "./cards";
import { BenchmarkDeckValidationError } from "./deck-battle-benchmark";
import {
  resolveRulesPracticeOpponentDeck,
  resolveRulesPracticePlayerDeck,
} from "./practice-rules-deck";

const leader = card("L-001", "LEADER");
const legalPool = [leader, ...Array.from({ length: 13 }, (_, i) => card(`C-${i + 1}`))];
const legalCards = legalPool.slice(1).map((item, index) => ({
  cardId: item.id,
  count: index === 12 ? 2 : 4,
}));

test("Rules draft resolves a verified, legal exact 50-card deck", () => {
  const deck = resolveRulesPracticePlayerDeck({
    request: { leaderId: leader.id, mode: "draft", cards: legalCards },
    pool: legalPool,
    regulations: {},
  });
  assert.equal(deck.totalCards, 50);
  assert.equal(deck.source, "draft");
});

test("Rules draft fails closed for 49/51, unknown, unverified, off-color, restrictions and pairs", () => {
  const cases: Array<{ cards: typeof legalCards; pool?: CardListItem[]; regulations?: Parameters<typeof resolveRulesPracticePlayerDeck>[0]["regulations"] }> = [
    { cards: legalCards.map((e, i) => i === 12 ? { ...e, count: 1 } : e) },
    { cards: legalCards.map((e, i) => i === 12 ? { ...e, count: 3 } : e) },
    { cards: [{ cardId: "UNKNOWN", count: 2 }, ...legalCards.slice(0, 12)] },
    { cards: legalCards, pool: legalPool.map((c) => c.id === "C-1" ? { ...c, verified: false } : c) },
    { cards: legalCards, pool: legalPool.map((c) => c.id === "C-1" ? { ...c, colors: ["Blue"] } : c) },
    { cards: legalCards, regulations: { perCardMax: new Map([["C-1", 0]]) } },
    { cards: legalCards, regulations: { pairBans: [{ cardIdA: "C-1", cardIdB: "C-2" }] } },
  ];
  for (const value of cases) {
    assert.throws(() => resolveRulesPracticePlayerDeck({
      request: { leaderId: leader.id, mode: "draft", cards: value.cards },
      pool: value.pool ?? legalPool,
      regulations: value.regulations ?? {},
    }));
  }
});

test("generated player/opponent use strict verified legal construction and fail when impossible", () => {
  for (const deck of [
    resolveRulesPracticePlayerDeck({ request: { leaderId: leader.id, mode: "generated" }, pool: legalPool, regulations: {} }),
    resolveRulesPracticeOpponentDeck({ leaderId: leader.id, pool: legalPool, regulations: {} }),
  ]) {
    assert.equal(deck.totalCards, 50);
    assert.ok(deck.entries.every((entry) => entry.card.colors.includes("Red")));
    assert.ok(deck.entries.every((entry) => entry.count <= 4));
  }
  assert.throws(
    () => resolveRulesPracticeOpponentDeck({ leaderId: leader.id, pool: legalPool.slice(0, 3), regulations: {} }),
    BenchmarkDeckValidationError,
  );
});

function card(id: string, cardType = "CHARACTER"): CardListItem {
  return {
    id, setCode: "TEST", cardType, name: id, colors: ["Red"], features: [], attributes: [],
    cost: cardType === "LEADER" ? null : 1, power: 5000, counter: 1000,
    life: cardType === "LEADER" ? 5 : null, rarity: null, hasTrigger: false,
    imageUrlJp: null, mechanics: [], effectText: null, triggerText: null,
    source: "official_jp", verified: true,
  };
}
