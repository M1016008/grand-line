/**
 * Phase 4 — AI deck suggestion (Claude Opus, tool-use enforced).
 *
 * Pipeline:
 *   1. Build a leader-aware candidate pool (color filter + feature
 *      relevance + reasonable cap so the prompt stays cheap).
 *   2. Call Claude with a single `propose_deck` tool whose JSON Schema
 *      pins down everything we'll persist: archetype name, card list,
 *      win condition, strengths, weaknesses.
 *   3. Validate the model's choices against the deck-rules validator
 *      (50 cards, 4-of, color match, no leader cards in deck).
 *   4. On rule violation, retry up to MAX_RETRIES with the violation
 *      messages echoed back as a "your previous proposal failed because
 *      …, fix and re-emit" follow-up.
 *
 * Hard rules per AGENTS.md:
 *   - Tool-use is mandatory. Free text is ignored.
 *   - Card ids in the response must come from the candidate pool we
 *     sent in. No invented ids.
 *   - The response is rejected (not silently truncated / merged) if any
 *     count is out of [1, 4] or sum != 50.
 */

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic, MODEL } from "@/ai/client";
import type { CardListItem } from "@/lib/cards";
import {
  validateDeck,
  type DeckLeader,
  type DeckRuleCard,
  type RuleViolation,
} from "@/lib/deck-rules";

const MAX_RETRIES = 2;
const POOL_SIZE_CAP = 220;

/* ──────────────────────────────────────────────────────────────────────── */
/* Tool schema                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

const PROPOSE_DECK_TOOL: Anthropic.Tool = {
  name: "propose_deck",
  description:
    "Emit a complete 50-card deck for the given leader using ONLY card ids from the candidate pool. Include a strategy summary.",
  input_schema: {
    type: "object",
    properties: {
      archetype_name: {
        type: "string",
        description: "Short Japanese name for the archetype (e.g. 麦わら速攻, 黒コントロール).",
        maxLength: 30,
      },
      cards: {
        type: "array",
        description:
          "Each entry is one unique card id from the candidate pool. Sum of `count` across all entries MUST equal 50. Maximum 4 of any card. Do not include the leader card.",
        items: {
          type: "object",
          properties: {
            card_id: { type: "string" },
            count: { type: "integer", minimum: 1, maximum: 4 },
          },
          required: ["card_id", "count"],
          additionalProperties: false,
        },
        minItems: 13, // 50 / 4 = 12.5; rounded up
        maxItems: 50,
      },
      win_condition: {
        type: "string",
        description: "How this deck wins, in 1-2 Japanese sentences.",
        maxLength: 240,
      },
      strengths: {
        type: "array",
        items: { type: "string", maxLength: 120 },
        maxItems: 4,
      },
      weaknesses: {
        type: "array",
        items: { type: "string", maxLength: 120 },
        maxItems: 4,
      },
      typical_matchups: {
        type: "object",
        description:
          "Notes on which archetypes this deck wants to face / avoid.",
        properties: {
          favorable: {
            type: "array",
            items: { type: "string", maxLength: 80 },
            maxItems: 4,
          },
          unfavorable: {
            type: "array",
            items: { type: "string", maxLength: 80 },
            maxItems: 4,
          },
        },
        additionalProperties: false,
        required: ["favorable", "unfavorable"],
      },
    },
    required: [
      "archetype_name",
      "cards",
      "win_condition",
      "strengths",
      "weaknesses",
      "typical_matchups",
    ],
    additionalProperties: false,
  },
};

const proposalSchema = z.object({
  archetype_name: z.string().min(1).max(30),
  cards: z
    .array(
      z.object({
        card_id: z.string(),
        count: z.number().int().min(1).max(4),
      }),
    )
    .min(1)
    .max(50),
  win_condition: z.string().max(240),
  strengths: z.array(z.string().max(120)).max(4),
  weaknesses: z.array(z.string().max(120)).max(4),
  typical_matchups: z.object({
    favorable: z.array(z.string().max(80)).max(4),
    unfavorable: z.array(z.string().max(80)).max(4),
  }),
});

export type DeckProposalRaw = z.infer<typeof proposalSchema>;

/* ──────────────────────────────────────────────────────────────────────── */
/* Public types                                                              */
/* ──────────────────────────────────────────────────────────────────────── */

