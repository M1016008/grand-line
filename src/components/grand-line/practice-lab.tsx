"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bot,
  BookOpenCheck,
  Dices,
  Gauge,
  Play,
  RefreshCw,
  Swords,
} from "lucide-react";

import { ColorChip } from "@/components/grand-line/color-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { evaluateDeck } from "@/lib/deck-evaluation";
import {
  ANALYSIS_METRIC_DEFINITIONS,
  OFFICIAL_RULES_REFERENCE,
  type GameReplayLog,
} from "@/lib/practice-log";
import {
  buildPracticeDeck,
  deckEvalCards,
  generateDrill,
  simulateMatch,
  type BatchResult,
  type CpuSkill,
  type MatchResult,
  type PracticeDeck,
} from "@/lib/practice-sim";
import { cn } from "@/lib/utils";
import { useDeckDraft } from "@/stores/deck";
import type { CardListItem } from "@/lib/cards";

interface PracticeLabProps {
  leaders: CardListItem[];
  pool: CardListItem[];
  usingMock: boolean;
}

type SaveState =
  | { status: "idle"; detail?: string; runId?: string }
  | { status: "saving"; detail?: string; runId?: string }
  | { status: "saved"; detail: string; runId: string }
  | { status: "error"; detail: string; runId?: string };

interface PracticeSummary {
  totalRuns: number;
  totalGames: number;
  matchups: PracticeSummaryMatchup[];
}

interface PracticeSummaryMatchup {
  key: string;
  playerLeaderId: string;
  opponentLeaderId: string;
  cpuSkill: string;
  rulesVersion: string;
  runs: number;
  games: number;
  playerWins: number;
  opponentWins: number;
  winRate: number;
  firstPlayerWinRate: number;
  secondPlayerWinRate: number;
  avgTurns: number;
  averageDonEfficiency: number;
  triggerRevealRate: number;
  triggerSuccessRate: number;
  mulliganKeepWinRate: number | null;
  mulliganRedrawWinRate: number | null;
  counterOverflowOnLoss: number;
  winReasons: Record<string, number>;
  cardTiming: Array<{
    cardId: string;
    name: string;
    side: "player" | "opponent";
    uses: number;
    averageTurn: number;
  }>;
  ablation: Array<{
    cardId: string;
    name: string;
    replacementName: string;
    averageDelta: number;
    observations: number;
  }>;
  latestRunAt: string | null;
}

const DON_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const HAND_OPTIONS = [3, 4, 5, 6, 7];
const MAX_BATCH_GAMES = 10_000;
const EVENT_SAMPLE_LIMIT = 100;
const CPU_SKILLS: Array<{ value: CpuSkill; label: string; detail: string }> = [
  {
    value: "beginner",
    label: "初心者の壁打ち",
    detail: "曲線通りにカードを使う、練習用の素直なCPU",
  },
  {
    value: "advanced",
    label: "上級者の練習相手",
    detail: "マリガン、リーサル、守りを少し強めに評価",
  },
];

