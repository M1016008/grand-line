import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("card detail page uses Card Coach without duplicate playstyle or compatible sections", async () => {
  const source = await readFile(
    path.join(process.cwd(), "src", "app", "cards", "[id]", "page.tsx"),
    "utf8",
  );

  assert.match(source, /CardCoachSection/);
  assert.match(source, /getCardCoachGuideForPage/);
  assert.doesNotMatch(source, /PlaystyleSection/);
  assert.doesNotMatch(source, /CompatibleCardsSection/);
});
