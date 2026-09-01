import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { getAnthropic, MODEL } from "@/ai/client";
import {
  isVerifiedOfficialFact,
  type CardCoachFactInput,
} from "@/ai/card-coach";
import type { DeckCoachDeterministicMetrics } from "@/lib/deck-coach-metrics";
import {
  deckCoachGuideSchema,
  type DeckCoachGuide,
  type DeckCoachLevel,
} from "@/lib/deck-coach-schema";

const MAX_RETRIES = 2;

export const DECK_COACH_PROMPT_VERSION = "deck-coach-v1.0.0";

export interface DeckCoachDeckCardInput {
  card: CardCoachFactInput;
  count: number;
}

export interface DeckCoachAiReference {
  cardId: string;
  roles: string[];
  purposeJa: string;
  timing: string[];
  source: "card_coach";
}

export interface DeckCoachAnalysisInput {
  deck: {
    id: string;
    name: string;
    leader: CardCoachFactInput;
    cards: DeckCoachDeckCardInput[];
  };
  systemMetrics: DeckCoachDeterministicMetrics;
  aiDerivedReferences: DeckCoachAiReference[];
  knownCardIds: string[];
  level: DeckCoachLevel;
}

export interface AiDeckCoachResult {
  modelVersion: string;
  guide: DeckCoachGuide;
}

export interface DeckCoachPayloadValidation {
  leaderId: string;
  deckCardIds: Iterable<string>;
  existingCardIds: Iterable<string>;
  cardCosts: ReadonlyMap<string, number | null>;
}

export class DeckCoachValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeckCoachValidationError";
  }
}

export class DeckCoachUnverifiedFactInputError extends Error {
  constructor(cardId: string) {
    super(
      `${cardId} does not have verified official facts and cannot be used as Deck Coach AI input.`,
    );
    this.name = "DeckCoachUnverifiedFactInputError";
  }
}

const deckCoachToolInputSchema = z.toJSONSchema(deckCoachGuideSchema, {
  target: "draft-7",
}) as Anthropic.Tool["input_schema"];

const RECORD_DECK_COACH_TOOL: Anthropic.Tool = {
  name: "record_deck_coach",
  description:
    "Record an easy Japanese Deck Coach guide using only the supplied verified deck facts and deterministic metrics.",
  input_schema: deckCoachToolInputSchema,
};

export function assertDeckCoachInputUsesVerifiedFacts(
  input: DeckCoachAnalysisInput,
): void {
  if (!isVerifiedOfficialFact(input.deck.leader)) {
    throw new DeckCoachUnverifiedFactInputError(input.deck.leader.id);
  }
  for (const entry of input.deck.cards) {
    if (!isVerifiedOfficialFact(entry.card)) {
      throw new DeckCoachUnverifiedFactInputError(entry.card.id);
    }
  }
}

