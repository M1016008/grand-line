"use client";

import { useMemo, useState } from "react";

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
import type {
  BenchmarkOpponentDescriptor,
} from "@/lib/deck-battle-benchmark";
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
import type { CpuSkill } from "@/lib/practice-log";

interface DeckOptimizerProps {
  response: DeckVariantsSuggestion;
  leader: CardListItem;
  pool: CardListItem[];
  variantCards: Record<VariantProfile, DeckCopyEntry[]>;
  opponent: BenchmarkOpponentDescriptor;
  cpuSkill: CpuSkill;
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
  cpuSkill,
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
  const [appliedCandidateId, setAppliedCandidateId] = useState<string | null>(
    null,
  );
  const poolById = useMemo(
    () => new Map(pool.map((card) => [card.id, card])),
    [pool],
  );

  async function runOptimizer() {
    setRunning(true);
    setError(null);
    setResult(null);
    setAppliedCandidateId(null);
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
          cpuSkill,
          optimizerGames,
          candidateLimit,
        }),
      });
      if (!request.ok) {
        const failure = (await request.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(
          failure.detail ?? "改善候補を評価できませんでした。",
        );
      }
      setResult((await request.json()) as OptimizerApiResponse);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="border-primary/25 bg-background/30 space-y-4 rounded-md border p-3">
      <div>
        <div className="text-primary text-[10px] tracking-[0.25em] uppercase">
          Optimizer candidate / 改善候補
        </div>
        <h4 className="font-display mt-1 text-base">
          Practice engine上の改善シグナル
        </h4>
        <p className="text-source-unverified mt-1 text-[10px] leading-relaxed">
          {OPTIMIZER_DISCLAIMER_JA}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1">
          <span className="text-muted-foreground text-[10px]">対象variant</span>
          <Select
            value={selectedProfile}
            onValueChange={(value) =>
              setSelectedProfile(value as VariantProfile)
            }
          >
            <SelectTrigger aria-label="Optimizer target variant" className="w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VARIANT_PROFILE_IDS.map((profile) => (
                <SelectItem key={profile} value={profile}>
                  {VARIANT_PROFILE_LABELS[profile]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground text-[10px]">Evaluation size</span>
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
                  {option.labelJa}: {option.games} games / candidate
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground text-[10px]">Candidate count</span>
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
                  {count} candidates
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <Button
        type="button"
        className="w-full"
        disabled={running}
        onClick={runOptimizer}
      >
        {running
          ? `${optimizerGames} × baseline/candidatesを比較中…`
          : "この構築の改善候補を探す"}
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
          onApply={(candidate) => {
            const applied = onApplyCandidate(
              result.optimizer.selectedVariant.variantProfile,
              candidate,
            );
            if (applied) setAppliedCandidateId(candidate.candidateId);
          }}
        />
      ) : null}

      {appliedCandidateId ? (
        <div className="border-primary/30 bg-primary/5 space-y-2 rounded-md border p-3 text-xs">
          <p>候補を下書きへ反映しました。自動保存・自動再探索は行っていません。</p>
          <Button type="button" size="sm" variant="secondary" onClick={onRebenchmark}>
            反映した候補で再ベンチマーク
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function OptimizerResults({
  response,
  poolById,
  onApply,
}: {
  response: OptimizerApiResponse;
  poolById: ReadonlyMap<string, CardListItem>;
  onApply: (candidate: DeckOptimizerCandidate) => void;
}) {
  return (
    <div className="border-border/40 space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">改善シグナル上位</Badge>
        <span className="text-muted-foreground text-[10px]">
          {response.optimizer.schedule.gamesPerDeck} games / deck・
          {response.optimizer.schedule.totalSimulations.toLocaleString()} simulations・
          {response.elapsedMs.toLocaleString()}ms
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {response.optimizer.candidates.map((candidate) => (
          <Card key={candidate.candidateId} className="border-border/50 bg-background/35">
            <CardContent className="space-y-3 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <EvidenceBadge status={candidate.evidenceStatus} />
                <span className="text-muted-foreground font-mono text-[9px]">
                  {candidate.candidateId}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <SwapBox
                  label="OUT"
                  cardId={candidate.removeCardId}
                  count={candidate.swapCount}
                  poolById={poolById}
                />
                <SwapBox
                  label="IN"
                  cardId={candidate.addCardId}
                  count={candidate.swapCount}
                  poolById={poolById}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                <div>
                  <div className="text-muted-foreground">Heuristic win rate</div>
                  <div>
                    {percent(candidate.baselineMetrics.heuristicWinRate)} →{" "}
                    {percent(candidate.candidateMetrics.heuristicWinRate)}
                  </div>
                  <div className="text-muted-foreground text-[9px]">
                    candidate 95% CI {percent(candidate.candidateMetrics.heuristicWinRateCi95.lower)}–
                    {percent(candidate.candidateMetrics.heuristicWinRateCi95.upper)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Paired flips</div>
                  <div>
                    gained {candidate.pairedOutcomes.gainedWins} / lost{" "}
                    {candidate.pairedOutcomes.lostWins}
                  </div>
                  <div className="text-muted-foreground text-[9px]">
                    net {signed(candidate.pairedOutcomes.netPairedWins)}・
                    {signedPoints(candidate.pairedOutcomes.pairedImprovementRate)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                <span>先攻差 {signedPoints(candidate.deltas.firstPlayerWinRate)}</span>
                <span>後攻差 {signedPoints(candidate.deltas.secondPlayerWinRate)}</span>
              </div>
              <div>
                <div className="text-muted-foreground mb-1 text-[9px] tracking-widest uppercase">
                  Deck structure delta
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
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => onApply(candidate)}
              >
                この入替を下書きに反映
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-source-unverified text-[10px] leading-relaxed">
        {response.optimizer.disclaimerJa}
      </p>
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
  return (
    <div className="border-border/30 rounded-md border p-2">
      <div className="text-primary font-mono text-[10px]">{label}</div>
      <div className="font-mono text-[10px]">{cardId} ×{count}</div>
      <div className="truncate text-[10px]">{poolById.get(cardId)?.name ?? cardId}</div>
    </div>
  );
}

function EvidenceBadge({ status }: { status: OptimizerEvidenceStatus }) {
  const labels: Record<OptimizerEvidenceStatus, string> = {
    improvement_signal: "改善シグナルあり",
    small_difference: "差は小さい",
    no_improvement: "今回の試行では改善せず",
  };
  return <Badge variant={status === "improvement_signal" ? "secondary" : "outline"}>{labels[status]}</Badge>;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPoints(value: number): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}pt`;
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}
