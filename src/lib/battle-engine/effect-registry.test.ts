import test from "node:test";
import assert from "node:assert/strict";

import { BattleEffectRegistry, compileCardEffect } from "./effect-registry";
import {
  GOLDEN_BLOCKER,
  GOLDEN_BOUNCE,
  GOLDEN_CARDS,
  GOLDEN_DRAW,
  GOLDEN_KO,
  GOLDEN_ON_ATTACK,
  GOLDEN_REST,
  GOLDEN_RUSH,
  GOLDEN_SEARCH,
  GOLDEN_TRIGGER_DRAW,
} from "./golden-fixtures";

test("golden verified cards compile to their exact structured effects", () => {
  assert.deepEqual(compileCardEffect(GOLDEN_DRAW).effects[0]?.actions, [
    { type: "draw", count: 1 },
  ]);
  assert.deepEqual(compileCardEffect(GOLDEN_KO).effects[0]?.actions, [
    {
      type: "ko",
      target: { owner: "opponent", zones: ["character"], count: 1, maxCost: 2 },
    },
  ]);
  assert.deepEqual(compileCardEffect(GOLDEN_REST).effects[0]?.actions, [
    {
      type: "rest",
      target: { owner: "opponent", zones: ["character"], count: 1, maxCost: 2 },
    },
  ]);
  assert.equal(compileCardEffect(GOLDEN_BOUNCE).effects[0]?.actions[0]?.type, "return_to_hand");
});

test("golden Search and OnAttack facts preserve filters and modifier values", () => {
  assert.deepEqual(compileCardEffect(GOLDEN_SEARCH).effects[0]?.actions, [
    {
      type: "search",
      lookAt: 5,
      count: 1,
      feature: "麦わらの一味",
      excludeName: "ナミ",
      cardType: undefined,
      minCost: undefined,
      maxCost: undefined,
    },
  ]);
  assert.deepEqual(compileCardEffect(GOLDEN_ON_ATTACK).effects[0]?.actions, [
    {
      type: "power_modifier",
      target: { owner: "opponent", zones: ["character"], count: 1 },
      amount: -2_000,
      duration: "turn",
    },
  ]);
});

test("Search compiler preserves printed color restrictions", () => {
  const definition = compileCardEffect({
    ...GOLDEN_SEARCH,
    id: "TEST-COLOR-SEARCH",
    name: "色指定サーチ",
    effectText:
      "[登場時]自分のデッキの上から5枚を見て、緑の特徴《ワノ国》を持つカード1枚までを公開し、手札に加える。その後、残りを好きな順番でデッキの下に置く。",
  });
  assert.equal(
    definition.effects[0]?.actions[0]?.type === "search"
      ? definition.effects[0].actions[0].color
      : undefined,
    "green",
  );
});

test("Rush and Blocker are executable abilities, while other text remains explicit", () => {
  const registry = new BattleEffectRegistry([...GOLDEN_CARDS]);
  assert.equal(registry.isRush(GOLDEN_RUSH.id), true);
  assert.equal(registry.isBlocker(GOLDEN_BLOCKER.id), true);
  assert.equal(registry.get(GOLDEN_RUSH.id).status, "partial");
  assert.match(registry.get(GOLDEN_RUSH.id).unsupportedReasons.join(" "), /OnKO/);
  assert.equal(registry.get(GOLDEN_TRIGGER_DRAW.id).status, "partial");
  assert.match(
    registry.get(GOLDEN_TRIGGER_DRAW.id).unsupportedReasons.join(" "),
    /Counter/,
  );
});

test("unverified and manual facts fail closed", () => {
  const definition = compileCardEffect({
    ...GOLDEN_DRAW,
    source: "manual",
    verified: false,
  });
  assert.equal(definition.status, "unsupported");
  assert.equal(definition.effects.length, 0);
});

test("verified but unparsed passive text is unsupported, never silently supported", () => {
  const definition = compileCardEffect({
    ...GOLDEN_DRAW,
    id: "TEST-PASSIVE",
    mechanics: [],
    effectText: "このキャラは特別な条件で効果を得る。",
  });
  assert.equal(definition.status, "unsupported");
  assert.match(definition.unsupportedReasons.join(" "), /構造化できません/);
});
