import assert from "node:assert/strict";
import test from "node:test";

import { buildRulesPracticeStorageRows } from "./practice-rules-storage";

test("Rules storage preserves inconclusive reason, full snapshots, decks and trace state", () => {
  const side = { deck: 40, hand: 5, life: 4, characters: 1, stage: 1, trash: 0, resolving: 0, donTotal: 2, donRested: 1 };
  const state = { turn: 2, activePlayer: "player" as const, player: side, opponent: side };
  const coverage = { totalCards: 50, supportedCards: 50, partialCards: 0, unsupportedCards: 0, supportedRatio: 1, complete: true, leaderStatus: "supported" as const, leaderReasons: [], entries: [] };
  const stats = { cardsPlayed: 0, attacksDeclared: 0, leaderAttacks: 0, characterAttacks: 0, damageDealt: 0, blockersUsed: 0, counterCardsUsed: 0, counterPowerUsed: 0, triggersRevealed: 0, triggersActivated: 0, triggersDeclined: 0, searchesResolved: 0, donAttached: 0, donSpent: 0, deckOut: 0, supportedEffectsResolved: 0, partialEffectsEncountered: 0, unsupportedEffectsEncountered: 0 };
  const deck = { leaderId: "L", leaderName: "Leader", source: "generated" as const, totalCards: 50, cards: [{ cardId: "C", count: 50 }] };
  const match = { schemaVersion: 2 as const, engineLabel: "Rules Kernel Practice v2" as const, disclosureJa: "d", outcome: "inconclusive" as const, reason: "turn_limit" as const, turns: 2, seed: 9, firstPlayer: "player" as const, playerCoverage: coverage, opponentCoverage: coverage, stats, finalState: state, trace: [{ index: 0, type: "game_end" as const, turn: 2, state }], playerDeck: deck, opponentDeck: deck };
  const rows = buildRulesPracticeStorageRows({ mode: "match", cpuSkill: "level1", result: match, games: [{ gameIndex: 0, result: match, trace: match.trace }], storagePolicy: { requestedMode: "full", mode: "full", eventSampleLimit: 1, autoFullEventGameLimit: 20, maxStoredEventGames: 100, capped: false } }, "run");
  assert.equal(rows.gameRows[0].winner, "inconclusive");
  assert.equal(rows.gameRows[0].reason, "turn_limit");
  assert.deepEqual(rows.gameRows[0].playerDeckSnapshot, deck);
  assert.deepEqual(rows.eventRows[0].state, state);
});

test("Rules storage rejects a saved full trace without state", () => {
  const source = buildRulesPracticeStorageRows.toString();
  assert.match(source, /practice_trace_state_missing/);
});
