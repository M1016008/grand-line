import test from "node:test";
import assert from "node:assert/strict";

import type { CardListItem } from "@/lib/cards";
import type { PracticeDeck } from "@/lib/practice-sim";
import { createAutoBattlePolicy } from "./auto-policy";
import { BattleEffectRegistry } from "./effect-registry";
import {
  createBattleState,
  declareLeaderAttack,
  endBattleTurn,
} from "./engine";
import {
  createHeadlessEnvironment,
  runHeadlessBatch,
  runHeadlessBattle,
} from "./headless-runner";
import {
  GOLDEN_BLOCKER,
  GOLDEN_BOUNCE,
  GOLDEN_DRAW,
  GOLDEN_KO,
  GOLDEN_ON_ATTACK,
  GOLDEN_REST,
  GOLDEN_RUSH,
  GOLDEN_SEARCH,
  GOLDEN_TRIGGER_DRAW,
} from "./golden-fixtures";

const PLAYER_LEADER = makeCard({
  id: "TEST-L-P",
  name: "Player Leader",
  cardType: "LEADER",
  cost: null,
  power: 5_000,
  life: 5,
});
const OPPONENT_LEADER = makeCard({
  id: "TEST-L-O",
  name: "Opponent Leader",
  cardType: "LEADER",
  cost: null,
  power: 5_000,
  life: 5,
});
const PLAYER_CARDS = makeVanillaPool("P");
const PLAYER_VARIANT_CARDS = makeVanillaPool("V");
const OPPONENT_CARDS = makeVanillaPool("O");
const PLAYER_DECK = makeDeck("player", PLAYER_LEADER, PLAYER_CARDS);
const PLAYER_VARIANT_DECK = makeDeck(
  "player-variant",
  PLAYER_LEADER,
  PLAYER_VARIANT_CARDS,
);
const OPPONENT_DECK = makeDeck("opponent", OPPONENT_LEADER, OPPONENT_CARDS);
const ALL_CARDS = [
  PLAYER_LEADER,
  OPPONENT_LEADER,
  ...PLAYER_CARDS,
  ...PLAYER_VARIANT_CARDS,
  ...OPPONENT_CARDS,
];

test("same decks, seed, and policies produce a byte-equivalent summary", () => {
  const options = {
    playerDeck: PLAYER_DECK,
    opponentDeck: OPPONENT_DECK,
    cards: ALL_CARDS,
    seed: 7_301,
    firstPlayer: "player" as const,
    playerPolicy: createAutoBattlePolicy("level4"),
    opponentPolicy: createAutoBattlePolicy("level3"),
    maxTurns: 8,
    traceMode: "summary" as const,
  };
  assert.equal(
    JSON.stringify(runHeadlessBattle(options)),
    JSON.stringify(runHeadlessBattle(options)),
  );
});

test("same seed creates the same initial zones", () => {
  const first = createBattleState(PLAYER_DECK, OPPONENT_DECK, 9_301);
  const second = createBattleState(PLAYER_DECK, OPPONENT_DECK, 9_301);
  assert.deepEqual(initialZoneIds(first, "player"), initialZoneIds(second, "player"));
  assert.deepEqual(
    initialZoneIds(first, "opponent"),
    initialZoneIds(second, "opponent"),
  );
});

test("player deck changes do not perturb the opponent RNG stream", () => {
  const baseline = createBattleState(PLAYER_DECK, OPPONENT_DECK, 4_201);
  const variant = createBattleState(PLAYER_VARIANT_DECK, OPPONENT_DECK, 4_201);
  assert.deepEqual(
    initialZoneIds(baseline, "opponent"),
    initialZoneIds(variant, "opponent"),
  );
});

