import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { practiceEvents, practiceGames, practiceRuns } from "@/db/schema";
import type { GameEvent, GameReplayLog } from "@/lib/practice-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const DEFAULT_EVENT_SAMPLE_LIMIT = 100;

const practiceSideSchema = z.enum(["player", "opponent"]);
const cpuSkillSchema = z.enum(["beginner", "advanced"]);
const winReasonSchema = z.enum([
  "leader_damage",
  "deck_out",
  "effect_win",
  "score_at_limit",
]);
const eventTypeSchema = z.enum([
  "game_start",
  "mulligan_decision",
  "turn_start",
  "refresh_phase",
  "draw_phase",
  "don_phase",
  "main_phase_action",
  "attack_declared",
  "trigger_revealed",
  "life_changed",
  "turn_end",
  "game_end",
]);
const jsonObjectSchema = z.record(z.string(), z.unknown());

const deckSummarySchema = z.object({
  leaderId: z.string().min(1),
  leaderName: z.string(),
  source: z.enum(["draft", "generated"]),
  totalCards: z.number().int().nonnegative(),
});

const replayStateSchema = z.object({
  playerLife: z.number(),
  opponentLife: z.number(),
  playerHand: z.number(),
  opponentHand: z.number(),
  playerDeck: z.number(),
  opponentDeck: z.number(),
  playerDonAvailable: z.number(),
  opponentDonAvailable: z.number(),
  playerDonUsed: z.number(),
  opponentDonUsed: z.number(),
});

const replayEventSchema = z.object({
  index: z.number().int().nonnegative(),
  type: eventTypeSchema,
  turn: z.number().int().nonnegative(),
  side: practiceSideSchema.optional(),
  payload: jsonObjectSchema,
  state: replayStateSchema,
});

const replayResultSchema = z.object({
  winner: practiceSideSchema,
  loser: practiceSideSchema,
  turns: z.number().int().nonnegative(),
  reason: winReasonSchema,
  playerLife: z.number().int(),
  opponentLife: z.number().int(),
});

const replaySchema = z.object({
  header: z.object({
    schemaVersion: z.literal(1),
    seed: z.number().int(),
    rulesVersion: z.string().min(1),
    cpuSkill: cpuSkillSchema,
    firstPlayer: practiceSideSchema,
    decks: z.object({
      player: deckSummarySchema,
      opponent: deckSummarySchema,
    }),
  }),
  events: z.array(replayEventSchema).min(1),
  result: replayResultSchema,
}) satisfies z.ZodType<GameReplayLog>;

const postSchema = z.object({
  mode: z.enum(["match", "batch"]),
  playerLeaderId: z.string().min(1).optional(),
  opponentLeaderId: z.string().min(1).optional(),
  replays: z.array(replaySchema).min(1).max(10_000),
  summaryMetrics: jsonObjectSchema.nullish(),
  eventStorageMode: z.enum(["auto", "full", "sampled", "summary_only"]).optional(),
  eventSampleLimit: z.number().int().min(0).max(1_000).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(limitParam)
    ? Math.min(100, Math.max(1, Math.floor(limitParam)))
    : 20;

  let rows: Awaited<ReturnType<typeof fetchRecentRuns>>;
  try {
    rows = await fetchRecentRuns(limit);
  } catch (err) {
    if (isMissingPracticeTableError(err)) {
      return NextResponse.json({ runs: [], needsMigration: true });
    }
    throw err;
  }

  return NextResponse.json({
    runs: rows.map((row) => ({
      ...row,
      createdAt: serializeDate(row.createdAt),
    })),
  });
}

function fetchRecentRuns(limit: number) {
  return db
    .select({
      id: practiceRuns.id,
      mode: practiceRuns.mode,
      cpuSkill: practiceRuns.cpuSkill,
      rulesVersion: practiceRuns.rulesVersion,
      playerLeaderId: practiceRuns.playerLeaderId,
      opponentLeaderId: practiceRuns.opponentLeaderId,
      gameCount: practiceRuns.gameCount,
      summaryMetrics: practiceRuns.summaryMetrics,
      createdAt: practiceRuns.createdAt,
    })
    .from(practiceRuns)
    .orderBy(desc(practiceRuns.createdAt))
    .limit(limit);
}

export async function POST(req: Request) {
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", detail: (err as Error).message },
      { status: 400 },
    );
  }

  const firstReplay = body.replays[0];
  const runId = crypto.randomUUID();
  const playerLeaderId =
    body.playerLeaderId ?? firstReplay.header.decks.player.leaderId;
  const opponentLeaderId =
    body.opponentLeaderId ?? firstReplay.header.decks.opponent.leaderId;
  const storagePolicy = resolveStoragePolicy(
    body.replays.length,
    body.eventStorageMode ?? "auto",
    body.eventSampleLimit,
  );
  const storedEventGameIndexes = selectEventGameIndexes(
    body.replays.length,
    storagePolicy.eventSampleLimit,
    storagePolicy.mode,
  );
  const gameRows = body.replays.map((replay, index) => ({
    id: `${runId}:game:${index + 1}`,
    runId,
    seed: replay.header.seed,
    firstPlayer: replay.header.firstPlayer,
    winner: replay.result.winner,
    reason: replay.result.reason,
    turns: replay.result.turns,
    playerLife: replay.result.playerLife,
    opponentLife: replay.result.opponentLife,
    playerDeckSnapshot: replay.header.decks.player,
    opponentDeckSnapshot: replay.header.decks.opponent,
    summaryMetrics: {
      ...summarizeReplay(replay),
      eventCount: replay.events.length,
      eventsStored: storedEventGameIndexes.has(index),
    },
  }));
  const eventRows = body.replays.flatMap((replay, gameIndex) => {
    if (!storedEventGameIndexes.has(gameIndex)) return [];
    const gameId = gameRows[gameIndex].id;
    return replay.events.map((event) => ({
      gameId,
      eventIndex: event.index,
      type: event.type,
      turn: event.turn,
      side: event.side ?? null,
      payload: event.payload,
      state: event.state,
    }));
  });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(practiceRuns).values({
        id: runId,
        mode: body.mode,
        cpuSkill: firstReplay.header.cpuSkill,
        rulesVersion: firstReplay.header.rulesVersion,
        playerLeaderId,
        opponentLeaderId,
        gameCount: body.replays.length,
        summaryMetrics: body.summaryMetrics
          ? {
              ...body.summaryMetrics,
              storagePolicy: {
                ...storagePolicy,
                storedEventGames: storedEventGameIndexes.size,
                skippedEventGames: body.replays.length - storedEventGameIndexes.size,
              },
            }
          : {
              storagePolicy: {
                ...storagePolicy,
                storedEventGames: storedEventGameIndexes.size,
                skippedEventGames: body.replays.length - storedEventGameIndexes.size,
              },
            },
      });

      for (const chunk of chunkRows(gameRows, 500)) {
        await tx.insert(practiceGames).values(chunk);
      }
      for (const chunk of chunkRows(eventRows, 500)) {
        await tx.insert(practiceEvents).values(chunk);
      }
    });
  } catch (err) {
    console.error("[/api/practice/runs] save failed:", err);
    return NextResponse.json(
      { error: "save_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    runId,
    savedGames: gameRows.length,
    savedEvents: eventRows.length,
    eventStorageMode: storagePolicy.mode,
    storedEventGames: storedEventGameIndexes.size,
    skippedEventGames: body.replays.length - storedEventGameIndexes.size,
  });
}

