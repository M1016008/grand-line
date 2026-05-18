/**
 * Phase B-1 DSL interpreter integration tests.
 *
 * Strategy
 * ────────
 * We hand-author CardData with synthetic `effect` arrays (using the
 * proper Zod-parsed shape via `parseCardEffectDsl`) and play minimal
 * scripts that exercise:
 *
 *   - ON_PLAY draw (zero-target, controller-side)
 *   - ON_PLAY KO with auto-resolved target
 *   - ON_PLAY KO with multiple legal targets → CHOICE_REQUIRED
 *   - RESOLVE_CHOICE → effect completes
 *   - ON_PLAY discard from opponent's hand (with chooser=opponent)
 *   - ON_PLAY power_buff isSelf
 *   - ON_PLAY if/then/else conditional (life count)
 *   - ON_PLAY choose_one modal
 *   - ON_PLAY for_each draws per character
 *   - ScaledInt: +1000 per matching card buff
 *   - Engine refuses non-RESOLVE_CHOICE actions while pendingChoice is set
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyAction,
  DSL_VERSION,
  initGame,
  isGameOver,
  makeRegistry,
  parseCardEffectDsl,
  type CardData,
  type CardEffectDsl,
  type DeckList,
  type GameAction,
  type GameState,
  type TriggeredEffect,
} from "./index";

/* ──────────────────────────────────────────────────────────────────────── */
/* Card factory                                                             */
/* ──────────────────────────────────────────────────────────────────────── */

function effectsFor(cardId: string, effects: TriggeredEffect[]): TriggeredEffect[] {
  // Round-trip through Zod parsing to ensure the test data matches what
  // production code will load from `card_effects.dsl_json`.
  const payload: unknown = {
    version: DSL_VERSION,
    cardId,
    effects,
  };
  const parsed = parseCardEffectDsl(payload);
  return parsed.dsl.effects;
}

