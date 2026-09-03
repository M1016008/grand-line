import assert from "node:assert/strict";
import test from "node:test";

import { BattleEffectRegistry } from "./battle-engine/effect-registry";
import type { HeadlessBattleResult } from "./battle-engine/headless-runner";
import type { CardListItem } from "./cards";
import { resolveRulesPracticeOpponentDeck } from "./practice-rules-deck";
import { runRulesPracticeBatch, runRulesPracticeMatch } from "./practice-rules";

const leader = card("L", "LEADER");
const cards = [leader, ...Array.from({ length: 13 }, (_, i) => card(`C${i}`))];
const playerDeck = resolveRulesPracticeOpponentDeck({ leaderId: "L", pool: cards, regulations: {} });
const opponentDeck = { ...playerDeck, id: "opponent" };

test("Rules Practice match is deterministic and returns full trace/coverage", () => {
  const one = runRulesPracticeMatch({ playerDeck, opponentDeck, cards, seed: 44, cpuSkill: "level2", maxTurns: 2 });
  const two = runRulesPracticeMatch({ playerDeck, opponentDeck, cards, seed: 44, cpuSkill: "level2", maxTurns: 2 });
  assert.deepEqual(one.result, two.result);
  assert.equal(one.result.schemaVersion, 2);
  assert.ok(one.result.trace.length > 0);
  assert.ok(one.result.trace.every((event) => event.state));
  assert.equal(one.result.playerCoverage.totalCards, 50);
});

test("Rules Practice batch compiles once, balances sides and uses resolved denominator", () => {
  let compiles = 0;
  let calls = 0;
  const execution = runRulesPracticeBatch({
    playerDeck, opponentDeck, cards, games: 10, seed: 10, seedStep: 97,
    cpuSkill: "level3", maxTurns: 5, eventStorageMode: "sampled", eventSampleLimit: 2,
  }, {
    buildRegistry(value) { compiles += 1; return new BattleEffectRegistry(value); },
    run(options) {
      calls += 1;
      const index = Math.round((options.seed - 10) / 97);
      return fakeResult(options, index < 4 ? "player" : index < 6 ? "inconclusive" : "opponent");
    },
  });
  assert.equal(compiles, 1);
  assert.equal(calls, 12);
  assert.equal(execution.batch.resolvedGames, 8);
  assert.equal(execution.batch.inconclusiveGames, 2);
  assert.equal(execution.batch.resolvedWinRate, 0.5);
  assert.equal(execution.batch.firstPlayer.games, 5);
  assert.equal(execution.batch.secondPlayer.games, 5);
  assert.equal(execution.games.filter((game) => game.trace).length, 2);
});

test("sample replay mismatch fails closed", () => {
  let full = false;
  assert.throws(() => runRulesPracticeBatch({
    playerDeck, opponentDeck, cards, games: 1, seed: 1, cpuSkill: "level1",
    eventStorageMode: "full", eventSampleLimit: 1,
  }, {
    buildRegistry: (value) => new BattleEffectRegistry(value),
    run(options) {
      if (options.traceMode === "full") full = true;
      const result = fakeResult(options, "player");
      return full ? { ...result, turns: result.turns + 1 } : result;
    },
  }), /practice_replay_determinism_error/);
});

function fakeResult(
  options: Parameters<typeof import("./battle-engine/headless-runner").runHeadlessBattle>[0],
  outcome: "player" | "opponent" | "inconclusive",
): HeadlessBattleResult {
  const finalState = {
    turn: 3, activePlayer: "player" as const,
    ...(outcome === "inconclusive" ? {} : { winner: outcome }),
    player: { deck: 40, hand: 5, life: 3, characters: 1, stage: 0, trash: 1, resolving: 0, donTotal: 4, donRested: 2 },
    opponent: { deck: 40, hand: 5, life: 3, characters: 1, stage: 0, trash: 1, resolving: 0, donTotal: 4, donRested: 2 },
  };
  const stats = {
    cardsPlayed: 1, attacksDeclared: 1, leaderAttacks: 1, characterAttacks: 0,
    damageDealt: 0, blockersUsed: 0, counterCardsUsed: 0, counterPowerUsed: 0,
    triggersRevealed: 0, triggersActivated: 0, triggersDeclined: 0, searchesResolved: 0,
    donAttached: 0, donSpent: 1, deckOut: 0, supportedEffectsResolved: 0,
    partialEffectsEncountered: 0, unsupportedEffectsEncountered: 0,
  };
  return {
    outcome, reason: outcome === "inconclusive" ? "turn_limit" : "leader_damage",
    turns: 3, seed: options.seed, firstPlayer: options.firstPlayer ?? "player",
    playerCoverage: options.environment!.playerCoverage,
    opponentCoverage: options.environment!.opponentCoverage,
    stats, finalState,
    ...(options.traceMode === "full" ? { trace: [{ index: 0, type: "game_end", turn: 3, state: finalState }] } : {}),
  };
}

function card(id: string, cardType = "CHARACTER"): CardListItem {
  return { id, setCode: "T", cardType, name: id, colors: ["Red"], features: [], attributes: [],
    cost: cardType === "LEADER" ? null : 1, power: 5000, counter: 1000,
    life: cardType === "LEADER" ? 5 : null, rarity: null, hasTrigger: false,
    imageUrlJp: null, mechanics: [], effectText: null, triggerText: null,
    source: "official_jp", verified: true };
}
