import test from "node:test";
import assert from "node:assert/strict";

import { resolveBenchmarkOpponent } from "@/lib/benchmark-opponent";
import type { CardListItem } from "@/lib/cards";
import {
  BenchmarkDeckValidationError,
  strictDeckIntelligencePracticeDeck,
} from "@/lib/deck-battle-benchmark";
import { emptyRulesBattleStats } from "@/lib/battle-engine/battle-trace";
import type { DeckEffectCoverage } from "@/lib/battle-engine/coverage";
import { BattleEffectRegistry } from "@/lib/battle-engine/effect-registry";
import type {
  HeadlessBattleOptions,
  HeadlessBattleResult,
} from "@/lib/battle-engine/headless-runner";
import { DeckCopyResolutionError } from "@/lib/deck-intelligence-compare";
import type { RulesBenchmarkDeckMetrics } from "@/lib/deck-rules-benchmark";
import {
  aggregateOptimizerPairedOutcomes,
  applyOptimizerCandidate,
  classifyOptimizerEvidence,
  compareCoverage,
  createOptimizerCardObservationCollector,
  DeckOptimizerError,
  runDeckOptimizer,
  type DeckOptimizerInput,
  type OptimizerCoverageDelta,
  type OptimizerPairedOutcomes,
  type OptimizerRulesDeltas,
  type OptimizerRulesDependencies,
} from "@/lib/deck-optimizer";
import type { PracticeDeck } from "@/lib/practice-sim";
import type { SavedDeckDetail } from "@/lib/saved-decks";

const LEADER = card("L-OPT", "LEADER", 0, {
  features: ["Crew"],
  mechanics: ["OnAttack"],
});
const BASELINE_CARDS = Array.from({ length: 13 }, (_, index) =>
  card(`C-${String(index).padStart(2, "0")}`, "CHARACTER", index, {
    features: ["Crew"],
  }),
);
const BASELINE_ENTRIES = BASELINE_CARDS.map((deckCard, index) => ({
  cardId: deckCard.id,
  count: index === 12 ? 2 : 4,
}));
const ADDITIONS = Array.from({ length: 12 }, (_, index) =>
  card(`A-${String(index).padStart(2, "0")}`, "CHARACTER", index + 20, {
    cost: index === 0 ? 3 : (index % 6) + 1,
    counter: index === 0 ? 2_000 : index % 2 === 0 ? 1_000 : 0,
    features: ["Crew"],
    mechanics: index === 0 ? ["Search", "OnPlay"] : ["OnPlay"],
    hasTrigger: index === 0,
  }),
);
const OFF_COLOR = card("A-BLUE", "CHARACTER", 40, { colors: ["blue"] });
const UNVERIFIED = card("A-MANUAL", "CHARACTER", 41, {
  source: "manual",
  verified: false,
});
const POOL = [LEADER, ...BASELINE_CARDS, ...ADDITIONS, OFF_COLOR, UNVERIFIED];

test("optimizer inherits the complete Benchmark schedule snapshot for every deck", () => {
  const calls: HeadlessBattleOptions[] = [];
  const result = runDeckOptimizer(optimizerInput(), rulesDependencies(calls));
  const schedules = [...groupCallsByDeck(calls).values()];

  assert.equal(result.schemaVersion, 2);
  assert.equal(result.optimizerLabel, "Rules Kernel Optimizer v2");
  assert.deepEqual(
    {
      baseSeed: result.schedule.baseSeed,
      seedStep: result.schedule.seedStep,
      cpuSkill: result.schedule.cpuSkill,
      maxTurns: result.schedule.maxTurns,
    },
    { baseSeed: 5_000, seedStep: 13, cpuSkill: "level3", maxTurns: 10 },
  );
  assert.equal(result.schedule.gamesPerDeck, 100);
  assert.equal(result.schedule.totalSimulations, 900);
  assert.equal(schedules.length, 9);
  assert.equal(schedules[0].length, 100);
  for (const schedule of schedules.slice(1)) assert.deepEqual(schedule, schedules[0]);
  assert.equal(calls.filter((call) => call.traceMode === "compact").length, 100);
  assert.equal(calls.filter((call) => call.traceMode === "none").length, 800);
});