test("opponent deck changes do not perturb the player RNG stream", () => {
  const baseline = createBattleState(PLAYER_DECK, OPPONENT_DECK, 4_202);
  const opponentVariant = makeDeck(
    "opponent-variant",
    OPPONENT_LEADER,
    PLAYER_VARIANT_CARDS,
  );
  const variant = createBattleState(PLAYER_DECK, opponentVariant, 4_202);
  assert.deepEqual(
    initialZoneIds(baseline, "player"),
    initialZoneIds(variant, "player"),
  );
});

test("first-player setup applies opening draw, DON, and attack timing symmetrically", () => {
  const registry = new BattleEffectRegistry(ALL_CARDS);
  for (const firstPlayer of ["player", "opponent"] as const) {
    const secondPlayer = firstPlayer === "player" ? "opponent" : "player";
    let state = createBattleState(PLAYER_DECK, OPPONENT_DECK, 91, {
      firstPlayer,
      choiceMode: "deferred",
    });
    assert.equal(state.activePlayer, firstPlayer);
    assert.equal(state[firstPlayer].hand.length, 5);
    assert.equal(state[firstPlayer].deck.length, 40);
    assert.equal(state[firstPlayer].donTotal, 1);
    assert.equal(
      declareLeaderAttack(state, firstPlayer, registry, "level3"),
      state,
    );
    state = endBattleTurn(state, firstPlayer);
    assert.equal(state.activePlayer, secondPlayer);
    assert.equal(state[secondPlayer].hand.length, 6);
    assert.equal(state[secondPlayer].deck.length, 39);
    assert.equal(state[secondPlayer].donTotal, 2);
    assert.equal(
      declareLeaderAttack(state, secondPlayer, registry, "level3"),
      state,
    );
    assert.equal(state.turnsTaken?.[firstPlayer], 1);
    assert.equal(state.turnsTaken?.[secondPlayer], 1);
    state = endBattleTurn(state, secondPlayer);
    assert.equal(
      declareLeaderAttack(state, firstPlayer, registry, "level3").pending?.type,
      "attack_target",
    );
  }
});

test("fixed-memory batch aggregates outcomes without retaining matches", () => {
  const batch = runHeadlessBatch({
    playerDeck: PLAYER_DECK,
    opponentDeck: OPPONENT_DECK,
    cards: ALL_CARDS,
    games: 12,
    seed: 2_000,
    alternateFirstPlayer: true,
    maxTurns: 3,
  });
  assert.equal(batch.games, 12);
  assert.equal(
    batch.outcomes.player + batch.outcomes.opponent + batch.outcomes.inconclusive,
    12,
  );
  assert.equal(
    Object.values(batch.reasons).reduce((sum, count) => sum + count, 0),
    12,
  );
});

test("N-game batch builds its precompiled environment exactly once", () => {
  let builds = 0;
  const batch = runHeadlessBatch(
    {
      playerDeck: PLAYER_DECK,
      opponentDeck: OPPONENT_DECK,
      cards: ALL_CARDS,
      games: 9,
      seed: 2_100,
      maxTurns: 3,
    },
    (input) => {
      builds += 1;
      return createHeadlessEnvironment(input);
    },
  );
  assert.equal(batch.games, 9);
  assert.equal(builds, 1);
});

test("precompiled and automatically compiled single matches are identical", () => {
  const options = {
    playerDeck: PLAYER_DECK,
    opponentDeck: OPPONENT_DECK,
    cards: ALL_CARDS,
    seed: 2_101,
    firstPlayer: "opponent" as const,
    maxTurns: 5,
    traceMode: "summary" as const,
  };
  const environment = createHeadlessEnvironment(options);
  assert.deepEqual(
    runHeadlessBattle({ ...options, environment }),
    runHeadlessBattle(options),
  );
});

