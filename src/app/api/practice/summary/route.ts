import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { practiceGames, practiceRuns } from "@/db/schema";
import type { PracticeSide, WinReason } from "@/lib/practice-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlayerMulligan = "keep" | "redraw";

interface StoredGameMetrics {
  averageDonEfficiency?: number;
  damageEvents?: number;
  triggerReveals?: number;
  triggerSuccesses?: number;
  playerMulligan?: PlayerMulligan;
  counterOverflowOnLoss?: number;
  cardUses?: StoredCardUse[];
}

interface StoredCardUse {
  cardId: string;
  cardName: string;
  side: PracticeSide;
  turn: number;
}

interface StoredAblation {
  cardId: string;
  name: string;
  replacementName: string;
  games: number;
  baselineWinRate: number;
  ablatedWinRate: number;
  delta: number;
}

interface MatchupAccumulator {
  key: string;
  playerLeaderId: string;
  opponentLeaderId: string;
  cpuSkill: string;
  rulesVersion: string;
  runs: Set<string>;
  seenRunMetrics: Set<string>;
  games: number;
  playerWins: number;
  opponentWins: number;
  firstPlayerGames: number;
  firstPlayerWins: number;
  secondPlayerGames: number;
  secondPlayerWins: number;
  turnTotal: number;
  donTotal: number;
  donCount: number;
  damageEvents: number;
  triggerReveals: number;
  triggerSuccesses: number;
  keepGames: number;
  keepWins: number;
  redrawGames: number;
  redrawWins: number;
  counterOverflowTotal: number;
  counterOverflowLosses: number;
  winReasons: Record<WinReason, number>;
  cardTiming: Map<string, { cardId: string; name: string; side: PracticeSide; turns: number[] }>;
  ablations: Map<string, { value: StoredAblation; deltas: number[] }>;
  latestRunAt: string | null;
}

export async function GET() {
  let rows: Awaited<ReturnType<typeof fetchRows>>;
  try {
    rows = await fetchRows();
  } catch (err) {
    if (isMissingPracticeTableError(err)) {
      return NextResponse.json(emptySummary(true));
    }
    throw err;
  }

  const groups = new Map<string, MatchupAccumulator>();
  const runIds = new Set<string>();

  for (const row of rows) {
    runIds.add(row.runId);
    const key = [
      row.playerLeaderId,
      row.opponentLeaderId,
      row.cpuSkill,
      row.rulesVersion,
    ].join("::");
    const group = groups.get(key) ?? createGroup(key, row);
    groups.set(key, group);

    group.runs.add(row.runId);
    group.games += 1;
    group.turnTotal += row.turns;
    if (row.winner === "player") group.playerWins += 1;
    else group.opponentWins += 1;
    if (row.firstPlayer === "player") {
      group.firstPlayerGames += 1;
      if (row.winner === "player") group.firstPlayerWins += 1;
    } else {
      group.secondPlayerGames += 1;
      if (row.winner === "player") group.secondPlayerWins += 1;
    }
    group.winReasons[row.reason] += 1;

    const metrics = normalizeGameMetrics(row.summaryMetrics);
    if (typeof metrics.averageDonEfficiency === "number") {
      group.donTotal += metrics.averageDonEfficiency;
      group.donCount += 1;
    }
    group.damageEvents += numberOrZero(metrics.damageEvents);
    group.triggerReveals += numberOrZero(metrics.triggerReveals);
    group.triggerSuccesses += numberOrZero(metrics.triggerSuccesses);
    if (metrics.playerMulligan === "redraw") {
      group.redrawGames += 1;
      if (row.winner === "player") group.redrawWins += 1;
    } else {
      group.keepGames += 1;
      if (row.winner === "player") group.keepWins += 1;
    }
    const counterOverflow = numberOrZero(metrics.counterOverflowOnLoss);
    if (row.winner !== "player") {
      group.counterOverflowTotal += counterOverflow;
      group.counterOverflowLosses += 1;
    }
    for (const use of metrics.cardUses ?? []) {
      const timingKey = `${use.side}:${use.cardId}`;
      const existing =
        group.cardTiming.get(timingKey) ??
        { cardId: use.cardId, name: use.cardName, side: use.side, turns: [] };
      existing.turns.push(use.turn);
      group.cardTiming.set(timingKey, existing);
    }

    if (!group.seenRunMetrics.has(row.runId)) {
      group.seenRunMetrics.add(row.runId);
      for (const ablation of normalizeAblations(row.runSummaryMetrics)) {
        const existing = group.ablations.get(ablation.cardId);
        if (existing) {
          existing.deltas.push(ablation.delta);
          existing.value = ablation;
        } else {
          group.ablations.set(ablation.cardId, {
            value: ablation,
            deltas: [ablation.delta],
          });
        }
      }
    }
  }

  return NextResponse.json({
    totalRuns: runIds.size,
    totalGames: rows.length,
    matchups: [...groups.values()]
      .map((group) => serializeGroup(group))
      .sort((a, b) => b.games - a.games),
  });
}

function fetchRows() {
  return db
    .select({
      runId: practiceRuns.id,
      mode: practiceRuns.mode,
      cpuSkill: practiceRuns.cpuSkill,
      rulesVersion: practiceRuns.rulesVersion,
      playerLeaderId: practiceRuns.playerLeaderId,
      opponentLeaderId: practiceRuns.opponentLeaderId,
      runSummaryMetrics: practiceRuns.summaryMetrics,
      createdAt: practiceRuns.createdAt,
      gameId: practiceGames.id,
      firstPlayer: practiceGames.firstPlayer,
      winner: practiceGames.winner,
      reason: practiceGames.reason,
      turns: practiceGames.turns,
      summaryMetrics: practiceGames.summaryMetrics,
    })
    .from(practiceGames)
    .innerJoin(practiceRuns, eq(practiceGames.runId, practiceRuns.id))
    .orderBy(desc(practiceRuns.createdAt));
}

