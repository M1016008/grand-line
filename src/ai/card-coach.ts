import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic, MODEL } from "@/ai/client";
import type { CardTranslationSource, SynergyRelationType } from "@/db/schema";
import {
  cardCoachGuideSchema,
  type CardCoachGuide,
  type CardCoachLevel,
} from "@/lib/card-coach-schema";

const MAX_RETRIES = 2;

export const CARD_COACH_PROMPT_VERSION = "card-coach-v1.0.0";

const OFFICIAL_FACT_SOURCES = new Set<CardTranslationSource>([
  "official_jp",
  "official_en",
]);

export interface CardCoachFactInput {
  id: string;
  setCode: string;
  cardType: string;
  name: string;
  colors: string[];
  attributes: string[];
  features: string[];
  mechanics: string[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  life: number | null;
  rarity: string | null;
  hasTrigger: boolean;
  imageUrlJp: string | null;
  effectText: string | null;
  triggerText: string | null;
  source: CardTranslationSource;
  verified: boolean;
}

export interface CardCoachCompatibleInput {
  card: CardCoachFactInput;
  relationType: SynergyRelationType;
  strength: number;
  reasoningJa: string;
  source: "rules" | "ai";
}

export interface CardCoachAnalysisInput {
  card: CardCoachFactInput;
  compatibleCards: CardCoachCompatibleInput[];
  level: CardCoachLevel;
}

export interface AiCardCoachResult {
  modelVersion: string;
  guide: CardCoachGuide;
}

export class CardCoachValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardCoachValidationError";
  }
}

export class UnverifiedCardFactError extends Error {
  constructor(cardId: string) {
    super(
      `${cardId} does not have verified official facts and cannot be used as Card Coach AI input.`,
    );
    this.name = "UnverifiedCardFactError";
  }
}

const RECORD_CARD_COACH_TOOL: Anthropic.Tool = {
  name: "record_card_coach",
  description:
    "Record an easy Japanese Card Coach guide. Use only the provided card id and allowed compatible card ids.",
  input_schema: {
    type: "object",
    properties: {
      summary_ja: {
        type: "string",
        description:
          "このカードは何をするカードか。小学生高学年にも分かる日本語で1-2文。",
        maxLength: 260,
      },
      roles: {
        type: "array",
        description: "このカードの役割を短い日本語ラベルで1-4個。",
        items: { type: "string", maxLength: 80 },
        minItems: 1,
        maxItems: 4,
      },
      purpose_ja: {
        type: "string",
        description: "このカードの役割をやさしく説明する文章。",
        maxLength: 260,
      },
      timing: {
        type: "array",
        description: "いつ使うか。DON!!数や序盤/中盤/終盤などを含めて1-4個。",
        items: { type: "string", maxLength: 160 },
        minItems: 1,
        maxItems: 4,
      },
      strong_situations: {
        type: "array",
        description: "どんな場面で強いかを1-4個。",
        items: { type: "string", maxLength: 160 },
        minItems: 1,
        maxItems: 4,
      },
      terms: {
        type: "array",
        description:
          "公式用語や難しい言葉の解説。例: ブロッカー — 相手の攻撃を代わりに受けられるカード。",
        items: {
          type: "object",
          properties: {
            term: { type: "string", maxLength: 40 },
            explanation_ja: { type: "string", maxLength: 140 },
          },
          required: ["term", "explanation_ja"],
          additionalProperties: false,
        },
        maxItems: 8,
      },
      compatible_cards: {
        type: "array",
        description:
          "相性の良いカード。card_idは候補カードリストのIDだけを使う。",
        items: {
          type: "object",
          properties: {
            card_id: { type: "string" },
            reason_ja: {
              type: "string",
              description: "なぜ相性が良いか。カード名ではなく役割を中心に説明。",
              maxLength: 180,
            },
          },
          required: ["card_id", "reason_ja"],
          additionalProperties: false,
        },
        maxItems: 5,
      },
      combos: {
        type: "array",
        description:
          "このカードを含む2-3枚の主要コンボ。card_idsはこのカードIDか候補カードIDだけ。",
        items: {
          type: "object",
          properties: {
            title_ja: { type: "string", maxLength: 80 },
            card_ids: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              maxItems: 3,
            },
            steps_ja: {
              type: "array",
              items: { type: "string", maxLength: 140 },
              minItems: 1,
              maxItems: 4,
            },
            why_ja: { type: "string", maxLength: 180 },
          },
          required: ["title_ja", "card_ids", "steps_ja", "why_ja"],
          additionalProperties: false,
        },
        maxItems: 3,
      },
      example_ja: {
        type: "string",
        description: "実戦での使用例を1つ。カード事実の追加説明は禁止。",
        maxLength: 260,
      },
      play_routes: {
        type: "array",
        description: "DON!!数を含むプレイルートを最大3個。",
        items: {
          type: "object",
          properties: {
            don_count: { type: "integer", minimum: 0, maximum: 10 },
            title_ja: { type: "string", maxLength: 80 },
            steps_ja: {
              type: "array",
              items: { type: "string", maxLength: 140 },
              minItems: 1,
              maxItems: 5,
            },
          },
          required: ["don_count", "title_ja", "steps_ja"],
          additionalProperties: false,
        },
        maxItems: 3,
      },
      fallback_plan_ja: {
        type: "string",
        description: "欲しいカードを引けなかった場合の代替案。",
        maxLength: 260,
      },
      common_mistakes_ja: {
        type: "array",
        description: "よくある使い方のミスを最大5個。",
        items: { type: "string", maxLength: 160 },
        maxItems: 5,
      },
    },
    required: [
      "summary_ja",
      "roles",
      "purpose_ja",
      "timing",
      "strong_situations",
      "terms",
      "compatible_cards",
      "combos",
      "example_ja",
      "play_routes",
      "fallback_plan_ja",
      "common_mistakes_ja",
    ],
    additionalProperties: false,
  },
};

