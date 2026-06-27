import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { practiceEvents, practiceGames, practiceRuns } from "@/db/schema";
import {
  simulateBatch,
  type BatchResult,
  type PracticeDeck,
} from "@/lib/practice-sim";
import type { CardListItem } from "@/lib/cards";
import {
  normalizeCpuSkill,
  type CpuSkill,
  type GameEvent,
  type GameReplayLog,
} from "@/lib/practice-log";
import {
  resolvePracticeStoragePolicy,
  selectPracticeEventGameIndexes,
  type PracticeRequestedEventStorageMode,
} from "@/lib/practice-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH_GAMES = 10_000;

const cpuSkillSchema = z.string().transform((value, ctx): CpuSkill => {
  const normalized = normalizeCpuSkill(value);
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid CPU level",
    });
    return "level1";
  }
  return normalized;
});

const cardSchema = z.object({
  id: z.string(),
  setCode: z.string(),
  cardType: z.string(),
  name: z.string(),
  colors: z.array(z.string()),
  features: z.array(z.string()),
  attributes: z.array(z.string()),
  cost: z.number().nullable(),
  power: z.number().nullable(),
  counter: z.number().nullable(),
  life: z.number().nullable(),
  rarity: z.string().nullable(),
  hasTrigger: z.boolean(),
  imageUrlJp: z.string().nullable(),
  mechanics: z.array(z.string()),
  source: z.enum(["official_jp", "official_en", "ai_translated", "manual"]),
  verified: z.boolean(),
}) satisfies z.ZodType<CardListItem>;

const practiceDeckSchema = z.object({
  id: z.string(),
  name: z.string(),
  leader: cardSchema,
  entries: z.array(
    z.object({
      card: cardSchema,
      count: z.number().int().positive(),
    }),
  ),
  source: z.enum(["draft", "generated"]),
  totalCards: z.number().int().positive(),
}) satisfies z.ZodType<PracticeDeck>;

const bodySchema = z.object({
  playerDeck: practiceDeckSchema,
  opponentDeck: practiceDeckSchema,
  games: z.number().int().min(1).max(MAX_BATCH_GAMES),
  seed: z.number().int(),
  cpuSkill: cpuSkillSchema,
  eventStorageMode: z.enum(["auto", "full", "sampled", "summary_only"]).optional(),
  eventSampleLimit: z.number().int().min(0).max(1_000).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_request", detail: (err as Error).message },
      { status: 400 },
    );
  }

  try {
    const startedAt = Date.now();
    const result = simulateBatch(
      body.playerDeck,
      body.opponentDeck,
      body.games,
      body.seed,
      body.cpuSkill,
    );
    const replays = result.replays ?? [];
    const save = await saveBatchRun({
      result,
      replays,
      playerLeaderId: body.playerDeck.leader.id,
      opponentLeaderId: body.opponentDeck.leader.id,
      eventStorageMode: body.eventStorageMode ?? "auto",
      eventSampleLimit: body.eventSampleLimit,
    });
    const responseResult = stripReplays(result);

    return NextResponse.json({
      batch: responseResult,
      save,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[/api/practice/batch] failed:", err);
    return NextResponse.json(
      { error: "batch_failed", detail: (err as Error).message },
      { status: 500 },
    );
  }
}

function stripReplays(result: BatchResult): Omit<BatchResult, "replays"> {
  const { replays: _replays, ...rest } = result;
  return rest;
}

async function saveBatchRun({
  result,
  replays,
  playerLeaderId,
  opponentLeaderId,
  eventStorageMode,
  eventSampleLimit,
}: {
  result: BatchResult;
  replays: GameReplayLog[];
  playerLeaderId: string;
  opponentLeaderId: string;
  eventStorageMode: PracticeRequestedEventStorageMode;
  eventSampleLimit?: number;
}) {
  const firstReplay = replays[0];
  if (!firstReplay) {
    throw new Error("No replays were generated.");
  }

  const runId = crypto.randomUUID();
  const storagePolicy = resolvePracticeStoragePolicy(
    replays.length,
    eventStorageMode,
    eventSampleLimit,
  );
  const storedEventGameIndexes = selectPracticeEventGameIndexes(
    replays.length,
    storagePolicy.eventSampleLimit,
    storagePolicy.mode,
  );
  const gameRows = replays.map((replay, index) => ({
    id: `${runId}:game:${index + 1}`,
    runId,
    seed: replay.header.seed,
    firstPlayer: replay.header.firstPlayer,
    winner: replay.result.winner,
    reason: replay.result.reason,
    turns: replay.result.turns,
    playerLife: replay.result.playerLife,
    opponentLife: replay.result.opponentLife,
    playerDeckSnapshot: replay.header.decks.player as unknown as Record<string, unknown>,
    opponentDeckSnapshot: replay.header.decks.opponent as unknown as Record<string, unknown>,
    summaryMetrics: {
      ...summarizeReplay(replay),
      eventCount: replay.events.length,
      eventsStored: storedEventGameIndexes.has(index),
    },
  }));
  const eventRows = replays.flatMap((replay, gameIndex) => {
    if (!storedEventGameIndexes.has(gameIndex)) return [];
    const gameId = gameRows[gameIndex].id;
    return replay.events.map((event) => ({
      gameId,
      eventIndex: event.index,
      type: event.type,
      turn: event.turn,
      side: event.side ?? null,
      payload: event.payload,
      state: event.state as unknown as Record<string, unknown>,
    }));
  });

  await db.transaction(async (tx) => {
    await tx.insert(practiceRuns).values({
      id: runId,
      mode: "batch",
      cpuSkill: firstReplay.header.cpuSkill,
      rulesVersion: firstReplay.header.rulesVersion,
      playerLeaderId,
      opponentLeaderId,
      gameCount: replays.length,
      summaryMetrics: {
        ...(result.metrics as unknown as Record<string, unknown>),
        storagePolicy: {
          ...storagePolicy,
          storedEventGames: storedEventGameIndexes.size,
          skippedEventGames: replays.length - storedEventGameIndexes.size,
        },
      },
    });
    for (const chunk of chunkRows(gameRows, 500)) {
      await tx.insert(practiceGames).values(chunk);
    }
    for (const chunk of chunkRows(eventRows, 1_000)) {
      await tx.insert(practiceEvents).values(chunk);
    }
  });

  return {
    runId,
    savedGames: gameRows.length,
    savedEvents: eventRows.length,
    eventStorageMode: storagePolicy.mode,
    storedEventGames: storedEventGameIndexes.size,
    skippedEventGames: replays.length - storedEventGameIndexes.size,
  };
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
