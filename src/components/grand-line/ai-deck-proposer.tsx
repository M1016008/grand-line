"use client";

import { useState, useTransition } from "react";

import type {
  DeckSuggestion,
  DeckVariantsSuggestion,
} from "@/ai/deck-suggestion";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { CardListItem } from "@/lib/cards";
import {
  FEATURE_TAG_IDS,
  FEATURE_TAG_LABELS,
  MAIN_STYLE_IDS,
  MAIN_STYLE_LABELS,
  MAX_FEATURE_TAGS,
  VARIANT_PROFILE_FOCUS_LABELS,
  VARIANT_PROFILE_IDS,
  type FeatureTag,
  type LeaderStyleAptitude,
  type MainStyle,
  type VariantProfile,
} from "@/lib/deck-intelligence-preferences";
import {
  DECK_INTELLIGENCE_GENERATION_MODES,
  resolveDeckCopyEntries,
  type DeckIntelligenceGenerationMode,
  type VariantMetricSummary,
} from "@/lib/deck-intelligence-compare";
import { proxiedCardImage } from "@/lib/img";
import { useDeckDraft } from "@/stores/deck";

interface AiDeckProposerProps {
  leader: CardListItem;
  pool: CardListItem[];
  styleAptitudes: LeaderStyleAptitude[];
}

interface ApiError {
  error: string;
  detail?: string;
  attempts?: number;
}

const VARIANT_PERSONALITY_JA: Record<VariantProfile, string> = {
  recommended:
    "Leaderとの相性と選択したMain Styleを軸に、Feature Tagsを自然に取り入れる標準案です。",
  consistency:
    "同じMain Styleを保ちながら、サーチ・アクセスしやすい中核札・カウンター・コスト帯の安定を厚くする案です。",
  specialization:
    "同じMain Styleを保ちながら、選択したFeature Tagsの動きを推奨構築より一段はっきり出す案です。",
};

