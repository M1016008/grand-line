import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

test("deck-builder keeps draft-first hierarchy", async () => {
  const builder = await source("src", "components", "grand-line", "deck-builder.tsx");

  const draftIndex = builder.indexOf("現在の下書き");
  const saveIndex = builder.indexOf('id="deck-save"');
  const leaderIndex = builder.indexOf("Leader ·");
  const ruleIndex = builder.indexOf("<RuleReport violations={report.violations}");
  const detailIndex = builder.indexOf("詳細分析");

  assert.notEqual(draftIndex, -1);
  assert.notEqual(saveIndex, -1);
  assert.notEqual(leaderIndex, -1);
  assert.notEqual(ruleIndex, -1);
  assert.notEqual(detailIndex, -1);

  assert.ok(
    draftIndex < saveIndex && saveIndex < leaderIndex && leaderIndex < ruleIndex && ruleIndex < detailIndex,
    "Draft should appear before save, save before leader summary, then rule and analysis",
  );

  assert.match(builder, /id="deck-save"/);
  assert.match(builder, /Save deck/);
  assert.ok(builder.includes("/api/decks"));
  assert.ok(builder.includes("router.push(`/decks/"));
  assert.match(builder, /デッキ枚数/);
  assert.match(builder, /コストカーブ/);
});
