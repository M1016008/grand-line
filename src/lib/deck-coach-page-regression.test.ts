import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

test("saved deck detail adds Deck Coach while preserving the PDF action", async () => {
  const page = await source("src", "app", "decks", "[deckId]", "page.tsx");
  assert.match(page, /DeckCoachSection/);
  assert.match(page, /getDeckCoachGuideForPage/);
  assert.match(page, /\/api\/decks\/\$\{deck\.id\}\/print\?includeLeader=1/);
  assert.match(page, /印刷用PDF/);
  assert.match(page, /メインデッキ/);
});

test("Deck Coach generation fetches active restrictions without an empty fallback", async () => {
  const lib = await source("src", "lib", "deck-coach.ts");
  const prepare = lib.match(
    /export async function prepareDeckCoachGeneration[\s\S]*?export async function getDeckCoachGuideForPage/,
  )?.[0];
  assert.ok(prepare);
  assert.match(prepare, /await activeRegulations\(\)/);
  assert.doesNotMatch(prepare, /catch\s*\{[\s\S]*?perCardMax:\s*new Map/);
});

test("Deck Coach does not alter Card Coach or deck PDF implementations", async () => {
  const cardPage = await source("src", "app", "cards", "[id]", "page.tsx");
  const cardCoach = await source(
    "src",
    "components",
    "grand-line",
    "card-coach-section.tsx",
  );
  const pdfRoute = await source(
    "src",
    "app",
    "api",
    "decks",
    "[deckId]",
    "print",
    "route.ts",
  );
  assert.match(cardPage, /CardCoachSection/);
  assert.match(cardCoach, /record|Card Coach|card-coach/i);
  assert.match(pdfRoute, /buildDeckPrintPdf/);
  assert.doesNotMatch(cardPage, /DeckCoachSection/);
  assert.doesNotMatch(pdfRoute, /DeckCoach/);
});