export function AiDeckProposer({
  leader,
  pool,
  styleAptitudes,
}: AiDeckProposerProps) {
  const [selectedStyle, setSelectedStyle] = useState<MainStyle>("auto");
  const [selectedTags, setSelectedTags] = useState<FeatureTag[]>([]);
  const [generationMode, setGenerationMode] =
    useState<DeckIntelligenceGenerationMode>("single");
  const [proposal, setProposal] = useState<DeckSuggestion | null>(null);
  const [variantProposal, setVariantProposal] =
    useState<DeckVariantsSuggestion | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, startTransition] = useTransition();
  const replace = useDeckDraft((s) => s.replace);
  const displayedAptitudes =
    proposal?.styleAptitudes ??
    variantProposal?.styleAptitudes ??
    styleAptitudes;
  const aptitudeByStyle = new Map(
    displayedAptitudes.map((aptitude) => [aptitude.style, aptitude]),
  );

  // Pool lookup so we can hydrate the AI's bare {cardId,count} into full cards.
  const poolById = new Map(pool.map((c) => [c.id, c]));

  async function fetchProposal() {
    setError(null);
    setProposal(null);
    setVariantProposal(null);
    const res = await fetch(`/api/ai/decks/${leader.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: generationMode,
        selectedStyle,
        selectedTags,
      }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as ApiError;
      setError(err);
      return;
    }
    if (generationMode === "compare") {
      setVariantProposal((await res.json()) as DeckVariantsSuggestion);
    } else {
      setProposal((await res.json()) as DeckSuggestion);
    }
  }

  function toggleTag(tag: FeatureTag) {
    setSelectedTags((current) => {
      if (current.includes(tag)) {
        return current.filter((candidate) => candidate !== tag);
      }
      if (current.length >= MAX_FEATURE_TAGS) return current;
      return [...current, tag];
    });
  }

  function applyProposal(target: DeckSuggestion) {
    replace(resolveDeckCopyEntries(target.cards, poolById));
  }

  return (
    <Card className="border-primary/40 bg-card/50">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-sm tracking-wide">
            Deck Intelligence Builder
          </h3>
          <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
            Phase 4 · Opus
          </span>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
              Generation Mode
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {DECK_INTELLIGENCE_GENERATION_MODES.map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={generationMode === mode ? "secondary" : "outline"}
                  aria-pressed={generationMode === mode}
                  disabled={pending}
                  onClick={() => setGenerationMode(mode)}
                >
                  {mode === "single" ? "おすすめ1案" : "3案を比較"}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-muted-foreground text-[10px] tracking-widest uppercase">
              Main Style · 1つ
            </label>
            <Select
              value={selectedStyle}
              onValueChange={(value) => setSelectedStyle(value as MainStyle)}
            >
              <SelectTrigger className="w-full text-xs" aria-label="Main Style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAIN_STYLE_IDS.map((style) => (
                  <SelectItem key={style} value={style}>
                    {MAIN_STYLE_LABELS[style]} {renderStars(aptitudeByStyle.get(style)?.stars)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div
              className="border-border/30 bg-background/30 mt-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border p-2"
              aria-label="Leader Style Aptitude"
            >
              {MAIN_STYLE_IDS.filter((style) => style !== "auto").map((style) => {
                const aptitude = aptitudeByStyle.get(style);
                return (
                  <div
                    key={style}
                    className="flex items-center justify-between gap-2 text-[10px]"
                  >
                    <span>{MAIN_STYLE_LABELS[style]}</span>
                    <span
                      className={cn(
                        "font-mono tracking-tight",
                        aptitude && aptitude.stars <= 2
                          ? "text-muted-foreground"
                          : "text-primary",
                      )}
                    >
                      {renderStars(aptitude?.stars)}
                      {aptitude && aptitude.stars <= 2 ? " 相性低め" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-muted-foreground text-[10px]">
              Leader効果・特徴・legal pool・support availabilityからsystemが算出。
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-[10px] tracking-widest uppercase">
                Feature Tags · 0〜3個
              </span>
              <span className="text-muted-foreground font-mono text-[10px]">
                {selectedTags.length}/{MAX_FEATURE_TAGS}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FEATURE_TAG_IDS.map((tag) => {
                const selected = selectedTags.includes(tag);
                const disabled =
                  !selected && selectedTags.length >= MAX_FEATURE_TAGS;
                return (
                  <Button
                    key={tag}
                    type="button"
                    size="xs"
                    variant={selected ? "secondary" : "outline"}
                    aria-pressed={selected}
                    disabled={disabled || pending}
                    onClick={() => toggleTag(tag)}
                  >
                    {FEATURE_TAG_LABELS[tag]}
                  </Button>
                );
              })}
            </div>
            <p className="text-muted-foreground text-[10px] leading-relaxed">
              Main Styleを主軸に、タグは候補順位へ補助的に加点します。
            </p>
          </div>

          <Button
            onClick={() => startTransition(fetchProposal)}
            disabled={pending}
            size="sm"
            className="w-full"
          >
            {pending
              ? generationMode === "compare"
                ? "3案を生成中…"
                : "生成中…"
              : generationMode === "compare"
                ? "3案を生成して比較"
                : "提案"}
          </Button>
        </div>

        {error ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-xs">
            <strong className="block">{error.error}</strong>
            {error.detail ? <p className="opacity-90">{error.detail}</p> : null}
            {error.error === "missing_api_key" ? (
              <p className="text-muted-foreground mt-2">
                <code className="font-mono text-[10px]">.env.local</code> の{" "}
                <code className="font-mono text-[10px]">ANTHROPIC_API_KEY</code>{" "}
                を設定して dev サーバを再起動してください。
              </p>
            ) : null}
          </div>
        ) : null}

        {variantProposal ? (
          <DeckVariantsView
            response={variantProposal}
            poolById={poolById}
            onApply={applyProposal}
          />
        ) : null}

        {proposal ? (
          <div className="space-y-3 text-xs">
            <Separator />
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
                  アーキタイプ
                </div>
                <div className="text-foreground font-display text-base font-semibold">
                  {proposal.archetypeName}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="secondary" className="text-[9px]">
                    {MAIN_STYLE_LABELS[proposal.selectedStyle]}
                  </Badge>
                  {proposal.selectedStyle === "auto" ? (
                    <Badge variant="outline" className="text-[9px]">
                      採用軸: {MAIN_STYLE_LABELS[proposal.effectiveStyle]}
                    </Badge>
                  ) : null}
                  {proposal.selectedTags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[9px]">
                      {FEATURE_TAG_LABELS[tag]}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                onClick={() => applyProposal(proposal)}
                size="sm"
                variant="outline"
              >
                下書きに反映
              </Button>
            </div>

            <Section label="デッキコンセプト">
              <p>{proposal.deckConceptJa}</p>
            </Section>

            <Section label="Leader Style Aptitude 理由">
              <p>{proposal.styleAptitudeReasonJa}</p>
            </Section>

            <Section label="勝ち筋">
              <p>{proposal.winCondition}</p>
            </Section>

            <Section label="キーカード">
              <div className="flex flex-wrap gap-1">
                {proposal.keyCards.map((cardId) => (
                  <Badge key={cardId} variant="outline" className="text-[9px]">
                    {poolById.get(cardId)?.name ?? cardId}
                  </Badge>
                ))}
              </div>
            </Section>

            {proposal.majorCombos.length > 0 ? (
              <Section label="主要コンボ">
                <ul className="space-y-1.5">
                  {proposal.majorCombos.map((combo, index) => (
                    <li key={`${combo.titleJa}-${index}`}>
                      <strong>{combo.titleJa}</strong>
                      <span className="text-muted-foreground ml-1 font-mono text-[9px]">
                        {combo.cardIds.join(" + ")}
                      </span>
                      <p>{combo.explanationJa}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            <Section label="コストカーブ方針">
              <p>{proposal.curveExplanationJa}</p>
            </Section>

            <div className="grid grid-cols-2 gap-3">
              <Section label="強み">
                <Bullets items={proposal.strengths} />
              </Section>
              <Section label="弱み">
                <Bullets items={proposal.weaknesses} />
              </Section>
            </div>

            {proposal.favorable.length + proposal.unfavorable.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                <Section label="相性◯">
                  <Bullets items={proposal.favorable} />
                </Section>
                <Section label="相性✕">
                  <Bullets items={proposal.unfavorable} />
                </Section>
              </div>
            ) : null}

            <Section label={`提案デッキ (${proposal.cards.length} 種 / ${proposal.cards.reduce((a, b) => a + b.count, 0)} 枚)`}>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {proposal.cards.map((c) => {
                  const card = poolById.get(c.cardId);
                  return (
                    <li
                      key={c.cardId}
                      className={cn(
                        "border-border/30 bg-background/40 flex items-center gap-2 rounded-md border p-1.5",
                        !card && "border-destructive/60 text-destructive",
                      )}
                    >
                      <div className="border-border/30 bg-card/60 relative aspect-[3/4] w-7 shrink-0 overflow-hidden rounded-sm border">
                        {card?.imageUrlJp ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={proxiedCardImage(card.imageUrlJp)!}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-muted-foreground font-mono text-[9px]">
                          {c.cardId} ×{c.count}
                        </div>
                        {card ? (
                          <div className="truncate text-[10px]">{card.name}</div>
                        ) : null}
                        <div className="text-primary text-[9px]">{c.roleJa}</div>
                        <p className="text-muted-foreground mt-0.5 text-[9px] leading-snug">
                          {c.selectionReasonJa}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>

            <Section label="Deterministic Metrics">
              <div className="grid grid-cols-2 gap-2">
                <MetricList title="Cost Curve" values={proposal.metrics.costCurve} />
                <MetricList
                  title="Counter"
                  values={proposal.metrics.counterDistribution}
                />
              </div>
              <p className="mt-1">
                Trigger ratio: {(proposal.metrics.triggerRatio * 100).toFixed(1)}%
              </p>
              <p className="mt-1">
                Evaluation: {Object.entries(proposal.metrics.evaluationScores)
                  .map(([key, value]) => `${key} ${value}`)
                  .join(" / ")}
              </p>
              <p className="mt-1">
                Major mechanics: {proposal.metrics.majorMechanics
                  .map(({ mechanic, count }) => `${mechanic}×${count}`)
                  .join(" / ") || "なし"}
              </p>
            </Section>

            {proposal.warnings.length > 0 ? (
              <div className="text-source-unverified text-[10px]">
                ⚠ {proposal.warnings.join(" / ")}
              </div>
            ) : null}

            <p className="text-muted-foreground text-[10px]">
              モデル: <code className="font-mono">{proposal.modelVersion}</code>
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DeckVariantsView({
  response,
  poolById,
  onApply,
}: {
  response: DeckVariantsSuggestion;
  poolById: Map<string, CardListItem>;
  onApply: (proposal: DeckSuggestion) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const byProfile = new Map(
    response.variants.map((variant) => [variant.variantProfile, variant]),
  );

  return (
    <div className="space-y-3 text-xs">
      <Separator />
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
            Deck Intelligence Compare v1
          </div>
          <p className="text-muted-foreground mt-0.5 text-[10px]">
            同じLeader・Main Style・Feature Tagsで構築方針だけを比較します。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((current) => !current)}
        >
          {showDetails ? "比較を閉じる" : "詳しく比較"}
        </Button>
      </div>

      <div className="grid gap-2 lg:grid-cols-3">
        {VARIANT_PROFILE_IDS.map((profile) => {
          const variant = byProfile.get(profile);
          if (!variant) return null;
          const metrics = response.comparison.metricsByVariant[profile];
          const cardComparison = response.comparison.cardsByVariant[profile];
          const uniqueCards = cardComparison.uniqueCardIds
            .slice(0, 5)
            .map((cardId) => poolById.get(cardId)?.name ?? cardId);
          return (
            <Card key={profile} className="border-border/50 bg-background/35">
              <CardContent className="flex h-full flex-col gap-2 p-3">
                <div>
                  <Badge variant="secondary" className="text-[9px]">
                    {variant.variantLabel}
                  </Badge>
                  <div className="font-display mt-1 text-sm font-semibold">
                    {variant.archetypeName}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant="outline" className="text-[9px]">
                      {MAIN_STYLE_LABELS[variant.selectedStyle]}
                    </Badge>
                    {variant.selectedTags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[9px]">
                        {FEATURE_TAG_LABELS[tag]}
                      </Badge>
                    ))}
                  </div>
                </div>

                <Section label="構築の性格">
                  <p>{VARIANT_PERSONALITY_JA[profile]}</p>
                </Section>
                <Section label="構築思想">
                  <p>{variant.deckConceptJa}</p>
                </Section>
                <Section label="この案だけの採用カード">
                  <p>
                    {uniqueCards.join(" / ") ||
                      "単独採用なし（採用枚数の配分で性格を分けています）"}
                  </p>
                  <p className="text-muted-foreground mt-1 text-[9px]">
                    枚数を増やした主なカード: {formatDeltas(
                      cardComparison.increasedCards,
                      poolById,
                    )}
                  </p>
                </Section>
                <Section label="この案を選ぶ理由">
                  <p>{variant.variantReasonJa}</p>
                </Section>
                <Section label="主なキーカード">
                  <div className="flex flex-wrap gap-1">
                    {variant.keyCards.slice(0, 5).map((cardId) => (
                      <Badge key={cardId} variant="outline" className="text-[9px]">
                        {poolById.get(cardId)?.name ?? cardId}
                      </Badge>
                    ))}
                  </div>
                </Section>

                <div className="border-border/30 border-y py-2">
                  <div className="text-muted-foreground mb-1 text-[9px]">
                    プレイ傾向（優劣ではなく性格の比較）
                  </div>
                  <div className="grid grid-cols-2 gap-1 font-mono text-[9px]">
                    <span>Attack {metrics.attack}</span>
                    <span>Stability {metrics.stability}</span>
                    <span>Expansion {metrics.expansion}</span>
                    <span>Defense {metrics.defense}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Section label="Strengths">
                    <Bullets items={variant.strengths.slice(0, 2)} />
                  </Section>
                  <Section label="Weaknesses">
                    <Bullets items={variant.weaknesses.slice(0, 2)} />
                  </Section>
                </div>

                {variant.lowDiversityWarning ? (
                  <p className="text-source-unverified text-[10px]">
                    ⚠ {variant.lowDiversityWarning}
                  </p>
                ) : null}

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-auto w-full"
                  onClick={() => onApply(variant)}
                >
                  この構築を下書きに反映
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {showDetails ? (
        <DetailedVariantComparison response={response} poolById={poolById} />
      ) : null}
    </div>
  );
}

function DetailedVariantComparison({
  response,
  poolById,
}: {
  response: DeckVariantsSuggestion;
  poolById: Map<string, CardListItem>;
}) {
  const summaries = response.comparison.metricsByVariant;
  const metricRows: Array<{
    label: string;
    render: (summary: VariantMetricSummary) => string;
  }> = [
    { label: "Attack", render: (summary) => String(summary.attack) },
    { label: "Stability", render: (summary) => String(summary.stability) },
    { label: "Expansion", render: (summary) => String(summary.expansion) },
    { label: "Defense", render: (summary) => String(summary.defense) },
    { label: "Meta", render: (summary) => String(summary.meta) },
    {
      label: "Trigger ratio",
      render: (summary) => `${(summary.triggerRatio * 100).toFixed(1)}%`,
    },
    {
      label: "Counter distribution",
      render: (summary) =>
        `${summary.counterCards}枚 / 2000+ ${summary.counter2000Plus}枚`,
    },
    {
      label: "Average / major cost bands",
      render: (summary) =>
        `${summary.averageCost.toFixed(2)} / ${costBandJa(summary.majorCostBand)} (${summary.costBands.low}-${summary.costBands.mid}-${summary.costBands.high})`,
    },
  ];

  return (
    <div className="border-border/40 bg-background/30 space-y-3 rounded-md border p-3">
      <p className="text-muted-foreground text-[10px]">
        各数値は3案の性格差を見るための指標です。高い数値が構築の優劣を決めるものではありません。
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-left text-[10px]">
          <thead>
            <tr className="border-border/40 border-b">
              <th className="p-2">指標</th>
              {VARIANT_PROFILE_IDS.map((profile) => (
                <th key={profile} className="p-2">
                  {VARIANT_PROFILE_FOCUS_LABELS[profile]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metricRows.map((row) => (
              <tr key={row.label} className="border-border/20 border-b last:border-0">
                <th className="text-muted-foreground p-2 font-medium">
                  {row.label}
                </th>
                {VARIANT_PROFILE_IDS.map((profile) => (
                  <td key={profile} className="p-2 font-mono">
                    {row.render(summaries[profile])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {VARIANT_PROFILE_IDS.map((profile) => {
          const comparison = response.comparison.cardsByVariant[profile];
          return (
            <Section
              key={profile}
              label={`${VARIANT_PROFILE_FOCUS_LABELS[profile]}だけの主な採用カード`}
            >
              <Bullets
                items={comparison.uniqueCardIds
                  .slice(0, 8)
                  .map((cardId) => poolById.get(cardId)?.name ?? cardId)}
              />
              <p className="text-muted-foreground mt-1 text-[9px]">
                増加: {formatDeltas(comparison.increasedCards, poolById)}
              </p>
              <p className="text-muted-foreground text-[9px]">
                減少: {formatDeltas(comparison.decreasedCards, poolById)}
              </p>
            </Section>
          );
        })}
      </div>

      <Section label="共通採用カード">
        <p>
          {response.comparison.commonCards
            .slice(0, 12)
            .map(
              (card) =>
                `${poolById.get(card.cardId)?.name ?? card.cardId}×${card.sharedCopies}`,
            )
            .join(" / ") || "なし"}
        </p>
      </Section>

      <Section label="Copy-level Similarity">
        <p className="font-mono text-[9px]">
          {response.comparison.similarities
            .map(
              (similarity) =>
                `${VARIANT_PROFILE_FOCUS_LABELS[similarity.profiles[0]]}↔${VARIANT_PROFILE_FOCUS_LABELS[similarity.profiles[1]]}: shared ${similarity.sharedCardCopies} / different ${similarity.differentCardCopies} / ${(similarity.similarityRatio * 100).toFixed(1)}%`,
            )
            .join(" | ")}
        </p>
      </Section>
    </div>
  );
}

function formatDeltas(
  deltas: Array<{
    cardId: string;
    referenceCount: number;
    variantCount: number;
  }>,
  poolById: Map<string, CardListItem>,
): string {
  return (
    deltas
      .slice(0, 5)
      .map(
        (delta) =>
          `${poolById.get(delta.cardId)?.name ?? delta.cardId} ${delta.referenceCount}→${delta.variantCount}`,
      )
      .join(" / ") || "なし"
  );
}

function costBandJa(band: "low" | "mid" | "high"): string {
  if (band === "low") return "low(0-3)";
  if (band === "mid") return "mid(4-6)";
  return "high(7+)";
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-[10px] tracking-widest uppercase">
        {label}
      </div>
      <div className="text-foreground/90 leading-relaxed">{children}</div>
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">(なし)</span>;
  return (
    <ul className="list-inside list-disc space-y-0.5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

function MetricList({
  title,
  values,
}: {
  title: string;
  values: Record<string, number>;
}) {
  return (
    <div>
      <strong className="text-[10px]">{title}</strong>
      <p className="text-muted-foreground font-mono text-[9px]">
        {Object.entries(values)
          .map(([key, value]) => `${key}:${value}`)
          .join(" / ")}
      </p>
    </div>
  );
}

function renderStars(stars: number | undefined): string {
  if (!stars) return "☆☆☆☆☆";
  return `${"★".repeat(stars)}${"☆".repeat(5 - stars)}`;
}
