import test, { before } from "node:test";
import assert from "node:assert/strict";

import type { CardCoachFactInput } from "@/ai/card-coach";
import type { SavedDeckCard, SavedDeckDetail } from "@/lib/saved-decks";

let deckCoach: typeof import("@/lib/deck-coach");

before(async () => {
  process.env.GRAND_LINE_DATABASE_MODE = "local";
  process.env.LOCAL_DB_PATH = ":memory:";
  deckCoach = await import("@/lib/deck-coach");
});

function fact(
  id: string,
  cardType: "LEADER" | "CHARACTER" = "CHARACTER",
): CardCoachFactInput {
  return {
    id,
    setCode: "OP01",
    cardType,
    name: id,
    colors: ["red"],
    attributes: ["打撃"],
    features: ["テスト"],
    mechanics: cardType === "LEADER" ? [] : ["OnPlay"],
    cost: cardType === "LEADER" ? null : 1,
    power: cardType === "LEADER" ? 5000 : 2000,
    counter: cardType === "LEADER" ? null : 1000,
    life: cardType === "LEADER" ? 5 : null,
    rarity: cardType === "LEADER" ? "L" : "C",
    hasTrigger: false,
    imageUrlJp: null,
    effectText: "公式確認済みの効果。",
    triggerText: null,
    source: "official_jp",
    verified: true,
  };
}

function savedCard(input: CardCoachFactInput): SavedDeckCard {
  return {
    id: input.id,
    setCode: input.setCode,
    cardType: input.cardType,
    name: input.name,
    colors: input.colors,
    features: input.features,
    attributes: input.attributes,
    cost: input.cost,
    power: input.power,
    counter: input.counter,
    life: input.life,
    rarity: input.rarity,
    hasTrigger: input.hasTrigger,
    imageUrlJp: input.imageUrlJp,
    mechanics: input.mechanics,
    source: input.source,
    verified: input.verified,
  };
}

function fixture() {
  const leader = fact("OP01-001", "LEADER");
  const cards = Array.from({ length: 13 }, (_, index) =>
    fact(`OP01-${String(index + 2).padStart(3, "0")}`),
  );
  const entries = cards.map((card, index) => ({
    card: savedCard(card),
    count: index === cards.length - 1 ? 2 : 4,
  }));
  const deck: SavedDeckDetail = {
    id: "deck-1",
    name: "Legal deck",
    format: "standard",
    notes: null,
    leader: savedCard(leader),
    entries,
    totalCards: 50,
    evaluationScores: {},
    ruleReport: { legal: true, totalCount: 50, violations: [] },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const facts = new Map(
    [leader, ...cards].map((card) => [card.id, card] as const),
  );
  return { deck, facts, ids: [...facts.keys()] };
}

test("Deck Coach rejects an illegal saved deck before metrics or AI", () => {
  const source = fixture();
  source.deck.ruleReport = {
    legal: false,
    totalCount: 49,
    violations: [
      { code: "deck_count", severity: "error", message: "49 cards" },
    ],
  };
  assert.throws(
    () =>
      deckCoach.assembleDeckCoachGeneration({
        deck: source.deck,
        regulations: {},
        knownCardIds: source.ids,
        verifiedFacts: source.facts,
      }),
    deckCoach.DeckCoachIllegalDeckError,
  );
});

test("Deck Coach revalidates active restrictions and rejects a newly banned card", () => {
  const source = fixture();
  const bannedId = source.deck.entries[0].card.id;
  assert.throws(
    () =>
      deckCoach.assembleDeckCoachGeneration({
        deck: source.deck,
        regulations: { perCardMax: new Map([[bannedId, 0]]) },
        knownCardIds: source.ids,
        verifiedFacts: source.facts,
      }),
    (error: unknown) =>
      error instanceof deckCoach.DeckCoachIllegalDeckError &&
      error.violations.some((violation) => violation.code === "banned_card"),
  );
});

test("Deck Coach rejects an unknown card id in a saved deck snapshot", () => {
  const source = fixture();
  const missingId = source.deck.entries[0].card.id;
  assert.throws(
    () =>
      deckCoach.assembleDeckCoachGeneration({
        deck: source.deck,
        regulations: {},
        knownCardIds: source.ids.filter((id) => id !== missingId),
        verifiedFacts: source.facts,
      }),
    deckCoach.DeckCoachUnknownCardError,
  );
});

test("Deck Coach rejects saved cards without verified official facts", () => {
  const source = fixture();
  const unverifiedId = source.deck.entries[0].card.id;
  source.facts.delete(unverifiedId);
  assert.throws(
    () =>
      deckCoach.assembleDeckCoachGeneration({
        deck: source.deck,
        regulations: {},
        knownCardIds: source.ids,
        verifiedFacts: source.facts,
      }),
    deckCoach.DeckCoachUnverifiedFactsError,
  );
});

test("Deck Coach hashes the legal deck and deterministic sources", () => {
  const source = fixture();
  const prepared = deckCoach.assembleDeckCoachGeneration({
    deck: source.deck,
    regulations: {},
    knownCardIds: source.ids,
    verifiedFacts: source.facts,
  });
  assert.equal(prepared.input.deck.cards.length, 13);
  assert.equal(prepared.input.systemMetrics.trigger.ratio, 0);
  assert.match(prepared.deckHash, /^[a-f0-9]{64}$/);
  assert.match(prepared.sourceDataHash, /^[a-f0-9]{64}$/);
});