test("shared precompiled environment has no state leakage between games", () => {
  const environment = createHeadlessEnvironment({
    playerDeck: PLAYER_DECK,
    opponentDeck: OPPONENT_DECK,
    cards: ALL_CARDS,
  });
  const options = {
    playerDeck: PLAYER_DECK,
    opponentDeck: OPPONENT_DECK,
    cards: ALL_CARDS,
    firstPlayer: "player" as const,
    maxTurns: 5,
    traceMode: "full" as const,
    environment,
  };
  const baseline = runHeadlessBattle({ ...options, seed: 2_102 });
  runHeadlessBattle({ ...options, seed: 2_103 });
  assert.deepEqual(runHeadlessBattle({ ...options, seed: 2_102 }), baseline);
});

test("Trigger metrics separate encounter status from supported resolution", async (t) => {
  const supportedTrigger = makeCard({
    id: "TEST-TRIGGER-SUPPORTED",
    name: "Supported Trigger",
    cardType: "EVENT",
    power: null,
    mechanics: ["Trigger"],
    triggerText: "[トリガー]カード1枚を引く。",
    hasTrigger: true,
  });
  const partialTrigger = makeCard({
    ...supportedTrigger,
    id: "TEST-TRIGGER-PARTIAL",
    name: "Partial Trigger",
    effectText: "[カウンター]未対応のカウンター効果。",
  });
  const unsupportedTrigger = makeCard({
    ...supportedTrigger,
    id: "TEST-TRIGGER-UNSUPPORTED",
    name: "Unsupported Trigger",
    triggerText: "[トリガー]裁定条件を安全に構造化できない効果。",
  });
  const cases = [
    {
      card: supportedTrigger,
      expected: { supported: 1, partial: 0, unsupported: 0 },
    },
    {
      card: partialTrigger,
      expected: { supported: 0, partial: 1, unsupported: 0 },
    },
    {
      card: unsupportedTrigger,
      expected: { supported: 0, partial: 0, unsupported: 1 },
    },
  ];

  for (const scenario of cases) {
    await t.test(
      `${scenario.card.name}: resolved/partial/unsupported metrics stay exclusive`,
      () => {
        const result = findScenario(
          featureDeck(`trigger-attacker-${scenario.card.id}`, PLAYER_LEADER, []),
          featureDeck(
            `trigger-defender-${scenario.card.id}`,
            OPPONENT_LEADER,
            [scenario.card],
            1,
          ),
          (candidate) => candidate.stats.triggersRevealed === 1,
          "level1",
        );
        assert.ok(result, `${scenario.card.name} was not revealed`);
        assert.equal(
          result.stats.supportedEffectsResolved,
          scenario.expected.supported,
          scenario.card.name,
        );
        assert.equal(
          result.stats.partialEffectsEncountered,
          scenario.expected.partial,
          scenario.card.name,
        );
        assert.equal(
          result.stats.unsupportedEffectsEncountered,
          scenario.expected.unsupported,
          scenario.card.name,
        );
      },
    );
  }
});

test("auto policy uses the minimum legal Counter and skips harmful optional targets", () => {
  const counter1 = makeCard({ id: "TEST-C1000", name: "Counter 1000", counter: 1_000 });
  const counter2 = makeCard({ id: "TEST-C2000", name: "Counter 2000", counter: 2_000 });
  const noCounter = makeCard({ id: "TEST-C0000", name: "No Counter", counter: 0 });
  const policy = createAutoBattlePolicy("level5");
  const state = createBattleState(PLAYER_DECK, OPPONENT_DECK, 301, {
    choiceMode: "deferred",
  });
  state.player.hand = [counter1, counter2, noCounter];
  state.pending = {
    type: "defense",
    attacker: "opponent",
    defender: "player",
    attackerName: "attacker",
    attackPower: 6_000,
    target: {
      owner: "player",
      zone: "leader",
      instanceId: "player:leader",
      cardId: PLAYER_LEADER.id,
      label: "Player Leader",
    },
    blockerOptions: [],
    counterPower: 0,
  };
  assert.equal(policy.chooseCounterCard(state, state.pending), 1);

  const ownTarget = {
    owner: "player" as const,
    zone: "character" as const,
    instanceId: "own-character",
    cardId: counter1.id,
    label: counter1.name,
  };
  assert.equal(
    policy.chooseEffectTarget(state, {
      type: "effect_target",
      actor: "player",
      sourceCardId: "TEST-SOURCE",
      sourceName: "source",
      action: {
        type: "ko",
        target: {
          owner: "own",
          zones: ["character"],
          count: 1,
          optional: true,
        },
      },
      remainingActions: [],
      legalTargets: [ownTarget],
      trigger: "on_play",
    }),
    null,
  );
});

