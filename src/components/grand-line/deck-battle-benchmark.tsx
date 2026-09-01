"use client";

import { useEffect, useMemo, useState } from "react";

import type { DeckVariantsSuggestion } from "@/ai/deck-suggestion";
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
import {
  BENCHMARK_DISCLOSURE_JA,
  BENCHMARK_SIZE_OPTIONS,
  type BenchmarkVariantMetrics,
  type DeckBattleBenchmarkResult,
} from "@/lib/deck-battle-benchmark";
import {
  VARIANT_PROFILE_IDS,
  VARIANT_PROFILE_LABELS,
  type VariantProfile,
} from "@/lib/deck-intelligence-preferences";
import {
  CPU_LEVELS,
  type CpuSkill,
  type WinReason,
} from "@/lib/practice-log";

interface DeckBattleBenchmarkProps {
  response: DeckVariantsSuggestion;
  leader: CardListItem;
  pool: CardListItem[];
  personalityByProfile: Record<VariantProfile, string>;
}

interface SavedDeckOption {
  id: string;
  name: string;
  totalCards: number;
  leader: { id: string; name: string };
}

interface BenchmarkApiResponse {
  benchmark: DeckBattleBenchmarkResult;
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
}: DeckBattleBenchmarkProps) {
  const [open, setOpen] = useState(false);
  const [savedDecks, setSavedDecks] = useState<SavedDeckOption[]>([]);
  const [opponentValue, setOpponentValue] = useState(`synthetic:${leader.id}`);
  const [cpuSkill, setCpuSkill] = useState<CpuSkill>("level3");
  const [games, setGames] = useState(500);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
            cards: variant.cards.map(({ cardId, count }) => ({ cardId, count })),
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
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (!open) {
    return (
      <div className="border-border/40 bg-background/30 rounded-md border p-3">
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => setOpen(true)}
        >
          3案を対戦ベンチマーク
        </Button>
        <p className="text-muted-foreground mt-2 text-[10px]">
          同じ相手・seed・先攻後攻・CPU条件で、3構築の挙動差を比較します。
        </p>
      </div>
    );
  }

  return (
    <div className="border-primary/25 bg-background/30 space-y-4 rounded-md border p-3">
      <div>
        <div className="text-primary text-[10px] tracking-[0.25em] uppercase">
          Battle Benchmark / 対戦ベンチマーク
        </div>
        <h4 className="font-display mt-1 text-base">構築による挙動差</h4>
        <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
          {BENCHMARK_DISCLOSURE_JA}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1">
          <span className="text-muted-foreground text-[10px]">1. Opponent</span>
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
                  Synthetic benchmark opponent — {opponentLeader.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-[9px]">
            保存済みデッキは実行時に現在のactive restrictionsで再検証します。
          </p>
        </label>

        <label className="space-y-1">
          <span className="text-muted-foreground text-[10px]">2. CPU level</span>
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
          <span className="text-muted-foreground text-[10px]">3. Benchmark size</span>
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
                  {option.labelJa}: {option.games.toLocaleString()} games / variant
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <div>
        <div className="text-muted-foreground mb-1 text-[10px]">4. Run</div>
        <Button
          type="button"
          className="w-full"
          disabled={running || !opponentValue}
          onClick={runBenchmark}
        >
          {running
            ? `${games.toLocaleString()} × 3案を実行中…`
            : "対戦ベンチマークを実行"}
        </Button>
      </div>

      {error ? (
        <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-xs">
          {error}
        </div>
      ) : null}

      {result ? (
        <BenchmarkResults
          response={result}
          personalityByProfile={personalityByProfile}
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
  const { benchmark } = response;
  const metricRows: Array<{
    label: string;
    render: (metrics: BenchmarkVariantMetrics) => string;
  }> = [
    {
      label: "Heuristic wins / games",
      render: (metrics) => `${metrics.heuristicWins} / ${metrics.games}`,
    },
    {
      label: "Heuristic win rate (95% CI)",
      render: (metrics) =>
        `${percent(metrics.heuristicWinRate)} (${percent(metrics.heuristicWinRateCi95.lower)}–${percent(metrics.heuristicWinRateCi95.upper)})`,
    },
    { label: "先攻", render: (metrics) => percent(metrics.firstPlayerWinRate) },
    { label: "後攻", render: (metrics) => percent(metrics.secondPlayerWinRate) },
    { label: "平均ターン", render: (metrics) => metrics.avgTurns.toFixed(1) },
    {
      label: "DON効率",
      render: (metrics) => percent(metrics.averageDonEfficiency),
    },
    {
      label: "Trigger reveal / success",
      render: (metrics) =>
        `${percent(metrics.triggerRevealRate)} / ${percent(metrics.triggerSuccessRate)}`,
    },
    {
      label: "Mulligan keep / redraw",
      render: (metrics) =>
        `${nullablePercent(metrics.mulliganKeepWinRate)} / ${nullablePercent(metrics.mulliganRedrawWinRate)}`,
    },
    {
      label: "敗北時counter overflow",
      render: (metrics) => metrics.counterOverflowOnLoss.toFixed(0),
    },
  ];

  return (
    <div className="border-border/40 space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Benchmark result</Badge>
        <span className="text-xs">対戦相手: {benchmark.opponent.name}</span>
        {benchmark.opponent.synthetic ? (
          <Badge variant="outline">Synthetic benchmark opponent</Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground text-[10px]">
        {benchmark.schedule.gamesPerVariant.toLocaleString()} games / variant・
        {benchmark.schedule.cpuSkill}・先攻{benchmark.schedule.playerFirstGames} / 後攻
        {benchmark.schedule.playerSecondGames}・処理時間 {response.elapsedMs.toLocaleString()}ms
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
                  <div className="text-muted-foreground text-[9px] tracking-widest uppercase">
                    構築の性格
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed">
                    {personalityByProfile[profile]}
                  </p>
                </div>
                <div>
                  <div className="text-muted-foreground text-[9px]">
                    Heuristic win rate
                  </div>
                  <div className="font-mono text-base">
                    {percent(metrics.heuristicWinRate)}
                  </div>
                  <div className="text-muted-foreground font-mono text-[9px]">
                    95% CI: {percent(metrics.heuristicWinRateCi95.lower)}–
                    {percent(metrics.heuristicWinRateCi95.upper)}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1 font-mono text-[9px]">
                  <span>先攻 {percent(metrics.firstPlayerWinRate)}</span>
                  <span>後攻 {percent(metrics.secondPlayerWinRate)}</span>
                  <span>平均 {metrics.avgTurns.toFixed(1)} turn</span>
                  <span>DON {percent(metrics.averageDonEfficiency)}</span>
                </div>
                <div className="text-[10px]">
                  <span className="text-muted-foreground">主な勝ち方: </span>
                  {primaryWinReason(metrics.winReasons)}
                </div>
                <div className="text-[10px]">
                  <span className="text-muted-foreground">Top contributors: </span>
                  {metrics.topContributors
                    .map((contribution) => contribution.name)
                    .join(" / ") || "なし"}
                </div>
              </CardContent>
            </Card>
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
        <ResultSection title="Relative metrics">
          {benchmark.relativeMetrics.map((relative) => (
            <p key={`${relative.leftProfile}:${relative.rightProfile}`}>
              {VARIANT_PROFILE_LABELS[relative.leftProfile]} vs {VARIANT_PROFILE_LABELS[relative.rightProfile]}: win {signedPoints(relative.winRateDelta)} / turns {signed(relative.avgTurnsDelta)} / DON {signedPoints(relative.donEfficiencyDelta)} / first {signedPoints(relative.firstPlayerDelta)} / second {signedPoints(relative.secondPlayerDelta)}
            </p>
          ))}
        </ResultSection>
        <ResultSection title="Paired outcomes">
          <p>3案すべて勝ち: {benchmark.pairedOutcomes.allThreeWin}</p>
          <p>3案すべて負け: {benchmark.pairedOutcomes.allThreeLose}</p>
          <p>推奨のみ勝ち: {benchmark.pairedOutcomes.recommendedOnlyWins}</p>
          <p>安定のみ勝ち: {benchmark.pairedOutcomes.consistencyOnlyWins}</p>
          <p>特化のみ勝ち: {benchmark.pairedOutcomes.specializationOnlyWins}</p>
          <p>2案が勝ち: {benchmark.pairedOutcomes.twoVariantsWin}</p>
        </ResultSection>
      </div>

      <ResultSection title="Deterministic interpretation">
        <ul className="list-inside list-disc space-y-1">
          {benchmark.interpretationsJa.map((interpretation) => (
            <li key={interpretation}>{interpretation}</li>
          ))}
        </ul>
      </ResultSection>

      <p className="text-source-unverified text-[10px] leading-relaxed">
        95% CIはPractice engine内部の反復試行に対する統計的不確実性です。公式ゲーム環境への精度保証ではありません。{benchmark.disclosureJa}
      </p>
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

function primaryWinReason(winReasons: Record<WinReason, number>): string {
  const labels: Record<WinReason, string> = {
    leader_damage: "Leader damage",
    deck_out: "Deck out",
    effect_win: "Effect win",
    score_at_limit: "Turn-limit heuristic score",
  };
  const [reason, count] = (Object.entries(winReasons) as Array<[WinReason, number]>).reduce(
    (best, current) => (current[1] > best[1] ? current : best),
    ["leader_damage", 0] as [WinReason, number],
  );
  return count > 0 ? `${labels[reason]} (${count})` : "なし";
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function nullablePercent(value: number | null): string {
  return value === null ? "—" : percent(value);
}

function signedPoints(value: number): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}pt`;
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}
