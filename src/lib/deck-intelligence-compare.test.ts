import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeckVariantsComparison,
  calculateDeckCopySimilarity,
  DECK_INTELLIGENCE_GENERATION_MODES,
  orchestrateVariantProfiles,
  resolveDeckCopyEntries,
  type ComparableDeckVariant,
  type DeckCopyEntry,
} from "@/lib/deck-intelligence-compare";
import {
  VARIANT_PROFILE_IDS,
  VARIANT_PROFILE_LABELS,
  type VariantProfile,
} from "@/lib/deck-intelligence-preferences";

test("variant profile enum and generation-mode schema expose v1 choices", () => {
  assert.deepEqual(VARIANT_PROFILE_IDS, [
    "recommended",
    "consistency",
    "specialization",
  ]);
  assert.deepEqual(DECK_INTELLIGENCE_GENERATION_MODES, ["single", "compare"]);
  assert.deepEqual(VARIANT_PROFILE_LABELS, {
    recommended: "推奨構築",
    consistency: "安定構築",
    specialization: "特化構築",
  });
});

test("copy-level similarity reports shared, different and ratio", () => {
  const similarity = calculateDeckCopySimilarity(
    [
      { cardId: "A", count: 4 },
      { cardId: "B", count: 46 },
    ],
    [
      { cardId: "A", count: 1 },
      { cardId: "B", count: 46 },
      { cardId: "C", count: 3 },
    ],
  );
  assert.deepEqual(similarity, {
    sharedCardCopies: 47,
    differentCardCopies: 3,
    similarityRatio: 0.94,
  });
});

test("compare orchestration generates three profiles and retries only a low-diversity variant", async () => {
  const calls: Array<{ profile: VariantProfile; attempt: number }> = [];
  const base = fiftyCardDeck();
  const results = await orchestrateVariantProfiles(
    async (profile, _accepted, attempt) => {
      calls.push({ profile, attempt });
      if (profile === "recommended") return { cards: base };
      if (profile === "consistency" && attempt === 0) return { cards: base };
      return {
        cards: diversify(base, profile === "consistency" ? "CONSISTENT" : "SPECIAL", 3),
      };
    },
    { candidatePoolSize: 50 },
  );

  assert.deepEqual(
    results.map((result) => result.variantProfile),
    VARIANT_PROFILE_IDS,
  );
  assert.deepEqual(calls, [
    { profile: "recommended", attempt: 0 },
    { profile: "consistency", attempt: 0 },
    { profile: "consistency", attempt: 1 },
    { profile: "specialization", attempt: 0 },
  ]);
  assert.equal(results[1].diversityRetries, 1);
  assert.equal(results[1].lowDiversityWarning, null);
});

test("retry exhaustion keeps the legal proposal and returns lowDiversityWarning", async () => {
  const base = fiftyCardDeck();
  let calls = 0;
  const results = await orchestrateVariantProfiles(
    async () => {
      calls += 1;
      return { cards: base };
    },
    { candidatePoolSize: 50 },
  );

  assert.equal(calls, 7);
  assert.equal(results.length, 3);
  assert.equal(results[0].lowDiversityWarning, null);
  assert.match(results[1].lowDiversityWarning ?? "", /類似度100%/);
  assert.equal(results[1].diversityRetries, 2);
  assert.equal(results[1].proposal.cards.reduce((sum, card) => sum + card.count, 0), 50);
});

test("small legal candidate pools warn without forcing impossible diversity retries", async () => {
  const base = fiftyCardDeck();
  let calls = 0;
  const results = await orchestrateVariantProfiles(
    async () => {
      calls += 1;
      return { cards: base };
    },
    { candidatePoolSize: 32 },
  );
  assert.equal(calls, 3);
  assert.match(results[1].lowDiversityWarning ?? "", /候補プールと合法性/);
});

test("deterministic comparison finds common, unique and count-delta cards", () => {
  const recommended = fiftyCardDeck();
  const consistency = diversify(recommended, "CONSISTENT", 3);
  const specialization = diversify(recommended, "SPECIAL", 3, 1);
  const variants: ComparableDeckVariant[] = [
    variant("recommended", recommended, 10),
    variant("consistency", consistency, 20),
    variant("specialization", specialization, 30),
  ];

  const first = buildDeckVariantsComparison(variants);
  const second = buildDeckVariantsComparison(variants);
  assert.deepEqual(first, second);
  assert.ok(first.commonCards.some((card) => card.cardId === "CARD-02"));
  assert.deepEqual(first.cardsByVariant.consistency.uniqueCardIds, ["CONSISTENT"]);
  assert.deepEqual(first.cardsByVariant.specialization.uniqueCardIds, ["SPECIAL"]);
  assert.ok(
    first.cardsByVariant.consistency.decreasedCards.some(
      (delta) => delta.cardId === "CARD-00" && delta.variantCount === 1,
    ),
  );
  assert.equal(first.metricsByVariant.recommended.attack, 10);
  assert.equal(first.metricsByVariant.consistency.stability, 21);
  assert.equal(first.metricsByVariant.specialization.composite, 35);
  assert.equal(first.metricsByVariant.recommended.triggerRatio, 0.1);
  assert.equal(first.metricsByVariant.recommended.counterCards, 20);
  assert.equal(first.metricsByVariant.recommended.averageCost, 4);
  assert.equal(first.metricsByVariant.recommended.majorCostBand, "mid");
});

test("any variant card list resolves to the existing draft replacement shape", () => {
  const pool = new Map([
    ["A", { id: "A", name: "Alpha" }],
    ["B", { id: "B", name: "Beta" }],
  ]);
  for (const profile of VARIANT_PROFILE_IDS) {
    const entries = resolveDeckCopyEntries(
      [
        { cardId: "A", count: profile === "recommended" ? 4 : 3 },
        { cardId: "B", count: profile === "specialization" ? 4 : 2 },
      ],
      pool,
    );
    assert.deepEqual(
      entries.map((entry) => [entry.card.id, entry.count]),
      [
        ["A", profile === "recommended" ? 4 : 3],
        ["B", profile === "specialization" ? 4 : 2],
      ],
    );
  }
});

function fiftyCardDeck(): DeckCopyEntry[] {
  return Array.from({ length: 13 }, (_, index) => ({
    cardId: `CARD-${String(index).padStart(2, "0")}`,
    count: index === 12 ? 2 : 4,
  }));
}

function diversify(
  source: DeckCopyEntry[],
  uniqueId: string,
  copies: number,
  sourceIndex = 0,
): DeckCopyEntry[] {
  return [
    ...source.map((entry, index) =>
      index === sourceIndex ? { ...entry, count: entry.count - copies } : entry,
    ),
    { cardId: uniqueId, count: copies },
  ].filter((entry) => entry.count > 0);
}

function variant(
  variantProfile: VariantProfile,
  cards: DeckCopyEntry[],
  baseScore: number,
): ComparableDeckVariant {
  return {
    variantProfile,
    cards,
    metrics: {
      costCurve: { "4": 50 },
      counterDistribution: { none: 30, "1000": 10, "2000": 10, other: 0 },
      triggerRatio: baseScore / 100,
      evaluationScores: {
        attack: baseScore,
        stability: baseScore + 1,
        expansion: baseScore + 2,
        defense: baseScore + 3,
        meta: baseScore + 4,
        composite: baseScore + 5,
      },
      majorMechanics: [{ mechanic: "OnPlay", count: 20 }],
    },
  };
}
