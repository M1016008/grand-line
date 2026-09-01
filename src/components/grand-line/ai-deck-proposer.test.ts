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
  assert.match(component, /おすすめ1案/);
  assert.match(component, /3案を比較/);
  assert.match(component, /mode: generationMode/);
  assert.match(component, /selectedStyle,/);
  assert.match(component, /selectedTags,/);
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
  assert.match(route, /mode: z\.enum\(DECK_INTELLIGENCE_GENERATION_MODES\)/);
  assert.match(route, /z\.enum\(DECK_INTELLIGENCE_GENERATION_MODES\)\.default\("single"\)/);
  assert.match(route, /\.max\(MAX_FEATURE_TAGS\)/);
  assert.match(route, /new Set\(tags\)\.size === tags\.length/);
  assert.match(route, /await Promise\.all/);
  assert.match(route, /activeRegulations\(\)/);
  assert.match(route, /readVerifiedCardFactsByIdsFromDb/);
  assert.match(route, /readAiSynergiesForLeader/);
  assert.match(route, /restrictions_unavailable/);
  assert.match(route, /body\.mode === "compare"/);
  assert.match(route, /proposeDeckVariants\(suggestionInput\)/);
  assert.match(route, /proposeDeck\(suggestionInput\)/);
  assert.equal(route.match(/listCards\(\{\}, 5000\)/g)?.length, 1);
  assert.equal(route.match(/activeRegulations\(\)/g)?.length, 1);
  assert.equal(
    route.match(/readVerifiedCardFactsByIdsFromDb\(/g)?.length,
    1,
  );
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

test("compare UI renders three profile cards, details, and draft apply actions", async () => {
  const component = await source(
    "src",
    "components",
    "grand-line",
    "ai-deck-proposer.tsx",
  );
  assert.match(component, /VARIANT_PROFILE_IDS\.map/);
  assert.match(component, /variant\.variantLabel/);
  assert.match(component, /詳しく比較/);
  assert.match(component, /指標/);
  assert.match(component, /VARIANT_PROFILE_FOCUS_LABELS\[profile\]/);
  assert.match(component, /VARIANT_PERSONALITY_JA\[profile\]/);
  assert.match(component, /構築の性格/);
  assert.match(component, /構築思想/);
  assert.match(component, /この案だけの採用カード/);
  assert.match(component, /cardComparison\.uniqueCardIds/);
  assert.match(component, /枚数を増やした主なカード/);
  assert.match(component, /高い数値が構築の優劣を決めるものではありません/);
  assert.match(component, /この構築を下書きに反映/);
  assert.match(component, /DeckBattleBenchmark/);
  assert.match(component, /personalityByProfile=\{VARIANT_PERSONALITY_JA\}/);
  assert.match(component, /onClick=\{\(\) => onApply\(variant\)\}/);
  assert.match(component, /applyDeckCopyEntries\(target\.cards, poolById, replace\)/);
  assert.match(component, /提案カードを下書きへ反映できませんでした/);
  assert.match(component, /catch \{/);
  assert.doesNotMatch(component, /metrics\.composite|label: "Composite"/);
  assert.doesNotMatch(component, /絶対おすすめ|最強/);
});
