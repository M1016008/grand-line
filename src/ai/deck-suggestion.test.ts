import test from "node:test";
import assert from "node:assert/strict";

import {
  _deckSuggestionTestInternals,
  buildPostGenerationMetrics,
  buildCandidatePool,
  DeckSuggestionError,
  proposeDeck,
} from "./deck-suggestion";
import type { CardCoachFactInput } from "@/ai/card-coach";
import {
  buildDeckCandidateRankingContext,
  calculateLeaderStyleAptitudes,
  FEATURE_TAG_IDS,
  FEATURE_TAG_MECHANIC_SIGNALS,
  MAIN_STYLE_IDS,
  resolveDeckPreferences,
  scoreDeckCandidate,
  type FeatureTag,
} from "@/lib/deck-intelligence-preferences";

/**
 * Live network calls are gated on ANTHROPIC_API_KEY (and would burn money
 * on every test run). These tests cover the deterministic surface:
 * pool compression, the early-exit on a non-leader input, and the
 * graceful error when the key is absent.
 */

function card(o: Partial<CardCoachFactInput>): CardCoachFactInput {
  return {
    id: "OP01-XXX",
    setCode: "OP01",
    cardType: "CHARACTER",
    name: "Mock",
    colors: ["red"],
    features: ["麦わらの一味"],
    attributes: [],
    mechanics: [],
    cost: 3,
    power: 4000,
    counter: 1000,
    life: null,
    rarity: "C",
    hasTrigger: false,
    imageUrlJp: null,
    effectText: "【登場時】テスト効果。",
    triggerText: null,
    source: "official_jp",
    verified: true,
    ...o,
  };
}

const RED_LEADER = card({
  id: "OP01-001",
  cardType: "LEADER",
  name: "Leader",
  features: ["麦わらの一味", "超新星"],
  power: 5000,
  life: 5,
  rarity: "L",
});

test("Deck Intelligence exposes the required main styles", () => {
  assert.deepEqual(MAIN_STYLE_IDS, [
    "auto",
    "aggressive",
    "midrange",
    "defensive",
    "removal",
    "control",
    "resource",
    "combo",
    "tempo",
    "ramp",
    "balanced",
  ]);
});

test("buildCandidatePool excludes leader card and off-color cards", () => {
  const pool: CardCoachFactInput[] = [
    RED_LEADER,
    card({ id: "OP01-RED", colors: ["red"] }),
    card({ id: "OP01-GREEN", colors: ["green"] }),
    card({ id: "OP01-DUAL", colors: ["red", "green"] }),
    card({ id: "OP01-LEADER2", cardType: "LEADER", colors: ["red"] }),
  ];
  const out = buildCandidatePool(RED_LEADER, pool);
  const ids = out.map((c) => c.id);
  assert.ok(!ids.includes(RED_LEADER.id), "should drop the leader itself");
  assert.ok(!ids.includes("OP01-LEADER2"), "should drop other leader cards");
  assert.ok(!ids.includes("OP01-GREEN"), "off-color drops");
  assert.ok(ids.includes("OP01-RED"));
  assert.ok(ids.includes("OP01-DUAL"));
});

