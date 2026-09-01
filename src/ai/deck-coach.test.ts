import test from "node:test";
import assert from "node:assert/strict";

import { MissingApiKeyError } from "@/ai/client";
import type { CardCoachFactInput } from "@/ai/card-coach";
import {
  _deckCoachTestInternals,
  analyzeDeckCoach,
  assertDeckCoachInputUsesVerifiedFacts,
  DeckCoachUnverifiedFactInputError,
  DeckCoachValidationError,
  parseAndValidateDeckCoachPayload,
  type DeckCoachAnalysisInput,
} from "@/ai/deck-coach";
import { buildDeckCoachMetrics } from "@/lib/deck-coach-metrics";

function fact(
  id: string,
  overrides: Partial<CardCoachFactInput> = {},
): CardCoachFactInput {
  return {
    id,
    setCode: "OP01",
    cardType: "CHARACTER",
    name: id,
    colors: ["red"],
    attributes: ["打撃"],
    features: ["麦わらの一味"],
    mechanics: ["OnPlay"],
    cost: 1,
    power: 2000,
    counter: 1000,
    life: null,
    rarity: "C",
    hasTrigger: false,
    imageUrlJp: null,
    effectText: "公式確認済みの効果。",
    triggerText: null,
    source: "official_jp",
    verified: true,
    ...overrides,
  };
}

const leader = fact("OP01-001", {
  cardType: "LEADER",
  name: "リーダー",
  cost: null,
  power: 5000,
  counter: null,
  life: 5,
});
const deckCard = fact("OP01-002");

function input(): DeckCoachAnalysisInput {
  const cards = [{ card: deckCard, count: 50 }];
  return {
    deck: { id: "deck-1", name: "赤デッキ", leader, cards },
    systemMetrics: buildDeckCoachMetrics(leader, cards),
    aiDerivedReferences: [],
    knownCardIds: [leader.id, deckCard.id, "OP01-003"],
    level: "easy",
  };
}

function validPayload() {
  return {
    level: "easy" as const,
    deckSummaryJa: "小さいキャラを出しながら、毎ターン攻めるデッキです。",
    archetypeJa: "赤・テンポ",
    winConditionsJa: ["場のキャラを残して、攻撃回数を増やします。"],
    keyCards: [{ cardId: "OP01-002", roleJa: "序盤の動きを作ります。" }],
    mulligan: {
      keepCardIds: ["OP01-002"],
      flexibleCardIds: [],
      returnCardIds: [],
      explanationJa: "最初のターンから使えるカードを残します。",
    },
    idealOpeningJa: ["1コストのカードを1枚持ちます。"],
    firstPlayerPlan: ["先に場を作ります。"],
    secondPlayerPlan: ["手札を増やしながら場を作ります。"],
    donPlan: [
      {
        donCount: 1,
        actionJa: "OP01-002を使って場を作ります。",
        referencedCardIds: ["OP01-002"],
      },
    ],
    combos: [
      {
        titleJa: "リーダーと序盤カード",
        cardIds: ["OP01-001", "OP01-002"],
        stepsJa: ["カードを出します。", "リーダーで攻めます。"],
        purposeJa: "攻撃回数を増やします。",
      },
    ],
    plans: {
      planAJa: "場を広げて攻めます。",
      planBJa: "手札を守って次のターンに備えます。",
      planCJa: "リーダー中心で少しずつ攻めます。",
    },
    finishMethodsJa: ["攻撃回数を増やして最後のライフをねらいます。"],
    weakBoardsJa: ["相手に大きなキャラが何枚もいる盤面です。"],
    weakMatchupsJa: ["守りを固めて長く戦うデッキが苦手です。"],
    commonMistakesJa: ["手札を全部使い切らないようにします。"],
  };
}

const validation = {
  leaderId: leader.id,
  deckCardIds: [deckCard.id],
  existingCardIds: [leader.id, deckCard.id, "OP01-003"],
  cardCosts: new Map<string, number | null>([
    [leader.id, null],
    [deckCard.id, 1],
  ]),
};

test("Deck Coach AI output schema accepts the required easy guide", () => {
  const guide = parseAndValidateDeckCoachPayload(validPayload(), validation);
  assert.equal(guide.level, "easy");
  assert.equal(guide.keyCards[0].cardId, deckCard.id);
});

test("Deck Coach rejects malformed AI output", () => {
  const raw: Record<string, unknown> = validPayload();
  delete raw.plans;
  assert.throws(
    () => parseAndValidateDeckCoachPayload(raw, validation),
    DeckCoachValidationError,
  );
});

test("Deck Coach rejects an unknown card id returned by AI", () => {
  const raw = validPayload();
  raw.keyCards[0].cardId = "OP99-999";
  assert.throws(
    () => parseAndValidateDeckCoachPayload(raw, validation),
    /unknown card id: OP99-999/,
  );
});

test("Deck Coach rejects a known card id outside the saved deck", () => {
  const raw = validPayload();
  raw.keyCards[0].cardId = "OP01-003";
  assert.throws(
    () => parseAndValidateDeckCoachPayload(raw, validation),
    /outside the saved deck: OP01-003/,
  );
});

test("Deck Coach excludes unverified card facts from AI input", () => {
  const candidate = input();
  candidate.deck.cards[0].card = fact("OP01-002", {
    source: "manual",
    verified: false,
  });
  assert.throws(
    () => assertDeckCoachInputUsesVerifiedFacts(candidate),
    DeckCoachUnverifiedFactInputError,
  );
});

test("Deck Coach rejects a DON!! plan whose printed costs exceed the turn budget", () => {
  const raw = validPayload();
  raw.donPlan[0].donCount = 1;
  assert.throws(
    () =>
      parseAndValidateDeckCoachPayload(raw, {
        ...validation,
        cardCosts: new Map([
          [leader.id, null],
          [deckCard.id, 2],
        ]),
      }),
    /printed costs totaling 2/,
  );
});

test("Deck Coach prompt separates facts, metrics, and AI-derived reference", () => {
  const candidate = input();
  candidate.aiDerivedReferences = [
    {
      cardId: deckCard.id,
      roles: ["AI_REFERENCE_ROLE"],
      purposeJa: "AI_REFERENCE_PURPOSE",
      timing: ["AI_REFERENCE_TIMING"],
      source: "card_coach",
    },
  ];
  const prompt = _deckCoachTestInternals.buildPrompt(candidate);
  assert.match(prompt, /verified official facts/);
  assert.match(prompt, /system deterministic metrics/);
  assert.match(prompt, /AI-derived tactical reference \(not card facts\)/);
  assert.match(prompt, /AI_REFERENCE_PURPOSE/);
});

test("Deck Coach generation reports the missing API key state", async () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    await assert.rejects(
      () => analyzeDeckCoach(input(), { maxRetries: 0 }),
      MissingApiKeyError,
    );
  } finally {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  }
});
