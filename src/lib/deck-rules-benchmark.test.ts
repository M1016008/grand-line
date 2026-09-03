import test from "node:test";
import assert from "node:assert/strict";

import type { CardListItem } from "@/lib/cards";
import {
  buildPairedBenchmarkSchedule,
  wilson95Interval,
  type BenchmarkOpponentDescriptor,
} from "@/lib/deck-battle-benchmark";
import {
  aggregateRulesPairedOutcomes,
  computeRulesPairwiseComparisons,
  runRulesDeckBenchmark,
  runRulesDeckOnBenchmarkSchedule,
  summarizeRulesScheduledResults,
  type RulesBenchmarkDependencies,
} from "@/lib/deck-rules-benchmark";
import { BattleEffectRegistry } from "@/lib/battle-engine/effect-registry";
import {
  emptyRulesBattleStats,
  type HeadlessStateSummary,
} from "@/lib/battle-engine/battle-trace";
import type {
  HeadlessBattleOptions,
  HeadlessBattleResult,
} from "@/lib/battle-engine/headless-runner";
import { calculateDeckCoverage } from "@/lib/battle-engine/coverage";
import type { PracticeDeck } from "@/lib/practice-sim";

const LEADER = card("TEST-L", "LEADER");
const OPPONENT_LEADER = card("TEST-OL", "LEADER");
const RECOMMENDED_CARD = card("TEST-R", "CHARACTER");
const CONSISTENCY_CARD = card("TEST-C", "CHARACTER", {
  verified: false,
  source: "manual",
  effectText: "[登場時]カード1枚を引く。",
});
const SPECIALIZATION_CARD = card("TEST-S", "CHARACTER", {
  mechanics: ["UnknownMechanic"],
  effectText: "[登場時]カード1枚を引く。",
});
const OPPONENT_CARD = card("TEST-O", "CHARACTER");
const VARIANTS = [
  { variantProfile: "recommended" as const, deck: deck("recommended", LEADER, RECOMMENDED_CARD) },
  { variantProfile: "consistency" as const, deck: deck("consistency", LEADER, CONSISTENCY_CARD) },
  { variantProfile: "specialization" as const, deck: deck("specialization", LEADER, SPECIALIZATION_CARD) },
];
const OPPONENT_DECK = deck("opponent", OPPONENT_LEADER, OPPONENT_CARD);
const CARDS = [
  LEADER,
  OPPONENT_LEADER,
  RECOMMENDED_CARD,
  CONSISTENCY_CARD,
  SPECIALIZATION_CARD,
  OPPONENT_CARD,
];
const OPPONENT: BenchmarkOpponentDescriptor = {
  kind: "synthetic",
  id: "synthetic:test",
  name: "Synthetic benchmark opponent — test",
  leaderId: OPPONENT_LEADER.id,
  synthetic: true,
};

test("Rules Benchmark v2 is deterministic and preserves one paired schedule", () => {
  const calls: HeadlessBattleOptions[] = [];
  const dependencies = dependenciesWithCalls(calls);
  const first = runRulesDeckBenchmark(benchmarkOptions(), dependencies);
  const second = runRulesDeckBenchmark(benchmarkOptions(), dependenciesWithCalls([]));

  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.schedule.playerPolicySkill, "level4");
  assert.equal(calls.length, 18);
  for (let gameIndex = 0; gameIndex < 6; gameIndex++) {
    const paired = [calls[gameIndex], calls[gameIndex + 6], calls[gameIndex + 12]];
    assert.equal(new Set(paired.map((call) => call.seed)).size, 1);
    assert.equal(new Set(paired.map((call) => call.firstPlayer)).size, 1);
    assert.equal(new Set(paired.map((call) => call.opponentSkill)).size, 1);
    assert.equal(new Set(paired.map((call) => call.maxTurns)).size, 1);
    assert.ok(paired.every((call) => call.opponentDeck === OPPONENT_DECK));
    assert.ok(paired.every((call) => call.traceMode === "none"));
  }
});

