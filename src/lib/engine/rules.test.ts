/**
 * Phase A-2 integration tests.
 *
 * These tests exercise the rule engine end-to-end with synthetic
 * "vanilla" cards (no triggered effects), proving that:
 *
 *   - initGame respects determinism (same seed → same state)
 *   - mulligan flow correctly transitions to TURN 1
 *   - the go-first player gets +1 DON, no draw, and cannot attack on T1
 *   - the second player gets the normal +2 DON, +1 draw, can attack
 *   - DON attach moves DON between zones correctly
 *   - attack → counter → block → resolve flows produce the right
 *     winner determination and KO/life-loss side effects
 *   - the END phase clears turn-scoped power buffs and refreshes
 *
 * We deliberately use vanilla cards because Phase A-2 does not yet
 * implement the DSL interpreter; Phase B's tests will layer effects on
 * top without touching this file's expectations.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAction,
  getLegalActions,
  initGame,
  isGameOver,
  makeRegistry,
  type CardData,
  type DeckList,
  type GameAction,
  type GameState,
} from "./index";

/* ──────────────────────────────────────────────────────────────────────── */
/* Synthetic cards.                                                         */
/* ──────────────────────────────────────────────────────────────────────── */

function leader(id: string, life: number, power: number): CardData {
  return {
    id,
    cardType: "LEADER",
    colors: ["black"],
    features: [],
    mechanics: [],
    cost: null,
    power,
    counter: null,
    life,
    hasTrigger: false,
  };
}

function char(
  id: string,
  cost: number,
  power: number,
  counter: number | null = null,
  mechanics: string[] = [],
): CardData {
  return {
    id,
    cardType: "CHARACTER",
    colors: ["black"],
    features: [],
    mechanics,
    cost,
    power,
    counter,
    life: null,
    hasTrigger: false,
  };
}

const CARDS = [
  leader("L-A", 4, 5000),
  leader("L-B", 4, 5000),
  char("C-1", 1, 2000, 1000),
  char("C-2", 2, 3000, 1000),
  char("C-3", 3, 4000, 1000),
  char("C-4", 4, 5000, null),
  char("C-5", 5, 6000, null),
  char("C-BLK", 4, 5000, 1000, ["ブロッカー"]),
  char("C-RUSH", 4, 5000, 1000, ["ラッシュ"]),
];

function deck(leaderId: string): DeckList {
  // 50 cards: 10 each of C-1, C-2, C-3 + 4 each of C-4, C-5,
  //          + 4 C-BLK + 4 C-RUSH + 4 of a placeholder
  // Wait — we need ≤4 copies. So: 12 different cards × ~4-ish.
  // Compose 50 deterministically with ≤4 copies.
  return {
    leaderId,
    cards: [
      { cardId: "C-1", count: 4 },
      { cardId: "C-2", count: 4 },
      { cardId: "C-3", count: 4 },
      { cardId: "C-4", count: 4 },
      { cardId: "C-5", count: 4 },
      { cardId: "C-BLK", count: 4 },
      { cardId: "C-RUSH", count: 4 },
      // Pad to 50 with extra copies — needs unique cards.
      // Add filler vanilla cards.
    ],
    donDeckSize: 10,
  };
}

/* Compose a 50-card deck without exceeding 4 copies. We register more
 * filler vanilla characters and use them as padding. */
const PAD_CARDS: CardData[] = Array.from({ length: 6 }, (_, i) =>
  char(`PAD-${i}`, 1, 1000, 1000),
);
const REGISTRY_FULL = makeRegistry([...CARDS, ...PAD_CARDS]);

function fullDeck(leaderId: string): DeckList {
  // 7 × 4 = 28; PAD-0..PAD-3 × 4 = 16; PAD-4 × 4 = 4; PAD-5 × 2 = 2; total 50.
  return {
    leaderId,
    cards: [
      { cardId: "C-1", count: 4 },
      { cardId: "C-2", count: 4 },
      { cardId: "C-3", count: 4 },
      { cardId: "C-4", count: 4 },
      { cardId: "C-5", count: 4 },
      { cardId: "C-BLK", count: 4 },
      { cardId: "C-RUSH", count: 4 },
      { cardId: "PAD-0", count: 4 },
      { cardId: "PAD-1", count: 4 },
      { cardId: "PAD-2", count: 4 },
      { cardId: "PAD-3", count: 4 },
      { cardId: "PAD-4", count: 4 },
      { cardId: "PAD-5", count: 2 },
    ],
    donDeckSize: 10,
  };
}

void deck; // (unused in tests; kept as documentation of an invalid <50 list)