test("turn limit is always inconclusive and never creates a heuristic winner", () => {
  const result = runHeadlessBattle({
    playerDeck: PLAYER_DECK,
    opponentDeck: OPPONENT_DECK,
    cards: ALL_CARDS,
    seed: 100,
    firstPlayer: "opponent",
    maxTurns: 1,
  });
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "turn_limit");
});

test("action and pending guards fail closed as engine_guard", () => {
  const result = runHeadlessBattle({
    playerDeck: PLAYER_DECK,
    opponentDeck: OPPONENT_DECK,
    cards: ALL_CARDS,
    seed: 101,
    firstPlayer: "player",
    maxActionsPerTurn: 1,
    maxPendingResolutions: 1,
  });
  assert.equal(result.outcome, "inconclusive");
  assert.equal(result.reason, "engine_guard");
});

test("trace modes avoid full event retention unless explicitly requested", () => {
  const common = {
    playerDeck: PLAYER_DECK,
    opponentDeck: OPPONENT_DECK,
    cards: ALL_CARDS,
    seed: 102,
    firstPlayer: "player" as const,
    maxTurns: 2,
  };
  const none = runHeadlessBattle({ ...common, traceMode: "none" });
  const summary = runHeadlessBattle({ ...common, traceMode: "summary" });
  const full = runHeadlessBattle({ ...common, traceMode: "full" });
  assert.equal(none.trace, undefined);
  assert.ok((summary.trace?.length ?? 0) > 0);
  assert.ok((full.trace?.length ?? 0) > (summary.trace?.length ?? 0));
  assert.equal(
    summary.trace?.every((event) =>
      ["battle_start", "turn_start", "turn_end", "game_end", "guard"].includes(
        event.type,
      ),
    ),
    true,
  );
});

test("every completed headless transition conserves all card zones", () => {
  const result = runHeadlessBattle({
    playerDeck: PLAYER_DECK,
    opponentDeck: OPPONENT_DECK,
    cards: ALL_CARDS,
    seed: 103,
    firstPlayer: "player",
    maxTurns: 6,
    traceMode: "full",
  });
  assert.notEqual(result.reason, "engine_guard");
  for (const event of result.trace ?? []) {
    if (!event.state) continue;
    assert.equal(sideTotal(event.state.player), 50);
    assert.equal(sideTotal(event.state.opponent), 50);
  }
});

