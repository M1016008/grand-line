import { db } from "@/db";
import { practiceEvents, practiceGames, practiceRuns } from "@/db/schema";
import type { CpuSkill } from "@/lib/practice-log";
import type {
  RulesPracticeBatchResult,
  RulesPracticeGameRecord,
  RulesPracticeMatchResult,
} from "@/lib/practice-rules";
import { RULES_PRACTICE_ENGINE_VERSION } from "@/lib/practice-rules";
import type { PracticeStoragePolicy } from "@/lib/practice-storage";

export interface RulesPracticeSaveResult {
  runId: string;
  savedGames: number;
  savedEvents: number;
  eventStorageMode: PracticeStoragePolicy["mode"];
  storedEventGames: number;
  skippedEventGames: number;
}

export interface RulesPracticeStorageInput {
  mode: "match" | "batch";
  cpuSkill: CpuSkill;
  result: RulesPracticeMatchResult | RulesPracticeBatchResult;
  games: RulesPracticeGameRecord[];
  storagePolicy: PracticeStoragePolicy;
}

export function buildRulesPracticeStorageRows(
  input: RulesPracticeStorageInput,
  runId = crypto.randomUUID(),
) {
  const gameRows = input.games.map((game) => {
    const result = game.result;
    return {
      id: `${runId}:game:${game.gameIndex + 1}`,
      runId,
      seed: result.seed,
      firstPlayer: result.firstPlayer,
      winner: result.outcome,
      reason: result.reason,
      turns: result.turns,
      playerLife: result.finalState.player.life,
      opponentLife: result.finalState.opponent.life,
      playerDeckSnapshot: input.result.playerDeck as unknown as Record<string, unknown>,
      opponentDeckSnapshot: input.result.opponentDeck as unknown as Record<string, unknown>,
      summaryMetrics: {
        outcome: result.outcome,
        reason: result.reason,
        rulesStats: result.stats,
        finalState: result.finalState,
        eventCount: game.trace?.length ?? 0,
        eventsStored: Boolean(game.trace),
      },
    };
  });
  const eventRows = input.games.flatMap((game) => {
    if (!game.trace) return [];
    const gameId = `${runId}:game:${game.gameIndex + 1}`;
    return game.trace.map((event) => {
      if (!event.state) {
        throw new Error("practice_trace_state_missing");
      }
      const payload: Record<string, unknown> = {};
      if (event.cardId !== undefined) payload.cardId = event.cardId;
      if (event.targetId !== undefined) payload.targetId = event.targetId;
      if (event.details !== undefined) payload.details = event.details;
      return {
        gameId,
        eventIndex: event.index,
        type: event.type,
        turn: event.turn,
        side: event.actor ?? null,
        payload,
        state: event.state as unknown as Record<string, unknown>,
      };
    });
  });
  const storedEventGames = input.games.filter((game) => Boolean(game.trace)).length;
  return {
    runId,
    runRow: {
      id: runId,
      mode: input.mode,
      cpuSkill: input.cpuSkill,
      rulesVersion: RULES_PRACTICE_ENGINE_VERSION,
      playerLeaderId: input.result.playerDeck.leaderId,
      opponentLeaderId: input.result.opponentDeck.leaderId,
      gameCount: input.games.length,
      summaryMetrics: {
        schemaVersion: input.result.schemaVersion,
        engineLabel: input.result.engineLabel,
        disclosureJa: input.result.disclosureJa,
        playerCoverage: input.result.playerCoverage,
        opponentCoverage: input.result.opponentCoverage,
        rulesStats: "rulesStats" in input.result
          ? input.result.rulesStats
          : input.result.stats,
        ...(input.mode === "batch" && "resolvedGames" in input.result
          ? {
              games: input.result.games,
              resolvedGames: input.result.resolvedGames,
              inconclusiveGames: input.result.inconclusiveGames,
              resolutionRate: input.result.resolutionRate,
              resolvedWinRate: input.result.resolvedWinRate,
              outcomes: input.result.outcomes,
            }
          : {}),
        storagePolicy: {
          ...input.storagePolicy,
          storedEventGames,
          skippedEventGames: input.games.length - storedEventGames,
        },
      },
    },
    gameRows,
    eventRows,
    storedEventGames,
  };
}

export async function saveRulesPracticeRun(
  input: RulesPracticeStorageInput,
): Promise<RulesPracticeSaveResult> {
  const rows = buildRulesPracticeStorageRows(input);
  await db.transaction(async (tx) => {
    await tx.insert(practiceRuns).values(rows.runRow);
    for (const chunk of chunkRows(rows.gameRows, 500)) {
      await tx.insert(practiceGames).values(chunk);
    }
    for (const chunk of chunkRows(rows.eventRows, 1_000)) {
      await tx.insert(practiceEvents).values(chunk);
    }
  });
  return {
    runId: rows.runId,
    savedGames: rows.gameRows.length,
    savedEvents: rows.eventRows.length,
    eventStorageMode: input.storagePolicy.mode,
    storedEventGames: rows.storedEventGames,
    skippedEventGames: rows.gameRows.length - rows.storedEventGames,
  };
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
