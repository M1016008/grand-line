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

test("filter — strict mode rejects nested OR (not supported in v0.1)", () => {
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
              or: [{ costLte: 3 }, { feature: "海軍" }],
            },
          },
        ],
      },
    ],
  };
  assert.throws(() => parseCardEffectDsl(payload));
});