test("golden rules scenarios occur through complete headless match flows", async (t) => {
  const effectLeader = makeCard({
    id: "TEST-L-EFFECT",
    name: "OnAttack Leader",
    cardType: "LEADER",
    cost: null,
    power: 5_000,
    life: 5,
    mechanics: ["OnAttack"],
    effectText:
      "[アタック時]自分のリーダーかキャラ1枚までを、このターン中、パワー+2000。",
  });
  const target = makeCard({
    id: "TEST-TARGET-7000",
    name: "Legal effect target",
    cost: 2,
    power: 7_000,
  });
  const searchHit = makeCard({
    id: "TEST-SEARCH-HIT",
    name: "モンキー・D・ルフィ",
    cost: 10,
    features: ["麦わらの一味"],
  });

  await t.test("Rush and DON power produce a same-turn Character attack", () => {
    const result = findScenario(
      featureDeck("rush", effectLeader, [GOLDEN_RUSH]),
      featureDeck("rush-target", OPPONENT_LEADER, [target]),
      (candidate) => {
        const played = candidate.trace?.find(
          (event) => event.type === "play_card" && event.cardId === GOLDEN_RUSH.id,
        );
        const attacked = candidate.trace?.find(
          (event) =>
            event.type === "attack_declared" &&
            event.cardId === GOLDEN_RUSH.id &&
            event.turn === played?.turn,
        );
        return Boolean(played && attacked && candidate.stats.donAttached > 0);
      },
    );
    assert.ok(result);
  });

  for (const scenario of [
    { name: "OnPlay Draw", card: GOLDEN_DRAW, action: "draw" },
    { name: "KO", card: GOLDEN_KO, action: "ko" },
    { name: "Rest", card: GOLDEN_REST, action: "rest" },
    { name: "Bounce", card: GOLDEN_BOUNCE, action: "return_to_hand" },
  ] as const) {
    await t.test(scenario.name, () => {
      const result = findScenario(
        featureDeck(`effect-${scenario.action}`, effectLeader, [scenario.card]),
        featureDeck(`target-${scenario.action}`, OPPONENT_LEADER, [target]),
        (candidate) =>
          candidate.trace?.some(
            (event) =>
              (event.type === "effect_target" &&
                event.cardId === scenario.card.id &&
                event.details?.action === scenario.action) ||
              (event.type === "play_card" &&
                event.cardId === scenario.card.id &&
                String(event.details?.actions).includes(scenario.action)),
          ) ?? false,
      );
      assert.ok(result, `${scenario.name} did not occur in fixed-seed matches`);
    });
  }

  await t.test("Search resolves through the pending choice pipeline", () => {
    const result = findScenario(
      featureDeck("search", effectLeader, [GOLDEN_SEARCH, searchHit], 12),
      featureDeck("search-target", OPPONENT_LEADER, [target]),
      (candidate) =>
        candidate.stats.searchesResolved > 0 &&
        Boolean(
          candidate.trace?.some(
            (event) => event.type === "search_choice" && event.cardId === GOLDEN_SEARCH.id,
          ),
        ),
    );
    assert.ok(result);
  });

  await t.test("Trigger resolves through a deterministic policy choice", () => {
    const triggerDeck = featureDeck(
      "trigger",
      OPPONENT_LEADER,
      [GOLDEN_TRIGGER_DRAW],
    );
    const triggerAttacker = featureDeck(
      "trigger-attacker",
      effectLeader,
      [GOLDEN_ON_ATTACK],
    );
    const triggerSeeds = Array.from({ length: 120 }, (_, index) => index + 1).filter(
      (seed) =>
        createBattleState(triggerAttacker, triggerDeck, seed).opponent.lifeCards.some(
          (card) => card.id === GOLDEN_TRIGGER_DRAW.id,
        ),
    );
    const seededTriggerLifeCount = triggerSeeds.length;
    assert.ok(seededTriggerLifeCount > 0);
    const result = findScenario(
      triggerAttacker,
      triggerDeck,
      (candidate) =>
        candidate.stats.triggersRevealed > 0 &&
        candidate.stats.triggersActivated > 0 &&
        Boolean(
          candidate.trace?.some(
            (event) =>
              event.type === "trigger_choice" &&
              event.cardId === GOLDEN_TRIGGER_DRAW.id,
          ),
        ),
      "level1",
    );
    const diagnostic = runHeadlessBattle({
      playerDeck: triggerAttacker,
      opponentDeck: triggerDeck,
      cards: [
        triggerAttacker.leader,
        triggerDeck.leader,
        ...triggerAttacker.entries.map((entry) => entry.card),
        ...triggerDeck.entries.map((entry) => entry.card),
      ],
      seed: triggerSeeds[0] ?? 1,
      firstPlayer: "player",
      playerPolicy: createAutoBattlePolicy("level5"),
      opponentPolicy: createAutoBattlePolicy("level1"),
      maxTurns: 10,
      traceMode: "full",
    });
    assert.ok(
      result,
      JSON.stringify({
        triggerSeed: triggerSeeds[0],
        stats: diagnostic.stats,
        outcome: diagnostic.outcome,
        reason: diagnostic.reason,
        triggerEvents: diagnostic.trace?.filter((event) =>
          ["trigger_choice", "attack_resolved"].includes(event.type),
        ),
      }),
    );
  });

  await t.test("Blocker and real hand Counter are consumed through Kernel APIs", () => {
    const defending = featureDeck(
      "defense",
      OPPONENT_LEADER,
      [GOLDEN_BLOCKER],
      16,
    );
    const result = findScenario(
      featureDeck("defense-attacker", effectLeader, [GOLDEN_ON_ATTACK]),
      defending,
      (candidate) =>
        candidate.stats.blockersUsed > 0 &&
        candidate.stats.counterCardsUsed > 0 &&
        candidate.stats.counterPowerUsed > 0,
    );
    assert.ok(result);
  });

  await t.test("Leader OnAttack is resolved by the attack pipeline", () => {
    const result = findScenario(
      featureDeck("leader-effect", effectLeader, [GOLDEN_ON_ATTACK]),
      featureDeck("leader-target", OPPONENT_LEADER, [target]),
      (candidate) =>
        candidate.stats.leaderAttacks > 0 &&
        candidate.playerCoverage.leaderStatus === "supported" &&
        candidate.stats.supportedEffectsResolved > 0,
    );
    assert.ok(result);
  });

  await t.test("partial and unsupported encounters stay explicit", () => {
    const unsupported = makeCard({
      id: "TEST-UNSUPPORTED-ONPLAY",
      name: "Unsupported OnPlay",
      mechanics: ["OnPlay"],
      effectText: "[登場時]裁定条件を安全に構造化できない効果。",
    });
    const partialAttacker = featureDeck(
      "partial-attacker",
      effectLeader,
      [GOLDEN_ON_ATTACK],
    );
    const partialDefender = featureDeck(
      "partial-trigger",
      OPPONENT_LEADER,
      [GOLDEN_TRIGGER_DRAW],
    );
    const partialResult = findScenario(
      partialAttacker,
      partialDefender,
      (candidate) => candidate.stats.partialEffectsEncountered > 0,
      "level1",
    );
    const unsupportedResult = findScenario(
      featureDeck("unsupported", effectLeader, [unsupported]),
      featureDeck("unsupported-target", OPPONENT_LEADER, [target]),
      (candidate) => candidate.stats.unsupportedEffectsEncountered > 0,
    );
    assert.ok(partialResult);
    assert.ok(unsupportedResult);
  });

  await t.test("deck-out is immediate inside the headless match", () => {
    const tinyPlayer = tinyDeck(PLAYER_LEADER);
    const result = runHeadlessBattle({
      playerDeck: tinyPlayer,
      opponentDeck: featureDeck("deck-out-opponent", OPPONENT_LEADER, []),
      cards: [
        tinyPlayer.leader,
        ...tinyPlayer.entries.map((entry) => entry.card),
        OPPONENT_LEADER,
        ...featureDeck("deck-out-opponent", OPPONENT_LEADER, []).entries.map(
          (entry) => entry.card,
        ),
      ],
      seed: 55,
      firstPlayer: "opponent",
      traceMode: "full",
      maxTurns: 3,
    });
    assert.equal(result.outcome, "opponent");
    assert.equal(result.reason, "deck_out");
    assert.equal(result.stats.deckOut, 1);
  });
});

