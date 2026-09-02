"use client";

import { useEffect, useMemo, useState } from "react";

import type { DeckVariantsSuggestion } from "@/ai/deck-suggestion";
import { DeckOptimizer } from "@/components/grand-line/deck-optimizer";
import {
  DeckIntelligenceStepPanel,
  type DeckIntelligenceStep,
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
import { BENCHMARK_SIZE_OPTIONS } from "@/lib/deck-battle-benchmark";
import type {
  DeckRulesBenchmarkResult,
  RulesBenchmarkVariantMetrics,
} from "@/lib/deck-rules-benchmark";
import type { DeckCopyEntry } from "@/lib/deck-intelligence-compare";
import {
  VARIANT_PROFILE_IDS,
  VARIANT_PROFILE_LABELS,
  type VariantProfile,
} from "@/lib/deck-intelligence-preferences";
import { CPU_LEVELS, type CpuSkill } from "@/lib/practice-log";

interface DeckBattleBenchmarkProps {
  response: DeckVariantsSuggestion;
  leader: CardListItem;
  pool: CardListItem[];
  personalityByProfile: Record<VariantProfile, string>;
  currentStep: DeckIntelligenceStep;
  expandedStep: DeckIntelligenceStep | null;
  onToggleStep: (step: DeckIntelligenceStep) => void;
  onAdvanceStep: (step: DeckIntelligenceStep) => void;
  onBenchmarkStart?: () => void;
  onBenchmarkComplete: () => void;
  onOptimizerComplete: () => void;
  onApplyCards: (
    cards: DeckCopyEntry[],
    status: { key: string; label: string },
  ) => boolean;
  appliedDraftKey: string | null;
}

interface SavedDeckOption {
  id: string;
  name: string;
  totalCards: number;
  leader: { id: string; name: string };
}

interface BenchmarkApiResponse {
  benchmark: DeckRulesBenchmarkResult;
  elapsedMs: number;
}

interface BenchmarkApiError {
  error?: string;
  detail?: string;
}

export function DeckBattleBenchmark({
  response,
  leader,
  pool,
  personalityByProfile,
  currentStep,
  expandedStep,
  onToggleStep,
  onAdvanceStep,
  onBenchmarkStart,
  onBenchmarkComplete,
  onOptimizerComplete,
  onApplyCards,
  appliedDraftKey,
}: DeckBattleBenchmarkProps) {
  const [savedDecks, setSavedDecks] = useState<SavedDeckOption[]>([]);
  const [opponentValue, setOpponentValue] = useState(`synthetic:${leader.id}`);
  const [cpuSkill, setCpuSkill] = useState<CpuSkill>("level3");
  const [games, setGames] = useState(500);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRunSettings, setShowRunSettings] = useState(false);
  const [variantOverrides, setVariantOverrides] = useState<
    Partial<Record<VariantProfile, DeckCopyEntry[]>>
  >({});

  const variantCards = useMemo(
    () =>
      Object.fromEntries(
        response.variants.map((variant) => [
          variant.variantProfile,
          variantOverrides[variant.variantProfile] ??
            variant.cards.map(({ cardId, count }) => ({ cardId, count })),
        ]),
      ) as Record<VariantProfile, DeckCopyEntry[]>,
    [response.variants, variantOverrides],
  );

  const syntheticLeaders = useMemo(() => {
    const byId = new Map(
      pool
        .filter((card) => card.cardType === "LEADER")
        .map((card) => [card.id, card]),
    );
    byId.set(leader.id, leader);
    return [...byId.values()].sort(
      (left, right) =>
        Number(right.id === leader.id) - Number(left.id === leader.id) ||
        left.id.localeCompare(right.id),
    );
  }, [leader, pool]);

  useEffect(() => {
    let active = true;
    void fetch("/api/decks?limit=100")
      .then(async (request) => {
        if (!request.ok) return { decks: [] as SavedDeckOption[] };
        return (await request.json()) as { decks?: SavedDeckOption[] };
      })
      .then((payload) => {
        if (!active) return;
        const decks = (payload.decks ?? []).filter(
          (deck) => deck.totalCards === 50,
        );
        setSavedDecks(decks);
        if (decks[0]) setOpponentValue(`saved:${decks[0].id}`);
      })
      .catch(() => {
        if (active) setSavedDecks([]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function runBenchmark() {
    onAdvanceStep(3);
    onBenchmarkStart?.();
    setRunning(true);
    setError(null);
    setResult(null);
    const [kind, id] = opponentValue.split(":", 2);
    const opponent =
      kind === "saved"
        ? { kind: "saved" as const, deckId: id }
        : { kind: "synthetic" as const, leaderId: id };
    try {
      const request = await fetch("/api/practice/benchmark", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leaderId: leader.id,
          variants: response.variants.map((variant) => ({
            variantProfile: variant.variantProfile,
            cards: variantCards[variant.variantProfile],
          })),
          opponent,
          games,
          cpuSkill,
        }),
      });
      if (!request.ok) {
        const failure = (await request.json().catch(() => ({}))) as BenchmarkApiError;
        throw new Error(
          failure.detail ?? "対戦ベンチマークを実行できませんでした。",
        );
      }
      setResult((await request.json()) as BenchmarkApiResponse);
      setShowRunSettings(false);
      onBenchmarkComplete();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const benchmarkStatus: DeckIntelligenceStepStatus =
    currentStep === 3 ? "current" : result ? "complete" : "upcoming";

  return (
    <div className="space-y-3">
      <DeckIntelligenceStepPanel
        step={3}
        title="対戦ベンチマーク"
        status={benchmarkStatus}
        summary={
          result
            ? `${result.benchmark.opponent.name}・${result.benchmark.schedule.cpuSkill}・各${result.benchmark.schedule.gamesPerVariant.toLocaleString()}試合`
            : "3案を同じ相手・seed・先攻後攻・CPU条件で比較"
        }
        expanded={expandedStep === 3}
        onToggle={() => onToggleStep(3)}
      >
        <div className="space-y-4">
          {result ? (
            <>
              <BenchmarkResults
                response={result}
                personalityByProfile={personalityByProfile}
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={showRunSettings}
                aria-controls="benchmark-run-settings"
                onClick={() => setShowRunSettings((current) => !current)}
              >
                {showRunSettings ? "再実行条件を閉じる" : "条件を変更して再実行"}
              </Button>
            </>
          ) : (
            <div>
              <h5 className="font-display text-base">3案を同条件で対戦比較</h5>
              <p className="text-muted-foreground mt-1 text-[10px]">
                相手・CPU・試行数を選び、推奨・安定・特化の挙動差を確認します。
              </p>
            </div>
          )}

          {!result || showRunSettings ? (
            <div id="benchmark-run-settings" className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-muted-foreground text-[10px]">対戦相手</span>
                  <Select value={opponentValue} onValueChange={setOpponentValue}>
                    <SelectTrigger aria-label="Benchmark opponent" className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {savedDecks.map((deck) => (
                        <SelectItem key={deck.id} value={`saved:${deck.id}`}>
                          保存済み — {deck.name} ({deck.leader.name})
                        </SelectItem>
                      ))}
                      {syntheticLeaders.map((opponentLeader) => (
                        <SelectItem
                          key={`synthetic:${opponentLeader.id}`}
                          value={`synthetic:${opponentLeader.id}`}
                        >
                          Synthetic — {opponentLeader.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1">
                  <span className="text-muted-foreground text-[10px]">CPU</span>
                  <Select
                    value={cpuSkill}
                    onValueChange={(value) => setCpuSkill(value as CpuSkill)}
                  >
                    <SelectTrigger aria-label="Benchmark CPU level" className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CPU_LEVELS.map((level) => (
                        <SelectItem key={level.value} value={level.value}>
                          {level.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="space-y-1">
                  <span className="text-muted-foreground text-[10px]">試行数</span>
                  <Select
                    value={String(games)}
                    onValueChange={(value) => setGames(Number(value))}
                  >
                    <SelectTrigger aria-label="Benchmark size" className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BENCHMARK_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option.id} value={String(option.games)}>
                          {option.labelJa}: {option.games.toLocaleString()} / 案
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <Button
                type="button"
                className="w-full sm:w-auto sm:min-w-56"
                disabled={running || !opponentValue}
                onClick={runBenchmark}
              >
                {running
                  ? `${games.toLocaleString()} × 3案を実行中…`
                  : result
                    ? "この条件で再実行"
                    : "比較を実行"}
              </Button>
              <p className="text-muted-foreground text-[9px]">
                保存済みデッキは実行時にactive restrictionsで再検証します。
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-xs">
              {error}
            </div>
          ) : null}
        </div>
      </DeckIntelligenceStepPanel>

      {result ? (
        <DeckOptimizer
          response={response}
          leader={leader}
          pool={pool}
          variantCards={variantCards}
          opponent={result.benchmark.opponent}
          baseSeed={result.benchmark.schedule.baseSeed}
          seedStep={result.benchmark.schedule.seedStep}
          cpuSkill={result.benchmark.schedule.cpuSkill}
          maxTurns={result.benchmark.schedule.maxTurns}
          current={currentStep === 4}
          expanded={expandedStep === 4}
          onToggle={() => onToggleStep(4)}
          onStart={() => onAdvanceStep(4)}
          onComplete={onOptimizerComplete}
          appliedDraftKey={appliedDraftKey}
          onApplyCandidate={(profile, candidate) => {
            const applied = onApplyCards(candidate.resultingDeck.cards, {
              key: `optimizer:${candidate.candidateId}`,
              label: "Optimizer候補反映済み",
            });
            if (!applied) return false;
            setVariantOverrides((current) => ({
              ...current,
              [profile]: candidate.resultingDeck.cards,
            }));
            return true;
          }}
          onRebenchmark={() => {
            onAdvanceStep(3);
            void runBenchmark();
          }}
        />
      ) : null}
    </div>
  );
}

function BenchmarkResults({
  response,
  personalityByProfile,
}: {
  response: BenchmarkApiResponse;
  personalityByProfile: Record<VariantProfile, string>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const { benchmark } = response;
  const metricRows: Array<{
    label: string;
    render: (metrics: RulesBenchmarkVariantMetrics) => string;
  }> = [
    {
      label: "決着試合 / 全試行",
      render: (metrics) => `${metrics.resolvedGames} / ${metrics.games}`,
    },
    {
      label: "決着試合勝率 (95% CI)",
      render: (metrics) =>
        `${nullablePercent(metrics.resolvedWinRate)} (${confidenceInterval(metrics)})`,
    },
    {
      label: "未決着 / 決着率",
      render: (metrics) =>
        `${metrics.inconclusiveGames} / ${percent(metrics.resolutionRate)}`,
    },
    {
      label: "先攻 決着試合勝率",
      render: (metrics) => nullablePercent(metrics.firstPlayer.resolvedWinRate),
    },
    {
      label: "後攻 決着試合勝率",
      render: (metrics) => nullablePercent(metrics.secondPlayer.resolvedWinRate),
    },
    {
      label: "平均決着ターン",
      render: (metrics) => nullableNumber(metrics.averageResolvedTurns),
    },
    {
      label: "Leader damage / Deck out / Effect wins",
      render: (metrics) =>
        `${metrics.outcomes.leaderDamageWins} / ${metrics.outcomes.deckOutWins} / ${metrics.outcomes.effectWins}`,
    },
    {
      label: "Turn limit / Engine guard",
      render: (metrics) =>
        `${metrics.outcomes.turnLimit} / ${metrics.outcomes.engineGuard}`,
    },
    {
      label: "Attacks / game",
      render: (metrics) => perGame(metrics.rulesStats.attacksDeclared, metrics.games),
    },
    {
      label: "Blockers / Counter cards per game",
      render: (metrics) =>
        `${perGame(metrics.rulesStats.blockersUsed, metrics.games)} / ${perGame(metrics.rulesStats.counterCardsUsed, metrics.games)}`,
    },
    {
      label: "Trigger reveal / activate",
      render: (metrics) =>
        `${metrics.rulesStats.triggersRevealed} / ${metrics.rulesStats.triggersActivated} (${triggerActivationRate(metrics)})`,
    },
    {
      label: "Supported effects / game",
      render: (metrics) =>
        perGame(metrics.rulesStats.supportedEffectsResolved, metrics.games),
    },
    {
      label: "Partial / Unsupported encounters",
      render: (metrics) =>
        `${metrics.rulesStats.partialEffectsEncountered} / ${metrics.rulesStats.unsupportedEffectsEncountered}`,
    },
    {
      label: "DON attached / game",
      render: (metrics) => perGame(metrics.rulesStats.donAttached, metrics.games),
    },
  ];

  return (
    <div className="border-border/40 space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Rules Kernel Benchmark v2</Badge>
        <span className="text-xs">対戦相手: {benchmark.opponent.name}</span>
        {benchmark.opponent.synthetic ? (
          <Badge variant="outline">Synthetic benchmark opponent</Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground text-[10px]">
        {benchmark.schedule.gamesPerVariant.toLocaleString()} games / variant・
        {benchmark.schedule.cpuSkill}・先攻{benchmark.schedule.playerFirstGames} / 後攻
        {benchmark.schedule.playerSecondGames}・Player policy {benchmark.schedule.playerPolicySkill}・
        処理時間 {response.elapsedMs.toLocaleString()}ms
      </p>

      <div className="grid gap-2 lg:grid-cols-3">
        {VARIANT_PROFILE_IDS.map((profile) => {
          const metrics = benchmark.variants[profile];
          return (
            <Card key={profile} className="border-border/50 bg-background/35">
              <CardContent className="space-y-2 p-3">
                <Badge variant="secondary" className="text-[9px]">
                  {VARIANT_PROFILE_LABELS[profile]}
                </Badge>
                <div>
                  <div className="text-muted-foreground text-[9px]">決着試合勝率</div>
                  <div className="font-mono text-base">
                    {nullablePercent(metrics.resolvedWinRate)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[9px]">
                  <span>決着試合</span>
                  <span>{metrics.resolvedGames} / {metrics.games}</span>
                  <span>未決着</span>
                  <span>{metrics.inconclusiveGames} / {metrics.games}</span>
                  <span>決着率</span>
                  <span>{percent(metrics.resolutionRate)}</span>
                  <span>95% CI</span>
                  <span>{confidenceInterval(metrics)}</span>
                  <span>先攻</span>
                  <span>{nullablePercent(metrics.firstPlayer.resolvedWinRate)}</span>
                  <span>後攻</span>
                  <span>{nullablePercent(metrics.secondPlayer.resolvedWinRate)}</span>
                  <span>平均決着ターン</span>
                  <span>{nullableNumber(metrics.averageResolvedTurns)}</span>
                </div>
                <CoverageSummary metrics={metrics} />
                <BenchmarkWarnings metrics={metrics} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-expanded={showDetails}
        aria-controls="benchmark-detailed-comparison"
        onClick={() => setShowDetails((value) => !value)}
      >
        {showDetails ? "詳しい比較を閉じる" : "詳しい比較"}
      </Button>

      {showDetails ? (
        <div id="benchmark-detailed-comparison" className="space-y-4">
          <div className="grid gap-2 lg:grid-cols-3">
            {VARIANT_PROFILE_IDS.map((profile) => {
              const metrics = benchmark.variants[profile];
              return (
                <ResultSection key={profile} title={VARIANT_PROFILE_LABELS[profile]}>
                  <p>{personalityByProfile[profile]}</p>
                  <p>Rules Kernel内の主な決着理由: {primaryRulesWinReason(metrics)}</p>
                  <p>決着試合: {metrics.resolvedGames} / {metrics.games}</p>
                  <p>未決着: {metrics.inconclusiveGames} / {metrics.games}</p>
                </ResultSection>
              );
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left text-[10px]">
              <thead>
                <tr className="border-border/40 border-b">
                  <th className="p-2">指標</th>
                  {VARIANT_PROFILE_IDS.map((profile) => (
                    <th key={profile} className="p-2">
                      {VARIANT_PROFILE_LABELS[profile]}
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
                        {row.render(benchmark.variants[profile])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <ResultSection title="案ごとの差分">
              {benchmark.relativeMetrics.map((relative) => (
                <p key={`${relative.leftProfile}:${relative.rightProfile}`}>
                  {VARIANT_PROFILE_LABELS[relative.leftProfile]} vs {VARIANT_PROFILE_LABELS[relative.rightProfile]}: 決着試合勝率 {nullableSignedPoints(relative.resolvedWinRateDelta)} / 決着率 {signedPoints(relative.resolutionRateDelta)} / 平均決着ターン {nullableSigned(relative.averageResolvedTurnsDelta)}
                </p>
              ))}
            </ResultSection>
            <ResultSection title="同一seedでの結果">
              <p>3案すべて決着: {benchmark.pairedOutcomes.allThreeResolved}</p>
              <p>未決着を含む: {benchmark.pairedOutcomes.anyInconclusive}</p>
              <p>3案すべて勝ち: {benchmark.pairedOutcomes.allThreeWin}</p>
              <p>3案すべて負け: {benchmark.pairedOutcomes.allThreeLose}</p>
              <p>3案すべて未決着: {benchmark.pairedOutcomes.allThreeInconclusive}</p>
              <p>推奨のみ勝ち: {benchmark.pairedOutcomes.recommendedOnlyWins}</p>
              <p>安定のみ勝ち: {benchmark.pairedOutcomes.consistencyOnlyWins}</p>
              <p>特化のみ勝ち: {benchmark.pairedOutcomes.specializationOnlyWins}</p>
              <p>2案が勝ち: {benchmark.pairedOutcomes.twoVariantsWin}</p>
            </ResultSection>
          </div>

          <ResultSection title="Pairwise — 同一seedの決着試合のみ">
            {benchmark.pairwiseComparisons.map((comparison) => (
              <p key={`${comparison.leftProfile}:${comparison.rightProfile}`}>
                {VARIANT_PROFILE_LABELS[comparison.leftProfile]} vs {VARIANT_PROFILE_LABELS[comparison.rightProfile]}: 両方決着 {comparison.bothResolved} / 未決着除外 {comparison.excludedByInconclusive} / 左のみ勝ち {comparison.leftOnlyWins} / 右のみ勝ち {comparison.rightOnlyWins} / 純差 {signed(comparison.netResolvedWins)}
              </p>
            ))}
          </ResultSection>

          <ResultSection title="対戦相手の効果再現">
            <p>Main 50: supported {benchmark.opponentCoverage.supportedCards} / partial {benchmark.opponentCoverage.partialCards} / unsupported {benchmark.opponentCoverage.unsupportedCards}</p>
            <p>Leader: {benchmark.opponentCoverage.leaderStatus}</p>
            <p>complete: {benchmark.opponentCoverage.complete ? "yes" : "no"}</p>
          </ResultSection>

          <ResultSection title="決定論的な読み取り">
            <ul className="list-inside list-disc space-y-1">
              {benchmark.interpretationsJa.map((interpretation) => (
                <li key={interpretation}>{interpretation}</li>
              ))}
            </ul>
          </ResultSection>
        </div>
      ) : null}

      <p className="text-source-unverified text-[10px] leading-relaxed">
        決着試合勝率と95% CIは、Rules Kernel内で決着した試合だけを分母にしています。{benchmark.disclosureJa}
      </p>
    </div>
  );
}

function CoverageSummary({
  metrics,
}: {
  metrics: RulesBenchmarkVariantMetrics;
}) {
  const coverage = metrics.effectCoverage;
  return (
    <div className="border-border/30 space-y-1 rounded-md border p-2 text-[9px]">
      <div className="text-muted-foreground tracking-widest uppercase">効果再現</div>
      <p>
        Main 50: supported {coverage.supportedCards} / partial {coverage.partialCards} /
        unsupported {coverage.unsupportedCards}
      </p>
      <p>Leader: {coverage.leaderStatus}</p>
      <p>complete: {coverage.complete ? "yes" : "no"}</p>
    </div>
  );
}

function BenchmarkWarnings({
  metrics,
}: {
  metrics: RulesBenchmarkVariantMetrics;
}) {
  const coverage = metrics.effectCoverage;
  return (
    <div className="space-y-1 text-[9px] leading-relaxed">
      {!coverage.complete ||
      coverage.partialCards > 0 ||
      coverage.unsupportedCards > 0 ||
      coverage.leaderStatus !== "supported" ? (
        <p className="text-source-unverified">
          partial / unsupportedまたはLeader未対応を含むため、効果を完全再現した比較ではありません。
        </p>
      ) : null}
      {metrics.resolutionRate < 0.7 ? (
        <p className="text-source-unverified">
          現在のRules Kernel再現範囲またはturn limitにより未決着が多いため、比較の解釈に注意してください。
        </p>
      ) : null}
      {metrics.outcomes.engineGuard > 0 ? (
        <p className="text-destructive font-medium">
          engine guardによる未決着が発生しています。
        </p>
      ) : null}
    </div>
  );
}

function ResultSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border/30 rounded-md border p-2">
      <div className="text-muted-foreground mb-1 text-[9px] tracking-widest uppercase">
        {title}
      </div>
      <div className="space-y-1 text-[10px]">{children}</div>
    </div>
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function nullablePercent(value: number | null): string {
  return value === null ? "—" : percent(value);
}

function confidenceInterval(metrics: RulesBenchmarkVariantMetrics): string {
  const interval = metrics.resolvedWinRateCi95;
  return interval ? `${percent(interval.lower)}–${percent(interval.upper)}` : "—";
}

function nullableNumber(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function perGame(value: number, games: number): string {
  return games > 0 ? (value / games).toFixed(2) : "—";
}

function triggerActivationRate(metrics: RulesBenchmarkVariantMetrics): string {
  const revealed = metrics.rulesStats.triggersRevealed;
  return revealed > 0
    ? percent(metrics.rulesStats.triggersActivated / revealed)
    : "—";
}

function primaryRulesWinReason(metrics: RulesBenchmarkVariantMetrics): string {
  const reasons = [
    ["Leader damage", metrics.outcomes.leaderDamageWins],
    ["Deck out", metrics.outcomes.deckOutWins],
    ["Effect win", metrics.outcomes.effectWins],
  ] as const;
  const primary = reasons.reduce((best, current) =>
    current[1] > best[1] ? current : best,
  );
  return primary[1] > 0 ? `${primary[0]} (${primary[1]})` : "なし";
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

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}
