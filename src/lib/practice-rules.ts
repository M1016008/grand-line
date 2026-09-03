import type { CardListItem } from "@/lib/cards";
import {
  buildPairedBenchmarkSchedule,
  type BenchmarkScheduleEntry,
  type WilsonConfidenceInterval,
  wilson95Interval,
} from "@/lib/deck-battle-benchmark";
import { createAutoBattlePolicy } from "@/lib/battle-engine/auto-policy";
import type {
  BattleTraceEvent,
  HeadlessStateSummary,
  RulesBattleStats,
} from "@/lib/battle-engine/battle-trace";
import type { DeckEffectCoverage } from "@/lib/battle-engine/coverage";
import { BattleEffectRegistry } from "@/lib/battle-engine/effect-registry";
import {
  runHeadlessBattle,
  type HeadlessBattleEnvironment,
  type HeadlessBattleReason,
  type HeadlessBattleResult,
} from "@/lib/battle-engine/headless-runner";
import type { CpuSkill, PracticeSide } from "@/lib/practice-log";
import type { PracticeDeck } from "@/lib/practice-sim";
import {
  summarizeRulesPracticeDeck,
  type RulesPracticeDeckSummary,
} from "@/lib/practice-rules-deck";
import {
  resolvePracticeStoragePolicy,
  selectPracticeEventGameIndexes,
  type PracticeRequestedEventStorageMode,
  type PracticeStoragePolicy,
} from "@/lib/practice-storage";
import { calculateDeckCoverage } from "@/lib/battle-engine/coverage";

export const RULES_PRACTICE_ENGINE_VERSION = "rules-kernel-practice-v2";
export const RULES_PRACTICE_DISCLOSURE_JA =
  "この結果はGrand Line Rules Kernelが現在再現できるverified officialカード効果の範囲に基づきます。partial / unsupported効果は推測実行せず、大会環境の勝率を示すものではありません。";

export interface RulesPracticeMatchResult {
  schemaVersion: 2;
  engineLabel: "Rules Kernel Practice v2";
  disclosureJa: string;
  outcome: "player" | "opponent" | "inconclusive";
  reason: HeadlessBattleReason;
  turns: number;
  seed: number;
  firstPlayer: PracticeSide;
  playerCoverage: DeckEffectCoverage;
  opponentCoverage: DeckEffectCoverage;
  stats: RulesBattleStats;
  finalState: HeadlessStateSummary;
  trace: BattleTraceEvent[];
  playerDeck: RulesPracticeDeckSummary;
  opponentDeck: RulesPracticeDeckSummary;
}

export interface RulesPracticeSideSplit {
  games: number;
  resolvedGames: number;
  inconclusiveGames: number;
  playerWins: number;
  opponentWins: number;
  resolvedWinRate: number | null;
}

export interface RulesPracticeBatchResult {
  schemaVersion: 2;
  engineLabel: "Rules Kernel Practice Batch v2";
  disclosureJa: string;
  games: number;
  resolvedGames: number;
  inconclusiveGames: number;
  resolutionRate: number;
  playerWins: number;
  opponentWins: number;
  resolvedWinRate: number | null;
  resolvedWinRateCi95: WilsonConfidenceInterval | null;
  firstPlayer: RulesPracticeSideSplit;
  secondPlayer: RulesPracticeSideSplit;
  averageResolvedTurns: number | null;
  outcomes: Record<HeadlessBattleReason, number>;
  playerCoverage: DeckEffectCoverage;
  opponentCoverage: DeckEffectCoverage;
  rulesStats: RulesBattleStats;
  playerDeck: RulesPracticeDeckSummary;
  opponentDeck: RulesPracticeDeckSummary;
  schedule: {
    baseSeed: number;
    seedStep: number;
    cpuSkill: CpuSkill;
    maxTurns: number;
    playerFirstGames: number;
    playerSecondGames: number;
  };
}

export interface RulesPracticeGameRecord {
  gameIndex: number;
  result: HeadlessBattleResult;
  trace?: BattleTraceEvent[];
}

export interface RulesPracticeBatchExecution {
  batch: RulesPracticeBatchResult;
  games: RulesPracticeGameRecord[];
  storagePolicy: PracticeStoragePolicy;
}

interface CommonRunInput {
  playerDeck: PracticeDeck;
  opponentDeck: PracticeDeck;
  cards: CardListItem[];
  cpuSkill: CpuSkill;
  maxTurns?: number;
}

