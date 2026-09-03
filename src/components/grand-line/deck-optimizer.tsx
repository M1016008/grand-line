"use client";

import Image from "next/image";
import { useMemo, useState } from "react";

import type { DeckVariantsSuggestion } from "@/ai/deck-suggestion";
import {
  DeckIntelligenceStepPanel,
  type DeckIntelligenceStepStatus,
} from "@/components/grand-line/deck-intelligence-workflow";
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
import type { CardListItem } from "@/lib/cards";
import type {
  BenchmarkOpponentDescriptor,
  WilsonConfidenceInterval,
} from "@/lib/deck-battle-benchmark";
import type { RulesBenchmarkDeckMetrics } from "@/lib/deck-rules-benchmark";
import type { DeckCopyEntry } from "@/lib/deck-intelligence-compare";
import {
  VARIANT_PROFILE_IDS,
  VARIANT_PROFILE_LABELS,
  type VariantProfile,
} from "@/lib/deck-intelligence-preferences";
import {
  OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
  OPTIMIZER_DEFAULT_GAMES,
  OPTIMIZER_DISCLAIMER_JA,
  OPTIMIZER_SIZE_OPTIONS,
  type DeckOptimizerCandidate,
  type DeckOptimizerResult,
  type OptimizerEvidenceStatus,
  type OptimizerGames,
} from "@/lib/deck-optimizer";
import { proxiedCardImage } from "@/lib/img";
import type { CpuSkill } from "@/lib/practice-log";

interface DeckOptimizerProps {
  response: DeckVariantsSuggestion;
  leader: CardListItem;
  pool: CardListItem[];
  variantCards: Record<VariantProfile, DeckCopyEntry[]>;
  opponent: BenchmarkOpponentDescriptor;
  baseSeed: number;
  seedStep: number;
  cpuSkill: CpuSkill;
  maxTurns: number;
  current: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStart: () => void;
  onComplete: () => void;
  appliedDraftKey: string | null;
  onApplyCandidate: (
    profile: VariantProfile,
    candidate: DeckOptimizerCandidate,
  ) => boolean;
  onRebenchmark: () => void;
}

interface OptimizerApiResponse {
  optimizer: DeckOptimizerResult;
  elapsedMs: number;
}