test("one optimizer request compiles one registry and isolates deck coverage", () => {
  let registryBuilds = 0;
  const calls: HeadlessBattleOptions[] = [];
  const result = runDeckOptimizer(
    optimizerInput(),
    rulesDependencies(calls, () => {
      registryBuilds += 1;
    }),
  );

  assert.equal(registryBuilds, 1);
  assert.equal(new Set(calls.map((call) => call.environment?.registry)).size, 1);
  assert.equal(
    new Set(calls.map((call) => call.environment?.opponentCoverage)).size,
    1,
  );
  assert.equal(
    new Set(calls.map((call) => call.environment?.playerCoverage)).size,
    9,
  );
  assert.strictEqual(calls[0].environment?.opponentCoverage, result.opponentCoverage);
  assert.ok(
    calls.every(
      (call) => call.environment?.opponentCoverage === result.opponentCoverage,
    ),
  );
});

test("optimizer generates legal 1-copy and 2-copy swaps that stay exactly 50", () => {
  const result = runOptimizer();
  assert.deepEqual(
    new Set(result.candidates.map((candidate) => candidate.swapCount)),
    new Set([1, 2]),
  );
  for (const candidate of result.candidates) {
    assert.equal(
      candidate.resultingDeck.cards.reduce((total, entry) => total + entry.count, 0),
      50,
    );
    assert.ok(candidate.resultingDeck.cards.every((entry) => entry.count <= 4));
  }
});

test("optimizer preserves bans, reduced copy limits, and pair bans", () => {
  const result = runOptimizer({
    regulations: {
      perCardMax: new Map([
        ["A-00", 1],
        ["A-02", 0],
      ]),
      pairBans: [
        { cardIdA: LEADER.id, cardIdB: "A-01" },
        { cardIdA: "C-00", cardIdB: "A-03" },
      ],
    },
  });
  const restricted = result.candidates.filter(
    (candidate) => candidate.addCardId === "A-00",
  );

  assert.ok(restricted.length > 0);
  assert.ok(restricted.every((candidate) => candidate.swapCount === 1));
  assert.ok(
    result.candidates.every(
      (candidate) => !["A-01", "A-02", "A-03"].includes(candidate.addCardId),
    ),
  );
});

test("optimizer additions remain verified, color-legal, and ranking-based", () => {
  const result = runOptimizer();
  const byId = new Map(POOL.map((candidate) => [candidate.id, candidate]));
  for (const candidate of result.candidates) {
    const addition = byId.get(candidate.addCardId);
    assert.ok(addition);
    assert.equal(addition.verified, true);
    assert.ok(addition.source === "official_jp" || addition.source === "official_en");
    assert.ok(addition.colors.some((color) => LEADER.colors.includes(color)));
    assert.notEqual(addition.id, OFF_COLOR.id);
    assert.notEqual(addition.id, UNVERIFIED.id);
    assert.ok(candidate.additionEvidence.rank > 0);
    assert.ok(candidate.additionEvidence.score.total > 0);
  }
});

test("optimizer rejects unknown and unverified target cards before Rules simulation", () => {
  const calls: HeadlessBattleOptions[] = [];
  const dependencies = rulesDependencies(calls);
  const unknownTarget = BASELINE_ENTRIES.map((entry, index) =>
    index === 0 ? { cardId: "UNKNOWN", count: entry.count } : entry,
  );
  assert.throws(
    () => runDeckOptimizer(optimizerInput({ targetCards: unknownTarget }), dependencies),
    (error) =>
      error instanceof DeckCopyResolutionError && error.code === "missing_card",
  );
  const unverifiedTarget = BASELINE_ENTRIES.map((entry, index) =>
    index === 0 ? { cardId: UNVERIFIED.id, count: entry.count } : entry,
  );
  assert.throws(
    () => runDeckOptimizer(optimizerInput({ targetCards: unverifiedTarget }), dependencies),
    (error) =>
      error instanceof DeckOptimizerError && error.code === "unverified_target",
  );
  assert.equal(calls.length, 0);
});

test("optimizer preserves style/tags and deterministic candidate order", () => {
  const first = runOptimizer();
  const second = runOptimizer();
  assert.deepEqual(first.selectedVariant, {
    variantProfile: "consistency",
    selectedStyle: "aggressive",
    selectedTags: ["search_focus", "counter_focus"],
  });
  assert.deepEqual(
    first.candidates.map((candidate) => candidate.candidateId),
    second.candidates.map((candidate) => candidate.candidateId),
  );
});