export interface RulesPracticeDependencies {
  buildRegistry(cards: CardListItem[]): BattleEffectRegistry;
  run: typeof runHeadlessBattle;
}

const DEFAULT_DEPS: RulesPracticeDependencies = {
  buildRegistry: (cards) => new BattleEffectRegistry(cards),
  run: runHeadlessBattle,
};

export function buildRulesPracticeEnvironment(
  input: Pick<CommonRunInput, "playerDeck" | "opponentDeck" | "cards">,
  dependencies: RulesPracticeDependencies = DEFAULT_DEPS,
): HeadlessBattleEnvironment {
  const registry = dependencies.buildRegistry(input.cards);
  return Object.freeze({
    registry,
    playerCoverage: calculateDeckCoverage(input.playerDeck, registry),
    opponentCoverage: calculateDeckCoverage(input.opponentDeck, registry),
  });
}

export function runRulesPracticeMatch(
  input: CommonRunInput & { seed: number; firstPlayer?: PracticeSide },
  dependencies: RulesPracticeDependencies = DEFAULT_DEPS,
): { result: RulesPracticeMatchResult; game: RulesPracticeGameRecord } {
  const environment = buildRulesPracticeEnvironment(input, dependencies);
  const raw = runOne(
    input,
    {
      gameIndex: 0,
      seed: input.seed,
      firstPlayer: input.firstPlayer ?? "player",
      cpuSkill: input.cpuSkill,
      maxTurns: input.maxTurns ?? 10,
    },
    environment,
    "full",
    dependencies,
  );
  const trace = raw.trace ?? [];
  return {
    result: {
      schemaVersion: 2,
      engineLabel: "Rules Kernel Practice v2",
      disclosureJa: RULES_PRACTICE_DISCLOSURE_JA,
      outcome: raw.outcome,
      reason: raw.reason,
      turns: raw.turns,
      seed: raw.seed,
      firstPlayer: raw.firstPlayer,
      playerCoverage: raw.playerCoverage,
      opponentCoverage: raw.opponentCoverage,
      stats: raw.stats,
      finalState: raw.finalState,
      trace,
      playerDeck: summarizeRulesPracticeDeck(input.playerDeck),
      opponentDeck: summarizeRulesPracticeDeck(input.opponentDeck),
    },
    game: { gameIndex: 0, result: raw, trace },
  };
}

export function runRulesPracticeBatch(
  input: CommonRunInput & {
    games: number;
    seed: number;
    seedStep?: number;
    eventStorageMode: PracticeRequestedEventStorageMode;
    eventSampleLimit?: number;
  },
  dependencies: RulesPracticeDependencies = DEFAULT_DEPS,
): RulesPracticeBatchExecution {
  const environment = buildRulesPracticeEnvironment(input, dependencies);
  const schedule = buildPairedBenchmarkSchedule(input.games, {
    baseSeed: input.seed,
    seedStep: input.seedStep,
    cpuSkill: input.cpuSkill,
    maxTurns: input.maxTurns,
  });
  const storagePolicy = resolvePracticeStoragePolicy(
    schedule.length,
    input.eventStorageMode,
    input.eventSampleLimit,
  );
  const sampled = selectPracticeEventGameIndexes(
    schedule.length,
    storagePolicy.eventSampleLimit,
    storagePolicy.mode,
  );
  const games: RulesPracticeGameRecord[] = schedule.map((entry) => ({
    gameIndex: entry.gameIndex,
    result: runOne(input, entry, environment, "none", dependencies),
  }));

  for (const index of sampled) {
    const original = games[index];
    const replay = runOne(input, schedule[index], environment, "full", dependencies);
    if (!sameDeterministicResult(original.result, replay)) {
      throw new Error("practice_replay_determinism_error");
    }
    original.trace = replay.trace ?? [];
  }

  return {
    batch: summarizeBatch(input, schedule, games, environment),
    games,
    storagePolicy,
  };
}

function runOne(
  input: CommonRunInput,
  entry: BenchmarkScheduleEntry,
  environment: HeadlessBattleEnvironment,
  traceMode: "none" | "full",
  dependencies: RulesPracticeDependencies,
): HeadlessBattleResult {
  return dependencies.run({
    playerDeck: input.playerDeck,
    opponentDeck: input.opponentDeck,
    cards: input.cards,
    seed: entry.seed,
    firstPlayer: entry.firstPlayer,
    playerPolicy: createAutoBattlePolicy("level4"),
    opponentSkill: entry.cpuSkill,
    maxTurns: entry.maxTurns,
    traceMode,
    environment,
  });
}

