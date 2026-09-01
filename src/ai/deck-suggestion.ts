/**
 * Phase 4 — AI deck suggestion (Claude Opus, tool-use enforced).
 *
 * Pipeline:
 *   1. Prepare one leader-aware candidate context (verified color/legal
 *      pool, relationship evidence, aptitude and prompt-size cap).
 *   2. Call Claude with a single `propose_deck` tool whose JSON Schema
 *      pins down everything we'll persist: archetype name, card list,
 *      win condition, strengths, weaknesses.
 *   3. Validate the model's choices against the deck-rules validator
 *      (50 cards, 4-of, color match, no leader cards in deck).
 *   4. On rule violation, retry up to MAX_RETRIES with the violation
 *      messages echoed back as a "your previous proposal failed because
 *      …, fix and re-emit" follow-up. Compare mode reuses the same context
 *      for three independently validated variant profiles.
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
import type { CardCoachFactInput } from "@/ai/card-coach";
import {
  validateDeck,
  type DeckLeader,
  type DeckRegulations,
  type DeckRuleCard,
  type RuleViolation,
} from "@/lib/deck-rules";
import { buildDeckCoachMetrics } from "@/lib/deck-coach-metrics";
import {
  FEATURE_TAG_LABELS,
  isVerifiedOfficialCard,
  MAIN_STYLE_LABELS,
  prepareDeckCandidateRanking,
  rankDeckCandidates,
  resolveDeckPreferences,
  VARIANT_PROFILE_LABELS,
  type DeckPreferenceSelection,
  type FeatureTag,
  type LeaderStyleAptitude,
  type MainStyle,
  type VariantProfile,
} from "@/lib/deck-intelligence-preferences";
import {
  buildDeckVariantsComparison,
  orchestrateVariantProfiles,
  type DeckVariantsComparison,
} from "@/lib/deck-intelligence-compare";
import type { RuleSynergy } from "@/lib/synergy-rules";

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
            role_ja: {
              type: "string",
              description: "このデッキでの役割を表す短い日本語。",
              maxLength: 80,
            },
            selection_reason_ja: {
              type: "string",
              description: "リーダー・スタイル・他カードとの関係に基づく採用理由。",
              maxLength: 240,
            },
          },
          required: ["card_id", "count", "role_ja", "selection_reason_ja"],
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
      deck_concept_ja: {
        type: "string",
        description: "リーダーと選択スタイルを軸にしたデッキコンセプト。",
        maxLength: 500,
      },
      style_aptitude_reason_ja: {
        type: "string",
        description:
          "system算出済み適性を前提に、選択スタイルがこのリーダーに合う/合いにくい理由だけを説明。星やscoreは生成しない。",
        maxLength: 320,
      },
      key_cards: {
        type: "array",
        description: "候補プール内の中核card_id。",
        items: { type: "string" },
        maxItems: 8,
      },
      major_combos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title_ja: { type: "string", maxLength: 100 },
            card_ids: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              maxItems: 5,
            },
            explanation_ja: { type: "string", maxLength: 320 },
          },
          required: ["title_ja", "card_ids", "explanation_ja"],
          additionalProperties: false,
        },
        maxItems: 6,
      },
      curve_explanation_ja: {
        type: "string",
        description:
          "具体的な数値を創作せず、選択したカードのコスト帯がスタイルとゲームプランをどう支えるかを説明。",
        maxLength: 320,
      },
      variant_reason_ja: {
        type: "string",
        description:
          "同じLeader/Main Style/Feature Tagsを維持したまま、このvariant profileとして採用配分を変えた理由。",
        maxLength: 320,
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
      "deck_concept_ja",
      "style_aptitude_reason_ja",
      "key_cards",
      "major_combos",
      "curve_explanation_ja",
      "variant_reason_ja",
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
        role_ja: z.string().min(1).max(80),
        selection_reason_ja: z.string().min(1).max(240),
      }),
    )
    .min(1)
    .max(50),
  win_condition: z.string().max(240),
  deck_concept_ja: z.string().min(1).max(500),
  style_aptitude_reason_ja: z.string().min(1).max(320),
  key_cards: z.array(z.string()).max(8),
  major_combos: z.array(
    z.object({
      title_ja: z.string().min(1).max(100),
      card_ids: z.array(z.string()).min(2).max(5),
      explanation_ja: z.string().min(1).max(320),
    }),
  ).max(6),
  curve_explanation_ja: z.string().min(1).max(320),
  variant_reason_ja: z.string().min(1).max(320),
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
  leader: CardCoachFactInput;
  /** Cards available to the leader (color-filtered). Caller passes the full
   * leader-pool and we further compress before prompting. */
  pool: CardCoachFactInput[];
  /** Main style is the primary user-controlled ranking axis. */
  selectedStyle?: MainStyle;
  /** Optional deterministic secondary weights. At most three, without duplicates. */
  selectedTags?: FeatureTag[];
  /** Current active restrictions, loaded fail-closed by the route. */
  regulations: DeckRegulations;
  /** Persisted AI synergy rows touching the leader, loaded by the route. */
  persistedSynergies?: RuleSynergy[];
  /** Override the model. Default: Opus per roadmap §8.2. */
  model?: keyof typeof MODEL;
}