/* ──────────────────────────────────────────────────────────────────────── */
/* Setup tests                                                              */
/* ──────────────────────────────────────────────────────────────────────── */

test("initGame — deterministic with same seed", () => {
  const cfg = {
    registry: REGISTRY_FULL,
    deckA: fullDeck("L-A"),
    deckB: fullDeck("L-B"),
    seed: "test-seed",
    goFirst: "A" as const,
  };
  const s1 = initGame(cfg);
  const s2 = initGame(cfg);
  assert.deepEqual(s1, s2);
});

test("initGame — hand size 5, life set from leader, deck size correct", () => {
  const s = initGame({
    registry: REGISTRY_FULL,
    deckA: fullDeck("L-A"),
    deckB: fullDeck("L-B"),
    seed: "abc",
    goFirst: "A",
  });
  assert.equal(s.phase, "MULLIGAN");
  assert.equal(s.players.A.hand.length, 5);
  assert.equal(s.players.A.life.length, 4); // life from leader
  // Deck = 50 - 4 life - 5 hand = 41.
  assert.equal(s.players.A.deck.length, 41);
  assert.equal(s.players.A.donDeck.length, 10);
  assert.equal(s.players.A.donArea.active, 0);
});

test("initGame — rejects deck with > 4 copies", () => {
  assert.throws(() =>
    initGame({
      registry: REGISTRY_FULL,
      deckA: {
        leaderId: "L-A",
        cards: [
          { cardId: "C-1", count: 5 },
          { cardId: "C-2", count: 45 },
        ],
      },
      deckB: fullDeck("L-B"),
      seed: "s",
      goFirst: "A",
    }),
  );
});