test("one request compiles one registry and shares only match-independent facts", () => {
  let registryBuilds = 0;
  const calls: HeadlessBattleOptions[] = [];
  const result = runRulesDeckBenchmark(benchmarkOptions(), {
    run: fakeRun(calls),
    buildRegistry(cards) {
      registryBuilds += 1;
      return new BattleEffectRegistry(cards);
    },
  });

  assert.equal(registryBuilds, 1);
  assert.equal(new Set(calls.map((call) => call.environment?.registry)).size, 1);
  assert.equal(
    new Set(calls.map((call) => call.environment?.opponentCoverage)).size,
    1,
  );
  assert.equal(
    new Set(calls.map((call) => call.environment?.playerCoverage)).size,
    3,
  );
  assert.equal(result.variants.recommended.effectCoverage.supportedCards, 50);
  assert.equal(result.variants.consistency.effectCoverage.unsupportedCards, 50);
  assert.equal(result.variants.specialization.effectCoverage.partialCards, 50);
  assert.equal(result.opponentCoverage.supportedCards, 50);
  assert.strictEqual(
    calls[0].environment?.opponentCoverage,
    calls[6].environment?.opponentCoverage,
  );
});

test("inconclusive games are excluded from win rate and Wilson denominators", () => {
  const schedule = buildPairedBenchmarkSchedule(6, { cpuSkill: "level3" });
  const registry = new BattleEffectRegistry(CARDS);
  const coverage = calculateDeckCoverage(VARIANTS[0].deck, registry);
  const results = schedule.map((entry) => fakeResult(entry.seed, entry.firstPlayer));
  const metrics = summarizeRulesScheduledResults(results, schedule, coverage);

  assert.equal(metrics.games, 6);
  assert.equal(metrics.resolvedGames, 3);
  assert.equal(metrics.inconclusiveGames, 3);
  assert.equal(metrics.playerWins, 2);
  assert.equal(metrics.opponentWins, 1);
  assert.equal(metrics.resolvedWinRate, 0.666667);
  assert.deepEqual(metrics.resolvedWinRateCi95, wilson95Interval(2, 3));
  assert.equal(metrics.outcomes.leaderDamageWins, 2);
  assert.equal(metrics.outcomes.deckOutWins, 1);
  assert.equal(metrics.outcomes.turnLimit, 2);
  assert.equal(metrics.outcomes.engineGuard, 1);
});

test("first and second player splits use their own resolved denominators", () => {
  const schedule = buildPairedBenchmarkSchedule(6, { cpuSkill: "level3" });
  const coverage = calculateDeckCoverage(
    VARIANTS[0].deck,
    new BattleEffectRegistry(CARDS),
  );
  const metrics = summarizeRulesScheduledResults(
    schedule.map((entry) => fakeResult(entry.seed, entry.firstPlayer)),
    schedule,
    coverage,
  );

  assert.deepEqual(metrics.firstPlayer, {
    games: 3,
    resolvedGames: 1,
    inconclusiveGames: 2,
    playerWins: 1,
    opponentWins: 0,
    resolutionRate: 0.333333,
    resolvedWinRate: 1,
  });
  assert.deepEqual(metrics.secondPlayer, {
    games: 3,
    resolvedGames: 2,
    inconclusiveGames: 1,
    playerWins: 1,
    opponentWins: 1,
    resolutionRate: 0.666667,
    resolvedWinRate: 0.5,
  });
});

test("tri-state paired aggregation never classifies inconclusive as a loss", () => {
  const aggregate = aggregateRulesPairedOutcomes({
    recommended: ["win", "loss", "inconclusive", "win", "loss", "inconclusive"],
    consistency: ["win", "loss", "win", "loss", "win", "inconclusive"],
    specialization: ["win", "loss", "loss", "loss", "win", "inconclusive"],
  });
  assert.deepEqual(aggregate, {
    games: 6,
    allThreeResolved: 4,
    anyInconclusive: 2,
    allThreeWin: 1,
    allThreeLose: 1,
    allThreeInconclusive: 1,
    recommendedOnlyWins: 1,
    consistencyOnlyWins: 0,
    specializationOnlyWins: 0,
    twoVariantsWin: 1,
  });
});

test("pairwise comparison excludes any schedule index with an inconclusive side", () => {
  const comparisons = computeRulesPairwiseComparisons({
    recommended: ["win", "loss", "inconclusive", "win"],
    consistency: ["loss", "loss", "win", "win"],
    specialization: ["win", "inconclusive", "loss", "loss"],
  });
  assert.deepEqual(comparisons[0], {
    leftProfile: "recommended",
    rightProfile: "consistency",
    games: 4,
    bothResolved: 3,
    excludedByInconclusive: 1,
    leftOnlyWins: 1,
    rightOnlyWins: 0,
    bothWin: 1,
    bothLose: 1,
    netResolvedWins: 1,
  });
  assert.equal(comparisons[1].excludedByInconclusive, 2);
});