test("buildCandidatePool prioritises feature-matched cards over filler", () => {
  const pool: CardCoachFactInput[] = [
    RED_LEADER,
    ...Array.from({ length: 10 }, (_, i) =>
      card({
        id: `RED-MATCH-${i}`,
        features: ["麦わらの一味"], // shares
      }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      card({
        id: `RED-FILLER-${i}`,
        features: ["他海賊団"], // no overlap
      }),
    ),
  ];
  const out = buildCandidatePool(RED_LEADER, pool);
  // The first 10 (or up to cap) must be the feature-matched bucket.
  for (let i = 0; i < 10; i++) {
    assert.ok(
      out[i].id.startsWith("RED-MATCH"),
      `slot ${i} should be feature-matched, got ${out[i].id}`,
    );
  }
});

test("buildCandidatePool excludes cards without verified official facts", () => {
  const pool = [
    card({ id: "OFFICIAL" }),
    card({ id: "MANUAL", source: "manual", verified: false }),
    card({ id: "AI", source: "ai_translated", verified: false }),
  ];
  assert.deepEqual(
    buildCandidatePool(RED_LEADER, pool).map((candidate) => candidate.id),
    ["OFFICIAL"],
  );
});

test("feature tags change deterministic candidate order", () => {
  const neutral = card({ id: "AAA-NEUTRAL", mechanics: [] });
  const trigger = card({
    id: "ZZZ-TRIGGER",
    hasTrigger: true,
    mechanics: ["Trigger"],
  });
  assert.deepEqual(
    buildCandidatePool(RED_LEADER, [neutral, trigger]).map((candidate) =>
      candidate.id,
    ),
    ["AAA-NEUTRAL", "ZZZ-TRIGGER"],
  );
  assert.deepEqual(
    buildCandidatePool(
      RED_LEADER,
      [neutral, trigger],
      resolveDeckPreferences("auto", ["trigger_focus"]),
    ).map((candidate) => candidate.id),
    ["ZZZ-TRIGGER", "AAA-NEUTRAL"],
  );
});

test("every feature tag contributes to its deterministic signal", () => {
  const neutral = card({
    id: "NEUTRAL",
    cost: 5,
    power: 5000,
    counter: 0,
    mechanics: [],
    hasTrigger: false,
  });
  const signals: Record<FeatureTag, Partial<CardCoachFactInput>> = {
    trigger_focus: { hasTrigger: true, mechanics: ["Trigger"] },
    search_focus: { mechanics: ["Search"] },
    blocker_focus: { mechanics: ["Blocker"] },
    wide_board: { cost: 2, mechanics: ["OnPlay"] },
    high_cost_focus: { cost: 8, power: 9000 },
    bounce_focus: { mechanics: ["ReturnToHand"] },
    hand_disruption: { mechanics: ["Discard"] },
    cost_manipulation: { mechanics: ["CostReduction"] },
    life_manipulation: { mechanics: ["AddToLife"] },
    trash_utilization: { mechanics: ["PlayFromTrash"] },
    counter_focus: { counter: 2000 },
    finisher_focus: { cost: 8, power: 9000, mechanics: ["Rush"] },
  };

  for (const tag of FEATURE_TAG_IDS) {
    const selection = resolveDeckPreferences("auto", [tag]);
    const signal = card({ id: `SIGNAL-${tag}`, ...signals[tag] });
    assert.ok(
      scoreDeckCandidate(RED_LEADER, signal, selection).featureTags >
        scoreDeckCandidate(RED_LEADER, neutral, selection).featureTags,
      `${tag} should add a deterministic ranking signal`,
    );
  }
});

test("feature-tag mechanic mapping matches names observed in the real DB audit", () => {
  const auditedCounts: Record<string, number> = {
    Trigger: 479,
    Search: 146,
    Look: 229,
    Blocker: 340,
    OnPlay: 803,
    ReturnToHand: 93,
    Discard: 3,
    CostReduction: 79,
    AddToLife: 115,
    PlayFromTrash: 7,
    OnKO: 159,
    Rush: 87,
    Banish: 22,
    PowerBuff: 433,
    OnAttack: 237,
  };
  for (const mechanics of Object.values(FEATURE_TAG_MECHANIC_SIGNALS)) {
    for (const mechanic of mechanics) {
      assert.ok(
        auditedCounts[mechanic] > 0,
        `${mechanic} must exist in the audited DB`,
      );
    }
  }
  const allSignals = Object.values(FEATURE_TAG_MECHANIC_SIGNALS).flat();
  assert.ok(!allSignals.includes("Counter"));
  assert.ok(!allSignals.includes("DoubleAttack"));
  assert.deepEqual(FEATURE_TAG_MECHANIC_SIGNALS.counter_focus, []);
});

test("main styles produce different deterministic rankings", () => {
  const rush = card({ id: "RUSH", cost: 2, mechanics: ["Rush", "OnAttack"] });
  const guard = card({
    id: "GUARD",
    cost: 6,
    counter: 2000,
    mechanics: ["Blocker", "DuringOpponentTurn"],
  });
  assert.equal(
    buildCandidatePool(
      RED_LEADER,
      [rush, guard],
      resolveDeckPreferences("aggressive"),
    )[0].id,
    "RUSH",
  );
  assert.equal(
    buildCandidatePool(
      RED_LEADER,
      [rush, guard],
      resolveDeckPreferences("defensive"),
    )[0].id,
    "GUARD",
  );
});

test("ranking reuses leader, compatibility, searchability, feature and persisted synergy signals", () => {
  const searcher = card({
    id: "SEARCHER",
    mechanics: ["Search"],
    features: ["麦わらの一味", "東の海"],
  });
  const finisher = card({
    id: "FINISHER",
    cost: 7,
    mechanics: ["Rush"],
    features: ["麦わらの一味", "東の海"],
  });
  const context = buildDeckCandidateRankingContext(
    RED_LEADER,
    [searcher, finisher],
    [
      {
        fromCardId: RED_LEADER.id,
        toCardId: finisher.id,
        relationType: "leader_direct",
        strength: 9,
        reasoningJa: "保存済み相性",
        reasoningEn: "persisted synergy",
      },
    ],
  );
  const searchEvidence = context.evidenceByCardId.get(searcher.id)!;
  const finisherEvidence = context.evidenceByCardId.get(finisher.id)!;
  assert.ok(searchEvidence.leaderDirect > 0);
  assert.ok(searchEvidence.compatibleRelationships > 0);
  assert.ok(searchEvidence.searchability > 0);
  assert.ok(searchEvidence.featureSupport > 0);
  assert.equal(finisherEvidence.synergyData, 9);
});

test("leader aptitude uses leader mechanics and legal support availability", () => {
  const leader = card({
    ...RED_LEADER,
    mechanics: ["Rush", "OnAttack", "PowerBuff"],
  });
  const pool = [
    ...Array.from({ length: 36 }, (_, index) =>
      card({
        id: `ATTACK-${index}`,
        cost: 2,
        mechanics: ["Rush", "OnAttack"],
      }),
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      card({ id: `BLOCK-${index}`, cost: 6, mechanics: ["Blocker"] }),
    ),
  ];
  const aptitudes = calculateLeaderStyleAptitudes(leader, pool);
  const aggressive = aptitudes.find((item) => item.style === "aggressive")!;
  const defensive = aptitudes.find((item) => item.style === "defensive")!;
  assert.ok(aggressive.score > defensive.score);
  assert.ok(aggressive.signals.supportCards > defensive.signals.supportCards);
  assert.ok(aggressive.stars >= defensive.stars);
});

test("main style remains stronger than one auxiliary feature tag", () => {
  const aggressive = card({
    id: "AGGRESSIVE",
    cost: 2,
    power: 6000,
    counter: 0,
    mechanics: ["Rush"],
  });
  const blocker = card({
    id: "BLOCKER",
    cost: 6,
    power: 5000,
    counter: 0,
    mechanics: ["Blocker"],
  });
  const ranked = buildCandidatePool(
    RED_LEADER,
    [blocker, aggressive],
    resolveDeckPreferences("aggressive", ["blocker_focus"]),
  );
  assert.equal(ranked[0].id, "AGGRESSIVE");
});

test("feature tag selection allows zero to three unique tags only", () => {
  assert.deepEqual(resolveDeckPreferences("auto", []).selectedTags, []);
  assert.equal(
    resolveDeckPreferences("balanced", FEATURE_TAG_IDS.slice(0, 3)).selectedTags
      .length,
    3,
  );
  assert.throws(
    () => resolveDeckPreferences("auto", FEATURE_TAG_IDS.slice(0, 4)),
    /at most 3/i,
  );
  assert.throws(
    () => resolveDeckPreferences("auto", ["trigger_focus", "trigger_focus"]),
    /duplicates/i,
  );
});

test("prompt keeps main style and feature tags as separate instructions", () => {
  const selection = resolveDeckPreferences("tempo", [
    "bounce_focus",
    "counter_focus",
  ]);
  const prompt = _deckSuggestionTestInternals.buildUserPrompt(
    {
      leader: RED_LEADER,
      pool: [],
      selectedStyle: selection.selectedStyle,
      selectedTags: selection.selectedTags,
      regulations: {},
    },
    [card({ id: "CANDIDATE" })],
    selection,
    "tempo",
    calculateLeaderStyleAptitudes(RED_LEADER, [card({ id: "CANDIDATE" })]),
  );
  assert.match(prompt, /main_style: tempo \/ テンポ型/);
  assert.match(prompt, /bounce_focus \/ バウンス/);
  assert.match(prompt, /counter_focus \/ カウンター重視/);
  assert.match(prompt, /main_style を構築の主軸/);
});

test("prompt uses verified official effect and trigger text only", () => {
  const official = card({
    id: "OFFICIAL-EFFECT",
    effectText: "公式の効果本文",
    triggerText: "公式のトリガー本文",
  });
  const manual = card({
    id: "MANUAL-EFFECT",
    source: "manual",
    verified: true,
    effectText: "混入してはいけないmanual本文",
  });
  const selection = resolveDeckPreferences("balanced");
  const candidates = buildCandidatePool(RED_LEADER, [official, manual], selection);
  const prompt = _deckSuggestionTestInternals.buildUserPrompt(
    {
      leader: RED_LEADER,
      pool: candidates,
      regulations: {},
    },
    candidates,
    selection,
    "balanced",
    calculateLeaderStyleAptitudes(RED_LEADER, candidates),
  );
  assert.match(prompt, /公式の効果本文/);
  assert.match(prompt, /公式のトリガー本文/);
  assert.doesNotMatch(prompt, /混入してはいけないmanual本文/);
});

test("system prompt has style-specific guidance without universal deck ratios", () => {
  const prompt = _deckSuggestionTestInternals.buildSystem("aggressive");
  assert.match(prompt, /選択スタイルの方針/);
  assert.doesNotMatch(prompt, /1-3 コスト中心/);
  assert.doesNotMatch(prompt, /8-12 枚/);
  assert.doesNotMatch(prompt, /12-16 枚/);
});

test("proposal schema requires per-card roles and reasons", () => {
  const valid = {
    archetype_name: "テスト",
    cards: Array.from({ length: 13 }, (_, index) => ({
      card_id: `CARD-${index}`,
      count: index === 12 ? 2 : 4,
      role_ja: "展開役",
      selection_reason_ja: "リーダー特徴を支えるため。",
    })),
    win_condition: "勝ち筋",
    deck_concept_ja: "コンセプト",
    style_aptitude_reason_ja: "適性理由",
    key_cards: ["CARD-0"],
    major_combos: [
      {
        title_ja: "主要コンボ",
        card_ids: ["CARD-0", "CARD-1"],
        explanation_ja: "組み合わせの理由。",
      },
    ],
    curve_explanation_ja: "カーブ説明",
    strengths: [],
    weaknesses: [],
    typical_matchups: { favorable: [], unfavorable: [] },
  };
  assert.equal(_deckSuggestionTestInternals.proposalSchema.safeParse(valid).success, true);
  const missingReason = structuredClone(valid);
  delete (missingReason.cards[0] as Partial<(typeof valid.cards)[number]>).selection_reason_ja;
  assert.equal(
    _deckSuggestionTestInternals.proposalSchema.safeParse(missingReason).success,
    false,
  );
});

test("post-generation metrics are deterministic and derived from 50 cards", () => {
  const entries = Array.from({ length: 13 }, (_, index) => ({
    card: card({
      id: `METRIC-${index}`,
      cost: index % 5,
      counter: index % 2 === 0 ? 2000 : 0,
      hasTrigger: index === 0,
      mechanics: index === 0 ? ["Trigger", "OnPlay"] : ["OnPlay"],
    }),
    count: index === 12 ? 2 : 4,
  }));
  const first = buildPostGenerationMetrics(RED_LEADER, entries);
  const second = buildPostGenerationMetrics(RED_LEADER, entries);
  assert.deepEqual(first, second);
  assert.equal(Object.values(first.costCurve).reduce((sum, count) => sum + count, 0), 50);
  assert.equal(first.triggerRatio, 0.08);
  assert.equal(first.majorMechanics[0].mechanic, "OnPlay");
  assert.equal(typeof first.evaluationScores.composite, "number");
});

test("proposal validation keeps current active restrictions", () => {
  const candidates = Array.from({ length: 13 }, (_, index) =>
    card({ id: `RESTRICT-${String(index + 1).padStart(2, "0")}` }),
  );
  const raw = {
    archetype_name: "制限確認",
    cards: candidates.map((candidate, index) => ({
      card_id: candidate.id,
      count: index === candidates.length - 1 ? 2 : 4,
      role_ja: "役割",
      selection_reason_ja: "採用理由",
    })),
    win_condition: "テスト",
    deck_concept_ja: "コンセプト",
    style_aptitude_reason_ja: "適性理由",
    key_cards: [candidates[0].id],
    major_combos: [],
    curve_explanation_ja: "カーブ説明",
    strengths: [],
    weaknesses: [],
    typical_matchups: { favorable: [], unfavorable: [] },
  };
  const result = _deckSuggestionTestInternals.validateProposal(
    raw,
    RED_LEADER,
    new Map(candidates.map((candidate) => [candidate.id, candidate])),
    { perCardMax: new Map([[candidates[0].id, 0]]) },
  );
  assert.ok(
    result.violations.some((violation) => violation.code === "banned_card"),
  );
});

test("proposeDeck rejects a non-LEADER input synchronously", async () => {
  await assert.rejects(
    () =>
      proposeDeck({
        leader: card({ cardType: "CHARACTER" }),
        pool: [],
        regulations: {},
      }),
    (e) => {
      assert.ok(e instanceof DeckSuggestionError);
      return true;
    },
  );
});

test("proposeDeck rejects an empty pool synchronously", async () => {
  await assert.rejects(
    () => proposeDeck({ leader: RED_LEADER, pool: [], regulations: {} }),
    (e) => {
      assert.ok(e instanceof DeckSuggestionError);
      assert.match((e as Error).message, /pool too small/i);
      return true;
    },
  );
});

test("proposeDeck propagates MissingApiKeyError when the env var is unset", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const fatPool = Array.from({ length: 80 }, (_, i) =>
      card({ id: `RED-${i}`, features: ["麦わらの一味"] }),
    );
    await assert.rejects(
      () =>
        proposeDeck({ leader: RED_LEADER, pool: fatPool, regulations: {} }),
      (e) => {
        assert.equal((e as Error).name, "MissingApiKeyError");
        return true;
      },
    );
  } finally {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  }
});