function leader(id: string, life = 4, power = 5000): CardData {
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
  effects?: TriggeredEffect[],
  extras: Partial<CardData> = {},
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
    hasTrigger: false,
    effect: effects,
    ...extras,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Deck plumbing — keeps tests one-liner.                                   */
/* ──────────────────────────────────────────────────────────────────────── */

function buildRegistryWith(...extras: CardData[]) {
  const base: CardData[] = [
    leader("L-A"),
    leader("L-B"),
    char("V1", 1, 2000, 1000),
    char("V2", 2, 3000, 1000),
    char("V3", 3, 4000, 1000),
    char("V4", 4, 5000, null),
    char("V5", 5, 6000, null),
  ];
  return makeRegistry([...base, ...extras]);
}

function defaultDeck(leaderId: string): DeckList {
  return {
    leaderId,
    cards: [
      { cardId: "V1", count: 4 },
      { cardId: "V2", count: 4 },
      { cardId: "V3", count: 4 },
      { cardId: "V4", count: 4 },
      { cardId: "V5", count: 4 },
      { cardId: "V1", count: 0 }, // placeholder if needed
    ].filter((e) => e.count > 0).concat([
      { cardId: "V1", count: 4 },
    ]) as unknown as DeckList["cards"],
    donDeckSize: 10,
  };
}

void defaultDeck;

function padCards(n: number): CardData[] {
  return Array.from({ length: n }, (_, i) => char(`PAD-${i}`, 1, 1000, 1000));
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Helper: jump to a turn with N DON in active player's area.               */
/* ──────────────────────────────────────────────────────────────────────── */

function startMain(
  registry: ReturnType<typeof buildRegistryWith>,
  deckA: DeckList,
  deckB: DeckList,
  endTurns = 0,
  seed = "effects-test",
  goFirst: "A" | "B" = "A",
): GameState {
  let s = initGame({ registry, deckA, deckB, seed, goFirst });
  ({ state: s } = applyAction(
    s,
    { type: "MULLIGAN_DECIDE", player: "A", redraw: false },
    registry,
  ));
  ({ state: s } = applyAction(
    s,
    { type: "MULLIGAN_DECIDE", player: "B", redraw: false },
    registry,
  ));
  for (let i = 0; i < endTurns; i++) {
    ({ state: s } = applyAction(s, { type: "END_TURN" }, registry));
  }
  return s;
}

/** Inject a card into the active player's hand so we can play it on demand. */
function injectInHand(
  s: GameState,
  who: "A" | "B",
  cardId: string,
  tag = "inj",
): GameState {
  const inst = { instanceId: `${who}-${tag}-${cardId}-${Date.now()}-${Math.random()}`, cardId };
  return {
    ...s,
    players: {
      ...s.players,
      [who]: { ...s.players[who], hand: [...s.players[who].hand, inst] },
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* TESTS                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

test("ON_PLAY draw: +1 card in hand after playing the trigger card itself", () => {
  const draw1 = char(
    "DRAW1",
    1,
    1000,
    null,
    effectsFor("DRAW1", [
      { on: "ON_PLAY", actions: [{ op: "draw", count: 1 }] },
    ]),
  );
  const registry = makeRegistry([
    leader("L-A"),
    leader("L-B"),
    draw1,
    ...padCards(15),
  ]);
  const fixed: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "DRAW1", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, fixed, fixed, 0);
  // We're on A's T1, 1 active DON. Inject DRAW1 in A's hand to play.
  s = injectInHand(s, "A", "DRAW1");
  const handLen0 = s.players.A.hand.length;
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  // Hand: -1 (played) +1 (drawn from ON_PLAY) = same length.
  assert.equal(s.players.A.hand.length, handLen0);
  // A character on field.
  assert.equal(s.players.A.characters.length, 1);
  assert.equal(s.pendingEffects.length, 0);
  assert.equal(s.pendingChoice, null);
});

test("ON_PLAY KO with unique target: auto-resolves, no choice needed", () => {
  const koOnePlayer = char(
    "KO1",
    1,
    1000,
    null,
    effectsFor("KO1", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "ko",
            target: {
              side: "opponent",
              cardType: "CHARACTER",
              zone: "character_area",
              costLte: 2,
            },
          },
        ],
      },
    ]),
  );
  const registry = makeRegistry([
    leader("L-A"),
    leader("L-B"),
    koOnePlayer,
    ...padCards(15),
  ]);
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "KO1", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  // Place exactly one ≤2-cost opp character.
  s = {
    ...s,
    players: {
      ...s.players,
      B: {
        ...s.players.B,
        characters: [
          {
            instanceId: "B-victim",
            cardId: "PAD-0",
            state: "active",
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
  s = injectInHand(s, "A", "KO1");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  assert.equal(s.players.B.characters.length, 0);
  assert.equal(s.players.B.trash[0]!.instanceId, "B-victim");
  assert.equal(s.pendingChoice, null);
});

test("ON_PLAY KO with multiple legal targets → CHOICE_REQUIRED, then RESOLVE_CHOICE completes", () => {
  const ko = char(
    "KOM",
    1,
    1000,
    null,
    effectsFor("KOM", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "ko",
            target: {
              side: "opponent",
              cardType: "CHARACTER",
              zone: "character_area",
              costLte: 3,
            },
          },
        ],
      },
    ]),
  );
  const registry = makeRegistry([
    leader("L-A"),
    leader("L-B"),
    ko,
    ...padCards(15),
  ]);
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "KOM", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  s = {
    ...s,
    players: {
      ...s.players,
      B: {
        ...s.players.B,
        characters: [
          {
            instanceId: "B-c1",
            cardId: "PAD-0",
            state: "active",
            attachedDon: 0,
            powerModPermanent: 0,
            powerModTurn: 0,
            playedThisTurn: false,
            hasBlockerGranted: false,
            hasRushGranted: false,
          },
          {
            instanceId: "B-c2",
            cardId: "PAD-1",
            state: "active",
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
  s = injectInHand(s, "A", "KOM");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  assert.ok(s.pendingChoice);
  assert.equal(s.pendingChoice!.kind, "TARGET_PICK");
  // Engine refuses other actions while waiting.
  assert.throws(() =>
    applyAction(s, { type: "END_TURN" }, registry),
  );
  // Resolve: pick B-c2.
  ({ state: s } = applyAction(
    s,
    {
      type: "RESOLVE_CHOICE",
      resolution: { kind: "TARGET_PICK", picked: ["B-c2"] },
    },
    registry,
  ));
  assert.equal(s.pendingChoice, null);
  assert.equal(s.players.B.characters.length, 1);
  assert.equal(s.players.B.characters[0]!.instanceId, "B-c1");
});

test("ON_PLAY discard from opponent (chooser=opponent): surfaces choice on opp side", () => {
  const discard = char(
    "DSC",
    1,
    1000,
    null,
    effectsFor("DSC", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "discard",
            from: "opponent",
            count: 1,
            chooser: "opponent",
          },
        ],
      },
    ]),
  );
  const registry = buildRegistryWith(discard, ...padCards(15));
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "DSC", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  s = injectInHand(s, "A", "DSC");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  // B has 5 hand cards → must choose 1 to discard. Choice goes to B.
  assert.ok(s.pendingChoice);
  assert.equal(s.pendingChoice!.kind, "TARGET_PICK");
  assert.equal(s.pendingChoice!.chooser, "B");
});

test("ON_PLAY power_buff isSelf: +2000 to the playing character (turn-scoped)", () => {
  const buff = char(
    "BUFF",
    1,
    1000,
    null,
    effectsFor("BUFF", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "power_buff",
            target: { isSelf: true },
            delta: 2000,
            duration: "turn",
          },
        ],
      },
    ]),
  );
  const registry = buildRegistryWith(buff, ...padCards(15));
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "BUFF", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  s = injectInHand(s, "A", "BUFF");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  const ch = s.players.A.characters.find((c) => c.instanceId === inst.instanceId)!;
  assert.equal(ch.powerModTurn, 2000);
});

