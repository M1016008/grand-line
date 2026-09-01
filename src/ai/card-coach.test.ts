import test from "node:test";
import assert from "node:assert/strict";

import { MissingApiKeyError } from "@/ai/client";
import {
  analyzeCardCoach,
  assertCardCoachInputUsesVerifiedFacts,
  CardCoachValidationError,
  parseAndValidateCardCoachPayload,
  UnverifiedCardFactError,
  _cardCoachTestInternals,
  type CardCoachCompatibleInput,
  type CardCoachFactInput,
} from "@/ai/card-coach";

function fact(overrides: Partial<CardCoachFactInput> = {}): CardCoachFactInput {
  return {
    id: "OP01-001",
    setCode: "OP01",
    cardType: "LEADER",
    name: "モンキー・D・ルフィ",
    colors: ["red"],
    attributes: ["打撃"],
    features: ["麦わらの一味"],
    mechanics: ["OnAttack"],
    cost: null,
    power: 5000,
    counter: null,
    life: 5,
    rarity: "L",
    hasTrigger: false,
    imageUrlJp: null,
    effectText: "[アタック時] このリーダーにDON!!を付与する。",
    triggerText: null,
    source: "official_jp",
    verified: true,
    ...overrides,
  };
}

function validPayload() {
  return {
    summary_ja: "このカードは攻める準備をしながら、相手のライフをねらうカードです。",
    roles: ["攻めの中心", "DON!!を使う役"],
    purpose_ja: "リーダーとして攻撃の流れを作り、手札のカードを出しやすくします。",
    timing: ["中盤にDON!!が増えてから、攻撃と展開を同じターンに進めます。"],
    strong_situations: ["場に仲間が残っていて、相手のライフを大きく削りたい時に強いです。"],
    terms: [
      {
        term: "DON!!",
        explanation_ja: "カードを出したり、攻撃を強くしたりするための力です。",
      },
    ],
    compatible_cards: [
      {
        card_id: "OP01-016",
        reason_ja: "序盤に必要なカードを探し、リーダーの攻めにつなげやすいです。",
      },
    ],
    combos: [
      {
        title_ja: "探してから攻める",
        card_ids: ["OP01-001", "OP01-016"],
        steps_ja: ["先に手札を整えます。", "次の攻撃でリーダーの動きを強く使います。"],
        why_ja: "ほしいカードを探してから攻めるので、動きが止まりにくいです。",
      },
    ],
    example_ja: "自分の場に仲間がいる中盤で、攻撃しながら次の展開も考えます。",
    play_routes: [
      {
        don_count: 5,
        title_ja: "中盤の攻め",
        steps_ja: ["低コストカードを出します。", "残ったDON!!でリーダーを強くします。"],
      },
    ],
    fallback_plan_ja: "探したいカードがない時は、手札を守りながら次のターンに備えます。",
    common_mistakes_ja: ["手札が少ないのに、無理に攻めすぎないようにします。"],
  };
}

test("Card Coach AI output schema normalizes to the UI guide shape", () => {
  const guide = parseAndValidateCardCoachPayload(validPayload(), {
    cardId: "OP01-001",
    existingCardIds: ["OP01-001", "OP01-016"],
    compatibleCardIds: ["OP01-016"],
  });

  assert.equal(guide.summaryJa, validPayload().summary_ja);
  assert.deepEqual(guide.roles, ["攻めの中心", "DON!!を使う役"]);
  assert.deepEqual(guide.compatibleCards, [
    {
      cardId: "OP01-016",
      reasonJa: "序盤に必要なカードを探し、リーダーの攻めにつなげやすいです。",
    },
  ]);
  assert.equal(guide.playRoutes[0].donCount, 5);
});

test("Card Coach rejects malformed AI output before persistence", () => {
  const raw = validPayload();
  Reflect.deleteProperty(raw, "summary_ja");

  assert.throws(
    () =>
      parseAndValidateCardCoachPayload(raw, {
        cardId: "OP01-001",
        existingCardIds: ["OP01-001", "OP01-016"],
        compatibleCardIds: ["OP01-016"],
      }),
    CardCoachValidationError,
  );
});

test("Card Coach rejects unknown card ids returned by AI", () => {
  const raw = validPayload();
  raw.combos[0].card_ids = ["OP01-001", "OP99-999"];

  assert.throws(
    () =>
      parseAndValidateCardCoachPayload(raw, {
        cardId: "OP01-001",
        existingCardIds: ["OP01-001", "OP01-016"],
        compatibleCardIds: ["OP01-016"],
      }),
    /Unknown card id returned: OP99-999/,
  );
});

test("Card Coach rejects compatible card ids outside the allow-list", () => {
  const raw = validPayload();
  raw.compatible_cards[0].card_id = "OP01-013";

  assert.throws(
    () =>
      parseAndValidateCardCoachPayload(raw, {
        cardId: "OP01-001",
        existingCardIds: ["OP01-001", "OP01-016", "OP01-013"],
        compatibleCardIds: ["OP01-016"],
      }),
    /non-allow-listed card id: OP01-013/,
  );
});

test("Card Coach refuses unverified card facts as AI input", () => {
  assert.throws(
    () =>
      assertCardCoachInputUsesVerifiedFacts({
        card: fact({ source: "manual", verified: false }),
        compatibleCards: [],
        level: "easy",
      }),
    UnverifiedCardFactError,
  );
});

test("Card Coach prompt omits AI compatible reasoning but keeps verified facts", () => {
  const compatibleCards: CardCoachCompatibleInput[] = [
    {
      card: fact({
        id: "OP01-016",
        cardType: "CHARACTER",
        name: "Rules Candidate",
      }),
      relationType: "tempo_combo",
      strength: 8,
      reasoningJa: "RULE_REASONING_SAFE",
      source: "rules",
    },
    {
      card: fact({
        id: "OP01-017",
        cardType: "CHARACTER",
        name: "AI Candidate",
        effectText: "AI candidate verified effect text",
      }),
      relationType: "resource_engine",
      strength: 7,
      reasoningJa: "AI_REASONING_SHOULD_NOT_APPEAR",
      source: "ai",
    },
  ];

  const prompt = _cardCoachTestInternals.buildPrompt({
    card: fact(),
    compatibleCards,
    level: "easy",
  });

  assert.match(prompt, /RULE_REASONING_SAFE/);
  assert.doesNotMatch(prompt, /AI_REASONING_SHOULD_NOT_APPEAR/);
  assert.match(prompt, /OP01-017/);
  assert.match(prompt, /AI Candidate/);
  assert.match(prompt, /AI candidate verified effect text/);
});

test("Card Coach generation reports the missing API key state", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  try {
    await assert.rejects(
      () =>
        analyzeCardCoach(
          {
            card: fact(),
            compatibleCards: [],
            level: "easy",
          },
          { maxRetries: 0 },
        ),
      MissingApiKeyError,
    );
  } finally {
    if (originalKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalKey;
    }
  }
});
