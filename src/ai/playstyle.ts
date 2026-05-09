/**
 * Phase ③ — per-card playstyle generation (Claude tool-use, Sonnet).
 *
 * For a single card, asks Claude to write three short paragraphs that a
 * grade-school player could understand:
 *   - whenToPlayJa : いつ使うか (cost / timing / setup)
 *   - shinesInJa   : どんな局面で強いか (board state / phase)
 *   - vsOpponentJa : 対戦中の使い方 (interaction / counters)
 *
 * The model only sees the card's own data — no other cards leak in, so
 * it can't hallucinate combos with cards that don't exist. The result is
 * persisted into `card_playstyles`. Re-running for the same card just
 * upserts (the model can iterate on its own description).
 */

import { z } from "zod";

import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic, MODEL } from "@/ai/client";
import type { CardListItem } from "@/lib/cards";

export interface CardPlaystyleInput extends CardListItem {
  effectText: string | null;
  triggerText?: string | null;
}

const RECORD_PLAYSTYLE_TOOL: Anthropic.Tool = {
  name: "record_playstyle",
  description:
    "Record a kid-friendly playstyle description for the card. All fields are Japanese, ≤120 characters each, written so a 10-year-old could understand.",
  input_schema: {
    type: "object",
    properties: {
      when_to_play_ja: {
        type: "string",
        description:
          "いつ使うかを 60〜120 字。コストやタイミング、組み合わせて出すべき場面を、子どもでも分かる言葉で。専門用語の言いかえ可。",
        maxLength: 200,
      },
      shines_in_ja: {
        type: "string",
        description:
          "どんな局面で強いかを 60〜120 字。序盤/中盤/終盤など試合のどの場面で輝くか、ライフが多いとき/少ないとき など。",
        maxLength: 200,
      },
      vs_opponent_ja: {
        type: "string",
        description:
          "対戦中、相手プレイヤーとのやり取りの中での使い方を 60〜120 字。相手の何を止められる、何を許してしまう、など実践的に。",
        maxLength: 200,
      },
    },
    required: ["when_to_play_ja", "shines_in_ja", "vs_opponent_ja"],
    additionalProperties: false,
  },
};

const playstyleSchema = z.object({
  when_to_play_ja: z.string().min(1).max(220),
  shines_in_ja: z.string().min(1).max(220),
  vs_opponent_ja: z.string().min(1).max(220),
});

export type PlaystyleRecord = z.infer<typeof playstyleSchema>;

export interface AiPlaystyleResult {
  modelVersion: string;
  record: PlaystyleRecord;
}

function buildPrompt(card: CardPlaystyleInput): string {
  return [
    "あなたはワンピースカードゲームのコーチです。下のカードについて、小学生でも理解できる言葉で 3 つの説明を書いてください。専門用語 (ブロッカー、リーサル、テンポ など) は使わず、平易な日本語で実際のプレイ場面が想像できるように。",
    "",
    "## ハードルール",
    "- 効果テキストに直接根拠のない強さは書かない (誇張禁止)。",
    "- 各説明は 60〜120 字。長すぎず短すぎず。",
    "- 「強いです」「便利です」だけで終わらせず、具体的な場面 (例:「相手のライフが残り 1 のとき」「自分のドンが 5 ある中盤」) を添える。",
    "- 子どもの言葉で:「ブロッカー」→「相手のこうげきを止めるカード」のように言いかえてよい。",
    "",
    "## カード情報",
    `- id: ${card.id}`,
    `- name: ${card.name}`,
    `- type: ${card.cardType}`,
    `- colors: ${card.colors.join(", ")}`,
    `- features: ${card.features.join(" / ") || "(なし)"}`,
    `- mechanics (検出キーワード): ${card.mechanics.join(", ") || "(なし)"}`,
    `- cost/power/counter/life: ${fmt(card.cost)} / ${fmt(card.power)} / ${fmt(card.counter)} / ${fmt(card.life)}`,
    "- effect:",
    quote(card.effectText ?? "(効果記載なし)"),
    card.triggerText
      ? `- trigger:\n${quote(card.triggerText)}`
      : "",
    "",
    "判定したら record_playstyle ツールを呼び出してください。free-form の補足は不要です。",
  ]
    .filter(Boolean)
    .join("\n");
}

function fmt(n: number | null): string {
  return n === null || n === undefined ? "—" : String(n);
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export async function analyzePlaystyle(
  card: CardPlaystyleInput,
  opts: { model?: keyof typeof MODEL; maxTokens?: number } = {},
): Promise<AiPlaystyleResult> {
  const client = getAnthropic();
  const model = MODEL[opts.model ?? "sonnet"];

  const message = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 700,
    tools: [RECORD_PLAYSTYLE_TOOL],
    tool_choice: { type: "tool", name: "record_playstyle" },
    messages: [
      { role: "user", content: buildPrompt(card) },
    ],
  });

  for (const block of message.content) {
    if (block.type !== "tool_use" || block.name !== "record_playstyle") continue;
    const parsed = playstyleSchema.safeParse(block.input);
    if (!parsed.success) {
      throw new Error(`Tool output failed validation: ${parsed.error.message}`);
    }
    return {
      modelVersion: `${model}@2026-05-09`,
      record: parsed.data,
    };
  }

  throw new Error("Model did not emit a record_playstyle tool call.");
}