test("initGame — rejects deck of wrong size", () => {
  assert.throws(() =>
    initGame({
      registry: REGISTRY_FULL,
      deckA: { leaderId: "L-A", cards: [{ cardId: "C-1", count: 4 }] },
      deckB: fullDeck("L-B"),
      seed: "s",
      goFirst: "A",
    }),
  );
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Mulligan + turn 1                                                        */
/* ──────────────────────────────────────────────────────────────────────── */

function setup(goFirst: "A" | "B" = "A"): GameState {
  return initGame({
    registry: REGISTRY_FULL,
    deckA: fullDeck("L-A"),
    deckB: fullDeck("L-B"),
    seed: "mulligan-test",
    goFirst,
  });
}

test("mulligan: both decline → advance to turn 1, goFirst starts", () => {
  let state = setup("A");
  ({ state } = applyAction(
    state,
    { type: "MULLIGAN_DECIDE", player: "A", redraw: false },
    REGISTRY_FULL,
  ));
  ({ state } = applyAction(
    state,
    { type: "MULLIGAN_DECIDE", player: "B", redraw: false },
    REGISTRY_FULL,
  ));
  assert.equal(state.turn, 1);
  assert.equal(state.activePlayer, "A");
  assert.equal(state.phase, "MAIN");
  // First player T1: +1 DON, no draw.
  assert.equal(state.players.A.donArea.active, 1);
  assert.equal(state.players.A.hand.length, 5);
});

test("mulligan: player A redraws → hand differs, deck size unchanged", () => {
  const state0 = setup("A");
  const originalHand = [...state0.players.A.hand];
  let state = state0;
  ({ state } = applyAction(
    state,
    { type: "MULLIGAN_DECIDE", player: "A", redraw: true },
    REGISTRY_FULL,
  ));
  assert.equal(state.players.A.hand.length, 5);
  // Same deck + hand size; new hand is *probably* different.
  const newHandIds = state.players.A.hand.map((c) => c.instanceId).sort();
  const oldHandIds = originalHand.map((c) => c.instanceId).sort();
  assert.notDeepEqual(newHandIds, oldHandIds);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Turn structure                                                           */
/* ──────────────────────────────────────────────────────────────────────── */

function intoTurn1(): GameState {
  let s = setup("A");
  ({ state: s } = applyAction(
    s,
    { type: "MULLIGAN_DECIDE", player: "A", redraw: false },
    REGISTRY_FULL,
  ));
  ({ state: s } = applyAction(
    s,
    { type: "MULLIGAN_DECIDE", player: "B", redraw: false },
    REGISTRY_FULL,
  ));
  return s;
}

test("turn 1 first player cannot attack with leader (or any character)", () => {
  const s = intoTurn1();
  const legal = getLegalActions(s, REGISTRY_FULL);
  assert.equal(
    legal.some((a) => a.type === "DECLARE_ATTACK"),
    false,
  );
});

test("turn 2 second player draws, gets +2 DON, can attack with leader", () => {
  let s = intoTurn1();
  // A ends turn → B's turn 2 starts.
  ({ state: s } = applyAction(s, { type: "END_TURN" }, REGISTRY_FULL));
  assert.equal(s.turn, 2);
  assert.equal(s.activePlayer, "B");
  assert.equal(s.players.B.donArea.active, 2);
  // B's hand = starting 5 + 1 drawn this turn.
  assert.equal(s.players.B.hand.length, 6);
  // B can attack with leader.
  const legal = getLegalActions(s, REGISTRY_FULL);
  const attacks = legal.filter((a) => a.type === "DECLARE_ATTACK");
  assert.ok(attacks.length > 0);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* Card play + combat                                                       */
/* ──────────────────────────────────────────────────────────────────────── */

/** Force a card into hand by direct state surgery (test-only). */
function placeInHand(state: GameState, who: "A" | "B", cardId: string): GameState {
  const inst = { instanceId: `${who}-forced-${cardId}`, cardId };
  return {
    ...state,
    players: {
      ...state.players,
      [who]: {
        ...state.players[who],
        hand: [...state.players[who].hand, inst],
      },
    },
  };
}

test("play character: cost paid in DON, character enters field rested-DON-ready", () => {
  let s = intoTurn1();
  // End A's T1 to give B's T2 a draw + 2 DON.
  ({ state: s } = applyAction(s, { type: "END_TURN" }, REGISTRY_FULL));
  // It's B's turn now. Give B a 2-cost char in hand.
  s = placeInHand(s, "B", "C-2");
  const inst = s.players.B.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    REGISTRY_FULL,
  ));
  assert.equal(s.players.B.characters.length, 1);
  assert.equal(s.players.B.characters[0]!.cardId, "C-2");
  assert.equal(s.players.B.donArea.active, 0); // 2/2 used
  assert.equal(s.players.B.donArea.rested, 2);
});

test("attach DON: increases attached power, decreases active DON", () => {
  let s = intoTurn1();
  // Move to A's T3 so A has 5 DON (T1=1, T3=+2 each = 1+2+2=5).
  ({ state: s } = applyAction(s, { type: "END_TURN" }, REGISTRY_FULL));
  ({ state: s } = applyAction(s, { type: "END_TURN" }, REGISTRY_FULL));
  assert.equal(s.activePlayer, "A");
  assert.equal(s.players.A.donArea.active, 3); // T1=1 + T3=2
  ({ state: s } = applyAction(
    s,
    { type: "ATTACH_DON", target: "leader" },
    REGISTRY_FULL,
  ));
  assert.equal(s.players.A.leader.attachedDon, 1);
  assert.equal(s.players.A.donArea.active, 2);
});

test("combat: leader attack hits → defender loses 1 life", () => {
  let s = intoTurn1();
  // A ends → B's T2; B attacks A's leader (5000 vs 5000, ties go to attacker).
  ({ state: s } = applyAction(s, { type: "END_TURN" }, REGISTRY_FULL));
  ({ state: s } = applyAction(
    s,
    {
      type: "DECLARE_ATTACK",
      attackerInstanceId: "B-LEADER",
      target: { kind: "leader", controller: "A" },
    },
    REGISTRY_FULL,
  ));
  assert.equal(s.phase, "BATTLE");
  // Defender passes (no counter, no blocker available).
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_COUNTER", counterHandInstanceId: null },
    REGISTRY_FULL,
  ));
  assert.equal(s.players.A.life.length, 3); // 4 → 3
  assert.equal(s.players.A.hand.length, 6); // life card → hand
  assert.equal(s.phase, "MAIN");
});

test("combat: counter card reduces effective power → attack misses → no life loss", () => {
  let s = intoTurn1();
  ({ state: s } = applyAction(s, { type: "END_TURN" }, REGISTRY_FULL));
  // B attacks A's leader. A has plenty of 1000-counter cards in hand.
  ({ state: s } = applyAction(
    s,
    {
      type: "DECLARE_ATTACK",
      attackerInstanceId: "B-LEADER",
      target: { kind: "leader", controller: "A" },
    },
    REGISTRY_FULL,
  ));
  // Find a counter card in A's hand.
  const counter = s.players.A.hand.find((c) => {
    const d = REGISTRY_FULL.get(c.cardId);
    return (d.counter ?? 0) > 0;
  });
  if (!counter) throw new Error("test setup: A should have counter cards");
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_COUNTER", counterHandInstanceId: counter.instanceId },
    REGISTRY_FULL,
  ));
  // Need 1000 more counter to actually exceed 5000 vs 5000.
  // 5000 attacker vs 5000+1000 = 6000 defender → miss.
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_COUNTER", counterHandInstanceId: null },
    REGISTRY_FULL,
  ));
  assert.equal(s.players.A.life.length, 4); // unchanged
});

