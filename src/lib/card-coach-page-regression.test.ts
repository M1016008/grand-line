import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("getCardCoachGuideForPage only falls back for missing card_coach_guides table", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src", "lib", "card-coach.ts"),
    "utf8",
  );
  const body = source.match(
    /export async function getCardCoachGuideForPage[\s\S]*?export async function prepareCardCoachGeneration/,
  )?.[0];

  assert.ok(body);
  assert.match(body, /catch \(err\)/);
  assert.match(body, /!isMissingCardCoachGuidesTableError\(err\)\) throw err/);
  assert.match(body, /prepareCardCoachGeneration\(cardId, level\)/);
  assert.match(body, /currentSourceDataHash/);
  assert.doesNotMatch(body, /catch\s*\{/);
});
