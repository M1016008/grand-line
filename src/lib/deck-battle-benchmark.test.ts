import test from "node:test";
import assert from "node:assert/strict";

import type { CardListItem } from "@/lib/cards";
import {
  aggregatePairedOutcomes,
  BenchmarkDeckValidationError,
  buildPairedBenchmarkSchedule,
  buildStrictSyntheticBenchmarkOpponent,
  runPairedDeckBenchmark,
  strictDeckIntelligencePracticeDeck,
  wilson95Interval,
} from "@/lib/deck-battle-benchmark";
import { DeckCopyResolutionError } from "@/lib/deck-intelligence-compare";
import type { VariantProfile } from "@/lib/deck-intelligence-preferences";
import type { GameEvent, ReplayStateSnapshot } from "@/lib/practice-log";
import {
  buildPracticeDeck,
  simulateBatch,
  simulateMatch,
  type MatchResult,
  type PracticeDeck,
} from "@/lib/practice-sim";

const LEADER = card("L-001", "LEADER", 0);
const DECK_CARDS = Array.from({ length: 13 }, (_, index) =>
  card(`C-${String(index).padStart(2, "0")}`, "CHARACTER", index),
);
const COPY_ENTRIES = DECK_CARDS.map((deckCard, index) => ({
  cardId: deckCard.id,
  count: index === 12 ? 2 : 4,
}));
const SYNTHETIC_CARDS = Array.from({ length: 16 }, (_, index) =>
  card(`S-${String(index).padStart(2, "0")}`, "CHARACTER", index),
);

test("strict 50-card PracticeDeck adapter preserves leader and exact counts", () => {
  const deck = strictDeckIntelligencePracticeDeck({
    id: "recommended",
    name: "Recommended",
    leader: LEADER,
    cards: COPY_ENTRIES,
    poolById: poolById(DECK_CARDS),
    regulations: {},
  });

  assert.strictEqual(deck.leader, LEADER);
  assert.equal(deck.totalCards, 50);
  assert.equal(deck.source, "draft");
  assert.deepEqual(
    new Map(deck.entries.map((entry) => [entry.card.id, entry.count])),
    new Map(COPY_ENTRIES.map((entry) => [entry.cardId, entry.count])),
  );
});

test("strict PracticeDeck adapter fails closed for a missing card", () => {
  assert.throws(
    () =>
      strictDeckIntelligencePracticeDeck({
        id: "missing",
        name: "Missing",
        leader: LEADER,
        cards: COPY_ENTRIES,
        poolById: poolById(DECK_CARDS.slice(0, -1)),
        regulations: {},
      }),
    (error) =>
      error instanceof DeckCopyResolutionError &&
      error.code === "missing_card" &&
      error.message.includes("C-12"),
  );
});

test("strict PracticeDeck adapter rejects a non-50-card proposal", () => {
  const short = COPY_ENTRIES.map((entry, index) =>
    index === 0 ? { ...entry, count: 3 } : entry,
  );
  assert.throws(
    () =>
      strictDeckIntelligencePracticeDeck({
        id: "short",
        name: "Short",
        leader: LEADER,
        cards: short,
        poolById: poolById(DECK_CARDS),
        regulations: {},
      }),
    (error) =>
      error instanceof DeckCopyResolutionError &&
      error.code === "invalid_total",
  );
});

test("saved opponent conversion fails when an active restriction is violated", () => {
  assert.throws(
    () =>
      strictDeckIntelligencePracticeDeck({
        id: "saved:illegal",
        name: "Saved opponent",
        leader: LEADER,
        cards: COPY_ENTRIES,
        poolById: poolById(DECK_CARDS),
        regulations: { perCardMax: new Map([["C-00", 0]]) },
      }),
    (error) =>
      error instanceof BenchmarkDeckValidationError &&
      error.violations.some((violation) => violation.code === "banned_card"),
  );
});

