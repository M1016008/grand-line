import test from "node:test";
import assert from "node:assert/strict";

import { deckPrintPreflightFailure } from "./deck-print-preflight";
import type { DeckRuleReport } from "./deck-rules";

test("deck print preflight allows legal decks", () => {
  const report: DeckRuleReport = {
    legal: true,
    totalCount: 50,
    violations: [],
  };

  assert.equal(deckPrintPreflightFailure(report), null);
});

test("deck print preflight rejects illegal decks before PDF generation", () => {
  const report: DeckRuleReport = {
    legal: false,
    totalCount: 50,
    violations: [
      {
        code: "banned_card",
        severity: "error",
        message: "Banned card",
        cardIds: ["OP01-001"],
      },
    ],
  };

  const failure = deckPrintPreflightFailure(report);

  assert.equal(failure?.status, 422);
  assert.equal(failure?.body.error, "illegal_deck");
  assert.deepEqual(failure?.body.violations, report.violations);
});
