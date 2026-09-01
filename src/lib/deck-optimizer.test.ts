import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveBenchmarkOpponent,
} from "@/lib/benchmark-opponent";
import type { CardListItem } from "@/lib/cards";
import {
  BenchmarkDeckValidationError,
  strictDeckIntelligencePracticeDeck,
} from "@/lib/deck-battle-benchmark";
import { DeckCopyResolutionError } from "@/lib/deck-intelligence-compare";
import {
  aggregateOptimizerPairedOutcomes,
  applyOptimizerCandidate,
  DeckOptimizerError,
  runDeckOptimizer,
  type DeckOptimizerInput,
} from "@/lib/deck-optimizer";
import type {
  GameEvent,
  ReplayStateSnapshot,
} from "@/lib/practice-log";
import {
  simulateMatch,
  type MatchResult,
  type PracticeDeck,
} from "@/lib/practice-sim";
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
const POOL = [
  LEADER,
  ...BASELINE_CARDS,
  ...ADDITIONS,
  OFF_COLOR,
  UNVERIFIED,
];

test("optimizer uses the exact same schedule for baseline and every candidate", () => {
  const calls = new Map<
    string,
    Array<{
      opponentId: string;
      seed: number;
      firstPlayer: string | undefined;
      cpuSkill: string | undefined;
      maxTurns: number | undefined;
    }>
  >();
  const result = runDeckOptimizer(optimizerInput(), {
    simulate: capturingFakeMatch(calls),
  });
  const schedules = [...calls.values()];

  assert.equal(result.schedule.gamesPerDeck, 100);
  assert.equal(result.schedule.totalSimulations, 900);
  assert.equal(schedules.length, 9);
  assert.equal(schedules[0].length, 100);
  for (const schedule of schedules.slice(1)) {
    assert.deepEqual(schedule, schedules[0]);
  }
});

test("optimizer generates legal 1-copy and 2-copy swaps that stay exactly 50", () => {
  const result = runOptimizer();
  assert.deepEqual(
    new Set(result.candidates.map((candidate) => candidate.swapCount)),
    new Set([1, 2]),
  );
  for (const candidate of result.candidates) {
    assert.equal(
      candidate.resultingDeck.cards.reduce(
        (total, entry) => total + entry.count,
        0,
      ),
      50,
    );
    assert.ok(candidate.resultingDeck.cards.every((entry) => entry.count <= 4));
  }
});

test("optimizer excludes banned and leader-pair-banned additions", () => {
  const result = runOptimizer({
    regulations: {
      perCardMax: new Map([["A-00", 0]]),
      pairBans: [{ cardIdA: LEADER.id, cardIdB: "A-01" }],
    },
  });

  assert.ok(result.candidates.length > 0);
  assert.ok(
    result.candidates.every(
      (candidate) =>
        candidate.addCardId !== "A-00" && candidate.addCardId !== "A-01",
    ),
  );
});

test("optimizer respects reduced copy limits and card-card pair bans", () => {
  const result = runOptimizer({
    regulations: {
      perCardMax: new Map([["A-00", 1]]),
      pairBans: [{ cardIdA: "C-00", cardIdB: "A-01" }],
    },
  });
  const restricted = result.candidates.filter(
    (candidate) => candidate.addCardId === "A-00",
  );

  assert.ok(restricted.length > 0);
  assert.ok(restricted.every((candidate) => candidate.swapCount === 1));
  assert.ok(
    result.candidates.every((candidate) => candidate.addCardId !== "A-01"),
  );
});

test("optimizer additions are verified official, color-legal, and ranking-based", () => {
  const result = runOptimizer();
  const byId = new Map(POOL.map((candidate) => [candidate.id, candidate]));

  assert.ok(result.candidates.some((candidate) => candidate.addCardId === "A-00"));
  for (const candidate of result.candidates) {
    const addition = byId.get(candidate.addCardId);
    assert.ok(addition);
    assert.equal(addition.verified, true);
    assert.ok(
      addition.source === "official_jp" || addition.source === "official_en",
    );
    assert.ok(addition.colors.some((color) => LEADER.colors.includes(color)));
    assert.notEqual(addition.id, OFF_COLOR.id);
    assert.notEqual(addition.id, UNVERIFIED.id);
    assert.ok(candidate.additionEvidence.rank > 0);
    assert.ok(candidate.additionEvidence.score.total > 0);
  }
});

