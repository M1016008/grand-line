import test from "node:test";
import assert from "node:assert/strict";

import {
  DSL_VERSION,
  EffectAction,
  parseCardEffectDsl,
} from "./effect-dsl";

test("DSL_VERSION is semver-ish", () => {
  assert.match(DSL_VERSION, /^\d+\.\d+\.\d+$/);
});

test("vanilla card (no effects) parses as isVanilla", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "OP01-016",
    effects: [],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.isVanilla, true);
  assert.equal(parsed.dsl.effects.length, 0);
});

test("黒イム-like: ON_PLAY → opponent discards 1 from hand", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "OP11-001",
    summary: "ON_PLAY: opponent discards 1 (their choice).",
    effects: [
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
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.isVanilla, false);
  assert.equal(parsed.dsl.effects[0]!.on, "ON_PLAY");
});

test("黒クロコダイル-like: cost mod + ko in sequence", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "ST06-001",
    summary: "ACTIVATE: reduce opponent character cost by 3, then KO ≤4.",
    effects: [
      {
        on: "ACTIVATE_MAIN",
        cost: { donFromArea: 2 },
        limit: "once_per_turn",
        actions: [
          {
            op: "cost_mod",
            target: {
              side: "opponent",
              cardType: "CHARACTER",
              zone: "character_area",
            },
            delta: -3,
            duration: "turn",
            count: 1,
            chooser: "controller",
          },
          {
            op: "ko",
            target: {
              side: "opponent",
              cardType: "CHARACTER",
              zone: "character_area",
              costLte: 4,
            },
            chooser: "controller",
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.dsl.effects[0]!.actions.length, 2);
  assert.equal(parsed.dsl.effects[0]!.actions[0]!.op, "cost_mod");
});

test("紫エネル-like: play_from_trash with DON cost", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "OP02-114",
    summary: "DON-fueled trash revival.",
    effects: [
      {
        on: "ACTIVATE_MAIN",
        cost: { donFromArea: 3 },
        limit: "once_per_turn",
        actions: [
          {
            op: "play_from_trash",
            filter: {
              cardType: "CHARACTER",
              costLte: 5,
              feature: "古代種",
            },
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.dsl.effects[0]!.cost?.donFromArea, 3);
});

test("trigger effect: TRIGGER + draw", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "OP01-015",
    effects: [
      {
        on: "TRIGGER",
        actions: [{ op: "draw", count: 1 }],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.dsl.effects[0]!.on, "TRIGGER");
});

test("rejects unknown op", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ON_PLAY",
        actions: [{ op: "summon_dragon", count: 1 }],
      },
    ],
  };
  assert.throws(() => parseCardEffectDsl(payload));
});

test("rejects extra fields (strict mode)", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [],
    extraField: "should fail",
  };
  assert.throws(() => parseCardEffectDsl(payload));
});

test("rejects version mismatch", () => {
  const payload = {
    version: "9.9.9",
    cardId: "X",
    effects: [],
  };
  assert.throws(
    () => parseCardEffectDsl(payload),
    /version mismatch/,
  );
});

test("rejects empty actions array on a triggered effect", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [{ on: "ON_PLAY", actions: [] }],
  };
  assert.throws(() => parseCardEffectDsl(payload));
});

test("EffectAction — discriminated union resolves correctly", () => {
  const draw = EffectAction.parse({ op: "draw", count: 2 });
  assert.equal(draw.op, "draw");
  if (draw.op === "draw") {
    assert.equal(draw.count, 2);
  }
});

test("filter — anyOf encodes OR over atoms", () => {
  // "Opponent's character with (cost ≤ 3 OR feature includes 海軍)"
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "ko",
            target: {
              side: "opponent",
              cardType: "CHARACTER",
              anyOf: [{ costLte: 3 }, { feature: "海軍" }],
            },
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  const action = parsed.dsl.effects[0]!.actions[0]!;
  assert.equal(action.op, "ko");
});