export interface DeckSuggestionEntry {
  cardId: string;
  count: number;
  roleJa: string;
  selectionReasonJa: string;
}

export interface DeckSuggestionMetrics {
  costCurve: Record<string, number>;
  counterDistribution: Record<string, number>;
  triggerRatio: number;
  evaluationScores: {
    attack: number;
    stability: number;
    expansion: number;
    defense: number;
    meta: number;
    composite: number;
  };
  majorMechanics: Array<{ mechanic: string; count: number }>;
}

export function buildPostGenerationMetrics(
  leader: CardCoachFactInput,
  entries: Array<{ card: CardCoachFactInput; count: number }>,
): DeckSuggestionMetrics {
  const deterministic = buildDeckCoachMetrics(leader, entries);
  return {
    costCurve: deterministic.costCurve,
    counterDistribution: deterministic.counterDistribution,
    triggerRatio: deterministic.trigger.ratio,
    evaluationScores: {
      attack: deterministic.evaluation.attack.score,
      stability: deterministic.evaluation.stability.score,
      expansion: deterministic.evaluation.expansion.score,
      defense: deterministic.evaluation.defense.score,
      meta: deterministic.evaluation.meta.score,
      composite: deterministic.evaluation.composite,
    },
    majorMechanics: deterministic.majorMechanics,
  };
}

export interface DeckSuggestion {
  modelVersion: string;
  variantProfile: VariantProfile;
  variantLabel: string;
  variantReasonJa: string;
  selectedStyle: MainStyle;
  selectedTags: FeatureTag[];
  effectiveStyle: Exclude<MainStyle, "auto">;
  styleAptitudes: LeaderStyleAptitude[];
  archetypeName: string;
  cards: DeckSuggestionEntry[];
  winCondition: string;
  deckConceptJa: string;
  styleAptitudeReasonJa: string;
  keyCards: string[];
  majorCombos: Array<{
    titleJa: string;
    cardIds: string[];
    explanationJa: string;
  }>;
  curveExplanationJa: string;
  metrics: DeckSuggestionMetrics;
  strengths: string[];
  weaknesses: string[];
  favorable: string[];
  unfavorable: string[];
  lowDiversityWarning: string | null;
  diversityRetries: number;
  /** Validation warnings (non-fatal — fatal violations would have caused a retry). */
  warnings: string[];
}