test("paired optimizer outcomes exclude inconclusive instead of converting it to loss", () => {
  assert.deepEqual(
    aggregateOptimizerPairedOutcomes(
      ["win", "loss", "inconclusive", "win", "loss", "inconclusive"],
      ["win", "win", "win", "loss", "inconclusive", "inconclusive"],
    ),
    {
      games: 6,
      bothResolved: 3,
      excludedByInconclusive: 3,
      bothWin: 1,
      bothLose: 0,
      candidateOnlyWins: 1,
      baselineOnlyWins: 1,
      netResolvedWins: 0,
      discordantResolvedGames: 2,
      netResolvedWinShare: 0,
    },
  );
});

test("evidence classification is fail-closed for resolution, guard, and coverage", () => {
  const adequate = paired({
    bothResolved: 80,
    excludedByInconclusive: 20,
    candidateOnlyWins: 6,
    baselineOnlyWins: 2,
    netResolvedWins: 4,
    discordantResolvedGames: 8,
  });
  const positive = deltas({ resolvedWinRate: 0.05, resolutionRate: 0 });
  const baseline = metrics();
  const candidate = metrics({ resolvedWinRate: 0.55 });
  const comparable = coverageDelta();

  assert.equal(
    classifyOptimizerEvidence(adequate, positive, comparable, baseline, candidate),
    "improvement_signal",
  );
  assert.equal(
    classifyOptimizerEvidence(
      adequate,
      positive,
      coverageDelta({ worsened: true, supportedCards: -1 }),
      baseline,
      candidate,
    ),
    "insufficient_evidence",
  );
  assert.equal(
    classifyOptimizerEvidence(
      paired({ bothResolved: 39, excludedByInconclusive: 61 }),
      positive,
      comparable,
      baseline,
      candidate,
    ),
    "insufficient_evidence",
  );
  assert.equal(
    classifyOptimizerEvidence(
      adequate,
      positive,
      comparable,
      baseline,
      metrics({ engineGuard: 1 }),
    ),
    "insufficient_evidence",
  );
  assert.equal(
    classifyOptimizerEvidence(
      adequate,
      deltas({ resolvedWinRate: null }),
      comparable,
      baseline,
      metrics({ resolvedWinRate: null }),
    ),
    "insufficient_evidence",
  );
  assert.equal(
    classifyOptimizerEvidence(
      paired({ netResolvedWins: 1, candidateOnlyWins: 3, baselineOnlyWins: 2 }),
      deltas({ resolvedWinRate: 0.01 }),
      comparable,
      baseline,
      candidate,
    ),
    "small_difference",
  );
  assert.equal(
    classifyOptimizerEvidence(
      paired({ netResolvedWins: -3, candidateOnlyWins: 1, baselineOnlyWins: 4 }),
      deltas({ resolvedWinRate: -0.04 }),
      comparable,
      baseline,
      candidate,
    ),
    "no_improvement",
  );
});

test("compact baseline events produce deterministic per-card observations", () => {
  const collector = createOptimizerCardObservationCollector(["C-00", "C-01"]);
  collector.observe([
    trace("play_card", 1),
    trace("attack_declared", 2),
    trace("counter_used", 3),
    trace("trigger_choice", 4, { activated: true }),
    trace("search_choice", 5),
    trace("effect_target", 6),
    { ...trace("play_card", 9), actor: "opponent" },
  ]);
  const observations = collector.finish();

  assert.deepEqual(observations[0], {
    cardId: "C-00",
    plays: 1,
    attacks: 1,
    counters: 1,
    triggerChoices: 1,
    triggerActivations: 1,
    searches: 1,
    effectTargets: 1,
    observedActions: 6,
    averageObservedTurn: 3.5,
  });
  assert.deepEqual(observations[1], {
    cardId: "C-01",
    plays: 0,
    attacks: 0,
    counters: 0,
    triggerChoices: 0,
    triggerActivations: 0,
    searches: 0,
    effectTargets: 0,
    observedActions: 0,
    averageObservedTurn: null,
  });
});

test("coverage deltas identify degradation without treating status as card weakness", () => {
  assert.deepEqual(
    compareCoverage(coverage(), coverage({ supportedCards: 49, partialCards: 1 })),
    {
      supportedCards: -1,
      partialCards: 1,
      unsupportedCards: 0,
      supportedRatio: -0.02,
      baselineComplete: true,
      candidateComplete: false,
      baselineLeaderStatus: "supported",
      candidateLeaderStatus: "supported",
      worsened: true,
    },
  );
  const candidate = runOptimizer().candidates[0];
  assert.equal(typeof candidate.removalEvidence.coverageStatus, "string");
  assert.match(candidate.reasonJa, /カード自体の強弱を示すものではありません/);
});