const toolPayloadSchema = z
  .object({
    summary_ja: z.string().min(1).max(260),
    roles: z.array(z.string().min(1).max(80)).min(1).max(4),
    purpose_ja: z.string().min(1).max(260),
    timing: z.array(z.string().min(1).max(160)).min(1).max(4),
    strong_situations: z.array(z.string().min(1).max(160)).min(1).max(4),
    terms: z
      .array(
        z
          .object({
            term: z.string().min(1).max(40),
            explanation_ja: z.string().min(1).max(140),
          })
          .strict(),
      )
      .max(8),
    compatible_cards: z
      .array(
        z
          .object({
            card_id: z.string().min(1),
            reason_ja: z.string().min(1).max(180),
          })
          .strict(),
      )
      .max(5),
    combos: z
      .array(
        z
          .object({
            title_ja: z.string().min(1).max(80),
            card_ids: z.array(z.string().min(1)).min(2).max(3),
            steps_ja: z.array(z.string().min(1).max(140)).min(1).max(4),
            why_ja: z.string().min(1).max(180),
          })
          .strict(),
      )
      .max(3),
    example_ja: z.string().min(1).max(260),
    play_routes: z
      .array(
        z
          .object({
            don_count: z.number().int().min(0).max(10),
            title_ja: z.string().min(1).max(80),
            steps_ja: z.array(z.string().min(1).max(140)).min(1).max(5),
          })
          .strict(),
      )
      .max(3),
    fallback_plan_ja: z.string().min(1).max(260),
    common_mistakes_ja: z.array(z.string().min(1).max(160)).max(5),
  })
  .strict();

export interface CardCoachPayloadValidation {
  cardId: string;
  existingCardIds: Iterable<string>;
  compatibleCardIds: Iterable<string>;
}

export function isVerifiedOfficialFact(card: CardCoachFactInput): boolean {
  return card.verified && OFFICIAL_FACT_SOURCES.has(card.source);
}

export function assertCardCoachInputUsesVerifiedFacts(
  input: CardCoachAnalysisInput,
): void {
  if (!isVerifiedOfficialFact(input.card)) {
    throw new UnverifiedCardFactError(input.card.id);
  }

  for (const candidate of input.compatibleCards) {
    if (!isVerifiedOfficialFact(candidate.card)) {
      throw new UnverifiedCardFactError(candidate.card.id);
    }
  }
}