export interface DeckVariantsSuggestion {
  selectedStyle: MainStyle;
  selectedTags: FeatureTag[];
  effectiveStyle: Exclude<MainStyle, "auto">;
  styleAptitudes: LeaderStyleAptitude[];
  variants: DeckSuggestion[];
  comparison: DeckVariantsComparison;
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
 * Compress the verified, color-legal pool to at most `POOL_SIZE_CAP` cards.
 * Ranking stays leader-first, treats the main style as the preference axis,
 * and caps feature-tag influence so auxiliary tags cannot take over the deck.
 */
export function buildCandidatePool(
  leader: CardCoachFactInput,
  pool: CardCoachFactInput[],
  selection: DeckPreferenceSelection = resolveDeckPreferences(),
  regulations: DeckRegulations = {},
  persistedSynergies: RuleSynergy[] = [],
  variantProfile: VariantProfile = "recommended",
): CardCoachFactInput[] {
  const analysis = buildCandidateAnalysis(
    leader,
    pool,
    selection,
    regulations,
    persistedSynergies,
  );
  return rankPreparedCandidatePool(leader, analysis, variantProfile);
}

interface CandidateAnalysis {
  analysisPool: CardCoachFactInput[];
  rankingContext: ReturnType<typeof prepareDeckCandidateRanking>["rankingContext"];
  effectiveSelection: DeckPreferenceSelection;
  aptitudes: LeaderStyleAptitude[];
  effectiveStyle: Exclude<MainStyle, "auto">;
}

function buildCandidateAnalysis(
  leader: CardCoachFactInput,
  pool: CardCoachFactInput[],
  selection: DeckPreferenceSelection,
  regulations: DeckRegulations,
  persistedSynergies: RuleSynergy[],
): CandidateAnalysis {
  const prepared = prepareDeckCandidateRanking(
    leader,
    pool,
    selection,
    regulations,
    persistedSynergies,
  );
  return {
    analysisPool: prepared.analysisPool,
    rankingContext: prepared.rankingContext,
    effectiveSelection: prepared.effectiveSelection,
    aptitudes: prepared.aptitudes,
    effectiveStyle: prepared.effectiveStyle,
  };
}

function rankPreparedCandidatePool(
  leader: CardCoachFactInput,
  analysis: CandidateAnalysis,
  variantProfile: VariantProfile,
): CardCoachFactInput[] {
  return rankDeckCandidates(
    leader,
    analysis.analysisPool,
    analysis.effectiveSelection,
    analysis.rankingContext,
    variantProfile,
  )
    .slice(0, POOL_SIZE_CAP)
    .map((entry) => entry.card as CardCoachFactInput);
}

export function isVerifiedOfficialDeckFact(
  card: Pick<CardCoachFactInput, "verified" | "source">,
): boolean {
  return isVerifiedOfficialCard(card);
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Prompt                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

function compactOfficialText(text: string | null): string {
  return text?.replace(/\s+/g, " ").trim() || "なし";
}

function describeCard(c: CardCoachFactInput): string {
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
  return [
    `${c.name} — ${parts.join(" ")}`,
    `official_effect: ${compactOfficialText(c.effectText)}`,
    `official_trigger: ${compactOfficialText(c.triggerText)}`,
  ].join(" | ");
}

const STYLE_CONSTRUCTION_GUIDANCE: Record<Exclude<MainStyle, "auto">, string> = {
  aggressive: "序盤から攻撃回数と打点を作れるカードを優先し、終盤札はリーダーの攻めを完結させるものに絞る。",
  midrange: "中盤の盤面効率を中心に、序盤の接続札と終盤の勝ち筋をリーダー効果に合わせて配分する。",
  defensive: "防御・ライフ維持・返しの盤面形成を軸にし、守るだけで勝ち筋を失わない構成にする。",
  removal: "リーダーが扱える除去手段と対象範囲を軸に、除去後に主導権を取るカードを組み合わせる。",
  control: "妨害、手札効率、終盤の決定力をリーダーの得意なゲーム速度に合わせて構成する。",
  resource: "サーチ、ルック、DON!!運用など実在するリソース手段から、再現性の高い流れを作る。",
  combo: "リーダー効果と複数カードの接続を主軸にし、単体でも機能する補助札で不成立時を支える。",
  tempo: "低中コストの展開と妨害を同じターンに行える流れを優先し、盤面と攻撃権を継続する。",
  ramp: "DON!!運用から高コスト札へ接続する流れを軸にし、到達前のターンを支える札を確保する。",
  balanced: "リーダーの主要な強みを中心に、展開・防御・リソース・決定力を候補の実在サポート量に合わせる。",
};

const VARIANT_CONSTRUCTION_GUIDANCE: Record<VariantProfile, string> = {
  recommended:
    "systemのLeader適性・Main Style・Feature Tags・候補順位を最も素直に反映する。",
  consistency:
    "Main StyleとFeature Tagsは変えず、searchability、feature support、印刷counter値、コスト帯の安定、繰り返しアクセスしやすい中核を補助的に重視する。",
  specialization:
    "Main StyleとFeature Tagsは変えず、その既存シグナルを推奨構築より少し強く反映する。Feature Tagsのsystem capを越える極端な配分にはしない。",
};

function buildSystem(
  effectiveStyle: Exclude<MainStyle, "auto">,
  variantProfile: VariantProfile = "recommended",
): string {
  return [
    "あなたはワンピースカードゲームの上級デッキビルダーです。",
    "リーダーと候補カードプールが与えられるので、競技で使える 50 枚デッキを 1 つ提案してください。",
    "",
    "## ハードルール (違反すると採用されません)",
    "- メインデッキは合計ちょうど 50 枚 (sum of count = 50)。リーダーは含めない。",
    "- 同名カード (同じ card_id) は 4 枚まで。",
    "- 候補プールに無い card_id は使わない (ハルシネーション禁止)。",
    "- 候補は公式確認済みのカード事実だけ。候補に無い効果・コスト・特徴を作らない。",
    "- 必ず propose_deck ツールで応答する。free-form テキストは無視されます。",
    "",
    "## 構築方針",
    "- 全リーダー共通の固定枚数・固定コスト比率は使わない。",
    "- verified official のリーダー効果、mechanics、features、legal poolのサポート量から構成を決める。",
    `- 選択スタイルの方針: ${STYLE_CONSTRUCTION_GUIDANCE[effectiveStyle]}`,
    `- Variant Profile (${VARIANT_PROFILE_LABELS[variantProfile]}): ${VARIANT_CONSTRUCTION_GUIDANCE[variantProfile]}`,
    "- Variant Profileは微調整軸であり、Leader affinity / Main Styleより優先しない。Main StyleやFeature Tagsを別のものへ変更しない。",
    "- Feature Tagsは補助重み。タグだけを満たすためにリーダー適性やデッキ全体の勝ち筋を崩さない。",
    "- system算出の適性score/星を変更・生成しない。適性の理由だけを説明する。",
    "- 数値メトリクスはsystemが生成後に計算するため、推測して出力しない。",
    "- simulationやtournament metaは未使用。compositeだけで『最強』『絶対おすすめ』と断定しない。",
  ].join("\n");
}

function buildUserPrompt(
  input: DeckSuggestionInput,
  pool: CardCoachFactInput[],
  selection: DeckPreferenceSelection,
  effectiveStyle: Exclude<MainStyle, "auto">,
  aptitudes: LeaderStyleAptitude[],
  variantProfile: VariantProfile = "recommended",
  previousVariants: ReadonlyArray<
    Pick<DeckSuggestion, "variantProfile" | "cards">
  > = [],
  diversityAttempt = 0,
): string {
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
  lines.push(`- official_effect: ${compactOfficialText(input.leader.effectText)}`);
  lines.push(`- official_trigger: ${compactOfficialText(input.leader.triggerText)}`);
  lines.push("");

  lines.push("## ユーザー指定 (system validated)");
  lines.push(
    `- main_style: ${selection.selectedStyle} / ${MAIN_STYLE_LABELS[selection.selectedStyle]}`,
  );
  lines.push(`- effective_style: ${effectiveStyle} / ${MAIN_STYLE_LABELS[effectiveStyle]}`);
  lines.push(
    `- feature_tags: ${
      selection.selectedTags.length > 0
        ? selection.selectedTags
            .map((tag) => `${tag} / ${FEATURE_TAG_LABELS[tag]}`)
            .join(", ")
        : "なし"
    }`,
  );
  lines.push(
    "- main_style を構築の主軸にし、feature_tags は補助要素として使う。タグだけでデッキ全体を極端に歪めない。",
  );
  lines.push(
    `- variant_profile: ${variantProfile} / ${VARIANT_PROFILE_LABELS[variantProfile]}`,
  );
  lines.push(`- variant方針: ${VARIANT_CONSTRUCTION_GUIDANCE[variantProfile]}`);
  lines.push("");

  lines.push("## system算出 Leader Style Aptitude");
  lines.push("星とscoreはsystem確定値。変更せず、選択スタイルとの適合理由だけを説明する。");
  for (const aptitude of aptitudes) {
    lines.push(
      `- ${aptitude.style}: ${"★".repeat(aptitude.stars)}${"☆".repeat(5 - aptitude.stars)} score=${aptitude.score} signals=${JSON.stringify(aptitude.signals)}`,
    );
  }
  lines.push("");

  if (previousVariants.length > 0) {
    lines.push("## 既に採用済みの比較案 (差分作成用・card factsではない)");
    lines.push(
      "Leader/Main Style/Feature Tagsと合法性を維持したまま、候補順位に沿ってカード配分へ意味のある差を作る。",
    );
    for (const previous of previousVariants) {
      lines.push(
        `- ${previous.variantProfile}: ${previous.cards
          .map((card) => `${card.cardId}x${card.count}`)
          .join(", ")}`,
      );
    }
    if (diversityAttempt > 0) {
      lines.push(
        `- diversity retry ${diversityAttempt}: 前案はcard copy単位で95%以上共通だったため、このprofileの範囲内で採用カードまたは枚数配分を見直す。`,
      );
    }
    lines.push("");
  }

  lines.push(`## deterministic ranking 済み候補カードプール (${pool.length} 枚)`);
  lines.push(
    "順序は system が leader適性、main_styleを最重要に、variant_profileとfeature_tagsを補助軸として重み付け済み。候補外カードを追加しない。",
  );
  lines.push(
    "各行: name — id (type, colors) stat... features:[…] mech:[…] | official_effect | official_trigger",
  );
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
  leader: CardCoachFactInput,
  poolById: Map<string, CardCoachFactInput>,
  regulations: DeckRegulations,
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

  const referencedIds = [
    ...proposal.key_cards,
    ...proposal.major_combos.flatMap((combo) => combo.card_ids),
  ];
  for (const cardId of new Set(referencedIds)) {
    if (!poolById.has(cardId)) {
      violations.push({
        code: "unknown_card",
        severity: "error",
        message: `Referenced card_id ${cardId} is not in the candidate pool.`,
        cardIds: [cardId],
      });
    }
  }

  const leaderShape: DeckLeader = {
    id: leader.id,
    name: leader.name,
    colors: leader.colors,
  };
  const ruleReport = validateDeck(leaderShape, ruleCards, regulations);
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
  const prepared = prepareDeckSuggestion(input);
  const client = getAnthropic();
  const model = MODEL[input.model ?? "opus"];
  return generatePreparedDeck(
    prepared,
    client,
    model,
    "recommended",
    [],
    0,
  );
}

/**
 * Generate all three comparison profiles from one verified input snapshot.
 * Candidate facts, regulations, aptitude and relationship detection are
 * prepared once; each AI result is still validated and retried independently.
 */
export async function proposeDeckVariants(
  input: DeckSuggestionInput,
): Promise<DeckVariantsSuggestion> {
  const prepared = prepareDeckSuggestion(input);
  const client = getAnthropic();
  const model = MODEL[input.model ?? "opus"];
  const generated = await orchestrateVariantProfiles<DeckSuggestion>(
    async (profile, accepted, diversityAttempt) =>
      generatePreparedDeck(
        prepared,
        client,
        model,
        profile,
        accepted.map((result) => result.proposal),
        diversityAttempt,
      ),
    { candidatePoolSize: prepared.analysis.analysisPool.length },
  );
  const variants = generated.map((result) => ({
    ...result.proposal,
    lowDiversityWarning: result.lowDiversityWarning,
    diversityRetries: result.diversityRetries,
  }));
  return {
    selectedStyle: prepared.selection.selectedStyle,
    selectedTags: prepared.selection.selectedTags,
    effectiveStyle: prepared.analysis.effectiveStyle,
    styleAptitudes: prepared.analysis.aptitudes,
    variants,
    comparison: buildDeckVariantsComparison(variants),
  };
}

interface PreparedDeckSuggestion {
  input: DeckSuggestionInput;
  selection: DeckPreferenceSelection;
  analysis: CandidateAnalysis;
}

function prepareDeckSuggestion(
  input: DeckSuggestionInput,
): PreparedDeckSuggestion {
  if (input.leader.cardType !== "LEADER") {
    throw new DeckSuggestionError(
      `${input.leader.id} (${input.leader.cardType}) is not a leader card.`,
      0,
    );
  }
  if (!isVerifiedOfficialDeckFact(input.leader)) {
    throw new DeckSuggestionError(
      `${input.leader.id} does not have verified official facts.`,
      0,
    );
  }

  let selection: DeckPreferenceSelection;
  try {
    selection = resolveDeckPreferences(
      input.selectedStyle,
      input.selectedTags,
    );
  } catch (error) {
    throw new DeckSuggestionError((error as Error).message, 0);
  }

  const analysis = buildCandidateAnalysis(
    input.leader,
    input.pool,
    selection,
    input.regulations,
    input.persistedSynergies ?? [],
  );
  if (analysis.analysisPool.length < 30) {
    throw new DeckSuggestionError(
      `Candidate pool too small (${analysis.analysisPool.length}). Make sure the DB has cards in this leader's color(s).`,
      0,
    );
  }
  return { input, selection, analysis };
}

async function generatePreparedDeck(
  prepared: PreparedDeckSuggestion,
  client: ReturnType<typeof getAnthropic>,
  model: (typeof MODEL)[keyof typeof MODEL],
  variantProfile: VariantProfile,
  previousVariants: ReadonlyArray<DeckSuggestion>,
  diversityAttempt: number,
): Promise<DeckSuggestion> {
  const { input, selection, analysis } = prepared;
  const { aptitudes, effectiveStyle } = analysis;
  const pool = rankPreparedCandidatePool(
    input.leader,
    analysis,
    variantProfile,
  );
  const poolById = new Map(pool.map((c) => [c.id, c]));

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildUserPrompt(
        input,
        pool,
        selection,
        effectiveStyle,
        aptitudes,
        variantProfile,
        previousVariants,
        diversityAttempt,
      ),
    },
  ];