export interface DeckSuggestionInput {
  leader: CardListItem;
  /** Cards available to the leader (color-filtered). Caller passes the full
   * leader-pool and we further compress before prompting. */
  pool: CardListItem[];
  /**
   * Free-text user nudge — "速攻寄り" / "ブロッカー多め" / "対 OP01-001 を意識".
   * Forwarded to the model verbatim, capped at 200 chars by the route.
   */
  preference?: string;
  /** Override the model. Default: Opus per roadmap §8.2. */
  model?: keyof typeof MODEL;
}

export interface DeckSuggestionEntry {
  cardId: string;
  count: number;
}

export interface DeckSuggestion {
  modelVersion: string;
  archetypeName: string;
  cards: DeckSuggestionEntry[];
  winCondition: string;
  strengths: string[];
  weaknesses: string[];
  favorable: string[];
  unfavorable: string[];
  /** Validation warnings (non-fatal — fatal violations would have caused a retry). */
  warnings: string[];
}

export class DeckSuggestionError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly violations: RuleViolation[] = [],
  ) {
    super(message);
    this.name = "DeckSuggestionError";
  }
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Pool compression                                                          */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Compress the leader's color pool to at most `POOL_SIZE_CAP` cards, biasing
 * toward cards that share a feature with the leader (the ones AI is most
 * likely to want) while keeping room for generic counter-cards / removal.
 */