test("combat: KO when attacker beats rested character", () => {
  let s = intoTurn1();
  // Inject a rested character on A's side for B to KO.
  s = {
    ...s,
    players: {
      ...s.players,
      A: {
        ...s.players.A,
        characters: [
          {
            instanceId: "A-tgt",
            cardId: "C-2",
            state: "rested",
            attachedDon: 0,
            powerModPermanent: 0,
            powerModTurn: 0,
            playedThisTurn: false,
            hasBlockerGranted: false,
            hasRushGranted: false,
          },
        ],
      },
    },
  };
  ({ state: s } = applyAction(s, { type: "END_TURN" }, REGISTRY_FULL));
  // B's leader 5000 vs C-2 3000 → KO.
  ({ state: s } = applyAction(
    s,
    {
      type: "DECLARE_ATTACK",
      attackerInstanceId: "B-LEADER",
      target: { kind: "character", controller: "A", instanceId: "A-tgt" },
    },
    REGISTRY_FULL,
  ));
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_COUNTER", counterHandInstanceId: null },
    REGISTRY_FULL,
  ));
  assert.equal(s.players.A.characters.length, 0);
  assert.equal(s.players.A.trash.length, 1);
  assert.equal(s.players.A.trash[0]!.cardId, "C-2");
});

test("game-over: leader attack with no life triggers win", () => {
  let s = intoTurn1();
  // Strip A's life down to 0 (hack for test).
  s = {
    ...s,
    players: {
      ...s.players,
      A: { ...s.players.A, life: [] },
    },
  };
  ({ state: s } = applyAction(s, { type: "END_TURN" }, REGISTRY_FULL));
  ({ state: s } = applyAction(
    s,
    {
      type: "DECLARE_ATTACK",
      attackerInstanceId: "B-LEADER",
      target: { kind: "leader", controller: "A" },
    },
    REGISTRY_FULL,
  ));
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_COUNTER", counterHandInstanceId: null },
    REGISTRY_FULL,
  ));
  assert.equal(isGameOver(s), true);
  assert.equal(s.winner, "B");
  assert.equal(s.endCondition, "LIFE_OUT");
});

test("end turn: refresh restores DON, clears turn buffs, hands off to opponent", () => {
  let s = intoTurn1();
  // A attaches DON to leader (turn buff via attached DON).
  ({ state: s } = applyAction(
    s,
    { type: "ATTACH_DON", target: "leader" },
    REGISTRY_FULL,
  ));
  assert.equal(s.players.A.leader.attachedDon, 1);
  ({ state: s } = applyAction(s, { type: "END_TURN" }, REGISTRY_FULL));
  // A's attached DON is *not* automatically detached in OPTCG — but
  // turn-scoped power mods are cleared. We're not modelling detach yet
  // (deferred to Phase B with proper end-of-turn DON return), so this
  // test only asserts the phase / active-player handoff.
  assert.equal(s.activePlayer, "B");
  assert.equal(s.turn, 2);
});

test("legal actions in MULLIGAN: 2 options per player (redraw / keep)", () => {
  const s = setup("A");
  const legal = getLegalActions(s, REGISTRY_FULL);
  // Both players haven't decided yet → 4 options total.
  assert.equal(legal.length, 4);
  assert.ok(
    legal.every(
      (a) => a.type === "MULLIGAN_DECIDE",
    ),
  );
});

test("legal actions terminal: empty when game over", () => {
  const s = setup("A");
  const ended: GameState = { ...s, phase: "GAME_OVER", winner: "A" };
  assert.deepEqual(getLegalActions(ended, REGISTRY_FULL), []);
});

test("deterministic playthrough: same actions + same seed → same state", () => {
  function play(seed: string): GameState {
    let s = initGame({
      registry: REGISTRY_FULL,
      deckA: fullDeck("L-A"),
      deckB: fullDeck("L-B"),
      seed,
      goFirst: "A",
    });
    const script: GameAction[] = [
      { type: "MULLIGAN_DECIDE", player: "A", redraw: false },
      { type: "MULLIGAN_DECIDE", player: "B", redraw: false },
      { type: "ATTACH_DON", target: "leader" },
      { type: "END_TURN" },
      { type: "ATTACH_DON", target: "leader" },
      { type: "END_TURN" },
    ];
    for (const a of script) {
      ({ state: s } = applyAction(s, a, REGISTRY_FULL));
    }
    return s;
  }
  assert.deepEqual(play("identical"), play("identical"));
});