export function parseAndValidateCardCoachPayload(
  raw: unknown,
  validation: CardCoachPayloadValidation,
): CardCoachGuide {
  const parsed = toolPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CardCoachValidationError(
      `record_card_coach output failed schema: ${parsed.error.message}`,
    );
  }

  const existing = new Set(validation.existingCardIds);
  const compatible = new Set(validation.compatibleCardIds);
  if (!existing.has(validation.cardId)) {
    throw new CardCoachValidationError(
      `Primary card id is not known: ${validation.cardId}`,
    );
  }

  for (const entry of parsed.data.compatible_cards) {
    assertKnownCard(entry.card_id, existing);
    if (!compatible.has(entry.card_id)) {
      throw new CardCoachValidationError(
        `compatible_cards contains non-allow-listed card id: ${entry.card_id}`,
      );
    }
    if (entry.card_id === validation.cardId) {
      throw new CardCoachValidationError(
        "compatible_cards must not include the coached card itself.",
      );
    }
  }

  for (const combo of parsed.data.combos) {
    const uniqueComboIds = new Set(combo.card_ids);
    if (uniqueComboIds.size !== combo.card_ids.length) {
      throw new CardCoachValidationError(
        `combo contains duplicate card ids: ${combo.title_ja}`,
      );
    }
    if (!uniqueComboIds.has(validation.cardId)) {
      throw new CardCoachValidationError(
        `combo must include the coached card id: ${combo.title_ja}`,
      );
    }
    for (const id of uniqueComboIds) {
      assertKnownCard(id, existing);
      if (id !== validation.cardId && !compatible.has(id)) {
        throw new CardCoachValidationError(
          `combo contains non-allow-listed card id: ${id}`,
        );
      }
    }
  }

  return cardCoachGuideSchema.parse({
    summaryJa: parsed.data.summary_ja,
    roles: parsed.data.roles,
    purposeJa: parsed.data.purpose_ja,
    timing: parsed.data.timing,
    strongSituations: parsed.data.strong_situations,
    terms: parsed.data.terms.map((t) => ({
      term: t.term,
      explanationJa: t.explanation_ja,
    })),
    compatibleCards: parsed.data.compatible_cards.map((c) => ({
      cardId: c.card_id,
      reasonJa: c.reason_ja,
    })),
    combos: parsed.data.combos.map((c) => ({
      titleJa: c.title_ja,
      cardIds: c.card_ids,
      stepsJa: c.steps_ja,
      whyJa: c.why_ja,
    })),
    exampleJa: parsed.data.example_ja,
    playRoutes: parsed.data.play_routes.map((r) => ({
      donCount: r.don_count,
      titleJa: r.title_ja,
      stepsJa: r.steps_ja,
    })),
    fallbackPlanJa: parsed.data.fallback_plan_ja,
    commonMistakesJa: parsed.data.common_mistakes_ja,
  });
}

function assertKnownCard(cardId: string, existing: Set<string>): void {
  if (!existing.has(cardId)) {
    throw new CardCoachValidationError(`Unknown card id returned: ${cardId}`);
  }
}

function buildPrompt(input: CardCoachAnalysisInput): string {
  assertCardCoachInputUsesVerifiedFacts(input);

  const compatibleIds = input.compatibleCards.map((c) => c.card.id);
  const lines: string[] = [
    "あなたはワンピースカードゲームの初心者向けコーチです。",
    "下の verified DB data だけをカード事実として使い、Card Coach を日本語で作ってください。",
    "",
    "## ハードルール",
    "- カード名、効果、コスト、パワー、色、特徴などの事実を新しく作らない。",
    "- 文章では戦術の説明だけを行う。カード事実を説明し直す時は、下にある verified DB data の範囲を超えない。",
    "- card_id は「このカード」または「許可された相性カードID」だけを使う。",
    "- 相性カードを自由に追加しない。compatible_cards は候補リストからだけ選ぶ。",
    "- 公式用語は使ってよいが、出した用語は terms でやさしく説明する。",
    "- 説明レベルは easy。小学生高学年でも読める短い文にする。",
    "",
    `## このカード (${input.level})`,
    describeCard(input.card),
    "",
    `## 許可された相性カードID (${compatibleIds.length}件)`,
    compatibleIds.length > 0 ? compatibleIds.join(", ") : "(なし)",
    "",
    "## 相性・シナジー候補",
  ];

  if (input.compatibleCards.length === 0) {
    lines.push("- 候補なし。compatible_cards と combos は空配列にしてよい。");
  } else {
    for (const candidate of input.compatibleCards) {
      lines.push(describeCompatible(candidate));
    }
  }

  lines.push(
    "",
    "record_card_coach ツールを呼び出してください。free-form の説明は不要です。",
  );

  return lines.join("\n");
}