export function buildCandidatePool(
  leader: CardListItem,
  pool: CardListItem[],
): CardListItem[] {
  const leaderFeatures = new Set(leader.features);
  const leaderColors = new Set(leader.colors);

  const validColor = pool.filter(
    (c) =>
      c.id !== leader.id &&
      c.cardType !== "LEADER" &&
      c.colors.some((col) => leaderColors.has(col)),
  );

  // Bucket A: shares ≥1 feature with leader (archetype core).
  // Bucket B: removal / blocker / counter staples (generic toolbox).
  // Bucket C: everything else, kept as filler if buckets A + B are short.
  const featureMatched: CardListItem[] = [];
  const staples: CardListItem[] = [];
  const filler: CardListItem[] = [];
  for (const c of validColor) {
    if (c.features.some((f) => leaderFeatures.has(f))) {
      featureMatched.push(c);
    } else if (
      c.mechanics.includes("Blocker") ||
      c.mechanics.includes("Banish") ||
      c.mechanics.includes("Trash") ||
      c.mechanics.includes("RestOpponentCard") ||
      c.mechanics.includes("ReturnToHand") ||
      (c.counter ?? 0) >= 2000
    ) {
      staples.push(c);
    } else {
      filler.push(c);
    }
  }

  const sortById = (a: CardListItem, b: CardListItem) => a.id.localeCompare(b.id);
  featureMatched.sort(sortById);
  staples.sort(sortById);
  filler.sort(sortById);

  const out: CardListItem[] = [];
  out.push(...featureMatched.slice(0, POOL_SIZE_CAP));
  out.push(...staples.slice(0, Math.max(0, POOL_SIZE_CAP - out.length)));
  out.push(...filler.slice(0, Math.max(0, POOL_SIZE_CAP - out.length)));
  return out.slice(0, POOL_SIZE_CAP);
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Prompt                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

function describeCard(c: CardListItem): string {
  const parts: string[] = [
    c.id,
    `(${c.cardType}, ${c.colors.join("/")})`,
    `cost=${c.cost ?? "—"}`,
  ];
  if (c.power !== null) parts.push(`pwr=${c.power}`);
  if (c.counter !== null && c.counter > 0) parts.push(`cnt=${c.counter}`);
  if (c.hasTrigger) parts.push("[trigger]");
  if (c.features.length > 0) parts.push(`features:[${c.features.join("/")}]`);
  if (c.mechanics.length > 0) parts.push(`mech:[${c.mechanics.join(",")}]`);
  return `${c.name} — ${parts.join(" ")}`;
}

function buildSystem(): string {
  return [
    "あなたはワンピースカードゲームの上級デッキビルダーです。",
    "リーダーと候補カードプールが与えられるので、競技で使える 50 枚デッキを 1 つ提案してください。",
    "",
    "## ハードルール (違反すると採用されません)",
    "- メインデッキは合計ちょうど 50 枚 (sum of count = 50)。リーダーは含めない。",
    "- 同名カード (同じ card_id) は 4 枚まで。",
    "- 候補プールに無い card_id は使わない (ハルシネーション禁止)。",
    "- 必ず propose_deck ツールで応答する。free-form テキストは無視されます。",
    "",
    "## 推奨方針",
    "- リーダーの特徴・効果・色からアーキタイプを推定し、それに沿って構築する。",
    "- コストカーブをなだらかに (1-3 コスト中心、フィニッシャーを 8-12 枚)。",
    "- 防御札 (counter ≥1000 のキャラ) を 12-16 枚程度。",
    "- 起動メイン / 登場時 / トリガーのバランスを考慮。",
  ].join("\n");
}

function buildUserPrompt(input: DeckSuggestionInput, pool: CardListItem[]): string {
  const lines: string[] = [];
  lines.push("## リーダー");
  lines.push(`- id: ${input.leader.id}`);
  lines.push(`- name: ${input.leader.name}`);
  lines.push(`- colors: ${input.leader.colors.join(", ")}`);
  if (input.leader.life !== null) lines.push(`- life: ${input.leader.life}`);
  if (input.leader.power !== null) lines.push(`- power: ${input.leader.power}`);
  if (input.leader.features.length > 0) {
    lines.push(`- features: ${input.leader.features.join(" / ")}`);
  }
  if (input.leader.mechanics.length > 0) {
    lines.push(`- mechanics: ${input.leader.mechanics.join(", ")}`);
  }
  lines.push("");

  if (input.preference?.trim()) {
    lines.push("## ユーザー要望");
    lines.push(input.preference.trim());
    lines.push("");
  }

  lines.push(`## 候補カードプール (${pool.length} 枚)`);
  lines.push("各行: name — id (type, colors) stat... features:[…] mech:[…]");
  for (const c of pool) {
    lines.push(`- ${describeCard(c)}`);
  }
  lines.push("");
  lines.push("propose_deck ツールを呼び出して 50 枚デッキを提案してください。");
  return lines.join("\n");
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Validation                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

interface ValidatedProposal {
  raw: DeckProposalRaw;
  ruleCards: DeckRuleCard[];
  violations: RuleViolation[];
}

function validateProposal(
  proposal: DeckProposalRaw,
  leader: CardListItem,
  poolById: Map<string, CardListItem>,
): ValidatedProposal {
  const violations: RuleViolation[] = [];
  const ruleCards: DeckRuleCard[] = [];

  const idsSeen = new Set<string>();
  for (const entry of proposal.cards) {
    if (idsSeen.has(entry.card_id)) {
      violations.push({
        code: "duplicate_entry",
        severity: "error",
        message: `card_id ${entry.card_id} appears twice; collapse counts into a single entry.`,
        cardIds: [entry.card_id],
      });
      continue;
    }
    idsSeen.add(entry.card_id);

    const card = poolById.get(entry.card_id);
    if (!card) {
      violations.push({
        code: "unknown_card",
        severity: "error",
        message: `card_id ${entry.card_id} is not in the candidate pool.`,
        cardIds: [entry.card_id],
      });
      continue;
    }
    ruleCards.push({
      id: card.id,
      cardType: card.cardType,
      colors: card.colors,
      count: entry.count,
    });
  }

  const leaderShape: DeckLeader = {
    id: leader.id,
    name: leader.name,
    colors: leader.colors,
  };
  const ruleReport = validateDeck(leaderShape, ruleCards);
  for (const v of ruleReport.violations) {
    violations.push(v);
  }

  return { raw: proposal, ruleCards, violations };
}

function feedbackForRetry(violations: RuleViolation[]): string {
  const fatal = violations.filter((v) => v.severity === "error");
  if (fatal.length === 0) return "";
  return [
    "前回の提案は次のルール違反で却下されました。修正して再度 propose_deck を呼び出してください:",
    ...fatal.map((v, i) => `  ${i + 1}. ${v.message}${
      v.cardIds && v.cardIds.length > 0 ? ` (cards: ${v.cardIds.slice(0, 5).join(", ")})` : ""
    }`),
  ].join("\n");
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Public entry point                                                        */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Ask Claude to build a 50-card deck for the given leader, retrying with
 * rule feedback if the first attempt produces an illegal deck.
 *
 * Throws `DeckSuggestionError` if every retry fails to produce a legal deck.
 */
export async function proposeDeck(
  input: DeckSuggestionInput,
): Promise<DeckSuggestion> {
  if (input.leader.cardType !== "LEADER") {
    throw new DeckSuggestionError(
      `${input.leader.id} (${input.leader.cardType}) is not a leader card.`,
      0,
    );
  }

  const pool = buildCandidatePool(input.leader, input.pool);
  if (pool.length < 30) {
    throw new DeckSuggestionError(
      `Candidate pool too small (${pool.length}). Make sure the DB has cards in this leader's color(s).`,
      0,
    );
  }
  const poolById = new Map(pool.map((c) => [c.id, c]));

  const client = getAnthropic();
  const model = MODEL[input.model ?? "opus"];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserPrompt(input, pool) },
  ];

  let lastViolations: RuleViolation[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 2200,
      system: buildSystem(),
      tools: [PROPOSE_DECK_TOOL],
      tool_choice: { type: "tool", name: "propose_deck" },
      messages,
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === "propose_deck",
    );
    if (!toolUse) {
      throw new DeckSuggestionError(
        "Model did not invoke propose_deck.",
        attempt + 1,
      );
    }

    const parsed = proposalSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      lastViolations = [
        {
          code: "schema_mismatch",
          severity: "error",
          message: `propose_deck output failed schema: ${parsed.error.message}`,
        },
      ];
    } else {
      const validated = validateProposal(parsed.data, input.leader, poolById);
      const fatal = validated.violations.filter((v) => v.severity === "error");
      if (fatal.length === 0) {
        return {
          modelVersion: `${model}@${new Date().toISOString().slice(0, 10)}`,
          archetypeName: validated.raw.archetype_name,
          cards: validated.raw.cards.map((c) => ({
            cardId: c.card_id,
            count: c.count,
          })),
          winCondition: validated.raw.win_condition,
          strengths: validated.raw.strengths,
          weaknesses: validated.raw.weaknesses,
          favorable: validated.raw.typical_matchups.favorable,
          unfavorable: validated.raw.typical_matchups.unfavorable,
          warnings: validated.violations
            .filter((v) => v.severity !== "error")
            .map((v) => v.message),
        };
      }
      lastViolations = validated.violations;
    }

    if (attempt < MAX_RETRIES) {
      messages.push(
        { role: "assistant", content: response.content },
        { role: "user", content: feedbackForRetry(lastViolations) },
      );
    }
  }

  throw new DeckSuggestionError(
    `Failed to produce a legal deck in ${MAX_RETRIES + 1} attempts.`,
    MAX_RETRIES + 1,
    lastViolations,
  );
}