export function parseAndValidateDeckCoachPayload(
  raw: unknown,
  validation: DeckCoachPayloadValidation,
): DeckCoachGuide {
  const parsed = deckCoachGuideSchema.safeParse(raw);
  if (!parsed.success) {
    throw new DeckCoachValidationError(
      `record_deck_coach output failed schema: ${parsed.error.message}`,
    );
  }

  const existing = new Set(validation.existingCardIds);
  const deckCards = new Set(validation.deckCardIds);
  const allowed = new Set([validation.leaderId, ...deckCards]);
  const guide = parsed.data;

  const assertAllowed = (id: string, context: string): void => {
    if (!existing.has(id)) {
      throw new DeckCoachValidationError(
        `${context} contains unknown card id: ${id}`,
      );
    }
    if (!allowed.has(id)) {
      throw new DeckCoachValidationError(
        `${context} contains card id outside the saved deck: ${id}`,
      );
    }
  };

  assertUnique(guide.keyCards.map((entry) => entry.cardId), "keyCards");
  for (const entry of guide.keyCards) assertAllowed(entry.cardId, "keyCards");

  const mulliganGroups = [
    ["mulligan.keepCardIds", guide.mulligan.keepCardIds],
    ["mulligan.flexibleCardIds", guide.mulligan.flexibleCardIds],
    ["mulligan.returnCardIds", guide.mulligan.returnCardIds],
  ] as const;
  const mulliganSeen = new Set<string>();
  for (const [label, ids] of mulliganGroups) {
    assertUnique(ids, label);
    for (const id of ids) {
      assertAllowed(id, label);
      if (!deckCards.has(id)) {
        throw new DeckCoachValidationError(
          `${label} can only contain main-deck card ids: ${id}`,
        );
      }
      if (mulliganSeen.has(id)) {
        throw new DeckCoachValidationError(
          `Mulligan card id appears in more than one group: ${id}`,
        );
      }
      mulliganSeen.add(id);
    }
  }

  const donCounts = guide.donPlan.map((entry) => entry.donCount);
  if (new Set(donCounts).size !== donCounts.length) {
    throw new DeckCoachValidationError("donPlan contains duplicate DON!! counts.");
  }
  for (const entry of guide.donPlan) {
    assertUnique(entry.referencedCardIds, `donPlan DON!! ${entry.donCount}`);
    let printedCostTotal = 0;
    for (const id of entry.referencedCardIds) {
      assertAllowed(id, `donPlan DON!! ${entry.donCount}`);
      if (id !== validation.leaderId) {
        printedCostTotal += validation.cardCosts.get(id) ?? 0;
      }
    }
    if (printedCostTotal > entry.donCount) {
      throw new DeckCoachValidationError(
        `donPlan DON!! ${entry.donCount} references printed costs totaling ${printedCostTotal}.`,
      );
    }
  }

  for (const combo of guide.combos) {
    assertUnique(combo.cardIds, `combo ${combo.titleJa}`);
    for (const id of combo.cardIds) assertAllowed(id, `combo ${combo.titleJa}`);
  }

  return guide;
}

function assertUnique(ids: readonly string[], context: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new DeckCoachValidationError(`${context} contains duplicate card ids.`);
  }
}

function validationForInput(
  input: DeckCoachAnalysisInput,
): DeckCoachPayloadValidation {
  return {
    leaderId: input.deck.leader.id,
    deckCardIds: input.deck.cards.map((entry) => entry.card.id),
    existingCardIds: input.knownCardIds,
    cardCosts: new Map([
      [input.deck.leader.id, input.deck.leader.cost],
      ...input.deck.cards.map(
        (entry) => [entry.card.id, entry.card.cost] as const,
      ),
    ]),
  };
}

function buildPrompt(input: DeckCoachAnalysisInput): string {
  assertDeckCoachInputUsesVerifiedFacts(input);

  const lines = [
    "あなたはワンピースカードゲームの初心者向け Deck Coach です。",
    "保存済みの合法な50枚デッキについて、使い方とゲームプランだけを日本語で説明してください。",
    "",
    "## 絶対ルール",
    "- card facts は verified official facts セクションだけを事実として使う。",
    "- コスト、パワー、カウンター、効果、色、特徴、トリガーを作らない。",
    "- legality、確率、評価、分布は system metrics の値をそのまま使い、計算し直さない。",
    "- cardId はリーダーまたは保存済みデッキ内カードだけを使う。デッキ外カードを提案しない。",
    "- デッキ変更案、カード追加案、サイドボード案を書かない。",
    "- AI-derived reference は過去のAI戦術解釈であり、カード事実として引用・増幅しない。",
    "- 説明レベルは easy。小学生高学年にも分かる短い日本語にする。",
    "- マリガン、ブロッカー、トリガー、DON!!は使ってよい。必要なら短く説明する。",
    "- weakMatchupsJa は特定カードの未提供事実や大会メタを作らず、苦手になりやすい一般的なデッキ傾向として書く。",
    "- DON!!プランの referencedCardIds は、そのDON!!数で直接使うカードだけにする。参照カードの印刷コスト合計をDON!!数以下にする。",
    "- effect engine は完全な公式裁定エンジンではない。断定できない細かな裁定を作らない。",
    "",
    `## deck (${input.level}, system validated legal=true)`,
    `- id: ${input.deck.id}`,
    `- name: ${input.deck.name}`,
    `- leader_id: ${input.deck.leader.id}`,
    `- main_deck_count: ${input.deck.cards.reduce((sum, entry) => sum + entry.count, 0)}`,
    "",
    "## verified official facts: leader",
    describeCard(input.deck.leader, 1),
    "",
    "## verified official facts: saved deck cards",
  ];

  for (const entry of input.deck.cards) {
    lines.push(describeCard(entry.card, entry.count));
  }

  lines.push(
    "",
    "## system deterministic metrics",
    JSON.stringify(input.systemMetrics, null, 2),
    "",
    "## AI-derived tactical reference (not card facts)",
  );
  if (input.aiDerivedReferences.length === 0) {
    lines.push("- なし");
  } else {
    for (const reference of input.aiDerivedReferences) {
      lines.push(
        JSON.stringify(
          {
            cardId: reference.cardId,
            source: reference.source,
            roles: reference.roles,
            purposeJa: reference.purposeJa,
            timing: reference.timing,
          },
          null,
          2,
        ),
      );
    }
  }

  lines.push(
    "",
    "record_deck_coach ツールを1回呼び出してください。free-formの返答は不要です。",
  );
  return lines.join("\n");
}

