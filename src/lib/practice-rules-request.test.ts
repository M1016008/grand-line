import assert from "node:assert/strict";
import test from "node:test";

import { rulesPracticeDeckRequestSchema } from "./practice-rules-request";

test("Rules Practice request accepts identifiers/counts and rejects client card facts", () => {
  assert.equal(rulesPracticeDeckRequestSchema.safeParse({
    leaderId: "L", mode: "draft", cards: [{ cardId: "C", count: 4 }],
  }).success, true);
  for (const fact of ["name", "colors", "cost", "power", "counter", "life", "mechanics", "effectText", "triggerText", "source", "verified"]) {
    assert.equal(rulesPracticeDeckRequestSchema.safeParse({
      leaderId: "L", mode: "draft", cards: [{ cardId: "C", count: 4, [fact]: "forged" }],
    }).success, false, fact);
  }
});
