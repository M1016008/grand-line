/**
 * Per-batch analytics: derives summary metrics from a completed
 * simulation_runs row and persists them to analysis_results.
 *
 * Metrics (Phase C-1 set)
 * ───────────────────────
 *   - winrate (overall A and B)
 *   - go_first_winrate (winrate when going first, by player slot)
 *   - avg_turns (game length)
 *   - end_condition_distribution
 *   - trigger_count_per_game (mean revealed life-card triggers)
 *   - card_play_frequency (per cardId)
 *
 * Phase C-2 will add: card_contribution_delta (ablation), mulligan
 * accuracy, draw probability per turn, etc.
 */

import { and, eq, sql } from "drizzle-orm";

import { db, schema } from "../../db/client";

export interface RunSummary {
  readonly runId: string;
  readonly nGames: number;
  readonly winsA: number;
  readonly winsB: number;
  readonly draws: number;
  readonly winrateA: number;
  readonly avgTurns: number;
  readonly endConditions: Record<string, number>;
}

export async function summarizeRun(runId: string): Promise<RunSummary> {
  const games = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.runId, runId));

  const winsA = games.filter((g) => g.winner === "A").length;
  const winsB = games.filter((g) => g.winner === "B").length;
  const draws = games.filter((g) => g.winner === "DRAW").length;
  const turns = games.map((g) => g.turns ?? 0);
  const avgTurns =
    turns.length > 0 ? turns.reduce((a, b) => a + b, 0) / turns.length : 0;
  const endConditions: Record<string, number> = {};
  for (const g of games) {
    const k = g.endCondition ?? "UNKNOWN";
    endConditions[k] = (endConditions[k] ?? 0) + 1;
  }

  return {
    runId,
    nGames: games.length,
    winsA,
    winsB,
    draws,
    winrateA: games.length > 0 ? winsA / games.length : 0,
    avgTurns,
    endConditions,
  };
}

export async function persistRunMetrics(summary: RunSummary): Promise<void> {
  await db.insert(schema.analysisResults).values([
    {
      runId: summary.runId,
      metric: "winrate_a",
      value: summary.winrateA,
      breakdownJson: { winsA: summary.winsA, winsB: summary.winsB, draws: summary.draws },
    },
    {
      runId: summary.runId,
      metric: "avg_turns",
      value: summary.avgTurns,
      breakdownJson: { nGames: summary.nGames },
    },
    {
      runId: summary.runId,
      metric: "end_conditions",
      value: null,
      breakdownJson: summary.endConditions,
    },
  ]);

  // Card play frequency (per cardId, per action).
  const rows = await db
    .select({
      cardId: schema.cardPlays.cardId,
      action: schema.cardPlays.action,
      n: sql<number>`count(*)`,
    })
    .from(schema.cardPlays)
    .innerJoin(schema.games, eq(schema.cardPlays.gameId, schema.games.id))
    .where(eq(schema.games.runId, summary.runId))
    .groupBy(schema.cardPlays.cardId, schema.cardPlays.action);
  for (const r of rows) {
    await db.insert(schema.analysisResults).values({
      runId: summary.runId,
      metric: "card_play_count",
      value: Number(r.n),
      breakdownJson: { cardId: r.cardId, action: r.action },
    });
  }

  // Go-first winrate breakdown.
  const goFirstA = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.runId, summary.runId),
        eq(schema.games.goFirst, "A"),
      ),
    );
  const goFirstAWins = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.runId, summary.runId),
        eq(schema.games.goFirst, "A"),
        eq(schema.games.winner, "A"),
      ),
    );
  const aGoFirstTotal = Number(goFirstA[0]?.n ?? 0);
  const aGoFirstWins = Number(goFirstAWins[0]?.n ?? 0);
  await db.insert(schema.analysisResults).values({
    runId: summary.runId,
    metric: "go_first_advantage",
    value: aGoFirstTotal > 0 ? aGoFirstWins / aGoFirstTotal : 0,
    breakdownJson: {
      aGoFirstTotal,
      aGoFirstWins,
    },
  });
}
