import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(...segments: string[]): Promise<string> {
  return readFile(path.join(process.cwd(), ...segments), "utf8");
}

test("Deck Intelligence UI sends one style and zero to three feature tags", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "ai-deck-proposer.tsx",
  );
  assert.match(component, /Main Style · 1つ/);
  assert.match(component, /Feature Tags · 0〜3個/);
  assert.match(component, /JSON\.stringify\(\{ selectedStyle, selectedTags \}\)/);
  assert.match(component, /selectedTags\.length >= MAX_FEATURE_TAGS/);
  assert.match(component, /Leader Style Aptitude/);
  assert.match(component, /renderStars/);
  assert.match(component, /相性低め/);
  assert.doesNotMatch(component, /\[preference, setPreference\]/);
  assert.doesNotMatch(component, /JSON\.stringify\(\{ preference/);
});

test("Deck suggestion API validates style tags and loads active restrictions", async () => {
  const route = await source(
    "src",
    "app",
    "api",
    "ai",
    "decks",
    "[leaderId]",
    "route.ts",
  );
  assert.match(route, /selectedStyle: z\.enum\(MAIN_STYLE_IDS\)/);
  assert.match(route, /\.max\(MAX_FEATURE_TAGS\)/);
  assert.match(route, /new Set\(tags\)\.size === tags\.length/);
  assert.match(route, /await Promise\.all/);
  assert.match(route, /activeRegulations\(\)/);
  assert.match(route, /readVerifiedCardFactsByIdsFromDb/);
  assert.match(route, /readAiSynergiesForLeader/);
  assert.match(route, /restrictions_unavailable/);
});

test("proposal response displays the server-selected style and tags", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "ai-deck-proposer.tsx",
  );
  assert.match(component, /proposal\.selectedStyle/);
  assert.match(component, /proposal\.selectedTags\.map/);
  assert.match(component, /proposal\.deckConceptJa/);
  assert.match(component, /c\.roleJa/);
  assert.match(component, /c\.selectionReasonJa/);
  assert.match(component, /proposal\.metrics\.triggerRatio/);
});