test("ON_PLAY if/then: condition met → then branch fires", () => {
  const card = char(
    "IF1",
    1,
    1000,
    null,
    effectsFor("IF1", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "if",
            condition: { lifeBetween: [0, 4] },
            then: [{ op: "draw", count: 2 }],
            else: [{ op: "draw", count: 1 }],
          },
        ],
      },
    ]),
  );
  const registry = buildRegistryWith(card, ...padCards(15));
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "IF1", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  s = injectInHand(s, "A", "IF1");
  const hand0 = s.players.A.hand.length;
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  // -1 played, +2 drawn = +1 net.
  assert.equal(s.players.A.hand.length, hand0 + 1);
});

test("ON_PLAY choose_one: surfaces MODAL_PICK, then resolves to chosen mode's actions", () => {
  const card = char(
    "MOD",
    1,
    1000,
    null,
    effectsFor("MOD", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "choose_one",
            chooser: "controller",
            modes: [
              { id: "drawTwo", actions: [{ op: "draw", count: 2 }] },
              { id: "drawOne", actions: [{ op: "draw", count: 1 }] },
            ],
          },
        ],
      },
    ]),
  );
  const registry = buildRegistryWith(card, ...padCards(15));
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "MOD", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  s = injectInHand(s, "A", "MOD");
  const hand0 = s.players.A.hand.length;
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  assert.ok(s.pendingChoice);
  assert.equal(s.pendingChoice!.kind, "MODAL_PICK");
  ({ state: s } = applyAction(
    s,
    {
      type: "RESOLVE_CHOICE",
      resolution: { kind: "MODAL_PICK", modeId: "drawTwo" },
    },
    registry,
  ));
  assert.equal(s.pendingChoice, null);
  // -1 played + 2 drawn = +1.
  assert.equal(s.players.A.hand.length, hand0 + 1);
});

test("ON_PLAY for_each: draw 1 per matching opp character", () => {
  const card = char(
    "FE",
    1,
    1000,
    null,
    effectsFor("FE", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "for_each",
            filter: { cardType: "CHARACTER" },
            zone: "character_area",
            side: "opponent",
            actions: [{ op: "draw", count: 1 }],
          },
        ],
      },
    ]),
  );
  const registry = buildRegistryWith(card, ...padCards(15));
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "FE", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  // Put 3 chars on B.
  s = {
    ...s,
    players: {
      ...s.players,
      B: {
        ...s.players.B,
        characters: [0, 1, 2].map((i) => ({
          instanceId: `B-x${i}`,
          cardId: `PAD-${i}`,
          state: "active" as const,
          attachedDon: 0,
          powerModPermanent: 0,
          powerModTurn: 0,
          playedThisTurn: false,
          hasBlockerGranted: false,
          hasRushGranted: false,
        })),
      },
    },
  };
  s = injectInHand(s, "A", "FE");
  const hand0 = s.players.A.hand.length;
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  // -1 played + 3 drawn = +2 net.
  assert.equal(s.players.A.hand.length, hand0 + 2);
});

