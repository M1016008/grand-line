import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

test("home expresses purpose-first actions", async () => {
  const home = await source("src", "app", "page.tsx");

  assert.match(home, /デッキを作る/);
  assert.match(home, /保存デッキを\s*見る/);
  assert.match(home, /カードを調べる/);
  assert.match(home, /Deck Intelligence/);
  assert.match(home, /Battle Benchmark/);
  assert.match(home, /Deck Optimizer/);
  assert.match(home, /Deck Coach/);
  assert.match(home, /Card Coach/);
});

test("home has no obsolete phase roadmap copy", async () => {
  const home = await source("src", "app", "page.tsx");

  assert.doesNotMatch(home, /Phase\s*\d/);
  assert.doesNotMatch(home, /Phase 4/);
  assert.doesNotMatch(home, /Phase 3/);
});

test("battle and practice copy distinguish roles", async () => {
  const battle = await source("src", "app", "battle", "page.tsx");
  const practice = await source("src", "app", "practice", "page.tsx");

  assert.match(battle, /CPU対戦/);
  assert.match(battle, /インタラクティブ対戦/);
  assert.match(practice, /検証ラボ/);
  assert.match(practice, /シミュレーション/);
  assert.doesNotMatch(practice, /<h1[^>]*>CPU対戦</);
});
