import assert from "node:assert/strict";
import test from "node:test";

import { summarizeStoredRulesOutcomes } from "./practice-rules-summary";

test("stored Rules summary excludes inconclusive games from win-rate denominators", () => {
  const value = summarizeStoredRulesOutcomes({
    games: 10, playerWins: 4, opponentWins: 2,
    firstPlayerResolvedGames: 3, firstPlayerWins: 2,
    secondPlayerResolvedGames: 3, secondPlayerWins: 2,
    resolvedTurnTotal: 30,
  });
  assert.equal(value.resolvedGames, 6);
  assert.equal(value.inconclusiveGames, 4);
  assert.equal(value.resolvedWinRate, 4 / 6);
  assert.equal(value.firstPlayerWinRate, 2 / 3);
  assert.equal(value.secondPlayerWinRate, 2 / 3);
  assert.equal(value.averageResolvedTurns, 5);
});