  let lastViolations: RuleViolation[] = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await client.messages.create({
      model,
      max_tokens: 5000,
      system: buildSystem(effectiveStyle, variantProfile),
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
      const validated = validateProposal(
        parsed.data,
        input.leader,
        poolById,
        input.regulations,
      );
      const fatal = validated.violations.filter((v) => v.severity === "error");
      if (fatal.length === 0) {
        const metricEntries = validated.raw.cards.map((entry) => ({
          card: poolById.get(entry.card_id)!,
          count: entry.count,
        }));
        const metrics = buildPostGenerationMetrics(input.leader, metricEntries);
        return {
          modelVersion: `${model}@${new Date().toISOString().slice(0, 10)}`,
          variantProfile,
          variantLabel: VARIANT_PROFILE_LABELS[variantProfile],
          variantReasonJa: validated.raw.variant_reason_ja,
          selectedStyle: selection.selectedStyle,
          selectedTags: selection.selectedTags,
          effectiveStyle,
          styleAptitudes: aptitudes,
          archetypeName: validated.raw.archetype_name,
          cards: validated.raw.cards.map((c) => ({
            cardId: c.card_id,
            count: c.count,
            roleJa: c.role_ja,
            selectionReasonJa: c.selection_reason_ja,
          })),
          winCondition: validated.raw.win_condition,
          deckConceptJa: validated.raw.deck_concept_ja,
          styleAptitudeReasonJa: validated.raw.style_aptitude_reason_ja,
          keyCards: validated.raw.key_cards,
          majorCombos: validated.raw.major_combos.map((combo) => ({
            titleJa: combo.title_ja,
            cardIds: combo.card_ids,
            explanationJa: combo.explanation_ja,
          })),
          curveExplanationJa: validated.raw.curve_explanation_ja,
          metrics,
          strengths: validated.raw.strengths,
          weaknesses: validated.raw.weaknesses,
          favorable: validated.raw.typical_matchups.favorable,
          unfavorable: validated.raw.typical_matchups.unfavorable,
          lowDiversityWarning: null,
          diversityRetries: 0,
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

export const _deckSuggestionTestInternals = {
  buildSystem,
  buildUserPrompt,
  prepareDeckSuggestion,
  proposalSchema,
  rankPreparedCandidatePool,
  validateProposal,
};
