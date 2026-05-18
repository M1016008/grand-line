/**
 * Persistence layer: writes simulation_runs / games / game_events /
 * card_plays / analysis_results rows from a completed batch.
 *
 * The engine itself stays framework-free; this module is the bridge
 * between the in-memory RunGameResult and the Drizzle DB.
 *
 * Performance note
 * ────────────────
 * Per-event INSERT round-trips on Turso are slow (each one is a
 * network hop). For 100 games × ~200 events = 20k inserts, naïve
 * one-at-a-time would take minutes. We batch via `db.insert(...)
 * .values([...])` which Drizzle compiles to a multi-row INSERT.
 */

import { randomUUID } from "node:crypto";

import { db, schema } from "../../db/client";
import { ENGINE_VERSION } from "./version";
import type { EngineEvent } from "./state";
import type { RunGameResult } from "./runner";

export interface CreateRunInput {
  readonly leaderAId: string;
  readonly leaderBId: string;
  readonly deckAId?: string | null;
  readonly deckBId?: string | null;
  readonly deckASnapshot: ReadonlyArray<{ cardId: string; count: number }>;
  readonly deckBSnapshot: ReadonlyArray<{ cardId: string; count: number }>;
  readonly nGames: number;
  readonly seedBase: string;
  readonly cpuAMode: "fast" | "strong" | "coach" | "human";
  readonly cpuBMode: "fast" | "strong" | "coach" | "human";
  readonly ablationTargetCardId?: string | null;
  readonly ablationReplacementCardId?: string | null;
  readonly notes?: string;
}

export async function createSimulationRun(
  input: CreateRunInput,
): Promise<string> {
  const id = `run-${randomUUID()}`;
  await db.insert(schema.simulationRuns).values({
    id,
    leaderAId: input.leaderAId,
    leaderBId: input.leaderBId,
    deckAId: input.deckAId ?? null,
    deckBId: input.deckBId ?? null,
    deckASnapshotJson: [...input.deckASnapshot],
    deckBSnapshotJson: [...input.deckBSnapshot],
    nGames: input.nGames,
    seedBase: input.seedBase,
    cpuAMode: input.cpuAMode,
    cpuBMode: input.cpuBMode,
    ablationTargetCardId: input.ablationTargetCardId ?? null,
    ablationReplacementCardId: input.ablationReplacementCardId ?? null,
    engineVersion: ENGINE_VERSION,
    notes: input.notes,
  });
  return id;
}

export async function persistGame(
  runId: string,
  gameIndex: number,
  rngSeed: string,
  result: RunGameResult,
): Promise<string> {
  const gameId = `game-${randomUUID()}`;
  const finalState = result.finalState;
  await db.insert(schema.games).values({
    id: gameId,
    runId,
    gameIndex,
    rngSeed,
    goFirst: finalState.goFirst,
    winner: finalState.winner,
    endCondition: finalState.endCondition,
    turns: finalState.turn,
    finalStateJson: finalStateSummary(finalState),
    finishedAt: new Date(),
  });

  // Persist events in batches of 500 so a single 100-game run stays
  // under Turso's request-size guidance.
  const events = result.events;
  const eventRows = events.map((e, idx) => ({
    gameId,
    seq: idx,
    turn: e.turn,
    phase: e.phase,
    actor: e.actor,
    eventType: e.type,
    payloadJson: e.payload as Record<string, unknown> | undefined,
  }));
  for (let i = 0; i < eventRows.length; i += 500) {
    const chunk = eventRows.slice(i, i + 500);
    if (chunk.length === 0) continue;
    await db.insert(schema.gameEvents).values(chunk);
  }

  // Derive card_plays from events for fast analytics queries.
  const cardPlayRows = events
    .filter(
      (e) =>
        e.type === "CARD_PLAYED" ||
        e.type === "DON_ATTACH" ||
        e.type === "ATTACK_DECLARED" ||
        e.type === "BLOCK_DECLARED" ||
        e.type === "COUNTER_PLAYED" ||
        e.type === "TRIGGER_REVEALED" ||
        e.type === "CHARACTER_KO",
    )
    .map((e) => deriveCardPlay(gameId, e))
    .filter((r): r is NonNullable<ReturnType<typeof deriveCardPlay>> => r !== null);
  for (let i = 0; i < cardPlayRows.length; i += 500) {
    const chunk = cardPlayRows.slice(i, i + 500);
    if (chunk.length === 0) continue;
    await db.insert(schema.cardPlays).values(chunk);
  }

  return gameId;
}

type CardPlayAction =
  | "PLAY"
  | "ATTACK"
  | "BLOCK"
  | "COUNTER"
  | "TRIGGER"
  | "KO"
  | "ATTACH_DON";

interface CardPlayRow {
  gameId: string;
  turn: number;
  actor: "A" | "B";
  cardId: string;
  action: CardPlayAction;
  outcome: string | null;
}

const EVENT_TO_PLAY_ACTION: Record<string, CardPlayAction> = {
  CARD_PLAYED: "PLAY",
  DON_ATTACH: "ATTACH_DON",
  ATTACK_DECLARED: "ATTACK",
  BLOCK_DECLARED: "BLOCK",
  COUNTER_PLAYED: "COUNTER",
  TRIGGER_REVEALED: "TRIGGER",
  CHARACTER_KO: "KO",
};

function deriveCardPlay(gameId: string, e: EngineEvent): CardPlayRow | null {
  if (e.actor === "SYSTEM" && e.type !== "CHARACTER_KO") return null;
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  const cardId = (payload.cardId as string | undefined) ?? null;
  if (!cardId) return null;
  const actor =
    e.type === "CHARACTER_KO" && typeof payload.owner === "string"
      ? (payload.owner as "A" | "B")
      : e.actor === "SYSTEM"
      ? "A"
      : (e.actor as "A" | "B");
  const action = EVENT_TO_PLAY_ACTION[e.type];
  if (!action) return null;
  return { gameId, turn: e.turn, actor, cardId, action, outcome: null };
}

function finalStateSummary(s: RunGameResult["finalState"]): Record<string, unknown> {
  return {
    turns: s.turn,
    phase: s.phase,
    winner: s.winner,
    endCondition: s.endCondition,
    aLifeRemaining: s.players.A.life.length,
    bLifeRemaining: s.players.B.life.length,
    aHandSize: s.players.A.hand.length,
    bHandSize: s.players.B.hand.length,
    aDeckSize: s.players.A.deck.length,
    bDeckSize: s.players.B.deck.length,
    aCharCount: s.players.A.characters.length,
    bCharCount: s.players.B.characters.length,
  };
}

export async function finalizeRun(
  runId: string,
  summary: Record<string, unknown>,
): Promise<void> {
  await db
    .update(schema.simulationRuns)
    .set({ finishedAt: new Date(), summaryJson: summary })
    .where(eqRunId(runId));
}

import { eq } from "drizzle-orm";
function eqRunId(id: string) {
  return eq(schema.simulationRuns.id, id);
}