test("applying an optimizer candidate remains fail-closed and preserves 50 cards", () => {
  const candidate = runOptimizer().candidates[0];
  const poolById = new Map(POOL.map((candidateCard) => [candidateCard.id, candidateCard]));
  let draft = [{ card: BASELINE_CARDS[0], count: 4 }];
  applyOptimizerCandidate(candidate, poolById, (entries) => {
    draft = entries;
  });
  assert.equal(draft.reduce((total, entry) => total + entry.count, 0), 50);
  const beforeFailure = draft;
  const incompletePool = new Map(poolById);
  incompletePool.delete(candidate.addCardId);
  assert.throws(() =>
    applyOptimizerCandidate(candidate, incompletePool, (entries) => {
      draft = entries;
    }),
  );
  assert.strictEqual(draft, beforeFailure);
});

test("shared opponent resolver still revalidates saved and synthetic decks", () => {
  const poolById = new Map(POOL.map((candidate) => [candidate.id, candidate]));
  assert.throws(
    () =>
      resolveBenchmarkOpponent({
        requested: { kind: "saved", deckId: "saved-opponent" },
        savedOpponent: savedOpponent(),
        poolById,
        pool: POOL,
        regulations: { perCardMax: new Map([["C-00", 0]]) },
      }),
    (error) =>
      error instanceof BenchmarkDeckValidationError &&
      error.violations.some((violation) => violation.code === "banned_card"),
  );
  const synthetic = resolveBenchmarkOpponent({
    requested: { kind: "synthetic", leaderId: LEADER.id },
    savedOpponent: null,
    poolById,
    pool: POOL,
    regulations: { perCardMax: new Map([["A-00", 0]]) },
  });
  assert.equal(synthetic.descriptor.synthetic, true);
  assert.equal(synthetic.deck.totalCards, 50);
});

function runOptimizer(overrides: Partial<DeckOptimizerInput> = {}) {
  return runDeckOptimizer(optimizerInput(overrides), rulesDependencies([]));
}

function optimizerInput(overrides: Partial<DeckOptimizerInput> = {}): DeckOptimizerInput {
  return {
    leader: LEADER,
    targetCards: BASELINE_ENTRIES,
    variantProfile: "consistency",
    selectedStyle: "aggressive",
    selectedTags: ["search_focus", "counter_focus"],
    pool: POOL,
    regulations: {},
    persistedSynergies: [],
    opponentDeck: baselineDeck("opponent"),
    opponent: {
      kind: "synthetic",
      id: `synthetic:${LEADER.id}`,
      name: `Synthetic benchmark opponent — ${LEADER.name}`,
      leaderId: LEADER.id,
      synthetic: true,
    },
    baseSeed: 5_000,
    seedStep: 13,
    cpuSkill: "level3",
    maxTurns: 10,
    optimizerGames: 100,
    candidateLimit: 8,
    ...overrides,
  };
}

function rulesDependencies(
  calls: HeadlessBattleOptions[],
  onRegistryBuild?: () => void,
): OptimizerRulesDependencies {
  return {
    buildRegistry(cards) {
      onRegistryBuild?.();
      return new BattleEffectRegistry(cards);
    },
    run(options) {
      calls.push(options);
      const gameIndex = Math.round((options.seed - 5_000) / 13);
      const candidate = options.playerDeck.id !==
        "optimizer:L-OPT:consistency:baseline";
      const baselineOutcome = gameIndex % 5 === 2
        ? "inconclusive"
        : gameIndex % 5 < 2
          ? "player"
          : "opponent";
      const outcome = candidate && gameIndex % 10 === 1
        ? "player"
        : baselineOutcome;
      return headlessResult(options, outcome);
    },
  };
}

function headlessResult(
  options: HeadlessBattleOptions,
  outcome: "player" | "opponent" | "inconclusive",
): HeadlessBattleResult {
  const firstCardId = options.playerDeck.entries[0].card.id;
  return {
    outcome,
    reason: outcome === "inconclusive" ? "turn_limit" : "leader_damage",
    turns: 5,
    seed: options.seed,
    firstPlayer: options.firstPlayer,
    playerCoverage: options.environment!.playerCoverage,
    opponentCoverage: options.environment!.opponentCoverage,
    stats: { ...emptyRulesBattleStats(), attacksDeclared: 3 },
    finalState: {
      turn: 5,
      activePlayer: "player",
      player: emptySide(),
      opponent: emptySide(),
    },
    trace:
      options.traceMode === "compact"
        ? [trace("play_card", 2, undefined, firstCardId)]
        : undefined,
  };
}