function emptySummary(needsMigration = false) {
  return {
    totalRuns: 0,
    totalGames: 0,
    matchups: [],
    needsMigration,
  };
}

function createGroup(
  key: string,
  row: {
    playerLeaderId: string;
    opponentLeaderId: string;
    cpuSkill: string;
    rulesVersion: string;
    createdAt: Date | number | string | null;
  },
): MatchupAccumulator {
  return {
    key,
    playerLeaderId: row.playerLeaderId,
    opponentLeaderId: row.opponentLeaderId,
    cpuSkill: row.cpuSkill,
    rulesVersion: row.rulesVersion,
    runs: new Set(),
    seenRunMetrics: new Set(),
    games: 0,
    playerWins: 0,
    opponentWins: 0,
    firstPlayerGames: 0,
    firstPlayerWins: 0,
    secondPlayerGames: 0,
    secondPlayerWins: 0,
    turnTotal: 0,
    donTotal: 0,
    donCount: 0,
    damageEvents: 0,
    triggerReveals: 0,
    triggerSuccesses: 0,
    keepGames: 0,
    keepWins: 0,
    redrawGames: 0,
    redrawWins: 0,
    counterOverflowTotal: 0,
    counterOverflowLosses: 0,
    winReasons: {
      leader_damage: 0,
      deck_out: 0,
      effect_win: 0,
      score_at_limit: 0,
    },
    cardTiming: new Map(),
    ablations: new Map(),
    latestRunAt: serializeDate(row.createdAt),
  };
}

function serializeGroup(group: MatchupAccumulator) {
  return {
    key: group.key,
    playerLeaderId: group.playerLeaderId,
    opponentLeaderId: group.opponentLeaderId,
    cpuSkill: group.cpuSkill,
    rulesVersion: group.rulesVersion,
    runs: group.runs.size,
    games: group.games,
    playerWins: group.playerWins,
    opponentWins: group.opponentWins,
    winRate: rate(group.playerWins, group.games),
    firstPlayerWinRate: rate(group.firstPlayerWins, group.firstPlayerGames),
    secondPlayerWinRate: rate(group.secondPlayerWins, group.secondPlayerGames),
    avgTurns: rate(group.turnTotal, group.games),
    averageDonEfficiency: rate(group.donTotal, group.donCount),
    triggerRevealRate: rate(group.triggerReveals, group.damageEvents),
    triggerSuccessRate: rate(group.triggerSuccesses, group.triggerReveals),
    mulliganKeepWinRate: nullableRate(group.keepWins, group.keepGames),
    mulliganRedrawWinRate: nullableRate(group.redrawWins, group.redrawGames),
    counterOverflowOnLoss: rate(
      group.counterOverflowTotal,
      group.counterOverflowLosses,
    ),
    winReasons: group.winReasons,
    cardTiming: [...group.cardTiming.values()]
      .map((card) => ({
        cardId: card.cardId,
        name: card.name,
        side: card.side,
        uses: card.turns.length,
        averageTurn: rate(
          card.turns.reduce((acc, turn) => acc + turn, 0),
          card.turns.length,
        ),
      }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 8),
    ablation: [...group.ablations.values()]
      .map(({ value, deltas }) => ({
        ...value,
        averageDelta: rate(
          deltas.reduce((acc, delta) => acc + delta, 0),
          deltas.length,
        ),
        observations: deltas.length,
      }))
      .sort((a, b) => b.averageDelta - a.averageDelta)
      .slice(0, 8),
    latestRunAt: group.latestRunAt,
  };
}

function normalizeGameMetrics(value: unknown): StoredGameMetrics {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const playerMulligan =
    record.playerMulligan === "redraw" ? "redraw" : "keep";
  const cardUses = Array.isArray(record.cardUses)
    ? record.cardUses.flatMap((item) => normalizeCardUse(item))
    : [];
  return {
    averageDonEfficiency: numberOrUndefined(record.averageDonEfficiency),
    damageEvents: numberOrUndefined(record.damageEvents),
    triggerReveals: numberOrUndefined(record.triggerReveals),
    triggerSuccesses: numberOrUndefined(record.triggerSuccesses),
    playerMulligan,
    counterOverflowOnLoss: numberOrUndefined(record.counterOverflowOnLoss),
    cardUses,
  };
}

function normalizeCardUse(value: unknown): StoredCardUse[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (
    typeof record.cardId !== "string" ||
    typeof record.cardName !== "string" ||
    (record.side !== "player" && record.side !== "opponent") ||
    typeof record.turn !== "number"
  ) {
    return [];
  }
  return [
    {
      cardId: record.cardId,
      cardName: record.cardName,
      side: record.side,
      turn: record.turn,
    },
  ];
}

function normalizeAblations(value: unknown): StoredAblation[] {
  if (!value || typeof value !== "object") return [];
  const ablation = (value as Record<string, unknown>).ablation;
  if (!Array.isArray(ablation)) return [];
  return ablation.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.cardId !== "string" ||
      typeof record.name !== "string" ||
      typeof record.replacementName !== "string"
    ) {
      return [];
    }
    return [
      {
        cardId: record.cardId,
        name: record.name,
        replacementName: record.replacementName,
        games: numberOrZero(record.games),
        baselineWinRate: numberOrZero(record.baselineWinRate),
        ablatedWinRate: numberOrZero(record.ablatedWinRate),
        delta: numberOrZero(record.delta),
      },
    ];
  });
}

function nullableRate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function serializeDate(value: Date | number | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function isMissingPracticeTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such table: practice_/i.test(message);
}
