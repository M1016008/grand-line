import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCandidatePool,
  DeckSuggestionError,
  proposeDeck,
} from "./deck-suggestion";
import type { CardListItem } from "@/lib/cards";

/**
 * Live network calls are gated on ANTHROPIC_API_KEY (and would burn money
 * on every test run). These tests cover the deterministic surface:
 * pool compression, the early-exit on a non-leader input, and the
 * graceful error when the key is absent.
 */

function card(o: Partial<CardListItem>): CardListItem {
  return {
    id: "OP01-XXX",
    setCode: "OP01",
    cardType: "CHARACTER",
    name: "Mock",
    colors: ["red"],
    features: ["麦わらの一味"],
    attributes: [],
    mechanics: [],
    cost: 3,
    power: 4000,
    counter: 1000,
    life: null,
    rarity: "C",
    hasTrigger: false,
    imageUrlJp: null,
    source: "manual",
    verified: false,
    ...o,
  };
}

const RED_LEADER = card({
  id: "OP01-001",
  cardType: "LEADER",
  name: "Leader",
  features: ["麦わらの一味", "超新星"],
  power: 5000,
  life: 5,
  rarity: "L",
});

test("buildCandidatePool excludes leader card and off-color cards", () => {
  const pool: CardListItem[] = [
    RED_LEADER,
    card({ id: "OP01-RED", colors: ["red"] }),
    card({ id: "OP01-GREEN", colors: ["green"] }),
    card({ id: "OP01-DUAL", colors: ["red", "green"] }),
    card({ id: "OP01-LEADER2", cardType: "LEADER", colors: ["red"] }),
  ];
  const out = buildCandidatePool(RED_LEADER, pool);
  const ids = out.map((c) => c.id);
  assert.ok(!ids.includes(RED_LEADER.id), "should drop the leader itself");
  assert.ok(!ids.includes("OP01-LEADER2"), "should drop other leader cards");
  assert.ok(!ids.includes("OP01-GREEN"), "off-color drops");
  assert.ok(ids.includes("OP01-RED"));
  assert.ok(ids.includes("OP01-DUAL"));
});

test("buildCandidatePool prioritises feature-matched cards over filler", () => {
  const pool: CardListItem[] = [
    RED_LEADER,
    ...Array.from({ length: 10 }, (_, i) =>
      card({
        id: `RED-MATCH-${i}`,
        features: ["麦わらの一味"], // shares
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      card({
        id: `RED-FILLER-${i}`,
        features: ["他海賊団"], // no overlap
      }),
    ),
  ];
  const out = buildCandidatePool(RED_LEADER, pool);
  // The first 10 (or up to cap) must be the feature-matched bucket.
  for (let i = 0; i < 10; i++) {
    assert.ok(
      out[i].id.startsWith("RED-MATCH"),
      `slot ${i} should be feature-matched, got ${out[i].id}`,
    );
  }
});

test("proposeDeck rejects a non-LEADER input synchronously", async () => {
  await assert.rejects(
    () => proposeDeck({ leader: card({ cardType: "CHARACTER" }), pool: [] }),
    (e) => {
      assert.ok(e instanceof DeckSuggestionError);
      return true;
    },
  );
});

test("proposeDeck rejects an empty pool synchronously", async () => {
  await assert.rejects(
    () => proposeDeck({ leader: RED_LEADER, pool: [] }),
    (e) => {
      assert.ok(e instanceof DeckSuggestionError);
      assert.match((e as Error).message, /pool too small/i);
      return true;
    },
  );
});

test("proposeDeck propagates MissingApiKeyError when the env var is unset", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const fatPool = Array.from({ length: 80 }, (_, i) =>
      card({ id: `RED-${i}`, features: ["麦わらの一味"] }),
    );
    await assert.rejects(
      () => proposeDeck({ leader: RED_LEADER, pool: fatPool }),
      (e) => {
        assert.equal((e as Error).name, "MissingApiKeyError");
        return true;
      },
    );
  } finally {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  }
});