export function DeckOptimizer({
  response,
  leader,
  pool,
  variantCards,
  opponent,
  baseSeed,
  seedStep,
  cpuSkill,
  maxTurns,
  current,
  expanded,
  onToggle,
  onStart,
  onComplete,
  appliedDraftKey,
  onApplyCandidate,
  onRebenchmark,
}: DeckOptimizerProps) {
  const [selectedProfile, setSelectedProfile] =
    useState<VariantProfile>("recommended");
  const [optimizerGames, setOptimizerGames] =
    useState<OptimizerGames>(OPTIMIZER_DEFAULT_GAMES);
  const [candidateLimit, setCandidateLimit] = useState(
    OPTIMIZER_DEFAULT_CANDIDATE_LIMIT,
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OptimizerApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const poolById = useMemo(
    () => new Map(pool.map((card) => [card.id, card])),
    [pool],
  );

  async function runOptimizer() {
    onStart();
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const request = await fetch("/api/practice/optimizer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaderId: leader.id,
          variantProfile: selectedProfile,
          targetCards: variantCards[selectedProfile],
          selectedStyle: response.selectedStyle,
          selectedTags: response.selectedTags,
          opponent,
          baseSeed,
          seedStep,
          cpuSkill,
          maxTurns,
          optimizerGames,
          candidateLimit,
        }),
      });
      if (!request.ok) {
        const failure = (await request.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(failure.detail ?? "改善候補を評価できませんでした。");
      }
      setResult((await request.json()) as OptimizerApiResponse);
      onComplete();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const status: DeckIntelligenceStepStatus = current
    ? "current"
    : result
      ? "complete"
      : "upcoming";

  return (
    <DeckIntelligenceStepPanel
      step={4}
      title="改善候補"
      status={status}
      summary={
        result
          ? `${VARIANT_PROFILE_LABELS[result.optimizer.selectedVariant.variantProfile]}・${result.optimizer.candidates.length}件の入替候補`
          : "表示中のベンチマーク条件を固定し、1枚入替の改善シグナルを探索"
      }
      expanded={expanded}
      onToggle={onToggle}
    >
      <div className="space-y-4">
        <div>
          <h5 className="font-display text-base">改善する構築を選ぶ</h5>
          <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
            ベンチマーク済みの相手・seed・CPU・最大ターンをそのまま使います。評価結果は優劣の断定ではなく、Rules Kernel内の入替差を確認する手掛かりです。
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="改善対象の構築">
          {VARIANT_PROFILE_IDS.map((profile) => (
            <Button
              key={profile}
              type="button"
              variant={selectedProfile === profile ? "default" : "outline"}
              aria-pressed={selectedProfile === profile}
              onClick={() => setSelectedProfile(profile)}
            >
              {VARIANT_PROFILE_LABELS[profile]}
            </Button>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={showSettings}
          aria-controls="optimizer-settings"
          onClick={() => setShowSettings((value) => !value)}
        >
          {showSettings ? "探索設定を閉じる" : "探索設定"}
        </Button>
        {showSettings ? (
          <div id="optimizer-settings" className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-muted-foreground text-[10px]">評価試行数</span>
              <Select
                value={String(optimizerGames)}
                onValueChange={(value) =>
                  setOptimizerGames(Number(value) as OptimizerGames)
                }
              >
                <SelectTrigger aria-label="Optimizer evaluation size" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPTIMIZER_SIZE_OPTIONS.map((option) => (
                    <SelectItem key={option.id} value={String(option.games)}>
                      {option.labelJa}: {option.games}試合 / 候補
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground text-[10px]">候補数</span>
              <Select
                value={String(candidateLimit)}
                onValueChange={(value) => setCandidateLimit(Number(value))}
              >
                <SelectTrigger aria-label="Optimizer candidate count" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[4, 8, 12, 20].map((count) => (
                    <SelectItem key={count} value={String(count)}>
                      {count}件
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        ) : null}

        <Button
          type="button"
          className="w-full sm:w-auto sm:min-w-64"
          disabled={running}
          onClick={runOptimizer}
        >
          {running
            ? `${optimizerGames} × baseline/candidatesを比較中…`
            : "改善候補を探す"}
        </Button>

        {error ? (
          <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-xs">
            {error}
          </div>
        ) : null}

        {result ? (
          <OptimizerResults
            response={result}
            poolById={poolById}
            appliedDraftKey={appliedDraftKey}
            onApply={(candidate) =>
              onApplyCandidate(
                result.optimizer.selectedVariant.variantProfile,
                candidate,
              )
            }
          />
        ) : null}

        {appliedDraftKey?.startsWith("optimizer:") ? (
          <div className="border-primary/30 bg-primary/5 space-y-2 rounded-md border p-3 text-xs">
            <p>改善候補を下書きへ反映済みです。自動保存はしていません。</p>
            <Button type="button" size="sm" variant="secondary" onClick={onRebenchmark}>
              反映した下書きで再ベンチマーク
            </Button>
          </div>
        ) : null}

        <p className="text-source-unverified text-[10px] leading-relaxed">
          {OPTIMIZER_DISCLAIMER_JA}
        </p>
      </div>
    </DeckIntelligenceStepPanel>
  );
}

function OptimizerResults({
  response,
  poolById,
  appliedDraftKey,
  onApply,
}: {
  response: OptimizerApiResponse;
  poolById: ReadonlyMap<string, CardListItem>;
  appliedDraftKey: string | null;
  onApply: (candidate: DeckOptimizerCandidate) => boolean;
}) {
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);

  return (
    <div className="border-border/40 space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{response.optimizer.optimizerLabel}</Badge>
        <span className="text-muted-foreground text-[10px]">
          {response.optimizer.schedule.gamesPerDeck}試合 / deck・
          {response.optimizer.schedule.totalSimulations.toLocaleString()} simulations・
          {response.elapsedMs.toLocaleString()}ms
        </span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {response.optimizer.candidates.map((candidate) => {
          const expanded = expandedCandidateId === candidate.candidateId;
          const applied = appliedDraftKey === `optimizer:${candidate.candidateId}`;
          return (
            <Card key={candidate.candidateId} className="border-border/50 bg-background/35">
              <CardContent className="space-y-3 p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <EvidenceBadge status={candidate.evidenceStatus} />
                  <span className="text-muted-foreground font-mono text-[9px]">
                    {candidate.candidateId}
                  </span>
                </div>

                <div className="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  <SwapBox
                    label="OUT"
                    cardId={candidate.removeCardId}
                    count={candidate.swapCount}
                    poolById={poolById}
                  />
                  <div aria-hidden="true" className="text-primary flex items-center justify-center text-lg">
                    →
                  </div>
                  <SwapBox
                    label="IN"
                    cardId={candidate.addCardId}
                    count={candidate.swapCount}
                    poolById={poolById}
                  />
                </div>

                <div className="border-primary/20 bg-primary/5 grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                  <div>
                    <div className="text-muted-foreground text-[9px]">
                      同一seed・両方決着の純勝差
                    </div>
                    <div className="font-mono text-lg">
                      {signed(candidate.pairedOutcomes.netResolvedWins)}
                    </div>
                    <div className="text-muted-foreground text-[9px]">
                      候補のみ勝利 {candidate.pairedOutcomes.candidateOnlyWins} / baselineのみ勝利 {candidate.pairedOutcomes.baselineOnlyWins}
                    </div>
                    <div className="text-muted-foreground text-[9px]">
                      両方決着 {candidate.pairedOutcomes.bothResolved} / {candidate.pairedOutcomes.games}・未決着除外 {candidate.pairedOutcomes.excludedByInconclusive}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[9px]">決着試合勝率</div>
                    <div className="font-mono text-sm">
                      {nullablePercent(candidate.baselineMetrics.resolvedWinRate)} →{" "}
                      {nullablePercent(candidate.candidateMetrics.resolvedWinRate)}
                    </div>
                    <div className="text-muted-foreground text-[9px]">
                      決着率 {percent(candidate.baselineMetrics.resolutionRate)} →{" "}
                      {percent(candidate.candidateMetrics.resolutionRate)}
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={expanded}
                  aria-controls={`optimizer-candidate-${candidate.candidateId}`}
                  onClick={() =>
                    setExpandedCandidateId(expanded ? null : candidate.candidateId)
                  }
                >
                  {expanded ? "分析を閉じる" : "入替理由と構造変化"}
                </Button>
                {expanded ? (
                  <div id={`optimizer-candidate-${candidate.candidateId}`} className="space-y-3">
                    <div className="grid gap-2 font-mono text-[10px] sm:grid-cols-2">
                      <div>
                        <div className="text-muted-foreground">候補 95% CI</div>
                        <div>
                          {confidenceInterval(candidate.candidateMetrics.resolvedWinRateCi95)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">baseline 95% CI</div>
                        <div>
                          {confidenceInterval(candidate.baselineMetrics.resolvedWinRateCi95)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">先攻 / 後攻 決着勝率差</div>
                        <div>
                          {nullableSignedPoints(candidate.deltas.firstPlayerResolvedWinRate)} /{" "}
                          {nullableSignedPoints(candidate.deltas.secondPlayerResolvedWinRate)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">平均決着ターン差</div>
                        <div>{nullableSigned(candidate.deltas.averageResolvedTurns)}</div>
                      </div>
                    </div>
                    <div className="grid gap-2 text-[10px] sm:grid-cols-2">
                      <RulesStatsSummary
                        title="Baseline Rules stats / game"
                        metrics={candidate.baselineMetrics}
                      />
                      <RulesStatsSummary
                        title="Candidate Rules stats / game"
                        metrics={candidate.candidateMetrics}
                      />
                      <CoverageSummary
                        title="Baseline coverage"
                        metrics={candidate.baselineMetrics}
                      />
                      <CoverageSummary
                        title="Candidate coverage"
                        metrics={candidate.candidateMetrics}
                      />
                    </div>
                    {candidate.coverageDelta.worsened ? (
                      <p className="text-source-unverified text-[10px] leading-relaxed">
                        入替後はRules Kernel coverageが低下するため、この差を改善シグナルとして扱っていません。
                      </p>
                    ) : null}
                    <div>
                      <div className="text-muted-foreground mb-1 text-[9px] tracking-widest uppercase">
                        Baseline observation
                      </div>
                      <p className="text-muted-foreground text-[10px]">
                        OUTの観測: play {candidate.removalEvidence.observation.plays} / attack {candidate.removalEvidence.observation.attacks} / counter {candidate.removalEvidence.observation.counters} / Trigger {candidate.removalEvidence.observation.triggerActivations} / Search {candidate.removalEvidence.observation.searches}
                      </p>
                      <p className="text-muted-foreground text-[9px]">
                        未観測をカード自体の弱さとは判定しません。
                      </p>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-[9px] tracking-widest uppercase">
                        構築変化（強さの断定ではありません）
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[9px]">
                          2000+ counter {signed(candidate.structuralDelta.counter2000Plus)}
                        </Badge>
                        <Badge variant="outline" className="text-[9px]">
                          Trigger {signedPoints(candidate.structuralDelta.triggerRatio)}
                        </Badge>
                        <Badge variant="outline" className="text-[9px]">
                          High cost {signed(candidate.structuralDelta.highCostCards)}
                        </Badge>
                        {candidate.structuralDelta.mechanics.slice(0, 4).map((item) => (
                          <Badge key={item.mechanic} variant="outline" className="text-[9px]">
                            {item.mechanic} {signed(item.delta)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <p className="text-muted-foreground text-[10px] leading-relaxed">
                      {candidate.reasonJa}
                    </p>
                  </div>
                ) : null}

                <Button
                  type="button"
                  size="sm"
                  variant={applied ? "secondary" : "outline"}
                  className="w-full"
                  disabled={applied}
                  onClick={() => onApply(candidate)}
                >
                  {applied ? "下書きに反映済み" : "この入替を下書きに反映"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SwapBox({
  label,
  cardId,
  count,
  poolById,
}: {
  label: "OUT" | "IN";
  cardId: string;
  count: number;
  poolById: ReadonlyMap<string, CardListItem>;
}) {
  const card = poolById.get(cardId);
  const image = proxiedCardImage(card?.imageUrlJp);
  return (
    <div className="border-border/30 flex min-w-0 items-center gap-2 rounded-md border p-2">
      <div className="bg-muted/40 relative h-16 w-11 shrink-0 overflow-hidden rounded-sm">
        {image ? (
          <Image src={image} alt="" fill sizes="44px" className="object-cover" />
        ) : null}
      </div>
      <div className="min-w-0">
        <div className="text-primary font-mono text-[10px]">{label} ×{count}</div>
        <div className="truncate text-xs font-medium">{card?.name ?? cardId}</div>
        <div className="text-muted-foreground font-mono text-[9px]">{cardId}</div>
      </div>
    </div>
  );
}

function RulesStatsSummary({
  title,
  metrics,
}: {
  title: string;
  metrics: RulesBenchmarkDeckMetrics;
}) {
  const stats = metrics.rulesStats;
  return (
    <div className="border-border/30 space-y-1 rounded-md border p-2">
      <div className="text-muted-foreground text-[9px] tracking-widest uppercase">
        {title}
      </div>
      <p>attack {perGame(stats.attacksDeclared, metrics.games)}</p>
      <p>blocker {perGame(stats.blockersUsed, metrics.games)}</p>
      <p>counter card {perGame(stats.counterCardsUsed, metrics.games)}</p>
      <p>Trigger activate {perGame(stats.triggersActivated, metrics.games)}</p>
      <p>
        supported effect {perGame(stats.supportedEffectsResolved, metrics.games)}
      </p>
    </div>
  );
}

function CoverageSummary({
  title,
  metrics,
}: {
  title: string;
  metrics: RulesBenchmarkDeckMetrics;
}) {
  const coverage = metrics.effectCoverage;
  return (
    <div className="border-border/30 space-y-1 rounded-md border p-2">
      <div className="text-muted-foreground text-[9px] tracking-widest uppercase">
        {title}
      </div>
      <p>
        Main supported {coverage.supportedCards} / partial {coverage.partialCards} /
        unsupported {coverage.unsupportedCards}
      </p>
      <p>Leader {coverage.leaderStatus}</p>
      <p>complete {coverage.complete ? "yes" : "no"}</p>
    </div>
  );
}

function EvidenceBadge({ status }: { status: OptimizerEvidenceStatus }) {
  const labels: Record<OptimizerEvidenceStatus, string> = {
    improvement_signal: "改善シグナル",
    small_difference: "差は小さい",
    no_improvement: "改善確認できず",
    insufficient_evidence: "判定保留",
  };
  return (
    <Badge variant={status === "improvement_signal" ? "secondary" : "outline"}>
      {labels[status]}
    </Badge>
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function nullablePercent(value: number | null): string {
  return value === null ? "—" : percent(value);
}

function confidenceInterval(
  interval: WilsonConfidenceInterval | null,
): string {
  return interval ? `${percent(interval.lower)}–${percent(interval.upper)}` : "—";
}

function signedPoints(value: number): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}pt`;
}

function nullableSignedPoints(value: number | null): string {
  return value === null ? "—" : signedPoints(value);
}

function nullableSigned(value: number | null): string {
  return value === null ? "—" : signed(value);
}

function perGame(value: number, games: number): string {
  return games > 0 ? (value / games).toFixed(2) : "—";
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}
