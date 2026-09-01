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
import { DeckBattleBenchmark } from "@/components/grand-line/deck-battle-benchmark";
import {
  DeckIntelligenceStepPanel,
  DeckIntelligenceStepper,
  type DeckIntelligenceStep,
  type DeckIntelligenceStepStatus,
} from "@/components/grand-line/deck-intelligence-workflow";
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
  applyDeckCopyEntries,
  DECK_INTELLIGENCE_GENERATION_MODES,
  type DeckCopyEntry,
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

interface AppliedDraftStatus {
  key: string;
  label: string;
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
  const [applyError, setApplyError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<DeckIntelligenceStep>(1);
  const [expandedStep, setExpandedStep] =
    useState<DeckIntelligenceStep | null>(1);
  const [benchmarkComplete, setBenchmarkComplete] = useState(false);
  const [optimizerComplete, setOptimizerComplete] = useState(false);
  const [appliedDraft, setAppliedDraft] =
    useState<AppliedDraftStatus | null>(null);
  const [showAptitudes, setShowAptitudes] = useState(false);
  const [pending, startTransition] = useTransition();
  const replace = useDeckDraft((s) => s.replace);
  const draftEntries = useDeckDraft((s) => s.entries);
  const draftTotal = Object.values(draftEntries).reduce(
    (total, entry) => total + entry.count,
    0,
  );
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
    setApplyError(null);
    setProposal(null);
    setVariantProposal(null);
    setBenchmarkComplete(false);
    setOptimizerComplete(false);
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
    setCurrentStep(2);
    setExpandedStep(2);
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

  function applyCards(
    entries: DeckCopyEntry[],
    status: AppliedDraftStatus = {
      key: "proposal",
      label: "構築案から反映",
    },
  ): boolean {
    setApplyError(null);
    try {
      applyDeckCopyEntries(entries, poolById, replace);
      setAppliedDraft(status);
      setCurrentStep(5);
      setExpandedStep(5);
      return true;
    } catch {
      setApplyError(
        "提案カードを下書きへ反映できませんでした。提案を再生成してください。",
      );
      return false;
    }
  }

  function applyProposal(target: DeckSuggestion, status: AppliedDraftStatus) {
    applyCards(target.cards, status);
  }

  const hasProposal = Boolean(proposal || variantProposal);
  const completedSteps = new Set<DeckIntelligenceStep>();
  if (hasProposal) completedSteps.add(1);
  if (hasProposal) completedSteps.add(2);
  if (benchmarkComplete) completedSteps.add(3);
  if (optimizerComplete) completedSteps.add(4);
  const enabledSteps = new Set<DeckIntelligenceStep>([1]);
  if (hasProposal) enabledSteps.add(2);
  if (variantProposal) enabledSteps.add(3);
  if (benchmarkComplete) enabledSteps.add(4);
  if (appliedDraft) enabledSteps.add(5);

  function stepStatus(step: DeckIntelligenceStep): DeckIntelligenceStepStatus {
    if (currentStep === step) return "current";
    return completedSteps.has(step) ? "complete" : "upcoming";
  }

  function advanceTo(step: DeckIntelligenceStep) {
    setCurrentStep(step);
    setExpandedStep(step);
  }

  function toggleStep(step: DeckIntelligenceStep) {
    if (!enabledSteps.has(step)) return;
    setExpandedStep((current) => (current === step ? null : step));
  }

  return (
    <Card className="border-primary/40 bg-card/50 overflow-hidden">
      <CardContent className="space-y-4 p-4 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-lg tracking-wide">Deck Intelligence</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              条件を決め、構築案を比較し、下書きへ反映するまでを順に進めます。
            </p>
          </div>
          <div className="border-border/40 bg-background/40 min-w-[190px] rounded-md border px-3 py-2">
            <div className="text-muted-foreground text-[9px] tracking-widest">現在の下書き</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="font-mono text-sm">{draftTotal}枚</span>
              <span className="text-muted-foreground text-[10px]">
                {appliedDraft?.label ?? "手動編集中"}
              </span>
            </div>
          </div>
        </header>

        <DeckIntelligenceStepper
          currentStep={currentStep}
          completedSteps={completedSteps}
          enabledSteps={enabledSteps}
          onStepChange={toggleStep}
        />

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

        {applyError ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-xs">
            {applyError}
          </div>
        ) : null}

        <div className="space-y-3">
          <DeckIntelligenceStepPanel
            step={1}
            title="構築条件"
            status={stepStatus(1)}
            summary={`${generationMode === "single" ? "おすすめ1案" : "3案を比較"}・${MAIN_STYLE_LABELS[selectedStyle]}・${selectedTags.length > 0 ? selectedTags.map((tag) => FEATURE_TAG_LABELS[tag]).join(" / ") : "タグなし"}`}
            expanded={expandedStep === 1}
            onToggle={() => toggleStep(1)}
          >
            <div className="space-y-5">
              <div className="space-y-2">
                <div className="text-muted-foreground text-[10px] tracking-widest">生成方法</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {DECK_INTELLIGENCE_GENERATION_MODES.map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={generationMode === mode ? "secondary" : "outline"}
                      aria-pressed={generationMode === mode}
                      disabled={pending}
                      className="h-auto justify-start px-4 py-3 text-left"
                      onClick={() => setGenerationMode(mode)}
                    >
                      <span>
                        <span className="block text-sm">
                          {mode === "single" ? "おすすめ1案" : "3案を比較"}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-[10px] font-normal">
                          {mode === "single" ? "すぐ構築" : "構築方針を比較"}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(220px,0.7fr)_minmax(0,1.3fr)]">
                <div className="space-y-2">
                  <label className="text-muted-foreground text-[10px] tracking-widest">
                    Main Style
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
                          {MAIN_STYLE_LABELS[style]}{" "}
                          {renderStars(aptitudeByStyle.get(style)?.stars)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-expanded={showAptitudes}
                    aria-controls="leader-style-aptitudes"
                    onClick={() => setShowAptitudes((current) => !current)}
                  >
                    {showAptitudes ? "Leader適性を閉じる" : "Leader適性を見る"}
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-[10px] tracking-widest">
                      Feature Tags
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
                  <p className="text-muted-foreground text-[10px]">
                    Main Styleを主軸に、0〜3個の補助傾向を加えます。
                  </p>
                </div>
              </div>

              {showAptitudes ? (
                <div
                  id="leader-style-aptitudes"
                  className="border-border/30 bg-background/30 grid gap-2 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-3"
                  aria-label="Leader Style Aptitude"
                >
                  {MAIN_STYLE_IDS.filter((style) => style !== "auto").map((style) => {
                    const aptitude = aptitudeByStyle.get(style);
                    return (
                      <div key={style} className="flex items-center justify-between gap-2 text-[10px]">
                        <span>{MAIN_STYLE_LABELS[style]}</span>
                        <span className={cn("font-mono", aptitude && aptitude.stars <= 2 ? "text-muted-foreground" : "text-primary")}>
                          {renderStars(aptitude?.stars)}
                          {aptitude && aptitude.stars <= 2 ? " 相性低め" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <Button
                onClick={() => startTransition(fetchProposal)}
                disabled={pending}
                className="w-full sm:w-auto sm:min-w-56"
              >
                {pending
                  ? generationMode === "compare"
                    ? "3案を生成中…"
                    : "生成中…"
                  : generationMode === "compare"
                    ? "3案を生成して比較"
                    : "おすすめ構築を生成"}
              </Button>
            </div>
          </DeckIntelligenceStepPanel>

          {hasProposal ? (
            <DeckIntelligenceStepPanel
              step={2}
              title={variantProposal ? "3つの構築案" : "構築案"}
              status={stepStatus(2)}
              summary={
                variantProposal
                  ? "推奨・安定・特化の違いを比較"
                  : proposal?.archetypeName ?? "生成済み"
              }
              expanded={expandedStep === 2}
              onToggle={() => toggleStep(2)}
            >
              {variantProposal ? (
                <DeckVariantsView
                  response={variantProposal}
                  poolById={poolById}
                  onApply={applyProposal}
                  appliedDraftKey={appliedDraft?.key ?? null}
                />
              ) : proposal ? (
                <SingleProposalView
                  proposal={proposal}
                  poolById={poolById}
                  applied={appliedDraft?.key === "single"}
                  onApply={() =>
                    applyProposal(proposal, {
                      key: "single",
                      label: "おすすめ構築から反映",
                    })
                  }
                />
              ) : null}
            </DeckIntelligenceStepPanel>
          ) : null}

          {variantProposal ? (
            <DeckBattleBenchmark
              response={variantProposal}
              leader={leader}
              pool={pool}
              personalityByProfile={VARIANT_PERSONALITY_JA}
              currentStep={currentStep}
              expandedStep={expandedStep}
              onToggleStep={toggleStep}
              onAdvanceStep={advanceTo}
              onBenchmarkComplete={() => setBenchmarkComplete(true)}
              onOptimizerComplete={() => setOptimizerComplete(true)}
              onApplyCards={applyCards}
              appliedDraftKey={appliedDraft?.key ?? null}
            />
          ) : null}

          {appliedDraft ? (
            <DeckIntelligenceStepPanel
              step={5}
              title="現在の下書き"
              status={stepStatus(5)}
              summary={`${draftTotal}枚・${appliedDraft.label}`}
              expanded={expandedStep === 5}
              onToggle={() => toggleStep(5)}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-medium">下書きに反映済み</p>
                  <p className="text-muted-foreground mt-1">
                    自動保存はしていません。内容を確認してから保存してください。
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    document.getElementById("deck-save")?.scrollIntoView({
                      behavior: "smooth",
                      block: "center",
                    })
                  }
                >
                  保存欄へ
                </Button>
              </div>
            </DeckIntelligenceStepPanel>
          ) : null}
        </div>

        <p className="text-muted-foreground border-border/30 border-t pt-3 text-[10px] leading-relaxed">
          カード事実と数値評価は検証済みデータとdeterministic計算を使用します。AIの説明は構築判断の参考情報です。
        </p>
      </CardContent>
    </Card>
  );
}

function SingleProposalView({
  proposal,
  poolById,
  applied,
  onApply,
}: {
  proposal: DeckSuggestion;
  poolById: Map<string, CardListItem>;
  applied: boolean;
  onApply: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const scores = proposal.metrics.evaluationScores;

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg font-semibold">
            {proposal.archetypeName}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge variant="secondary">
              {MAIN_STYLE_LABELS[proposal.selectedStyle]}
            </Badge>
            {proposal.selectedStyle === "auto" ? (
              <Badge variant="outline">
                採用軸: {MAIN_STYLE_LABELS[proposal.effectiveStyle]}
              </Badge>
            ) : null}
            {proposal.selectedTags.map((tag) => (
              <Badge key={tag} variant="outline">
                {FEATURE_TAG_LABELS[tag]}
              </Badge>
            ))}
          </div>
        </div>
        <Button
          type="button"
          variant={applied ? "secondary" : "outline"}
          disabled={applied}
          onClick={onApply}
        >
          {applied ? "下書きに反映済み" : "この構築を下書きに反映"}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
        <div className="border-border/30 rounded-md border p-3">
          <div className="text-muted-foreground text-[9px] tracking-widest">構築コンセプト</div>
          <p className="mt-1 leading-relaxed">{proposal.deckConceptJa}</p>
          <p className="text-muted-foreground mt-2 text-[10px]">
            勝ち筋: {proposal.winCondition}
          </p>
        </div>
        <div className="border-border/30 grid grid-cols-2 gap-2 rounded-md border p-3 font-mono text-[10px]">
          <span>Attack {scores.attack}</span>
          <span>Stability {scores.stability}</span>
          <span>Expansion {scores.expansion}</span>
          <span>Defense {scores.defense}</span>
        </div>
      </div>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-expanded={showDetails}
        aria-controls="single-proposal-details"
        onClick={() => setShowDetails((current) => !current)}
      >
        {showDetails ? "分析詳細を閉じる" : "分析詳細を見る"}
      </Button>

      {showDetails ? (
        <div id="single-proposal-details" className="border-border/30 space-y-4 border-t pt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Section label="Leader適性の理由">
              <p>{proposal.styleAptitudeReasonJa}</p>
            </Section>
            <Section label="コストカーブ方針">
              <p>{proposal.curveExplanationJa}</p>
            </Section>
            <Section label="強み">
              <Bullets items={proposal.strengths} />
            </Section>
            <Section label="弱み">
              <Bullets items={proposal.weaknesses} />
            </Section>
          </div>

          <Section label="キーカード">
            <div className="flex flex-wrap gap-1">
              {proposal.keyCards.map((cardId) => (
                <Badge key={cardId} variant="outline">
                  {poolById.get(cardId)?.name ?? cardId}
                </Badge>
              ))}
            </div>
          </Section>

          <Section
            label={`提案デッキ (${proposal.cards.length}種 / ${proposal.cards.reduce((total, card) => total + card.count, 0)}枚)`}
          >
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {proposal.cards.map((item) => {
                const card = poolById.get(item.cardId);
                return (
                  <li
                    key={item.cardId}
                    className={cn(
                      "border-border/30 bg-background/40 flex items-center gap-2 rounded-md border p-2",
                      !card && "border-destructive/60 text-destructive",
                    )}
                  >
                    <div className="border-border/30 bg-card/60 relative aspect-[3/4] w-9 shrink-0 overflow-hidden rounded-sm border">
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
                      <div className="truncate text-[10px]">{card?.name ?? item.cardId}</div>
                      <div className="text-muted-foreground font-mono text-[9px]">
                        {item.cardId} ×{item.count}
                      </div>
                      <div className="text-primary text-[9px]">{item.roleJa}</div>
                      <div className="text-muted-foreground mt-0.5 line-clamp-2 text-[9px] leading-relaxed">
                        {item.selectionReasonJa}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section label="Deterministic metrics">
            <div className="grid gap-2 sm:grid-cols-2">
              <MetricList title="Cost Curve" values={proposal.metrics.costCurve} />
              <MetricList title="Counter" values={proposal.metrics.counterDistribution} />
            </div>
            <p className="text-muted-foreground mt-2 font-mono text-[9px]">
              Trigger {(proposal.metrics.triggerRatio * 100).toFixed(1)}%・model {proposal.modelVersion}
            </p>
          </Section>
        </div>
      ) : null}
    </div>
  );
}

function CardDifferenceList({
  label,
  cardIds,
  proposal,
  poolById,
}: {
  label: string;
  cardIds: string[];
  proposal: DeckSuggestion;
  poolById: Map<string, CardListItem>;
}) {
  const visible = cardIds.slice(0, 4);
  return (
    <div>
      <div className="text-muted-foreground mb-1.5 text-[9px] tracking-widest">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {visible.length > 0 ? (
          visible.map((cardId) => {
            const card = poolById.get(cardId);
            const count = proposal.cards.find((item) => item.cardId === cardId)?.count ?? 0;
            return (
              <span key={cardId} className="border-border/40 bg-background/45 max-w-full rounded-md border px-2 py-1">
                <span className="block truncate text-[10px]">{card?.name ?? cardId} ×{count}</span>
                <span className="text-muted-foreground block font-mono text-[8px]">{cardId}</span>
              </span>
            );
          })
        ) : (
          <span className="text-muted-foreground text-[9px]">単独採用なし</span>
        )}
      </div>
    </div>
  );
}

function CardDeltaList({
  label,
  deltas,
  poolById,
}: {
  label: string;
  deltas: Array<{ cardId: string; referenceCount: number; variantCount: number }>;
  poolById: Map<string, CardListItem>;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-[9px] tracking-widest">{label}</div>
      <div className="space-y-1">
        {deltas.length > 0 ? (
          deltas.slice(0, 3).map((delta) => (
            <div key={delta.cardId} className="flex min-w-0 items-center justify-between gap-2 text-[10px]">
              <span className="min-w-0 truncate">
                {poolById.get(delta.cardId)?.name ?? delta.cardId}
                <span className="text-muted-foreground ml-1 font-mono text-[8px]">{delta.cardId}</span>
              </span>
              <span className="shrink-0 font-mono">
                {delta.referenceCount}→{delta.variantCount}
              </span>
            </div>
          ))
        ) : (
          <span className="text-muted-foreground text-[9px]">なし</span>
        )}
      </div>
    </div>
  );
}

function DeckVariantsView({
  response,
  poolById,
  onApply,
  appliedDraftKey,
}: {
  response: DeckVariantsSuggestion;
  poolById: Map<string, CardListItem>;
  onApply: (proposal: DeckSuggestion, status: AppliedDraftStatus) => void;
  appliedDraftKey: string | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [expandedProfile, setExpandedProfile] =
    useState<VariantProfile | null>(null);
  const byProfile = new Map(
    response.variants.map((variant) => [variant.variantProfile, variant]),
  );

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-[10px]">
          固有採用と枚数差を中心に、3案の構築方針を比べます。
        </p>
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

      <div className="grid gap-3 xl:grid-cols-3">
        {VARIANT_PROFILE_IDS.map((profile) => {
          const variant = byProfile.get(profile);
          if (!variant) return null;
          const metrics = response.comparison.metricsByVariant[profile];
          const cardComparison = response.comparison.cardsByVariant[profile];
          const applied = appliedDraftKey === `variant:${profile}`;
          const expanded = expandedProfile === profile;
          return (
            <Card key={profile} className="border-border/50 bg-background/35">
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="secondary">{variant.variantLabel}</Badge>
                    {applied ? <Badge variant="outline">反映済み</Badge> : null}
                  </div>
                  <div className="font-display mt-2 text-base font-semibold">
                    {variant.archetypeName}
                  </div>
                  <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
                    {VARIANT_PERSONALITY_JA[profile]}
                  </p>
                </div>

                <CardDifferenceList
                  label="この案だけ"
                  cardIds={cardComparison.uniqueCardIds}
                  proposal={variant}
                  poolById={poolById}
                />
                <CardDeltaList
                  label="推奨より増"
                  deltas={cardComparison.increasedCards}
                  poolById={poolById}
                />
                <CardDeltaList
                  label="推奨より減"
                  deltas={cardComparison.decreasedCards}
                  poolById={poolById}
                />

                <div className="border-border/30 grid grid-cols-2 gap-2 border-y py-3 font-mono text-[10px]">
                    <span>Attack {metrics.attack}</span>
                    <span>Stability {metrics.stability}</span>
                    <span>Expansion {metrics.expansion}</span>
                    <span>Defense {metrics.defense}</span>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={expanded}
                  aria-controls={`variant-${profile}-details`}
                  onClick={() =>
                    setExpandedProfile((current) =>
                      current === profile ? null : profile,
                    )
                  }
                >
                  {expanded ? "詳細を閉じる" : "詳細を見る"}
                </Button>

                {expanded ? (
                  <div id={`variant-${profile}-details`} className="border-border/30 space-y-3 border-t pt-3">
                    <Section label="構築思想">
                      <p>{variant.deckConceptJa}</p>
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
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Section label="強み">
                        <Bullets items={variant.strengths} />
                      </Section>
                      <Section label="弱み">
                        <Bullets items={variant.weaknesses} />
                      </Section>
                    </div>
                  </div>
                ) : null}

                {variant.lowDiversityWarning ? (
                  <p className="text-source-unverified text-[10px]">
                    ⚠ {variant.lowDiversityWarning}
                  </p>
                ) : null}

                <Button
                  type="button"
                  size="sm"
                  variant={applied ? "secondary" : "outline"}
                  className="mt-auto w-full"
                  disabled={applied}
                  onClick={() =>
                    onApply(variant, {
                      key: `variant:${profile}`,
                      label: `${variant.variantLabel}から反映`,
                    })
                  }
                >
                  {applied ? "下書きに反映済み" : "この構築を下書きに反映"}
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