test("ScaledInt: +1000 per black character on field → 3 chars = +3000", () => {
  const card = char(
    "SCALE",
    1,
    1000,
    null,
    effectsFor("SCALE", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "power_buff",
            target: { isSelf: true },
            delta: {
              base: 0,
              perCardMatching: { color: "black", cardType: "CHARACTER" },
              in: "character_area",
              side: "self",
              multiplier: 1000,
            },
            duration: "turn",
          },
        ],
      },
    ]),
  );
  const registry = buildRegistryWith(card, ...padCards(15));
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "SCALE", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  // Put 2 existing black chars on A.
  s = {
    ...s,
    players: {
      ...s.players,
      A: {
        ...s.players.A,
        characters: [0, 1].map((i) => ({
          instanceId: `A-pre${i}`,
          cardId: `PAD-${i}`,
          state: "active" as const,
          attachedDon: 0,
          powerModPermanent: 0,
          powerModTurn: 0,
          playedThisTurn: false,
          hasBlockerGranted: false,
          hasRushGranted: false,
        })),
      },
    },
  };
  s = injectInHand(s, "A", "SCALE");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  // After play, A has 3 black characters on field including the new one.
  // ScaledInt evaluates AFTER the character enters, so +1000 × 3 = 3000.
  const me = s.players.A.characters.find((c) => c.instanceId === inst.instanceId)!;
  assert.equal(me.powerModTurn, 3000);
});

test("Engine refuses non-RESOLVE_CHOICE actions while pendingChoice is set", () => {
  const ko = char(
    "KOC",
    1,
    1000,
    null,
    effectsFor("KOC", [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "ko",
            target: {
              side: "opponent",
              cardType: "CHARACTER",
              zone: "character_area",
            },
          },
        ],
      },
    ]),
  );
  const registry = buildRegistryWith(ko, ...padCards(15));
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "KOC", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  // Two opp chars to force choice.
  s = {
    ...s,
    players: {
      ...s.players,
      B: {
        ...s.players.B,
        characters: [0, 1].map((i) => ({
          instanceId: `B-d${i}`,
          cardId: `PAD-${i}`,
          state: "active" as const,
          attachedDon: 0,
          powerModPermanent: 0,
          powerModTurn: 0,
          playedThisTurn: false,
          hasBlockerGranted: false,
          hasRushGranted: false,
        })),
      },
    },
  };
  s = injectInHand(s, "A", "KOC");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  assert.ok(s.pendingChoice);
  assert.throws(
    () => applyAction(s, { type: "ATTACH_DON", target: "leader" }, registry),
    /waiting for RESOLVE_CHOICE/,
  );
});

test("vanilla card with empty effect array: no triggers fire", () => {
  // Already covered by Phase A-2 tests, but reasserted as a regression
  // check that introducing the DSL didn't break the vanilla path.
  const v = char("VAN", 1, 1000, 1000); // no effect field
  const registry = buildRegistryWith(v, ...padCards(15));
  const deck: DeckList = {
    leaderId: "L-A",
    cards: [
      { cardId: "VAN", count: 4 },
      ...Array.from({ length: 11 }, (_, i) => ({ cardId: `PAD-${i}`, count: 4 as const })),
      { cardId: "PAD-11", count: 2 as const },
    ],
    donDeckSize: 10,
  };
  let s = startMain(registry, deck, deck, 0);
  s = injectInHand(s, "A", "VAN");
  const inst = s.players.A.hand.at(-1)!;
  ({ state: s } = applyAction(
    s,
    { type: "PLAY_CHARACTER", handInstanceId: inst.instanceId },
    registry,
  ));
  assert.equal(s.pendingChoice, null);
  assert.equal(s.pendingEffects.length, 0);
});

test("import sanity: parseCardEffectDsl + GameAction types round-trip", () => {
  const payload: CardEffectDsl = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [{ on: "ON_PLAY", actions: [{ op: "draw", count: 1 }] }],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.dsl.effects.length, 1);
  void isGameOver;
  // GameAction discriminated union compiles.
  const a: GameAction = { type: "END_TURN" };
  assert.equal(a.type, "END_TURN");
});