function initialZoneIds(
  state: ReturnType<typeof createBattleState>,
  owner: "player" | "opponent",
) {
  const side = state[owner];
  return {
    hand: side.hand.map((card) => card.id),
    life: side.lifeCards.map((card) => card.id),
    deck: side.deck.map((card) => card.id),
  };
}

function sideTotal(side: {
  deck: number;
  hand: number;
  life: number;
  characters: number;
  stage: number;
  trash: number;
  resolving: number;
}): number {
  return (
    side.deck +
    side.hand +
    side.life +
    side.characters +
    side.stage +
    side.trash +
    side.resolving
  );
}

function makeVanillaPool(prefix: string): CardListItem[] {
  return Array.from({ length: 13 }, (_, index) =>
    makeCard({
      id: `TEST-${prefix}-${String(index + 1).padStart(3, "0")}`,
      name: `${prefix} card ${index + 1}`,
      cost: (index % 6) + 1,
      power: ((index % 6) + 2) * 1_000,
      counter: index % 2 === 0 ? 1_000 : 2_000,
    }),
  );
}

function makeDeck(
  id: string,
  leader: CardListItem,
  cards: CardListItem[],
): PracticeDeck {
  return {
    id,
    name: id,
    leader,
    source: "generated",
    totalCards: 50,
    entries: cards.map((card, index) => ({
      card,
      count: index < 11 ? 4 : 3,
    })),
  };
}