function summarizeBatch(
  input: CommonRunInput,
  schedule: BenchmarkScheduleEntry[],
  records: RulesPracticeGameRecord[],
  environment: HeadlessBattleEnvironment,
): RulesPracticeBatchResult {
  const results = records.map((record) => record.result);
  const resolved = results.filter((result) => result.outcome !== "inconclusive");
  const playerWins = resolved.filter((result) => result.outcome === "player").length;
  const reasons = emptyReasons();
  const stats = emptyStats();
  for (const result of results) {
    reasons[result.reason] += 1;
    for (const key of Object.keys(stats) as Array<keyof RulesBattleStats>) {
      stats[key] += result.stats[key];
    }
  }
  const first = results.filter((_, index) => schedule[index].firstPlayer === "player");
  const second = results.filter((_, index) => schedule[index].firstPlayer === "opponent");
  return {
    schemaVersion: 2,
    engineLabel: "Rules Kernel Practice Batch v2",
    disclosureJa: RULES_PRACTICE_DISCLOSURE_JA,
    games: results.length,
    resolvedGames: resolved.length,
    inconclusiveGames: results.length - resolved.length,
    resolutionRate: ratio(resolved.length, results.length),
    playerWins,
    opponentWins: resolved.length - playerWins,
    resolvedWinRate: resolved.length ? ratio(playerWins, resolved.length) : null,
    resolvedWinRateCi95: resolved.length ? wilson95Interval(playerWins, resolved.length) : null,
    firstPlayer: sideSplit(first),
    secondPlayer: sideSplit(second),
    averageResolvedTurns: resolved.length
      ? round(resolved.reduce((sum, result) => sum + result.turns, 0) / resolved.length)
      : null,
    outcomes: reasons,
    playerCoverage: environment.playerCoverage,
    opponentCoverage: environment.opponentCoverage,
    rulesStats: stats,
    playerDeck: summarizeRulesPracticeDeck(input.playerDeck),
    opponentDeck: summarizeRulesPracticeDeck(input.opponentDeck),
    schedule: {
      baseSeed: schedule[0].seed,
      seedStep: schedule.length > 1 ? schedule[1].seed - schedule[0].seed : 97,
      cpuSkill: schedule[0].cpuSkill,
      maxTurns: schedule[0].maxTurns,
      playerFirstGames: first.length,
      playerSecondGames: second.length,
    },
  };
}

function sideSplit(results: HeadlessBattleResult[]): RulesPracticeSideSplit {
  const resolved = results.filter((result) => result.outcome !== "inconclusive");
  const playerWins = resolved.filter((result) => result.outcome === "player").length;
  return {
    games: results.length,
    resolvedGames: resolved.length,
    inconclusiveGames: results.length - resolved.length,
    playerWins,
    opponentWins: resolved.length - playerWins,
    resolvedWinRate: resolved.length ? ratio(playerWins, resolved.length) : null,
  };
}

function sameDeterministicResult(
  left: HeadlessBattleResult,
  right: HeadlessBattleResult,
): boolean {
  return (
    left.outcome === right.outcome &&
    left.reason === right.reason &&
    left.turns === right.turns &&
    JSON.stringify(left.finalState) === JSON.stringify(right.finalState)
  );
}

function emptyReasons(): Record<HeadlessBattleReason, number> {
  return { leader_damage: 0, deck_out: 0, effect_win: 0, turn_limit: 0, engine_guard: 0 };
}

function emptyStats(): RulesBattleStats {
  return {
    cardsPlayed: 0, attacksDeclared: 0, leaderAttacks: 0, characterAttacks: 0,
    damageDealt: 0, blockersUsed: 0, counterCardsUsed: 0, counterPowerUsed: 0,
    triggersRevealed: 0, triggersActivated: 0, triggersDeclined: 0,
    searchesResolved: 0, donAttached: 0, donSpent: 0, deckOut: 0,
    supportedEffectsResolved: 0, partialEffectsEncountered: 0,
    unsupportedEffectsEncountered: 0,
  };
}

function ratio(a: number, b: number): number {
  return b ? Math.round((a / b) * 1_000_000) / 1_000_000 : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