test("optimizer rejects unknown and unverified target cards before simulation", () => {
  let simulationCalls = 0;
  const dependencies = {
    simulate: ((...args: Parameters<typeof simulateMatch>) => {
      simulationCalls += 1;
      return fakeMatch(...args);
    }) as typeof simulateMatch,
  };
  const unknownTarget = BASELINE_ENTRIES.map((entry, index) =>
    index === 0 ? { cardId: "UNKNOWN", count: entry.count } : entry,
  );

  assert.throws(
    () =>
      runDeckOptimizer(optimizerInput({ targetCards: unknownTarget }), dependencies),
    (error) =>
      error instanceof DeckCopyResolutionError &&
      error.code === "missing_card",
  );

  const unverifiedTarget = BASELINE_ENTRIES.map((entry, index) =>
    index === 0 ? { cardId: UNVERIFIED.id, count: entry.count } : entry,
  );
  assert.throws(
    () =>
      runDeckOptimizer(
        optimizerInput({ targetCards: unverifiedTarget }),
        dependencies,
      ),
    (error) =>
      error instanceof DeckOptimizerError &&
      error.code === "unverified_target",
  );
  assert.equal(simulationCalls, 0);
});

test("optimizer preserves selected Main Style, Feature Tags, and deterministic order", () => {
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

test("paired flip metrics, Wilson CI, and structural deltas are system-derived", () => {
  assert.deepEqual(
    aggregateOptimizerPairedOutcomes(
      [true, false, false, true, false],
      [true, true, false, false, true],
    ),
    {
      games: 5,
      bothWin: 1,
      bothLose: 1,
      gainedWins: 2,
      lostWins: 1,
      netPairedWins: 1,
      discordantGames: 3,
      pairedImprovementRate: 0.2,
    },
  );

  const result = runOptimizer();
  const candidate = result.candidates[0];
  assert.equal(candidate.candidateMetrics.heuristicWinRateCi95.level, 0.95);
  assert.equal(
    candidate.pairedOutcomes.netPairedWins,
    candidate.pairedOutcomes.gainedWins - candidate.pairedOutcomes.lostWins,
  );
  assert.equal(typeof candidate.structuralDelta.counter2000Plus, "number");
  assert.equal(typeof candidate.structuralDelta.triggerRatio, "number");
  assert.equal(typeof candidate.structuralDelta.evaluationScores.stability, "number");
  assert.match(candidate.reasonJa, /candidate-only win/);
});

test("applying an optimizer candidate is fail-closed and preserves 50 cards", () => {
  const candidate = runOptimizer().candidates[0];
  const poolById = new Map(POOL.map((candidateCard) => [candidateCard.id, candidateCard]));
  let draft = [{ card: BASELINE_CARDS[0], count: 4 }];
  applyOptimizerCandidate(candidate, poolById, (entries) => {
    draft = entries;
  });
  assert.equal(
    draft.reduce((total, entry) => total + entry.count, 0),
    50,
  );

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

test("shared opponent resolver revalidates saved decks and keeps synthetic strict", () => {
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
  assert.equal(
    synthetic.deck.entries.some((entry) => entry.card.id === "A-00"),
    false,
  );
});

function runOptimizer(overrides: Partial<DeckOptimizerInput> = {}) {
  return runDeckOptimizer(optimizerInput(overrides), { simulate: fakeMatch });
}

function optimizerInput(
  overrides: Partial<DeckOptimizerInput> = {},
): DeckOptimizerInput {
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
    cpuSkill: "level3",
    maxTurns: 10,
    optimizerGames: 100,
    candidateLimit: 8,
    ...overrides,
  };
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

function capturingFakeMatch(
  calls: Map<
    string,
    Array<{
      opponentId: string;
      seed: number;
      firstPlayer: string | undefined;
      cpuSkill: string | undefined;
      maxTurns: number | undefined;
    }>
  >,
): typeof simulateMatch {
  return (deck, opponent, options) => {
    const deckCalls = calls.get(deck.id) ?? [];
    deckCalls.push({
      opponentId: opponent.id,
      seed: options.seed,
      firstPlayer: options.firstPlayer,
      cpuSkill: options.cpuSkill,
      maxTurns: options.maxTurns,
    });
    calls.set(deck.id, deckCalls);
    return fakeMatch(deck, opponent, options);
  };
}

const fakeMatch: typeof simulateMatch = (playerDeck, opponentDeck, options) => {
  const gameIndex = Math.round((options.seed - 1_001) / 97);
  const hasOptimizerAddition = playerDeck.entries.some((entry) =>
    entry.card.id.startsWith("A-"),
  );
  const baselineWin = gameIndex % 5 < 2;
  const playerWins = baselineWin || (hasOptimizerAddition && gameIndex % 10 === 2);
  const winner = playerWins ? "player" : "opponent";
  const firstPlayer = options.firstPlayer ?? "player";
  const cpuSkill = options.cpuSkill ?? "level1";
  const state = replayState();
  const timedCard = playerDeck.entries[0].card;
  const events: GameEvent[] = [
    {
      index: 0,
      type: "mulligan_decision",
      turn: 0,
      side: "player",
      payload: { decision: gameIndex % 3 === 0 ? "redraw" : "keep" },
      state,
    },
    {
      index: 1,
      type: "main_phase_action",
      turn: 3,
      side: "player",
      payload: { cardId: timedCard.id, cardName: timedCard.name },
      state,
    },
    {
      index: 2,
      type: "turn_end",
      turn: 5,
      side: "player",
      payload: {},
      state: { ...state, playerDonAvailable: 6, playerDonUsed: 5 },
    },
    {
      index: 3,
      type: "game_end",
      turn: 5,
      side: winner,
      payload: {
        loser: playerWins ? "opponent" : "player",
        counterOverflow: playerWins ? 0 : 2_000,
      },
      state,
    },
  ];
  return {
    winner,
    turns: 5,
    reason: "leader_damage",
    playerLife: playerWins ? 2 : 0,
    opponentLife: playerWins ? 0 : 2,
    playerScore: playerWins ? 10 : 5,
    opponentScore: playerWins ? 5 : 10,
    log: [],
    contributions: playerDeck.entries.map((entry, index) => ({
      cardId: entry.card.id,
      name: entry.card.name,
      side: "player" as const,
      impact: index + 1,
      appearances: 1,
    })),
    replay: {
      header: {
        schemaVersion: 1,
        seed: options.seed,
        rulesVersion: "optimizer-test",
        cpuSkill,
        firstPlayer,
        decks: {
          player: deckSummary(playerDeck),
          opponent: deckSummary(opponentDeck),
        },
      },
      events,
      result: {
        winner,
        loser: playerWins ? "opponent" : "player",
        turns: 5,
        reason: "leader_damage",
        playerLife: playerWins ? 2 : 0,
        opponentLife: playerWins ? 0 : 2,
      },
    },
  } satisfies MatchResult;
};

function deckSummary(deck: PracticeDeck) {
  return {
    leaderId: deck.leader.id,
    leaderName: deck.leader.name,
    source: deck.source,
    totalCards: deck.totalCards,
  };
}

function replayState(): ReplayStateSnapshot {
  return {
    playerLife: 3,
    opponentLife: 3,
    playerHand: 5,
    opponentHand: 5,
    playerDeck: 30,
    opponentDeck: 30,
    playerDonAvailable: 5,
    opponentDonAvailable: 5,
    playerDonUsed: 4,
    opponentDonUsed: 4,
  };
}

function card(
  id: string,
  cardType: string,
  index: number,
  overrides: Partial<CardListItem> = {},
): CardListItem {
  return {
    id,
    setCode: "TEST",
    cardType,
    name: `Card ${id}`,
    colors: ["red"],
    features: ["Test"],
    attributes: ["Strike"],
    cost: cardType === "LEADER" ? null : (index % 7) + 1,
    power: cardType === "LEADER" ? 5_000 : 2_000 + (index % 5) * 1_000,
    counter: cardType === "LEADER" ? null : index % 2 === 0 ? 1_000 : 0,
    life: cardType === "LEADER" ? 5 : null,
    rarity: "C",
    hasTrigger: index % 3 === 0,
    imageUrlJp: null,
    mechanics: index % 3 === 0 ? ["Trigger"] : [],
    source: "official_jp",
    verified: true,
    ...overrides,
  };
}
