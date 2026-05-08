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

/* ──────────────────────────────────────────────────────────────────────── */
/* Bandai regulations: bans + restrictions + pair bans                      */
/* ──────────────────────────────────────────────────────────────────────── */

test("banned card in deck → banned_card error", () => {
  const cards = reds(13, 4);
  cards[12].count = 2;
  // Mark the card with the lowest id as banned (max_copies = 0).
  const banned = cards[0].id;
  const r = validateDeck(RED_LEADER, cards, {
    perCardMax: new Map([[banned, 0]]),
  });
  assert.equal(r.legal, false);
  const v = r.violations.find((v) => v.code === "banned_card");
  assert.ok(v && v.cardIds?.includes(banned));
});

test("restricted card over its max_copies → over_restricted error", () => {
  const cards = reds(13, 4);
  cards[12].count = 2;
  const restricted = cards[0].id;
  // restricted to 1 but deck has 4
  const r = validateDeck(RED_LEADER, cards, {
    perCardMax: new Map([[restricted, 1]]),
  });
  assert.ok(r.violations.find((v) => v.code === "over_restricted"));
});

test("restricted card at exactly max_copies → legal", () => {
  // 14 distinct reds: 12 at 4-of, 1 at 1-of (restricted), 1 at 1-of filler.
  // 12*4 + 1 + 1 = 50.
  const cards = reds(14, 4);
  cards[0].count = 1;
  cards[13].count = 1;
  const r = validateDeck(RED_LEADER, cards, {
    perCardMax: new Map([[cards[0].id, 1]]),
  });
  assert.equal(r.totalCount, 50);
  assert.equal(r.legal, true, JSON.stringify(r.violations));
});

test("banned pair triggers when both cards present", () => {
  const cards = reds(13, 4);
  cards[12].count = 2;
  // Take any two ids from the deck and call them a banned pair.
  const a = cards[0].id < cards[1].id ? cards[0].id : cards[1].id;
  const b = cards[0].id < cards[1].id ? cards[1].id : cards[0].id;
  const r = validateDeck(RED_LEADER, cards, {
    pairBans: [{ cardIdA: a, cardIdB: b }],
  });
  assert.ok(r.violations.find((v) => v.code === "banned_pair"));
});

test("banned pair only one half present → no violation", () => {
  const cards = reds(13, 4);
  cards[12].count = 2;
  const present = cards[0].id;
  const r = validateDeck(RED_LEADER, cards, {
    pairBans: [{ cardIdA: present, cardIdB: "OTHER-999" }],
  });
  assert.ok(!r.violations.find((v) => v.code === "banned_pair"));
});

test("banned pair fires for leader + character combos", () => {
  const cards = reds(13, 4);
  cards[12].count = 2;
  // Pair: leader id + first card id. The leader counts as "in deck" for
  // pair-ban purposes even though it isn't in the 50.
  const leaderId = RED_LEADER.id;
  const otherId = cards[0].id;
  const a = leaderId < otherId ? leaderId : otherId;
  const b = leaderId < otherId ? otherId : leaderId;
  const r = validateDeck(RED_LEADER, cards, {
    pairBans: [{ cardIdA: a, cardIdB: b }],
  });
  assert.ok(r.violations.find((v) => v.code === "banned_pair"));
});