function groupCallsByDeck(calls: HeadlessBattleOptions[]) {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const call of calls) {
    const entries = groups.get(call.playerDeck.id) ?? [];
    entries.push({
      seed: call.seed,
      firstPlayer: call.firstPlayer,
      opponentId: call.opponentDeck.id,
      cpuSkill: call.opponentSkill,
      maxTurns: call.maxTurns,
    });
    groups.set(call.playerDeck.id, entries);
  }
  return groups;
}

function baselineDeck(id: string): PracticeDeck {
  return strictDeckIntelligencePracticeDeck({
    id,
    name: id,
    leader: LEADER,
    cards: BASELINE_ENTRIES,
    poolById: new Map(BASELINE_CARDS.map((deckCard) => [deckCard.id, deckCard])),
    regulations: {},
  });
}

function savedOpponent(): SavedDeckDetail {
  return {
    id: "saved-opponent",
    name: "Saved opponent",
    format: "standard",
    notes: null,
    leader: LEADER,
    entries: BASELINE_CARDS.map((deckCard, index) => ({
      card: deckCard,
      count: index === 12 ? 2 : 4,
    })),
    totalCards: 50,
    evaluationScores: {},
    ruleReport: { legal: true, totalCount: 50, violations: [] },
    createdAt: 0,
    updatedAt: 0,
  };
}

function metrics(
  options: { resolvedWinRate?: number | null; engineGuard?: number } = {},
): Pick<RulesBenchmarkDeckMetrics, "outcomes" | "resolvedWinRate"> {
  return {
    resolvedWinRate:
      "resolvedWinRate" in options ? options.resolvedWinRate ?? null : 0.5,
    outcomes: {
      leaderDamageWins: 50,
      deckOutWins: 0,
      effectWins: 0,
      turnLimit: 0,
      engineGuard: options.engineGuard ?? 0,
    },
  };
}

function paired(overrides: Partial<OptimizerPairedOutcomes> = {}): OptimizerPairedOutcomes {
  return {
    games: 100,
    bothResolved: 80,
    excludedByInconclusive: 20,
    bothWin: 35,
    bothLose: 35,
    candidateOnlyWins: 5,
    baselineOnlyWins: 5,
    netResolvedWins: 0,
    discordantResolvedGames: 10,
    netResolvedWinShare: 0,
    ...overrides,
  };
}

function deltas(overrides: Partial<OptimizerRulesDeltas> = {}): OptimizerRulesDeltas {
  return {
    resolvedWinRate: 0,
    resolutionRate: 0,
    firstPlayerResolvedWinRate: 0,
    secondPlayerResolvedWinRate: 0,
    averageResolvedTurns: 0,
    attacksPerGame: 0,
    blockersPerGame: 0,
    counterCardsPerGame: 0,
    triggerActivationsPerGame: 0,
    supportedEffectsPerGame: 0,
    ...overrides,
  };
}

function coverageDelta(
  overrides: Partial<OptimizerCoverageDelta> = {},
): OptimizerCoverageDelta {
  return {
    supportedCards: 0,
    partialCards: 0,
    unsupportedCards: 0,
    supportedRatio: 0,
    baselineComplete: true,
    candidateComplete: true,
    baselineLeaderStatus: "supported",
    candidateLeaderStatus: "supported",
    worsened: false,
    ...overrides,
  };
}

function coverage(overrides: Partial<DeckEffectCoverage> = {}): DeckEffectCoverage {
  const supportedCards = overrides.supportedCards ?? 50;
  const partialCards = overrides.partialCards ?? 0;
  const unsupportedCards = overrides.unsupportedCards ?? 0;
  return {
    totalCards: 50,
    supportedCards,
    partialCards,
    unsupportedCards,
    supportedRatio: supportedCards / 50,
    complete: partialCards === 0 && unsupportedCards === 0,
    leaderStatus: "supported",
    leaderReasons: [],
    entries: [],
    ...overrides,
  };
}

function trace(
  type:
    | "play_card"
    | "attack_declared"
    | "counter_used"
    | "trigger_choice"
    | "search_choice"
    | "effect_target",
  turn: number,
  details?: Record<string, string | number | boolean | null>,
  cardId = "C-00",
) {
  return { index: turn, type, turn, actor: "player" as const, cardId, details };
}

function emptySide() {
  return {
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
}

function card(
  id: string,
  cardType: CardListItem["cardType"],
  order: number,
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
    cost: cardType === "LEADER" ? null : (order % 6) + 1,
    power: cardType === "EVENT" ? null : 5_000 + order,
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
