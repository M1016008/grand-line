/**
 * Phase 3.5 — AI synergy analysis (Claude tool-use, Sonnet).
 *
 * Pipeline shape:
 *   1. Take a leader + a candidate card. Build a constrained prompt that
 *      includes ONLY the leader's effect text, the candidate's effect
 *      text, the candidate's mechanics + features. No other cards in the
 *      DB are mentioned, so the model can't hallucinate IDs.
 *   2. Call Claude with a `record_synergies` tool. The model must emit
 *      one or more synergy records via tool_use; we ignore any free-text
 *      output (which would otherwise be a vector for hallucinated card
 *      facts).
 *   3. Validate every emitted record server-side: from/to ids must equal
 *      the leader/candidate we sent in (no other ids accepted),
 *      strength ∈ [0, 10], reasoning ≤ 200 chars per language.
 *   4. Tag `detected_by = "ai"` and `ai_model_version` so the UI can
 *      surface a "解釈は AI 推論" badge.
 *
 * The function is exposed but currently *not* called from anywhere in
 * the app — this lets the rest of the codebase compile and run without
 * `ANTHROPIC_API_KEY`. Wiring into a /api/synergy/refresh route happens
 * once Yoshio confirms the API key is set.
 */

import { z } from "zod";

import { getAnthropic, MODEL } from "@/ai/client";
import type { CardListItem } from "@/lib/cards";
import type { SynergyRelationType } from "@/db/schema";

const RELATION_TYPES = [
  "leader_direct",
  "feature_chain",
  "tempo_combo",
  "defense_combo",
  "resource_engine",
  "finisher",
  "anti_meta",
  "other",
] as const satisfies readonly SynergyRelationType[];

/* ──────────────────────────────────────────────────────────────────────── */
/* Tool schema                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

import type Anthropic from "@anthropic-ai/sdk";

const RECORD_SYNERGIES_TOOL: Anthropic.Tool = {
  name: "record_synergies",
  description:
    "Record one or more synergy relationships between the leader and the candidate card. Only emit a record if the synergy is directly supported by the effect text shown.",
  input_schema: {
    type: "object",
    properties: {
      synergies: {
        type: "array",
        description:
          "One record per directional synergy. Empty array if no meaningful synergy exists.",
        items: {
          type: "object",
          properties: {
            from_card_id: {
              type: "string",
              description:
                "Source card id. Must exactly match either the leader id or candidate id provided.",
            },
            to_card_id: {
              type: "string",
              description:
                "Target card id. Must exactly match either the leader id or candidate id provided, and differ from from_card_id.",
            },
            relation_type: {
              type: "string",
              enum: RELATION_TYPES,
            },
            strength: {
              type: "number",
              description: "Synergy strength on a 0-10 scale (10 = decklist-defining).",
              minimum: 0,
              maximum: 10,
            },
            reasoning_ja: {
              type: "string",
              description: "100文字以内。効果テキストに直接根拠のあること。",
              maxLength: 220,
            },
            reasoning_en: {
              type: "string",
              description: "Up to 100 chars; must trace to the printed effect text.",
              maxLength: 220,
            },
          },
          required: [
            "from_card_id",
            "to_card_id",
            "relation_type",
            "strength",
            "reasoning_ja",
            "reasoning_en",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["synergies"],
    additionalProperties: false,
  },
};

/* ──────────────────────────────────────────────────────────────────────── */
/* Validation                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

const synergyRecordSchema = z.object({
  from_card_id: z.string(),
  to_card_id: z.string(),
  relation_type: z.enum(RELATION_TYPES),
  strength: z.number().min(0).max(10),
  reasoning_ja: z.string().max(220),
  reasoning_en: z.string().max(220),
});

const toolPayloadSchema = z.object({
  synergies: z.array(synergyRecordSchema),
});

export type SynergyRecord = z.infer<typeof synergyRecordSchema>;

export interface AiSynergyResult {
  modelVersion: string;
  records: SynergyRecord[];
  /** Records the model produced that failed our post-validation. */
  rejected: Array<{ raw: unknown; reason: string }>;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Prompt                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