test("synthetic opponent excludes banned card", () => {
  const baseline = buildStrictSyntheticBenchmarkOpponent({
    leader: LEADER,
    pool: SYNTHETIC_CARDS,
    regulations: {},
  });
  const bannedId = baseline.entries[0].card.id;
  const deck = buildStrictSyntheticBenchmarkOpponent({
    leader: LEADER,
    pool: SYNTHETIC_CARDS,
    regulations: { perCardMax: new Map([[bannedId, 0]]) },
  });

  assert.equal(deck.totalCards, 50);
  assert.equal(deck.entries.some((entry) => entry.card.id === bannedId), false);
});

test("synthetic opponent respects reduced copy limit", () => {
  const baseline = buildStrictSyntheticBenchmarkOpponent({
    leader: LEADER,
    pool: SYNTHETIC_CARDS,
    regulations: {},
  });
  const restrictedId = baseline.entries[0].card.id;
  const deck = buildStrictSyntheticBenchmarkOpponent({
    leader: LEADER,
    pool: SYNTHETIC_CARDS,
    regulations: { perCardMax: new Map([[restrictedId, 1]]) },
  });

  assert.equal(deck.totalCards, 50);
  assert.ok(
    (deck.entries.find((entry) => entry.card.id === restrictedId)?.count ?? 0) <= 1,
  );
});

test("synthetic opponent respects pair bans", () => {
  const baseline = buildStrictSyntheticBenchmarkOpponent({
    leader: LEADER,
    pool: SYNTHETIC_CARDS,
    regulations: {},
  });
  const [cardIdA, cardIdB] = baseline.entries.slice(0, 2).map((entry) => entry.card.id);
  const deck = buildStrictSyntheticBenchmarkOpponent({
    leader: LEADER,
    pool: SYNTHETIC_CARDS,
    regulations: { pairBans: [{ cardIdA, cardIdB }] },
  });
  const selected = new Set(deck.entries.map((entry) => entry.card.id));

  assert.equal(deck.totalCards, 50);
  assert.equal(selected.has(cardIdA) && selected.has(cardIdB), false);
});

test("synthetic opponent is exactly 50 and color-legal", () => {
  const offColor = { ...card("B-001", "CHARACTER", 0), colors: ["blue"] };
  const deck = buildStrictSyntheticBenchmarkOpponent({
    leader: LEADER,
    pool: [...SYNTHETIC_CARDS, offColor],
    regulations: {},
  });
  const leaderColors = new Set(LEADER.colors);

  assert.equal(deck.source, "generated");
  assert.equal(deck.totalCards, 50);
  assert.equal(
    deck.entries.reduce((total, entry) => total + entry.count, 0),
    50,
  );
  assert.ok(deck.entries.every((entry) => entry.count <= 4));
  assert.ok(
    deck.entries.every((entry) =>
      entry.card.colors.some((color) => leaderColors.has(color)),
    ),
  );
  assert.equal(deck.entries.some((entry) => entry.card.id === offColor.id), false);
});

test("impossible legal synthetic construction fails closed", () => {
  assert.throws(
    () =>
      buildStrictSyntheticBenchmarkOpponent({
        leader: LEADER,
        pool: SYNTHETIC_CARDS.slice(0, 12),
        regulations: {},
      }),
    (error) =>
      error instanceof BenchmarkDeckValidationError &&
      error.violations.some(
        (violation) => violation.code === "synthetic_opponent_unavailable",
      ),
  );
});

test("existing buildPracticeDeck keeps its Practice Lab fallback behavior", () => {
  const offColor = { ...card("B-ONLY", "CHARACTER", 0), colors: ["blue"] };
  const deck = buildPracticeDeck(LEADER, [offColor]);

  assert.equal(deck.totalCards, 50);
  assert.deepEqual(deck.entries, [{ card: offColor, count: 50 }]);
});

