/**
 * Phase B-2 tests — non-ON_PLAY triggers and remaining DSL actions.
 *
 *   - ON_KO fires when a character is KO'd in combat
 *   - TRIGGER fires when a life card is revealed and has TRIGGER effect
 *   - PLAY_EVENT runs ON_PLAY then sends card to trash
 *   - PLAY_STAGE places card in stage area, replaces existing stage
 *   - ACTIVATE_EFFECT pays cost and resolves ACTIVATE_MAIN
 *   - WHEN_ATTACKING / WHEN_ATTACKED triggers fire on attack
 *   - search action picks from top of deck
 *   - play_from_trash brings a character back
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAction,
  DSL_VERSION,
  initGame,
  makeRegistry,
  parseCardEffectDsl,
  type CardData,
  type DeckList,
  type GameState,
  type TriggeredEffect,
} from "./index";

function effectsFor(cardId: string, effects: TriggeredEffect[]): TriggeredEffect[] {
  return parseCardEffectDsl({ version: DSL_VERSION, cardId, effects }).dsl.effects;
}

function leader(id: string, effects?: TriggeredEffect[], life = 4): CardData {
  return {
    id,
    cardType: "LEADER",
    colors: ["black"],
    features: [],
    mechanics: [],
    cost: null,
    power: 5000,
    counter: null,
    life,
    hasTrigger: false,
    effect: effects,
  };
}

function char(
  id: string,
  cost: number,
  power: number,
  effects?: TriggeredEffect[],
  hasTrigger = false,
  counter: number | null = 1000,
): CardData {
  return {
    id,
    cardType: "CHARACTER",
    colors: ["black"],
    features: [],
    mechanics: [],
    cost,
    power,
    counter,
    life: null,
    hasTrigger,
    effect: effects,
  };
}

function event(id: string, cost: number, effects: TriggeredEffect[]): CardData {
  return {
    id,
    cardType: "EVENT",
    colors: ["black"],
    features: [],
    mechanics: [],
    cost,
    power: null,
    counter: null,
    life: null,
    hasTrigger: false,
    effect: effects,
  };
}

function stage(id: string, cost: number, effects?: TriggeredEffect[]): CardData {
  return {
    id,
    cardType: "STAGE",
    colors: ["black"],
    features: [],
    mechanics: [],
    cost,
    power: null,
    counter: null,
    life: null,
    hasTrigger: false,
    effect: effects,
  };
}

function pad(n: number): CardData[] {
  return Array.from({ length: n }, (_, i) => char(`P${i}`, 1, 1000));
}

function makeDeck(leaderId: string, mainId: string): DeckList {
  return {
    leaderId,
    cards: [
      { cardId: mainId, count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `P${i}`, count: 4 as const })),
      { cardId: "P11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
}

function setupAndMain(
  registry: ReturnType<typeof makeRegistry>,
  deck: DeckList,
  goFirst: "A" | "B" = "A",
  endTurns = 0,
): GameState {
  let s = initGame({ registry, deckA: deck, deckB: deck, seed: "b2", goFirst });
  ({ state: s } = applyAction(s, { type: "MULLIGAN_DECIDE", player: "A", redraw: false }, registry));
  ({ state: s } = applyAction(s, { type: "MULLIGAN_DECIDE", player: "B", redraw: false }, registry));
  for (let i = 0; i < endTurns; i++) {
    ({ state: s } = applyAction(s, { type: "END_TURN" }, registry));
  }
  return s;
}

function inject(s: GameState, who: "A" | "B", cardId: string, tag = "i"): GameState {
  const inst = { instanceId: `${who}-${tag}-${cardId}-${Math.random()}`, cardId };
  return {
    ...s,
    players: {
      ...s.players,
      [who]: { ...s.players[who], hand: [...s.players[who].hand, inst] },
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* PLAY_EVENT                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

test("PLAY_EVENT: ON_PLAY draw 1, then to trash, costs DON", () => {
  const ev = event(
    "EV1",
    1,
    effectsFor("EV1", [{ on: "ON_PLAY", actions: [{ op: "draw", count: 1 }] }]),
  );
  const registry = makeRegistry([leader("L"), ev, ...pad(15)]);
  const deck = makeDeck("L", "EV1");
  let s = setupAndMain(registry, deck);
  s = inject(s, "A", "EV1");
  const hand0 = s.players.A.hand.length;
  const don0 = s.players.A.donArea.active;
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_EVENT", handInstanceId: inst.instanceId },
    registry,
  ));
  // Hand: -1 (played) +1 (drawn) = same.
  assert.equal(s.players.A.hand.length, hand0);
  // Event in trash.
  assert.ok(s.players.A.trash.some((c) => c.cardId === "EV1"));
  // DON spent.
  assert.equal(s.players.A.donArea.active, don0 - 1);
  // No character entered field.
  assert.equal(s.players.A.characters.length, 0);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* PLAY_STAGE                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

test("PLAY_STAGE: enters stage area, replaces existing stage (old → trash)", () => {
  const st1 = stage("ST1", 1);
  const st2 = stage("ST2", 1);
  const registry = makeRegistry([leader("L"), st1, st2, ...pad(15)]);
  const deck = makeDeck("L", "ST1");
  let s = setupAndMain(registry, deck, "A", 2); // turn 3 to have 3 DON
  s = inject(s, "A", "ST1", "a");
  let inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(s, { type: "PLAY_STAGE", handInstanceId: inst.instanceId }, registry));
  assert.equal(s.players.A.stage?.cardId, "ST1");
  s = inject(s, "A", "ST2", "b");
  inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(s, { type: "PLAY_STAGE", handInstanceId: inst.instanceId }, registry));
  assert.equal(s.players.A.stage?.cardId, "ST2");
  assert.ok(s.players.A.trash.some((c) => c.cardId === "ST1"));
});

/* ──────────────────────────────────────────────────────────────────────── */
/* ACTIVATE_EFFECT                                                          */
/* ──────────────────────────────────────────────────────────────────────── */