function resolveStoragePolicy(
  games: number,
  requestedMode: "auto" | "full" | "sampled" | "summary_only",
  requestedLimit: number | undefined,
) {
  const mode =
    requestedMode === "auto"
      ? games <= 100
        ? "full"
        : "sampled"
      : requestedMode;
  const eventSampleLimit =
    mode === "full"
      ? games
      : mode === "summary_only"
        ? 0
        : Math.min(
            games,
            Math.max(0, requestedLimit ?? DEFAULT_EVENT_SAMPLE_LIMIT),
          );

  return { mode, eventSampleLimit };
}

function selectEventGameIndexes(
  games: number,
  limit: number,
  mode: "full" | "sampled" | "summary_only",
): Set<number> {
  if (mode === "summary_only" || limit <= 0) return new Set();
  if (mode === "full" || limit >= games) {
    return new Set(Array.from({ length: games }, (_, index) => index));
  }

  const target = Math.min(limit, games);
  const indexes = new Set<number>([0]);
  if (target === 1) return indexes;

  indexes.add(games - 1);
  const middleSlots = target - indexes.size;
  for (let i = 1; i <= middleSlots; i++) {
    indexes.add(Math.round((i * (games - 1)) / (middleSlots + 1)));
  }
  for (let index = 0; indexes.size < target && index < games; index++) {
    indexes.add(index);
  }
  return indexes;
}

function summarizeReplay(replay: GameReplayLog): Record<string, unknown> {
  const turnEndEvents = replay.events.filter(
    (event) => event.type === "turn_end" && event.side,
  );
  const donEfficiencyValues = turnEndEvents
    .map((event) => donEfficiency(event))
    .filter((value): value is number => value !== null);
  const lifeChanged = replay.events.filter((event) => event.type === "life_changed");
  const triggers = replay.events.filter((event) => event.type === "trigger_revealed");
  const playerMulligan = replay.events.find(
    (event) => event.type === "mulligan_decision" && event.side === "player",
  );
  const gameEnd = replay.events.find((event) => event.type === "game_end");
  const cardUses = replay.events
    .filter((event) => event.type === "main_phase_action")
    .flatMap((event) => cardUseFromEvent(event));

  return {
    averageDonEfficiency: average(donEfficiencyValues),
    damageEvents: lifeChanged.length,
    triggerReveals: triggers.length,
    triggerSuccesses: triggers.filter((event) => event.payload.activated === true).length,
    playerMulligan:
      playerMulligan?.payload.decision === "redraw" ? "redraw" : "keep",
    counterOverflowOnLoss:
      gameEnd?.payload.loser === "player"
        ? Number(gameEnd.payload.counterOverflow ?? 0)
        : 0,
    cardUses,
  };
}

function donEfficiency(event: GameEvent): number | null {
  if (!event.side) return null;
  const used =
    event.side === "player" ? event.state.playerDonUsed : event.state.opponentDonUsed;
  const available =
    event.side === "player"
      ? event.state.playerDonAvailable
      : event.state.opponentDonAvailable;
  return available > 0 ? used / available : null;
}

function cardUseFromEvent(event: GameEvent) {
  const cardId = event.payload.cardId;
  if (typeof cardId !== "string" || !event.side) return [];
  return [
    {
      cardId,
      cardName: String(event.payload.cardName ?? cardId),
      side: event.side,
      turn: event.turn,
    },
  ];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
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