test("paired schedule balances first and second and is deterministic", () => {
  const first = buildPairedBenchmarkSchedule(100, {
    cpuSkill: "level3",
  });
  const second = buildPairedBenchmarkSchedule(100, {
    cpuSkill: "level3",
  });
  assert.deepEqual(first, second);
  assert.equal(first.filter((game) => game.firstPlayer === "player").length, 50);
  assert.equal(first.filter((game) => game.firstPlayer === "opponent").length, 50);
  assert.deepEqual(first.slice(0, 3).map(({ seed, firstPlayer }) => ({ seed, firstPlayer })), [
    { seed: 1001, firstPlayer: "player" },
    { seed: 1098, firstPlayer: "opponent" },
    { seed: 1195, firstPlayer: "player" },
  ]);
});

test("three variants receive the same seeds, assignments, CPU, turns and opponent", () => {
  const calls: Array<{
    deckId: string;
    opponent: PracticeDeck;
    seed: number;
    firstPlayer: string | undefined;
    cpuSkill: string | undefined;
    maxTurns: number | undefined;
  }> = [];
  const opponent = practiceDeck("opponent");
  runPairedDeckBenchmark(
    benchmarkOptions(opponent),
    {
      simulate: ((deck, receivedOpponent, options) => {
        calls.push({
          deckId: deck.id,
          opponent: receivedOpponent,
          seed: options.seed,
          firstPlayer: options.firstPlayer,
          cpuSkill: options.cpuSkill,
          maxTurns: options.maxTurns,
        });
        return fakeMatch(deck, receivedOpponent, options);
      }) satisfies typeof simulateMatch,
    },
  );

  assert.equal(calls.length, 18);
  for (let gameIndex = 0; gameIndex < 6; gameIndex++) {
    const paired = [calls[gameIndex], calls[gameIndex + 6], calls[gameIndex + 12]];
    assert.deepEqual(new Set(paired.map((call) => call.seed)).size, 1);
    assert.deepEqual(new Set(paired.map((call) => call.firstPlayer)).size, 1);
    assert.deepEqual(new Set(paired.map((call) => call.cpuSkill)).size, 1);
    assert.deepEqual(new Set(paired.map((call) => call.maxTurns)).size, 1);
    assert.ok(paired.every((call) => call.opponent === opponent));
  }
});

test("same benchmark input is deterministic and produces heuristic metrics and deltas", () => {
  const opponent = practiceDeck("opponent");
  const dependencies = { simulate: fakeMatch satisfies typeof simulateMatch };
  const first = runPairedDeckBenchmark(
    benchmarkOptions(opponent),
    dependencies,
  );
  const second = runPairedDeckBenchmark(
    benchmarkOptions(opponent),
    dependencies,
  );

  assert.deepEqual(first, second);
  assert.equal(first.variants.recommended.heuristicWins, 4);
  assert.equal(first.variants.recommended.heuristicWinRate, 4 / 6);
  assert.equal(first.variants.consistency.heuristicWins, 3);
  assert.equal(first.variants.specialization.heuristicWins, 2);
  assert.equal(first.relativeMetrics[0].winRateDelta, 0.166667);
  assert.equal(first.relativeMetrics[0].avgTurnsDelta, 0);
  assert.equal(first.relativeMetrics[0].donEfficiencyDelta, 0);
  assert.equal(first.relativeMetrics[0].firstPlayerDelta, -0.333333);
  assert.equal(first.relativeMetrics[0].secondPlayerDelta, 0.666667);
  assert.equal(first.variants.recommended.games, 6);
  assert.equal(first.variants.recommended.replaySamples.length, 1);
  assert.match(first.interpretationsJa[0], /明確な優劣|Practice engine/);
});

test("Wilson 95% confidence interval is deterministic", () => {
  assert.deepEqual(wilson95Interval(53, 100), {
    level: 0.95,
    lower: 0.432889,
    upper: 0.624892,
  });
});