test("ACTIVATE_EFFECT on stage: pays donFromArea cost, resolves ACTIVATE_MAIN", () => {
  const st = stage(
    "ACT",
    1,
    effectsFor("ACT", [
      {
        on: "ACTIVATE_MAIN",
        cost: { donFromArea: 1 },
        actions: [{ op: "draw", count: 1 }],
      },
    ]),
  );
  const registry = makeRegistry([leader("L"), st, ...pad(15)]);
  const deck = makeDeck("L", "ACT");
  let s = setupAndMain(registry, deck, "A", 2); // 3 DON on T3
  s = inject(s, "A", "ACT");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(s, { type: "PLAY_STAGE", handInstanceId: inst.instanceId }, registry));
  const handBefore = s.players.A.hand.length;
  const donBefore = s.players.A.donArea.active;
  ({ state: s } = applyAction(
    s,
    { type: "ACTIVATE_EFFECT", instanceId: s.players.A.stage!.instanceId },
    registry,
  ));
  assert.equal(s.players.A.hand.length, handBefore + 1);
  assert.equal(s.players.A.donArea.active, donBefore - 1);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* ON_KO                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

test("ON_KO: KO'd character triggers controller-side ON_KO effect (draw 1)", () => {
  const onko = char(
    "KOC",
    2,
    3000,
    effectsFor("KOC", [{ on: "ON_KO", actions: [{ op: "draw", count: 1 }] }]),
  );
  const registry = makeRegistry([leader("L"), onko, ...pad(15)]);
  const deck = makeDeck("L", "KOC");
  let s = setupAndMain(registry, deck, "A", 2);
  // Now A's T3 with 3 DON, can attack. Inject KOC on B's side as rested.
  s = {
    ...s,
    players: {
      ...s.players,
      B: {
        ...s.players.B,
        characters: [
          {
            instanceId: "B-koc",
            cardId: "KOC",
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
  const handBefore = s.players.B.hand.length;
  ({ state: s } = applyAction(
    s,
    {
      type: "DECLARE_ATTACK",
      attackerInstanceId: "A-LEADER",
      target: { kind: "character", controller: "B", instanceId: "B-koc" },
    },
    registry,
  ));
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_COUNTER", counterHandInstanceId: null },
    registry,
  ));
  // KOC is KO'd → ON_KO fires → B (the owner) draws 1.
  assert.equal(s.players.B.characters.length, 0);
  assert.equal(s.players.B.hand.length, handBefore + 1);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* TRIGGER from life                                                        */
/* ──────────────────────────────────────────────────────────────────────── */

test("TRIGGER: life card with TRIGGER effect fires when revealed", () => {
  const trig = char(
    "TR1",
    1,
    2000,
    effectsFor("TR1", [{ on: "TRIGGER", actions: [{ op: "draw", count: 2 }] }]),
    true,
  );
  const registry = makeRegistry([leader("L"), trig, ...pad(15)]);
  const deck = makeDeck("L", "TR1");
  let s = setupAndMain(registry, deck, "A", 0);
  // Force a TR1 to the top of A's life pile.
  s = {
    ...s,
    players: {
      ...s.players,
      A: {
        ...s.players.A,
        life: [{ instanceId: "A-life-trig", cardId: "TR1" }, ...s.players.A.life.slice(1)],
      },
    },
  };
  // End A's T1 so B can attack on T2 with leader.
  ({ state: s } = applyAction(s, { type: "END_TURN" }, registry));
  const handBefore = s.players.A.hand.length;
  ({ state: s } = applyAction(
    s,
    {
      type: "DECLARE_ATTACK",
      attackerInstanceId: "B-LEADER",
      target: { kind: "leader", controller: "A" },
    },
    registry,
  ));
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_COUNTER", counterHandInstanceId: null },
    registry,
  ));
  // A took 1 life damage: TR1 fired → draw 2, plus the life card itself
  // went to hand. Net: +1 (life) + 2 (TRIGGER draw) = +3.
  assert.equal(s.players.A.hand.length, handBefore + 3);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* WHEN_ATTACKING / WHEN_ATTACKED                                           */
/* ──────────────────────────────────────────────────────────────────────── */

test("WHEN_ATTACKING: leader effect fires when leader attacks", () => {
  const lWith = leader(
    "Latk",
    effectsFor("Latk", [
      { on: "WHEN_ATTACKING", actions: [{ op: "draw", count: 1 }] },
    ]),
  );
  const lPlain = leader("Lplain");
  const registry = makeRegistry([lWith, lPlain, ...pad(15)]);
  const deck: DeckList = {
    leaderId: "Latk",
    cards: [
      ...Array.from({ length: 12 }, (_, i) => ({ cardId: `P${i}`, count: 4 as const })),
      { cardId: "P12", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  const deckB: DeckList = { ...deck, leaderId: "Lplain" };
  let s = initGame({ registry, deckA: deck, deckB, seed: "watk", goFirst: "B" });
  ({ state: s } = applyAction(s, { type: "MULLIGAN_DECIDE", player: "A", redraw: false }, registry));
  ({ state: s } = applyAction(s, { type: "MULLIGAN_DECIDE", player: "B", redraw: false }, registry));
  // B is goFirst T1, ends → A's T2 with 2 DON, can attack.
  ({ state: s } = applyAction(s, { type: "END_TURN" }, registry));
  const hand0 = s.players.A.hand.length;
  ({ state: s } = applyAction(
    s,
    {
      type: "DECLARE_ATTACK",
      attackerInstanceId: "A-LEADER",
      target: { kind: "leader", controller: "B" },
    },
    registry,
  ));
  // A's WHEN_ATTACKING fires → +1 to A's hand.
  // (Combat hasn't resolved yet — counter step is pending.)
  assert.equal(s.players.A.hand.length, hand0 + 1);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* search                                                                   */
/* ──────────────────────────────────────────────────────────────────────── */

test("search: take 1 matching from top 5 of deck → to hand, leftovers to bottom", () => {
  const searcher = char(
    "SR",
    1,
    1000,
    effectsFor("SR", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "search",
            zone: "deck",
            look: 5,
            take: 1,
            filter: { cardType: "CHARACTER", costGte: 4 },
            destination: "hand",
            leftoverDestination: "deck_bottom",
          },
        ],
      },
    ]),
  );
  const high = char("HI", 5, 6000);
  const registry = makeRegistry([leader("L"), searcher, high, ...pad(15)]);
  const deck: DeckList = {
    leaderId: "L",
    cards: [
      { cardId: "SR", count: 4 },
      { cardId: "HI", count: 4 },
      ...Array.from({ length: 10 }, (_, i) => ({ cardId: `P${i}`, count: 4 as const })),
      { cardId: "P10", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = setupAndMain(registry, deck);
  // Force the deck's top 5 to include exactly one HI.
  s = {
    ...s,
    players: {
      ...s.players,
      A: {
        ...s.players.A,
        deck: [
          { instanceId: "A-d0", cardId: "P0" },
          { instanceId: "A-d1", cardId: "HI" },
          { instanceId: "A-d2", cardId: "P1" },
          { instanceId: "A-d3", cardId: "P2" },
          { instanceId: "A-d4", cardId: "P3" },
          ...s.players.A.deck.slice(5),
        ],
      },
    },
  };
  s = inject(s, "A", "SR");
  const hand0 = s.players.A.hand.length;
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  // -1 (played), +1 (HI from search) = same hand size.
  assert.equal(s.players.A.hand.length, hand0);
  assert.ok(s.players.A.hand.some((c) => c.cardId === "HI"));
});

/* ──────────────────────────────────────────────────────────────────────── */
/* play_from_trash                                                          */
/* ──────────────────────────────────────────────────────────────────────── */

test("play_from_trash: brings a 4-cost char back to character_area", () => {
  const revive = char(
    "RV",
    1,
    1000,
    effectsFor("RV", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "play_from_trash",
            filter: { cardType: "CHARACTER", costLte: 4 },
          },
        ],
      },
    ]),
  );
  const target = char("TG", 3, 3000);
  const registry = makeRegistry([leader("L"), revive, target, ...pad(15)]);
  const deck: DeckList = {
    leaderId: "L",
    cards: [
      { cardId: "RV", count: 4 },
      { cardId: "TG", count: 4 },
      ...Array.from({ length: 10 }, (_, i) => ({ cardId: `P${i}`, count: 4 as const })),
      { cardId: "P10", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = setupAndMain(registry, deck);
  // Put TG in A's trash.
  s = {
    ...s,
    players: {
      ...s.players,
      A: {
        ...s.players.A,
        trash: [{ instanceId: "A-trash-tg", cardId: "TG" }],
      },
    },
  };
  s = inject(s, "A", "RV");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  // TG is back on field.
  assert.ok(s.players.A.characters.some((c) => c.cardId === "TG"));
  // Trash no longer has TG.
  assert.equal(s.players.A.trash.length, 0);
});

/* ──────────────────────────────────────────────────────────────────────── */
/* ACTIVATE_EFFECT restThis cost                                            */
/* ──────────────────────────────────────────────────────────────────────── */

test("ACTIVATE_EFFECT: restThis cost rests the source", () => {
  const c = char(
    "AR",
    1,
    1000,
    effectsFor("AR", [
      {
        on: "ACTIVATE_MAIN",
        cost: { restThis: true },
        actions: [{ op: "draw", count: 1 }],
      },
    ]),
  );
  const registry = makeRegistry([leader("L"), c, ...pad(15)]);
  const deck = makeDeck("L", "AR");
  let s = setupAndMain(registry, deck, "A", 2); // T3, 3 DON
  s = inject(s, "A", "AR");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  // Played this turn → summoning sickness, but ACTIVATE_EFFECT doesn't
  // need active state. (Some real cards require active explicitly via
  // their DSL — we don't impose it engine-side.)
  ({ state: s } = applyAction(
    s,
    { type: "ACTIVATE_EFFECT", instanceId: inst.instanceId },
    registry,
  ));
  const ch = s.players.A.characters.find((c) => c.instanceId === inst.instanceId)!;
  assert.equal(ch.state, "rested");
});