function describeCard(card: CardCoachFactInput, count: number): string {
  return [
    `- id: ${card.id}`,
    `  count: ${count}`,
    `  name: ${card.name}`,
    `  type: ${card.cardType}`,
    `  colors: ${card.colors.join(", ") || "(なし)"}`,
    `  attributes: ${card.attributes.join(" / ") || "(なし)"}`,
    `  features: ${card.features.join(" / ") || "(なし)"}`,
    `  mechanics: ${card.mechanics.join(", ") || "(なし)"}`,
    `  cost/power/counter/life: ${formatValue(card.cost)} / ${formatValue(card.power)} / ${formatValue(card.counter)} / ${formatValue(card.life)}`,
    `  source: ${card.source}, verified: ${card.verified ? "1" : "0"}`,
    `  effect: ${JSON.stringify(card.effectText ?? "(効果記載なし)")}`,
    `  trigger: ${JSON.stringify(card.triggerText ?? "(トリガー記載なし)")}`,
  ].join("\n");
}

function formatValue(value: number | null): string {
  return value === null ? "—" : String(value);
}

function feedbackForRetry(error: Error): string {
  return [
    "前回の record_deck_coach は採用できませんでした。",
    `理由: ${error.message}`,
    "schema、デッキ内cardId、DON!!コストのルールを守って再度ツールを呼び出してください。",
  ].join("\n");
}

export async function analyzeDeckCoach(
  input: DeckCoachAnalysisInput,
  opts: {
    model?: keyof typeof MODEL;
    maxTokens?: number;
    maxRetries?: number;
  } = {},
): Promise<AiDeckCoachResult> {
  assertDeckCoachInputUsesVerifiedFacts(input);

  const client = getAnthropic();
  const model = MODEL[opts.model ?? "sonnet"];
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const validation = validationForInput(input);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildPrompt(input) },
  ];
  let lastError: Error = new DeckCoachValidationError(
    "Model did not emit a record_deck_coach tool call.",
  );

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4200,
      tools: [RECORD_DECK_COACH_TOOL],
      tool_choice: { type: "tool", name: "record_deck_coach" },
      messages,
    });
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === "record_deck_coach",
    );

    if (!toolUse) {
      lastError = new DeckCoachValidationError(
        "Model did not emit a record_deck_coach tool call.",
      );
    } else {
      try {
        return {
          modelVersion: `${model}@${new Date().toISOString().slice(0, 10)}`,
          guide: parseAndValidateDeckCoachPayload(toolUse.input, validation),
        };
      } catch (error) {
        lastError = error as Error;
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

export const _deckCoachTestInternals = {
  buildPrompt,
  RECORD_DECK_COACH_TOOL,
};
