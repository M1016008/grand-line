import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./battle-arena.tsx", import.meta.url),
  "utf8",
);

test("BattleArena dispatches to the shared rules kernel", () => {
  assert.match(source, /@\/lib\/battle-engine\/engine/);
  assert.match(source, /createBattleState/);
  assert.match(source, /declareCharacterAttack/);
  assert.doesNotMatch(source, /function resolveTacticCard/);
  assert.doesNotMatch(source, /function estimateCounter/);
});

test("Battle UI exposes coverage, unsupported warning, counter, Trigger and DON choices", () => {
  assert.match(source, /効果再現率/);
  assert.match(source, /この対戦は完全再現ではありません/);
  assert.match(source, /カウンターを使わず受ける/);
  assert.match(source, /Trigger発動/);
  assert.match(source, /DON!!付与/);
  assert.match(source, /Leader:/);
  assert.match(source, /アタック対象を選択/);
  assert.match(source, /選ばない/);
  assert.match(source, /加えない/);
  assert.match(source, /STAGE/);
});
