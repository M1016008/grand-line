import test from "node:test";
import assert from "node:assert/strict";

import {
  cardCoachCompatibleReasoningForPrompt,
  hashSourceData,
  isCardCoachSourceDataStale,
} from "@/lib/card-coach-source-data";

test("Card Coach source hash is stable across object key order", () => {
  const first = hashSourceData({
    promptVersion: "card-coach-v1.0.0",
    card: { id: "OP01-001", colors: ["red"] },
    compatibleCards: [{ card: { id: "OP01-016" }, rank: 1 }],
  });
  const second = hashSourceData({
    compatibleCards: [{ rank: 1, card: { id: "OP01-016" } }],
    card: { colors: ["red"], id: "OP01-001" },
    promptVersion: "card-coach-v1.0.0",
  });

  assert.equal(first, second);
});

test("Card Coach source data is stale only when a current hash differs", () => {
  assert.equal(isCardCoachSourceDataStale("hash-1", "hash-1"), false);
  assert.equal(isCardCoachSourceDataStale("hash-1", "hash-2"), true);
  assert.equal(isCardCoachSourceDataStale("hash-1", null), false);
});

test("Card Coach prompt reasoning keeps rules text and drops AI text", () => {
  assert.equal(
    cardCoachCompatibleReasoningForPrompt("rules", "RULE_REASONING"),
    "RULE_REASONING",
  );
  assert.equal(
    cardCoachCompatibleReasoningForPrompt("ai", "AI_REASONING"),
    "",
  );
});