function describeCard(card: CardCoachFactInput): string {
  const parts = [
    `- id: ${card.id}`,
    `- name: ${card.name}`,
    `- type: ${card.cardType}`,
    `- colors: ${card.colors.join(", ") || "(なし)"}`,
    `- attributes: ${card.attributes.join(" / ") || "(なし)"}`,
    `- features: ${card.features.join(" / ") || "(なし)"}`,
    `- mechanics: ${card.mechanics.join(", ") || "(なし)"}`,
    `- cost/power/counter/life: ${fmt(card.cost)} / ${fmt(card.power)} / ${fmt(card.counter)} / ${fmt(card.life)}`,
    `- rarity: ${card.rarity ?? "—"}`,
    `- source: ${card.source}, verified: ${card.verified ? "1" : "0"}`,
    "- effect:",
    quote(card.effectText ?? "(効果記載なし)"),
  ];

  if (card.triggerText) {
    parts.push("- trigger:", quote(card.triggerText));
  }

  return parts.join("\n");
}

function describeCompatible(candidate: CardCoachCompatibleInput): string {
  return [
    `- candidate_id: ${candidate.card.id}`,
    `  name: ${candidate.card.name}`,
    `  type/colors: ${candidate.card.cardType} / ${candidate.card.colors.join(", ")}`,
    `  cost/power/counter/life: ${fmt(candidate.card.cost)} / ${fmt(candidate.card.power)} / ${fmt(candidate.card.counter)} / ${fmt(candidate.card.life)}`,
    `  features: ${candidate.card.features.join(" / ") || "(なし)"}`,
    `  mechanics: ${candidate.card.mechanics.join(", ") || "(なし)"}`,
    `  relation: ${candidate.relationType}, strength: ${candidate.strength.toFixed(1)} / 10, source: ${candidate.source}`,
    `  system_reasoning_ja: ${candidate.reasoningJa || "(なし)"}`,
    "  effect:",
    indent(quote(candidate.card.effectText ?? "(効果記載なし)")),
    candidate.card.triggerText
      ? `  trigger:\n${indent(quote(candidate.card.triggerText))}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function fmt(value: number | null): string {
  return value === null ? "—" : String(value);
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function validationForInput(
  input: CardCoachAnalysisInput,
): CardCoachPayloadValidation {
  return {
    cardId: input.card.id,
    existingCardIds: [
      input.card.id,
      ...input.compatibleCards.map((candidate) => candidate.card.id),
    ],
    compatibleCardIds: input.compatibleCards.map(
      (candidate) => candidate.card.id,
    ),
  };
}

function feedbackForRetry(error: Error): string {
  return [
    "前回の record_card_coach は採用できませんでした。",
    `理由: ${error.message}`,
    "schema と card_id のルールを守って、もう一度 record_card_coach を呼び出してください。",
  ].join("\n");
}

export async function analyzeCardCoach(
  input: CardCoachAnalysisInput,
  opts: {
    model?: keyof typeof MODEL;
    maxTokens?: number;
    maxRetries?: number;
  } = {},
): Promise<AiCardCoachResult> {
  assertCardCoachInputUsesVerifiedFacts(input);

  const client = getAnthropic();
  const model = MODEL[opts.model ?? "sonnet"];
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const validation = validationForInput(input);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildPrompt(input) },
  ];

  let lastError: Error = new CardCoachValidationError(
    "Model did not emit a record_card_coach tool call.",
  );

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 1800,
      tools: [RECORD_CARD_COACH_TOOL],
      tool_choice: { type: "tool", name: "record_card_coach" },
      messages,
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "record_card_coach",
    );

    if (!toolUse) {
      lastError = new CardCoachValidationError(
        "Model did not emit a record_card_coach tool call.",
      );
    } else {
      try {
        return {
          modelVersion: `${model}@${new Date().toISOString().slice(0, 10)}`,
          guide: parseAndValidateCardCoachPayload(toolUse.input, validation),
        };
      } catch (err) {
        lastError = err as Error;
      }
    }

    if (attempt < maxRetries) {
      messages.push(
        { role: "assistant", content: response.content },
        { role: "user", content: feedbackForRetry(lastError) },
      );
    }
  }

  throw lastError;
}

export const _cardCoachTestInternals = {
  buildPrompt,
  RECORD_CARD_COACH_TOOL,
};