test("single-deck schedule exposes compact observations without retaining traces", () => {
  const schedule = buildPairedBenchmarkSchedule(3, { cpuSkill: "level3" });
  const registry = new BattleEffectRegistry(CARDS);
  const environment = Object.freeze({
    registry,
    playerCoverage: calculateDeckCoverage(VARIANTS[0].deck, registry),
    opponentCoverage: calculateDeckCoverage(OPPONENT_DECK, registry),
  });
  const observed: number[] = [];
  const result = runRulesDeckOnBenchmarkSchedule(
    {
      deck: VARIANTS[0].deck,
      opponentDeck: OPPONENT_DECK,
      cards: CARDS,
      schedule,
      environment,
      traceMode: "compact",
      replaySampleSize: 0,
      onResult: (game) => observed.push(game.trace?.length ?? 0),
    },
    (options) => ({
      ...fakeResult(options.seed, options.firstPlayer, options.environment),
      trace: [
        {
          index: 0,
          type: "play_card",
          turn: 2,
          actor: "player",
          cardId: RECOMMENDED_CARD.id,
        },
      ],
    }),
  );

  assert.deepEqual(observed, [1, 1, 1]);
  assert.equal(result.metrics.traceSamples, undefined);
  assert.equal(result.outcomes.length, 3);
});

function benchmarkOptions() {
  return {
    variants: VARIANTS,
    opponentDeck: OPPONENT_DECK,
    opponent: OPPONENT,
    cards: CARDS,
    games: 6,
    cpuSkill: "level3" as const,
    replaySampleSize: 0,
  };
}

function dependenciesWithCalls(calls: HeadlessBattleOptions[]): RulesBenchmarkDependencies {
  return {
    run: fakeRun(calls),
    buildRegistry: (cards) => new BattleEffectRegistry(cards),
  };
}

function fakeRun(calls: HeadlessBattleOptions[]): typeof import("@/lib/battle-engine/headless-runner").runHeadlessBattle {
  return (options) => {
    calls.push(options);
    return fakeResult(options.seed, options.firstPlayer, options.environment);
  };
}

function fakeResult(
  seed: number,
  firstPlayer: "player" | "opponent",
  environment?: HeadlessBattleOptions["environment"],
): HeadlessBattleResult {
  const index = Math.round((seed - 1_001) / 97);
  const outcomes = [
    ["player", "leader_damage"],
    ["opponent", "leader_damage"],
    ["inconclusive", "turn_limit"],
    ["player", "deck_out"],
    ["inconclusive", "turn_limit"],
    ["inconclusive", "engine_guard"],
  ] as const;
  const [outcome, reason] = outcomes[index % outcomes.length];
  const registry = new BattleEffectRegistry(CARDS);
  return {
    outcome,
    reason,
    turns: 4 + index,
    seed,
    firstPlayer,
    playerCoverage:
      environment?.playerCoverage ?? calculateDeckCoverage(VARIANTS[0].deck, registry),
    opponentCoverage:
      environment?.opponentCoverage ?? calculateDeckCoverage(OPPONENT_DECK, registry),
    stats: { ...emptyRulesBattleStats(), attacksDeclared: index + 1 },
    finalState: EMPTY_STATE,
  };
}

const EMPTY_SIDE = {
  deck: 40,
  hand: 5,
  life: 5,
  characters: 0,
  stage: 0,
  trash: 0,
  resolving: 0,
  donTotal: 0,
  donRested: 0,
};
const EMPTY_STATE: HeadlessStateSummary = {
  turn: 1,
  activePlayer: "player",
  player: EMPTY_SIDE,
  opponent: EMPTY_SIDE,
};

function deck(id: string, leader: CardListItem, main: CardListItem): PracticeDeck {
  return {
    id,
    name: id,
    leader,
    entries: [{ card: main, count: 50 }],
    source: "generated",
    totalCards: 50,
  };
}

function card(
  id: string,
  cardType: CardListItem["cardType"],
  overrides: Partial<CardListItem> = {},
): CardListItem {
  return {
    id,
    name: id,
    cardType,
    setCode: "TEST",
    colors: ["red"],
    attributes: [],
    features: [],
    mechanics: [],
    cost: cardType === "LEADER" ? null : 1,
    power: cardType === "EVENT" ? null : 5_000,
    counter: cardType === "LEADER" ? null : 1_000,
    life: cardType === "LEADER" ? 5 : null,
    rarity: null,
    hasTrigger: false,
    imageUrlJp: null,
    effectText: null,
    triggerText: null,
    source: "official_jp",
    verified: true,
    ...overrides,
  };
}
