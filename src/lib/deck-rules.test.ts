import test from "node:test";
import assert from "node:assert/strict";

import { validateDeck, type DeckLeader, type DeckRuleCard } from "./deck-rules";

const RED_LEADER: DeckLeader = {
  id: "OP01-001",
  name: "Mock Luffy",
  colors: ["red"],
};

function reds(count: number, perCard = 4): DeckRuleCard[] {
  const cards: DeckRuleCard[] = [];
  for (let i = 0; i < count; i++) {
    cards.push({
      id: `OP01-${String(100 + i).padStart(3, "0")}`,
      cardType: "CHARACTER",
      colors: ["red"],
      count: perCard,
    });
  }
  return cards;
}

test("legal red mono deck (50 cards, 4-of-each, color match)", () => {
  const cards = reds(13, 4); // 13 * 4 = 52 — too many
  cards[12].count = 2;        // bring it down to 50
  const r = validateDeck(RED_LEADER, cards);
  assert.equal(r.totalCount, 50);
  assert.equal(r.legal, true, JSON.stringify(r.violations));
});

test("missing leader → not legal", () => {
  const r = validateDeck(null, reds(13, 4));
  assert.equal(r.legal, false);
  assert.ok(r.violations.find((v) => v.code === "no_leader"));
});

test("less than 50 cards → deck_count error", () => {
  const r = validateDeck(RED_LEADER, reds(10, 4)); // 40 cards
  assert.equal(r.legal, false);
  assert.ok(r.violations.find((v) => v.code === "deck_count"));
});

test("more than 4 of a card → over_four_copies error", () => {
  const cards = reds(12, 4);
  cards.push({ id: "OP01-999", cardType: "CHARACTER", colors: ["red"], count: 5 });
  const r = validateDeck(RED_LEADER, cards);
  assert.ok(r.violations.find((v) => v.code === "over_four_copies"));
});

test("off-color card → off_color error", () => {
  const cards = reds(12, 4);
  cards.push({
    id: "OP02-001",
    cardType: "CHARACTER",
    colors: ["green"],
    count: 2,
  });
  const r = validateDeck(RED_LEADER, cards);
  assert.ok(r.violations.find((v) => v.code === "off_color"));
});

test("dual-color leader accepts both colors", () => {
  const dual: DeckLeader = {
    id: "OP03-099",
    name: "Mock Dual",
    colors: ["red", "green"],
  };
  const cards: DeckRuleCard[] = [
    ...reds(6, 4), // 24 red
    { id: "OP02-G1", cardType: "CHARACTER", colors: ["green"], count: 4 },
    { id: "OP02-G2", cardType: "CHARACTER", colors: ["green"], count: 4 },
    { id: "OP02-G3", cardType: "CHARACTER", colors: ["green"], count: 4 },
    { id: "OP02-G4", cardType: "CHARACTER", colors: ["green", "red"], count: 4 },
    { id: "OP02-G5", cardType: "CHARACTER", colors: ["green"], count: 4 },
    { id: "OP02-G6", cardType: "CHARACTER", colors: ["green"], count: 4 },
    { id: "OP02-G7", cardType: "CHARACTER", colors: ["green"], count: 2 },
  ];
  const r = validateDeck(dual, cards);
  assert.equal(r.totalCount, 50);
  assert.equal(r.legal, true, JSON.stringify(r.violations));
});

test("leader card placed in main deck → leader_in_deck error", () => {
  const cards = reds(12, 4);
  cards.push({
    id: "OP01-XXX",
    cardType: "LEADER",
    colors: ["red"],
    count: 2,
  });
  const r = validateDeck(RED_LEADER, cards);
  assert.ok(r.violations.find((v) => v.code === "leader_in_deck"));
});