export function PracticeLab({ leaders, pool, usingMock }: PracticeLabProps) {
  const [playerLeaderId, setPlayerLeaderId] = useState(leaders[0]?.id ?? "");
  const [opponentLeaderId, setOpponentLeaderId] = useState(
    leaders[1]?.id ?? leaders[0]?.id ?? "",
  );
  const [cpuSkill, setCpuSkill] = useState<CpuSkill>("beginner");
  const [don, setDon] = useState(3);
  const [handSize, setHandSize] = useState(4);
  const [drillSeed, setDrillSeed] = useState(1001);
  const [matchSeed, setMatchSeed] = useState(2401);
  const [games, setGames] = useState(100);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const [summary, setSummary] = useState<PracticeSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);

  const draftLeaderId = useDeckDraft((s) => s.leaderId);
  const draftEntries = useDeckDraft((s) => s.entries);

  const playerLeader = leaders.find((leader) => leader.id === playerLeaderId) ?? leaders[0];
  const opponentLeader =
    leaders.find((leader) => leader.id === opponentLeaderId) ??
    leaders.find((leader) => leader.id !== playerLeader?.id) ??
    leaders[0];

  const localDraftEntries = useMemo(
    () => (draftLeaderId === playerLeader?.id ? Object.values(draftEntries) : []),
    [draftEntries, draftLeaderId, playerLeader?.id],
  );

  const playerDeck = useMemo(
    () => (playerLeader ? buildPracticeDeck(playerLeader, pool, localDraftEntries) : null),
    [localDraftEntries, playerLeader, pool],
  );
  const opponentDeck = useMemo(
    () => (opponentLeader ? buildPracticeDeck(opponentLeader, pool) : null),
    [opponentLeader, pool],
  );

  const drill = useMemo(
    () => (playerDeck ? generateDrill(playerDeck, { don, handSize, seed: drillSeed }) : null),
    [don, drillSeed, handSize, playerDeck],
  );

  useEffect(() => {
    void refreshSummary();
  }, []);

  if (!playerLeader || !opponentLeader || !playerDeck || !opponentDeck) {
    return (
      <Card className="border-border/40 bg-card/40">
        <CardContent className="text-muted-foreground p-10 text-center text-sm">
          練習に使えるリーダーがまだありません。
        </CardContent>
      </Card>
    );
  }

  const playerEval = evaluateDeck(deckEvalCards(playerDeck));
  const opponentEval = evaluateDeck(deckEvalCards(opponentDeck));
  const selectedSkill = CPU_SKILLS.find((skill) => skill.value === cpuSkill) ?? CPU_SKILLS[0];
  const currentSummary =
    summary?.matchups.find(
      (item) =>
        item.playerLeaderId === playerLeader.id &&
        item.opponentLeaderId === opponentLeader.id &&
        item.cpuSkill === cpuSkill,
    ) ??
    summary?.matchups[0] ??
    null;

  function resetResults() {
    setMatch(null);
    setBatch(null);
    setSaveState({ status: "idle" });
  }

  async function refreshSummary() {
    setIsLoadingSummary(true);
    try {
      const response = await fetch("/api/practice/summary", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`summary ${response.status}`);
      }
      setSummary((await response.json()) as PracticeSummary);
      setSummaryError(null);
    } catch (err) {
      setSummaryError((err as Error).message);
    } finally {
      setIsLoadingSummary(false);
    }
  }

  async function savePracticeRun(
    mode: "match" | "batch",
    replays: GameReplayLog[],
    summaryMetrics?: Record<string, unknown>,
  ) {
    if (!playerDeck || !opponentDeck) return;
    setSaveState({ status: "saving", detail: "対戦ログを保存中" });
    try {
      const response = await fetch("/api/practice/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          playerLeaderId: playerDeck.leader.id,
          opponentLeaderId: opponentDeck.leader.id,
          replays,
          summaryMetrics,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload.detail ?? payload.error ?? response.status));
      }
      setSaveState({
        status: "saved",
        runId: String(payload.runId),
        detail: saveDetail(payload),
      });
      await refreshSummary();
    } catch (err) {
      setSaveState({
        status: "error",
        detail: (err as Error).message,
      });
    }
  }

  function runMatch() {
    if (!playerDeck || !opponentDeck) return;
    const next = simulateMatch(playerDeck, opponentDeck, { seed: matchSeed, cpuSkill });
    setMatch(next);
    void savePracticeRun("match", [next.replay]);
    setMatchSeed((seed) => seed + 1);
  }

  async function runBatch() {
    if (!playerDeck || !opponentDeck) return;
    const safeGames = Math.min(MAX_BATCH_GAMES, Math.max(1, Math.floor(games)));
    setIsBatchRunning(true);
    setSaveState({
      status: "saving",
      detail: `${safeGames.toLocaleString()}戦をサーバーで実行・保存中`,
    });
    try {
      const response = await fetch("/api/practice/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerDeck,
          opponentDeck,
          games: safeGames,
          seed: matchSeed,
          cpuSkill,
          eventStorageMode: "auto",
          eventSampleLimit: EVENT_SAMPLE_LIMIT,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload.detail ?? payload.error ?? response.status));
      }
      setBatch(payload.batch as BatchResult);
      setSaveState({
        status: "saved",
        runId: String(payload.save.runId),
        detail: saveDetail(payload.save),
      });
      setMatchSeed((seed) => seed + safeGames + 7);
      await refreshSummary();
    } catch (err) {
      setSaveState({
        status: "error",
        detail: (err as Error).message,
      });
    } finally {
      setIsBatchRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <DeckSelector
          label="自分"
          value={playerLeader.id}
          leaders={leaders}
          deck={playerDeck}
          score={playerEval.composite}
          onChange={(value) => {
            setPlayerLeaderId(value);
            resetResults();
          }}
        />
        <div className="hidden items-center justify-center text-muted-foreground lg:flex">
          <Swords className="size-5" />
        </div>
        <DeckSelector
          label="CPU"
          value={opponentLeader.id}
          leaders={leaders}
          deck={opponentDeck}
          score={opponentEval.composite}
          onChange={(value) => {
            setOpponentLeaderId(value);
            resetResults();
          }}
        />
      </section>

      <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="border-border/40 bg-card/40">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">公式ルール {OFFICIAL_RULES_REFERENCE.version}</Badge>
                <Badge variant="secondary">seed保存</Badge>
                <Badge variant="secondary">JSONイベントログ</Badge>
              </div>
              <p className="text-muted-foreground mt-2 text-sm">
                対戦ログを基礎データとして保存し、後から分析指標を増やせる形で記録します。
              </p>
            </div>
            <MetricBox label="記録イベント" value="12種" />
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/40">
          <CardContent className="space-y-2 p-4">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">CPU強度</span>
              <select
                value={cpuSkill}
                onChange={(event) => {
                  setCpuSkill(event.target.value as CpuSkill);
                  resetResults();
                }}
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {CPU_SKILLS.map((skill) => (
                  <option key={skill.value} value={skill.value}>
                    {skill.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-muted-foreground text-xs leading-relaxed">{selectedSkill.detail}</p>
          </CardContent>
        </Card>
      </section>

      <SavedAnalysisPanel
        summary={summary}
        current={currentSummary}
        saveState={saveState}
        isLoading={isLoadingSummary}
        error={summaryError}
        onRefresh={() => void refreshSummary()}
      />

      <Tabs defaultValue="drill" className="gap-4">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="drill">
            <Dices className="size-4" />
            局面ドリル
          </TabsTrigger>
          <TabsTrigger value="match">
            <Bot className="size-4" />
            CPU戦
          </TabsTrigger>
          <TabsTrigger value="batch">
            <BarChart3 className="size-4" />
            自動対戦分析
          </TabsTrigger>
          <TabsTrigger value="rules">
            <BookOpenCheck className="size-4" />
            再現範囲
          </TabsTrigger>
        </TabsList>

        <TabsContent value="drill">
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="border-border/40 bg-card/40">
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl tracking-wide">瞬間判断ドリル</h2>
                    <p className="text-muted-foreground text-xs">
                      seed {drillSeed} · pressure {drill?.boardPressure ?? 0}
                    </p>
                  </div>
                  <Button type="button" onClick={() => setDrillSeed((seed) => seed + 31)}>
                    <RefreshCw className="size-4" />
                    生成
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <MetricBox label="DON" value={String(don)} />
                  <MetricBox label="手札" value={`${handSize}枚`} />
                  <MetricBox label="自分ライフ" value={String(drill?.playerLife ?? "-")} />
                  <MetricBox label="相手ライフ" value={String(drill?.opponentLife ?? "-")} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <ControlSelect label="DON" value={don} options={DON_OPTIONS} onChange={setDon} />
                  <ControlSelect
                    label="手札枚数"
                    value={handSize}
                    options={HAND_OPTIONS}
                    onChange={setHandSize}
                  />
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">手札</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {drill?.hand.map((card) => (
                      <li
                        key={`${drill.seed}:${card.id}`}
                        className="border-border/40 bg-background/40 rounded-md border p-3"
                      >
                        <CardLine card={card} />
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card className="border-primary/30 bg-card/50">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg tracking-wide">候補手</h3>
                  <Badge variant="outline">反復練習</Badge>
                </div>
                <ul className="space-y-2">
                  {drill?.actions.map((action, index) => (
                    <li
                      key={action.id}
                      className={cn(
                        "rounded-md border p-3",
                        index === 0
                          ? "border-primary/50 bg-primary/10"
                          : "border-border/40 bg-background/30",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{action.label}</div>
                          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                            {action.rationale}
                          </p>
                        </div>
                        <span className="font-mono text-sm">{action.score.toFixed(1)}</span>
                      </div>
                      <div className="text-muted-foreground mt-2 flex gap-2 text-[11px]">
                        <span>DON {action.donUsed}</span>
                        <span>risk {action.risk}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        </TabsContent>

        <TabsContent value="match">
          <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="border-border/40 bg-card/40">
              <CardContent className="space-y-4 p-4">
                <h2 className="font-display text-xl tracking-wide">1戦シミュレート</h2>
                <div className="grid grid-cols-2 gap-3">
                  <MetricBox label="自分総合" value={playerEval.composite.toFixed(0)} />
                  <MetricBox label="CPU総合" value={opponentEval.composite.toFixed(0)} />
                </div>
                <Button type="button" className="w-full" onClick={runMatch}>
                  <Play className="size-4" />
                  対戦
                </Button>
                {match ? (
                  <div className="grid grid-cols-2 gap-3">
                    <MetricBox label="勝者" value={sideName(match.winner)} />
                    <MetricBox label="勝因" value={reasonLabel(match.reason)} />
                    <MetricBox label="ターン" value={String(match.turns)} />
                    <MetricBox label="イベント" value={String(match.replay.events.length)} />
                    <MetricBox label="自分ライフ" value={String(match.playerLife)} />
                    <MetricBox label="CPUライフ" value={String(match.opponentLife)} />
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border/40 bg-card/40">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg tracking-wide">再現ログ</h3>
                  {match ? (
                    <Badge variant="outline">
                      {sideName(match.replay.header.firstPlayer)}先攻
                    </Badge>
                  ) : null}
                </div>
                <ScrollArea className="h-80">
                  {match ? (
                    <ol className="space-y-1 text-sm">
                      {match.log.map((line, index) => (
                        <li key={`${index}:${line}`} className="text-muted-foreground">
                          {line}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-muted-foreground text-sm">まだ対戦していません。</p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </section>
        </TabsContent>

        <TabsContent value="batch">
          <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="border-border/40 bg-card/40">
              <CardContent className="space-y-4 p-4">
                <h2 className="font-display text-xl tracking-wide">AI vs AI</h2>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">試行回数</span>
                  <Input
                    type="number"
                    min={1}
                    max={MAX_BATCH_GAMES}
                    value={games}
                    onChange={(event) => setGames(Number(event.target.value))}
                  />
                </label>
                <p className="text-muted-foreground text-xs">
                  最大 {MAX_BATCH_GAMES.toLocaleString()} 戦。全試合の要約を保存し、イベントログは最大 {EVENT_SAMPLE_LIMIT.toLocaleString()} 試合分だけ保存します。
                </p>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => void runBatch()}
                  disabled={isBatchRunning}
                >
                  {isBatchRunning ? (
                    <RefreshCw className="size-4 animate-spin" />
                  ) : (
                    <BarChart3 className="size-4" />
                  )}
                  {isBatchRunning ? "実行中" : "集計"}
                </Button>
                {batch ? (
                  <div className="grid grid-cols-2 gap-3">
                    <MetricBox label="自分勝率" value={percent(batch.playerWinRate)} />
                    <MetricBox label="平均ターン" value={batch.avgTurns.toFixed(1)} />
                    <MetricBox label="先攻勝率" value={percent(batch.metrics.firstPlayerWinRate)} />
                    <MetricBox label="後攻勝率" value={percent(batch.metrics.secondPlayerWinRate)} />
                    <MetricBox label="DON効率" value={percent(batch.metrics.averageDonEfficiency)} />
                    <MetricBox label="トリガー成功" value={percent(batch.metrics.triggerSuccessRate)} />
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <div className="grid gap-4">
              <Card className="border-border/40 bg-card/40">
                <CardContent className="space-y-3 p-4">
                  <h3 className="font-display text-lg tracking-wide">分析サマリー</h3>
                  {batch ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      <MetricBox label="Keep勝率" value={nullablePercent(batch.metrics.mulliganKeepWinRate)} />
                      <MetricBox label="Redraw勝率" value={nullablePercent(batch.metrics.mulliganRedrawWinRate)} />
                      <MetricBox label="敗北時カウンター" value={batch.metrics.counterOverflowOnLoss.toFixed(0)} />
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      集計すると、勝率、先攻後攻差、マリガン、トリガー、DON効率、ライフ推移を表示します。
                    </p>
                  )}
                </CardContent>
              </Card>

              {batch ? (
                <>
                  <Card className="border-border/40 bg-card/40">
                    <CardContent className="space-y-3 p-4">
                      <h3 className="font-display text-lg tracking-wide">Ablation</h3>
                      <ul className="space-y-2">
                        {batch.metrics.ablation.map((result) => (
                          <li
                            key={result.cardId}
                            className="border-border/40 bg-background/30 flex items-center justify-between gap-3 rounded-md border p-3"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{result.name}</div>
                              <div className="text-muted-foreground text-xs">
                                → {result.replacementName} · {result.games}戦
                              </div>
                            </div>
                            <span className="font-mono text-sm tabular-nums">
                              {result.delta >= 0 ? "+" : ""}
                              {result.delta.toFixed(1)}pt
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="border-border/40 bg-card/40">
                    <CardContent className="space-y-3 p-4">
                      <h3 className="font-display text-lg tracking-wide">ターン別に引く確率</h3>
                      <div className="grid gap-2 md:grid-cols-2">
                        {batch.metrics.drawProbability.map((item) => (
                          <div
                            key={item.cardId}
                            className="border-border/40 bg-background/30 rounded-md border p-3"
                          >
                            <div className="truncate text-sm font-semibold">{item.name}</div>
                            <div className="text-muted-foreground mt-1 flex flex-wrap gap-2 font-mono text-[11px]">
                              <span>{item.copies}枚</span>
                              <span>3T {percent(item.turn3)}</span>
                              <span>5T {percent(item.turn5)}</span>
                              <span>7T {percent(item.turn7)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border/40 bg-card/40">
                    <CardContent className="space-y-3 p-4">
                      <h3 className="font-display text-lg tracking-wide">カード使用タイミング</h3>
                      <ul className="space-y-2">
                        {batch.metrics.cardTiming.map((card) => (
                          <li
                            key={`${card.side}:${card.cardId}`}
                            className="border-border/40 bg-background/30 flex items-center justify-between gap-3 rounded-md border p-3"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{card.name}</div>
                              <div className="text-muted-foreground text-xs">
                                {sideName(card.side)} · {card.uses}回
                              </div>
                            </div>
                            <span className="font-mono text-sm">{card.averageTurn.toFixed(1)}T</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="rules">
          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/40 bg-card/40">
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center gap-2">
                  <Gauge className="size-4" />
                  <h2 className="font-display text-xl tracking-wide">ルール再現ロードマップ</h2>
                </div>
                <div className="grid gap-3">
                  <RuleList title="実装済み" items={OFFICIAL_RULES_REFERENCE.implementedScope} />
                  <RuleList title="次に完全再現へ寄せる領域" items={OFFICIAL_RULES_REFERENCE.pendingScope} />
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/40 bg-card/40">
              <CardContent className="space-y-4 p-4">
                <h2 className="font-display text-xl tracking-wide">分析指標</h2>
                <ul className="space-y-2">
                  {ANALYSIS_METRIC_DEFINITIONS.map((definition) => (
                    <li
                      key={definition.key}
                      className="border-border/40 bg-background/30 rounded-md border p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">{definition.label}</div>
                          <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                            {definition.method}
                          </p>
                        </div>
                        <Badge variant={definition.implemented ? "default" : "outline"}>
                          {definition.implemented ? "実装" : "設計"}
                        </Badge>
                      </div>
                      <div className="text-muted-foreground mt-2 text-[11px]">
                        data: {definition.requiredData}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </section>
        </TabsContent>
      </Tabs>

      {usingMock ? (
        <p className="text-source-unverified text-xs">
          現在はモックカードでも動作します。実カードDBを入れると、同じ練習画面が実デッキ向けになります。
        </p>
      ) : null}
    </div>
  );
}

function SavedAnalysisPanel({
  summary,
  current,
  saveState,
  isLoading,
  error,
  onRefresh,
}: {
  summary: PracticeSummary | null;
  current: PracticeSummaryMatchup | null;
  saveState: SaveState;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const statusText =
    saveState.status === "saving"
      ? "保存中"
      : saveState.status === "saved"
        ? "保存済み"
        : saveState.status === "error"
          ? "保存失敗"
          : "待機中";

  return (
    <Card className="border-border/40 bg-card/40">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl tracking-wide">保存済み分析</h2>
            <p className="text-muted-foreground text-sm">
              DBに残した対戦ログから、リロード後も同じ集計を確認できます。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={saveState.status === "error" ? "destructive" : "outline"}>
              {statusText}
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className={cn("size-4", isLoading ? "animate-spin" : "")} />
              更新
            </Button>
          </div>
        </div>

        {saveState.detail ? (
          <p
            className={cn(
              "text-xs",
              saveState.status === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {saveState.detail}
          </p>
        ) : null}

        {error ? <p className="text-destructive text-xs">集計取得失敗: {error}</p> : null}

        {summary && summary.totalGames > 0 && current ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <MetricBox label="保存試合" value={String(current.games)} />
              <MetricBox label="保存Run" value={String(current.runs)} />
              <MetricBox label="勝率" value={percent(current.winRate)} />
              <MetricBox label="先攻勝率" value={percent(current.firstPlayerWinRate)} />
              <MetricBox label="後攻勝率" value={percent(current.secondPlayerWinRate)} />
              <MetricBox label="DON効率" value={percent(current.averageDonEfficiency)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MetricBox label="Keep勝率" value={nullablePercent(current.mulliganKeepWinRate)} />
              <MetricBox label="Redraw勝率" value={nullablePercent(current.mulliganRedrawWinRate)} />
              <MetricBox label="トリガー公開" value={percent(current.triggerRevealRate)} />
              <MetricBox label="トリガー成功" value={percent(current.triggerSuccessRate)} />
              <MetricBox label="敗北時カウンター" value={current.counterOverflowOnLoss.toFixed(0)} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <MiniList
                title="保存済みAblation"
                empty="Ablation結果はバッチ保存後に表示されます。"
                items={current.ablation.map((item) => ({
                  key: item.cardId,
                  title: item.name,
                  detail: `→ ${item.replacementName} · ${item.observations}回`,
                  value: `${item.averageDelta >= 0 ? "+" : ""}${item.averageDelta.toFixed(1)}pt`,
                }))}
              />
              <MiniList
                title="使用タイミング"
                empty="カード使用ログは保存後に表示されます。"
                items={current.cardTiming.map((item) => ({
                  key: `${item.side}:${item.cardId}`,
                  title: item.name,
                  detail: `${sideName(item.side)} · ${item.uses}回`,
                  value: `${item.averageTurn.toFixed(1)}T`,
                }))}
              />
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            まだ保存済みログがありません。CPU戦またはAI vs AIを実行すると自動保存されます。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MiniList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ key: string; title: string; detail: string; value: string }>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.slice(0, 4).map((item) => (
            <li
              key={item.key}
              className="border-border/40 bg-background/30 flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{item.title}</div>
                <div className="text-muted-foreground text-xs">{item.detail}</div>
              </div>
              <span className="font-mono text-sm tabular-nums">{item.value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{empty}</p>
      )}
    </div>
  );
}

function DeckSelector({
  label,
  value,
  leaders,
  deck,
  score,
  onChange,
}: {
  label: string;
  value: string;
  leaders: CardListItem[];
  deck: PracticeDeck;
  score: number;
  onChange: (value: string) => void;
}) {
  return (
    <Card className="border-border/40 bg-card/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-muted-foreground text-[11px] tracking-widest uppercase">
              {label}
            </div>
            <div className="truncate text-base font-semibold">{deck.leader.name}</div>
          </div>
          <Badge variant={deck.source === "draft" ? "default" : "outline"}>
            {deck.source === "draft" ? "下書き" : "自動"}
          </Badge>
        </div>
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {leaders.map((leader) => (
            <option key={leader.id} value={leader.id}>
              {leader.id} · {leader.name}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {deck.leader.colors.map((color) => (
            <ColorChip key={color} color={color} />
          ))}
          <span className="text-muted-foreground">{deck.totalCards}枚</span>
          <span className="text-muted-foreground">総合 {score.toFixed(0)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ControlSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function CardLine({ card }: { card: CardListItem }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-mono text-[11px]">{card.id}</span>
        {card.colors.map((color) => (
          <ColorChip key={color} color={color} />
        ))}
      </div>
      <div className="truncate text-sm font-semibold">{card.name}</div>
      <div className="text-muted-foreground flex gap-2 font-mono text-[11px]">
        {card.cost !== null ? <span>c{card.cost}</span> : null}
        {card.power !== null ? <span>p{card.power}</span> : null}
        {card.counter !== null ? <span>+{card.counter}</span> : null}
      </div>
    </div>
  );
}

function RuleList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className="border-border/40 bg-background/30 rounded-md border px-3 py-2 text-sm"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/40 bg-background/30 rounded-md border p-3">
      <div className="text-muted-foreground text-[10px] tracking-widest uppercase">
        {label}
      </div>
      <div className="break-words font-mono text-xl tabular-nums">{value}</div>
    </div>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function nullablePercent(value: number | null): string {
  return value === null ? "-" : percent(value);
}

function saveDetail(payload: {
  savedGames?: number;
  savedEvents?: number;
  storedEventGames?: number;
  skippedEventGames?: number;
}): string {
  const games = Number(payload.savedGames ?? 0).toLocaleString();
  const events = Number(payload.savedEvents ?? 0).toLocaleString();
  const storedEventGames = Number(payload.storedEventGames ?? payload.savedGames ?? 0);
  const skippedEventGames = Number(payload.skippedEventGames ?? 0);
  if (skippedEventGames > 0) {
    return `${games}試合を保存。イベントは${storedEventGames.toLocaleString()}試合分のみ保存、残り${skippedEventGames.toLocaleString()}試合は要約保存`;
  }
  return `${games}試合 / ${events}イベントを保存`;
}

function sideName(side: "player" | "opponent"): string {
  return side === "player" ? "自分" : "CPU";
}

function reasonLabel(reason: MatchResult["reason"]): string {
  const labels: Record<MatchResult["reason"], string> = {
    leader_damage: "リーサル",
    deck_out: "デッキ切れ",
    effect_win: "効果勝利",
    score_at_limit: "判定",
  };
  return labels[reason];
}