test("paired outcome aggregation distinguishes shared and variant-only wins", () => {
  const aggregate = aggregatePairedOutcomes({
    recommended: [true, false, true, true, true, false, true, false],
    consistency: [true, false, false, true, false, true, true, false],
    specialization: [true, false, false, false, true, true, false, true],
  });
  assert.deepEqual(aggregate, {
    games: 8,
    allThreeWin: 1,
    allThreeLose: 1,
    recommendedOnlyWins: 1,
    consistencyOnlyWins: 0,
    specializationOnlyWins: 1,
    twoVariantsWin: 4,
    recommendedAndConsistencyWin: 2,
    recommendedAndSpecializationWin: 1,
    consistencyAndSpecializationWin: 1,
  });
});

test("existing Practice batch still returns every replay and analysis metrics", () => {
  const batch = simulateBatch(
    practiceDeck("practice-player"),
    practiceDeck("practice-opponent"),
    4,
    1_001,
    "level2",
  );
  assert.equal(batch.games, 4);
  assert.equal(batch.replays?.length, 4);
  assert.equal(batch.playerWins + batch.opponentWins, 4);
  assert.equal(typeof batch.metrics.averageDonEfficiency, "number");
  assert.ok(Array.isArray(batch.metrics.ablation));
});

function benchmarkOptions(opponentDeck: PracticeDeck) {
  return {
    variants: (["recommended", "consistency", "specialization"] as const).map(
      (variantProfile) => ({
        variantProfile,
        deck: practiceDeck(variantProfile),
      }),
    ),
    opponentDeck,
    opponent: {
      kind: "saved" as const,
      id: "saved-opponent",
      name: "Saved opponent",
      leaderId: LEADER.id,
      synthetic: false,
    },
    games: 6,
    cpuSkill: "level3" as const,
  };
}

const fakeMatch: typeof simulateMatch = (playerDeck, opponentDeck, options) => {
  const gameIndex = Math.round((options.seed - 1_001) / 97);
  const profile = playerDeck.id as VariantProfile;
  const playerWins =
    profile === "recommended"
      ? gameIndex < 4
      : profile === "consistency"
        ? gameIndex % 2 === 0
        : gameIndex === 1 || gameIndex === 5;
  const winner = playerWins ? "player" : "opponent";
  const firstPlayer = options.firstPlayer ?? "player";
  const cpuSkill = options.cpuSkill ?? "level1";
  const state = replayState();
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
      type: "turn_end",
      turn: 5,
      side: "player",
      payload: {},
      state: { ...state, playerDonAvailable: 6, playerDonUsed: 5 },
    },
    {
      index: 2,
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
    turns: 5 + (gameIndex % 2),
    reason: "leader_damage",
    playerLife: playerWins ? 2 : 0,
    opponentLife: playerWins ? 0 : 2,
    playerScore: playerWins ? 10 : 5,
    opponentScore: playerWins ? 5 : 10,
    log: [],
    contributions: [
      {
        cardId: "C-00",
        name: "Card C-00",
        side: "player",
        impact: 2,
        appearances: 1,
      },
    ],
    replay: {
      header: {
        schemaVersion: 1,
        seed: options.seed,
        rulesVersion: "test",
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
        turns: 5 + (gameIndex % 2),
        reason: "leader_damage",
        playerLife: playerWins ? 2 : 0,
        opponentLife: playerWins ? 0 : 2,
      },
    },
  } satisfies MatchResult;
};

function practiceDeck(id: string): PracticeDeck {
  const deck = strictDeckIntelligencePracticeDeck({
    id,
    name: id,
    leader: LEADER,
    cards: COPY_ENTRIES,
    poolById: poolById(DECK_CARDS),
    regulations: {},
  });
  return deck;
}

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

function poolById(cards: CardListItem[]): Map<string, CardListItem> {
  return new Map(cards.map((deckCard) => [deckCard.id, deckCard]));
}

function card(id: string, cardType: string, index: number): CardListItem {
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
  };
}