test("filter — anyOf rejects nesting (depth-1 only)", () => {
  // anyOf can only hold atoms, not full filters with their own anyOf.
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "ko",
            target: {
              cardType: "CHARACTER",
              anyOf: [
                {
                  costLte: 3,
                  anyOf: [{ feature: "海軍" }],
                },
              ],
            },
          },
        ],
      },
    ],
  };
  assert.throws(() => parseCardEffectDsl(payload));
});

test("filter — orderBy + count: 'up to N'", () => {
  // "KO up to 2 opp characters, choosing highest cost first."
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ACTIVATE_MAIN",
        actions: [
          {
            op: "ko",
            target: {
              side: "opponent",
              cardType: "CHARACTER",
              orderBy: "highest_cost",
            },
            count: { upTo: 2 },
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  const action = parsed.dsl.effects[0]!.actions[0]!;
  assert.equal(action.op, "ko");
});

test("target count: 'all'", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "ko",
            target: {
              side: "opponent",
              cardType: "CHARACTER",
              powerLte: 3000,
            },
            count: "all",
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  const action = parsed.dsl.effects[0]!.actions[0]!;
  assert.equal(action.op, "ko");
});

test("self-reference: power_buff target isSelf", () => {
  // "This character gains +2000 power this turn."
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
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
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  const action = parsed.dsl.effects[0]!.actions[0]!;
  assert.equal(action.op, "power_buff");
});

test("scaling power buff: +1000 per black character", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
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
            },
            duration: "turn",
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.dsl.effects[0]!.actions[0]!.op, "power_buff");
});

test("conditional action: if life ≤ 2, draw 2 else draw 1", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "if",
            condition: { lifeBetween: [0, 2] },
            then: [{ op: "draw", count: 2 }],
            else: [{ op: "draw", count: 1 }],
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  const action = parsed.dsl.effects[0]!.actions[0]! as { op: "if" };
  assert.equal(action.op, "if");
});

test("modal effect: choose_one with 2 modes", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ACTIVATE_MAIN",
        actions: [
          {
            op: "choose_one",
            chooser: "controller",
            modes: [
              {
                id: "draw_one",
                label: "ドロー1",
                actions: [{ op: "draw", count: 1 }],
              },
              {
                id: "ko_small",
                label: "KO cost≤2",
                actions: [
                  {
                    op: "ko",
                    target: {
                      side: "opponent",
                      cardType: "CHARACTER",
                      costLte: 2,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.dsl.effects[0]!.actions[0]!.op, "choose_one");
});

test("choose_one requires at least 2 modes", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "choose_one",
            modes: [
              { id: "only", actions: [{ op: "draw", count: 1 }] },
            ],
          },
        ],
      },
    ],
  };
  assert.throws(() => parseCardEffectDsl(payload));
});

test("for_each: per-character draws", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ON_PLAY",
        actions: [
          {
            op: "for_each",
            filter: { color: "black", cardType: "CHARACTER" },
            zone: "character_area",
            side: "self",
            cap: 5,
            actions: [{ op: "draw", count: 1 }],
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.dsl.effects[0]!.actions[0]!.op, "for_each");
});

test("turn-history condition: if you played a 黒 card this turn", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ON_PLAY",
        condition: {
          controllerPlayedThisTurn: {
            filter: { color: "black" },
            gte: 1,
          },
        },
        actions: [{ op: "draw", count: 1 }],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(
    parsed.dsl.effects[0]!.condition?.controllerPlayedThisTurn?.gte,
    1,
  );
});

test("nested if-inside-choose_one resolves recursively", () => {
  const payload = {
    version: DSL_VERSION,
    cardId: "X",
    effects: [
      {
        on: "ACTIVATE_MAIN",
        actions: [
          {
            op: "choose_one",
            modes: [
              {
                id: "smart_draw",
                actions: [
                  {
                    op: "if",
                    condition: { minDonInArea: 5 },
                    then: [{ op: "draw", count: 2 }],
                    else: [{ op: "draw", count: 1 }],
                  },
                ],
              },
              {
                id: "ko",
                actions: [
                  {
                    op: "ko",
                    target: { side: "opponent", costLte: 3 },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const parsed = parseCardEffectDsl(payload);
  assert.equal(parsed.dsl.effects[0]!.actions[0]!.op, "choose_one");
});