function featureDeck(
  id: string,
  leader: CardListItem,
  featured: CardListItem[],
  featuredCopies = 4,
): PracticeDeck {
  const entries: PracticeDeck["entries"] = [];
  let remaining = 50;
  for (const card of featured) {
    const count = Math.min(featuredCopies, remaining);
    entries.push({ card, count });
    remaining -= count;
  }
  let index = 0;
  while (remaining > 0) {
    const count = Math.min(4, remaining);
    entries.push({
      card: makeCard({
        id: `TEST-${id.toUpperCase()}-FILLER-${index}`,
        name: `${id} filler ${index}`,
        cost: 10,
        power: 1_000,
        counter: 2_000,
      }),
      count,
    });
    remaining -= count;
    index += 1;
  }
  return {
    id,
    name: id,
    leader,
    entries,
    source: "generated",
    totalCards: 50,
  };
}

function tinyDeck(leader: CardListItem): PracticeDeck {
  const cards = Array.from({ length: 7 }, (_, index) =>
    makeCard({ id: `TEST-TINY-${index}`, name: `tiny ${index}`, cost: 10 }),
  );
  return {
    id: "tiny",
    name: "tiny",
    leader: { ...leader, life: 1 },
    entries: cards.map((card) => ({ card, count: 1 })),
    source: "generated",
    totalCards: 7,
  };
}

function findScenario(
  playerDeck: PracticeDeck,
  opponentDeck: PracticeDeck,
  predicate: (result: ReturnType<typeof runHeadlessBattle>) => boolean,
  opponentSkill: "level1" | "level2" | "level3" | "level4" | "level5" = "level5",
) {
  const cards = [
    playerDeck.leader,
    opponentDeck.leader,
    ...playerDeck.entries.map((entry) => entry.card),
    ...opponentDeck.entries.map((entry) => entry.card),
  ];
  for (let seed = 1; seed <= 120; seed++) {
    const result = runHeadlessBattle({
      playerDeck,
      opponentDeck,
      cards,
      seed,
      firstPlayer: seed % 2 === 0 ? "player" : "opponent",
      playerPolicy: createAutoBattlePolicy("level5"),
      opponentPolicy: createAutoBattlePolicy(opponentSkill),
      maxTurns: 10,
      traceMode: "full",
    });
    if (predicate(result)) return result;
  }
  return null;
}

function makeCard(input: Partial<CardListItem> & Pick<CardListItem, "id" | "name">): CardListItem {
  return {
    cardType: "CHARACTER",
    setCode: "TEST",
    colors: ["red"],
    attributes: [],
    features: [],
    mechanics: [],
    cost: 1,
    power: 2_000,
    counter: 1_000,
    life: null,
    rarity: null,
    hasTrigger: false,
    imageUrlJp: null,
    effectText: null,
    triggerText: null,
    source: "official_jp",
    verified: true,
    ...input,
  };
}