function buildPrompt(
  leader: CardListItemWithEffect,
  candidate: CardListItemWithEffect,
): string {
  return [
    "あなたはワンピースカードゲームの戦術アナリストです。リーダーカードと候補カードを与えるので、両者の効果テキスト・特徴・キーワード仕様から導かれる相互作用を 1〜2 件、record_synergies ツールで返してください。",
    "",
    "## ハードルール",
    "- 効果テキストに直接根拠のないシナジーは絶対に作らない (ハルシネーション禁止)。",
    "- 既存のカード ID は引数の 2 枚以外、絶対に使わない。",
    "- 該当するシナジーが無い場合は synergies: [] を返す。",
    "- reasoning_ja は 100 字以内、reasoning_en は 100 chars 以内。",
    "- strength は 0-10、根拠の強さに応じて控えめに採点 (慣性で 7+ にしない)。",
    "",
    "## リーダー",
    `- id: ${leader.id}`,
    `- name: ${leader.name}`,
    `- colors: ${leader.colors.join(", ")}`,
    `- features: ${leader.features.join(" / ") || "(なし)"}`,
    `- mechanics: ${leader.mechanics.join(", ") || "(なし)"}`,
    "- effect:",
    quote(leader.effectText ?? "(効果記載なし)"),
    "",
    "## 候補カード",
    `- id: ${candidate.id}`,
    `- name: ${candidate.name}`,
    `- type: ${candidate.cardType}`,
    `- colors: ${candidate.colors.join(", ")}`,
    `- features: ${candidate.features.join(" / ") || "(なし)"}`,
    `- mechanics: ${candidate.mechanics.join(", ") || "(なし)"}`,
    `- cost/power/counter: ${fmt(candidate.cost)} / ${fmt(candidate.power)} / ${fmt(candidate.counter)}`,
    "- effect:",
    quote(candidate.effectText ?? "(効果記載なし)"),
    "",
    "判定したらツールを呼び出してください。free-form の説明は不要です。",
  ].join("\n");
}

function fmt(n: number | null): string {
  return n === null ? "—" : String(n);
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export interface CardListItemWithEffect extends CardListItem {
  effectText: string | null;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Public API                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

export interface AnalyzeOptions {
  /** Override the model. Default: Sonnet (per roadmap §8.2). */
  model?: keyof typeof MODEL;
  /** Cap output tokens to keep cost predictable per call. Default 800. */
  maxTokens?: number;
}

/**
 * Ask Claude to analyze the synergy between a leader and a candidate card.
 *
 * This is a *single-pair* call — the synergy graph builder will batch by
 * iterating over candidates and caching results in `card_synergies`. The
 * narrow surface keeps the tool-use validation tight: we only ever accept
 * the two ids we sent in.
 */
export async function analyzeSynergy(
  leader: CardListItemWithEffect,
  candidate: CardListItemWithEffect,
  opts: AnalyzeOptions = {},
): Promise<AiSynergyResult> {
  const client = getAnthropic();
  const model = MODEL[opts.model ?? "sonnet"];

  const message = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 800,
    tools: [RECORD_SYNERGIES_TOOL],
    tool_choice: { type: "tool", name: "record_synergies" },
    messages: [
      {
        role: "user",
        content: buildPrompt(leader, candidate),
      },
    ],
  });

  const records: SynergyRecord[] = [];
  const rejected: AiSynergyResult["rejected"] = [];

  for (const block of message.content) {
    if (block.type !== "tool_use" || block.name !== "record_synergies") continue;
    const parsed = toolPayloadSchema.safeParse(block.input);
    if (!parsed.success) {
      rejected.push({ raw: block.input, reason: parsed.error.message });
      continue;
    }
    for (const r of parsed.data.synergies) {
      // Hard-fail on hallucinated ids — only accept the two we sent in.
      const allowed = new Set([leader.id, candidate.id]);
      if (!allowed.has(r.from_card_id) || !allowed.has(r.to_card_id)) {
        rejected.push({
          raw: r,
          reason: `Illegal card id pair: ${r.from_card_id} → ${r.to_card_id}`,
        });
        continue;
      }
      if (r.from_card_id === r.to_card_id) {
        rejected.push({ raw: r, reason: "self-loop" });
        continue;
      }
      records.push(r);
    }
  }

  return {
    modelVersion: `${model}@2026-05-08`,
    records,
    rejected,
  };
}
