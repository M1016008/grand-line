import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

test("deck list and detail pages use Japanese user-facing labels", async () => {
  const listPage = await source("src", "app", "decks", "page.tsx");
  const detailPage = await source("src", "app", "decks", "[deckId]", "page.tsx");
  const newPage = await source("src", "app", "decks", "new", "page.tsx");
  const leaderPage = await source("src", "app", "decks", "new", "[leaderId]", "page.tsx");

  assert.match(listPage, /保存デッキ/);
  assert.match(listPage, /新しいデッキ/);
  assert.match(listPage, /印刷用PDF/);
  assert.match(listPage, /開く/);

  assert.match(detailPage, /保存デッキ/);
  assert.match(detailPage, /メインデッキ/);
  assert.match(detailPage, /印刷用PDF/);
  assert.match(detailPage, /合法|要修正/);

  assert.doesNotMatch(listPage, /Saved decks/);
  assert.doesNotMatch(listPage, /New deck/);
  assert.doesNotMatch(listPage, /Print PDF/);
  assert.doesNotMatch(listPage, /Deck Library/);
  assert.doesNotMatch(detailPage, /Main Deck/);
  assert.doesNotMatch(detailPage, /Deck Library/);

  assert.doesNotMatch(newPage, /Step 1 of 2/);
  assert.doesNotMatch(leaderPage, /Step 2 of 2/);
  assert.match(leaderPage, /デッキ構築/);
});
