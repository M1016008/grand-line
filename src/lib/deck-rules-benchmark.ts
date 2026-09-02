import type { CardListItem } from "@/lib/cards";
import {
  BENCHMARK_REPLAY_SAMPLE_SIZE,
  BENCHMARK_SEED_STEP,
  buildPairedBenchmarkSchedule,
  type BenchmarkOpponentDescriptor,
  type BenchmarkScheduleEntry,
  type BenchmarkVariantInput,
  type WilsonConfidenceInterval,
  wilson95Interval,
} from "@/lib/deck-battle-benchmark";
import {
  VARIANT_PROFILE_IDS,
  VARIANT_PROFILE_LABELS,
  type VariantProfile,
} from "@/lib/deck-intelligence-preferences";
import type { CpuSkill } from "@/lib/practice-log";
import { createAutoBattlePolicy } from "@/lib/battle-engine/auto-policy";
import type { BattleTraceEvent, RulesBattleStats } from "@/lib/battle-engine/battle-trace";
import { calculateDeckCoverage, type DeckEffectCoverage } from "@/lib/battle-engine/coverage";
import { BattleEffectRegistry } from "@/lib/battle-engine/effect-registry";
import {
  runHeadlessBattle,
  type HeadlessBattleEnvironment,
  type HeadlessBattleResult,
} from "@/lib/battle-engine/headless-runner";
import type { PracticeDeck } from "@/lib/practice-sim";

export const RULES_BENCHMARK_DISCLOSURE_JA =
  "この結果はGrand Line Rules Kernelで現在構造化・再現できる公式verifiedカード効果の範囲内で行った自動対戦比較です。partial / unsupported効果は推測実行していません。大会環境の勝率や公式シミュレーター結果を示すものではありません。";

export type RulesScheduledOutcome = "win" | "loss" | "inconclusive";

export interface RulesBenchmarkSideSplit {
  games: number;
  resolvedGames: number;
  inconclusiveGames: number;
  playerWins: number;
  opponentWins: number;
  resolutionRate: number;
  resolvedWinRate: number | null;
}

export interface RulesBenchmarkOutcomes {
  leaderDamageWins: number;
  deckOutWins: number;
  effectWins: number;
  turnLimit: number;
  engineGuard: number;
}

export type RulesBenchmarkStats = Omit<RulesBattleStats, "deckOut">;

export interface RulesBenchmarkDeckMetrics {
  games: number;
  resolvedGames: number;
  inconclusiveGames: number;
  resolutionRate: number;
  playerWins: number;
  opponentWins: number;
  resolvedWinRate: number | null;
  resolvedWinRateCi95: WilsonConfidenceInterval | null;
  firstPlayer: RulesBenchmarkSideSplit;
  secondPlayer: RulesBenchmarkSideSplit;
  averageResolvedTurns: number | null;
  outcomes: RulesBenchmarkOutcomes;
  effectCoverage: DeckEffectCoverage;
  rulesStats: RulesBenchmarkStats;
  traceSamples?: BattleTraceEvent[][];
}

export interface RulesBenchmarkVariantMetrics extends RulesBenchmarkDeckMetrics {
  variantProfile: VariantProfile;
}

export interface RulesRelativeMetrics {
  leftProfile: VariantProfile;
  rightProfile: VariantProfile;
  resolvedWinRateDelta: number | null;
  resolutionRateDelta: number;
  averageResolvedTurnsDelta: number | null;
}

export interface RulesPairedOutcomeAggregation {
  games: number;
  allThreeResolved: number;
  anyInconclusive: number;
  allThreeWin: number;
  allThreeLose: number;
  allThreeInconclusive: number;
  recommendedOnlyWins: number;
  consistencyOnlyWins: number;
  specializationOnlyWins: number;
  twoVariantsWin: number;
}

export interface RulesPairwiseComparison {
  leftProfile: VariantProfile;
  rightProfile: VariantProfile;
  games: number;
  bothResolved: number;
  excludedByInconclusive: number;
  leftOnlyWins: number;
  rightOnlyWins: number;
  bothWin: number;
  bothLose: number;
  netResolvedWins: number;
}

export interface DeckRulesBenchmarkResult {
  schemaVersion: 2;
  benchmarkLabel: "Rules Benchmark v2";
  disclosureJa: string;
  opponent: BenchmarkOpponentDescriptor;
  opponentCoverage: DeckEffectCoverage;
  schedule: {
    gamesPerVariant: number;
    baseSeed: number;
    seedStep: number;
    cpuSkill: CpuSkill;
    playerPolicySkill: "level4";
    maxTurns: number;
    playerFirstGames: number;
    playerSecondGames: number;
    sample: BenchmarkScheduleEntry[];
  };
  variants: Record<VariantProfile, RulesBenchmarkVariantMetrics>;
  relativeMetrics: RulesRelativeMetrics[];
  pairedOutcomes: RulesPairedOutcomeAggregation;
  pairwiseComparisons: RulesPairwiseComparison[];
  interpretationsJa: string[];
}

export interface RulesBenchmarkRunOptions {
  variants: BenchmarkVariantInput[];
  opponentDeck: PracticeDeck;
  opponent: BenchmarkOpponentDescriptor;
  cards: CardListItem[];
  games: number;
  cpuSkill: CpuSkill;
  baseSeed?: number;
  seedStep?: number;
  maxTurns?: number;
  replaySampleSize?: number;
}

export interface RulesBenchmarkDependencies {
  run: typeof runHeadlessBattle;
  buildRegistry: (cards: CardListItem[]) => BattleEffectRegistry;
}

interface ScheduledRulesResult {
  metrics: RulesBenchmarkDeckMetrics;
  outcomes: RulesScheduledOutcome[];
}

const DEFAULT_DEPENDENCIES: RulesBenchmarkDependencies = {
  run: runHeadlessBattle,
  buildRegistry: (cards) => new BattleEffectRegistry(cards),
};

export function runRulesDeckBenchmark(
  options: RulesBenchmarkRunOptions,
  dependencies: RulesBenchmarkDependencies = DEFAULT_DEPENDENCIES,
): DeckRulesBenchmarkResult {
  assertThreeProfiles(options.variants);
  const schedule = buildPairedBenchmarkSchedule(options.games, {
    baseSeed: options.baseSeed,
    seedStep: options.seedStep,
    cpuSkill: options.cpuSkill,
    maxTurns: options.maxTurns,
  });

  // One request-wide compilation. Every environment below shares this registry.
  const registry = dependencies.buildRegistry(options.cards);
  const opponentCoverage = calculateDeckCoverage(options.opponentDeck, registry);
  const outcomes = emptyOutcomeMap();
  const variantEntries = options.variants.map(({ variantProfile, deck }) => {
    const playerCoverage = calculateDeckCoverage(deck, registry);
    const environment: HeadlessBattleEnvironment = Object.freeze({
      registry,
      playerCoverage,
      opponentCoverage,
    });
    const scheduled = runRulesDeckOnSchedule(
      {
        deck,
        opponentDeck: options.opponentDeck,
        cards: options.cards,
        schedule,
        environment,
        replaySampleSize:
          options.replaySampleSize ?? BENCHMARK_REPLAY_SAMPLE_SIZE,
      },
      dependencies.run,
    );
    outcomes[variantProfile] = scheduled.outcomes;
    return [
      variantProfile,
      { variantProfile, ...scheduled.metrics } satisfies RulesBenchmarkVariantMetrics,
    ] as const;
  });
  const variants = Object.fromEntries(variantEntries) as Record<
    VariantProfile,
    RulesBenchmarkVariantMetrics
  >;
  const relativeMetrics = computeRulesRelativeMetrics(variants);
  const firstPlayerGames = schedule.filter(
    (entry) => entry.firstPlayer === "player",
  ).length;

  return {
    schemaVersion: 2,
    benchmarkLabel: "Rules Benchmark v2",
    disclosureJa: RULES_BENCHMARK_DISCLOSURE_JA,
    opponent: options.opponent,
    opponentCoverage,
    schedule: {
      gamesPerVariant: schedule.length,
      baseSeed: schedule[0].seed,
      seedStep:
        schedule.length > 1
          ? schedule[1].seed - schedule[0].seed
          : options.seedStep ?? BENCHMARK_SEED_STEP,
      cpuSkill: schedule[0].cpuSkill,
      playerPolicySkill: "level4",
      maxTurns: schedule[0].maxTurns,
      playerFirstGames: firstPlayerGames,
      playerSecondGames: schedule.length - firstPlayerGames,
      sample: schedule.slice(0, 6),
    },
    variants,
    relativeMetrics,
    pairedOutcomes: aggregateRulesPairedOutcomes(outcomes),
    pairwiseComparisons: computeRulesPairwiseComparisons(outcomes),
    interpretationsJa: buildRulesInterpretations(relativeMetrics, variants),
  };
}

export function summarizeRulesScheduledResults(
  results: HeadlessBattleResult[],
  schedule: BenchmarkScheduleEntry[],
  effectCoverage: DeckEffectCoverage,
  traceSamples?: BattleTraceEvent[][],
): RulesBenchmarkDeckMetrics {
  if (results.length !== schedule.length || results.length < 1) {
    throw new Error("Rules Benchmark results must match a non-empty schedule.");
  }
  const resolved = results.filter((result) => result.outcome !== "inconclusive");
  const playerWins = resolved.filter((result) => result.outcome === "player").length;
  const opponentWins = resolved.length - playerWins;
  const outcomes = emptyRulesOutcomes();
  const rulesStats = emptyRulesStats();

  for (const result of results) {
    if (result.reason === "leader_damage") outcomes.leaderDamageWins += 1;
    else if (result.reason === "deck_out") outcomes.deckOutWins += 1;
    else if (result.reason === "effect_win") outcomes.effectWins += 1;
    else if (result.reason === "turn_limit") outcomes.turnLimit += 1;
    else if (result.reason === "engine_guard") outcomes.engineGuard += 1;
    addRulesStats(rulesStats, result.stats);
  }

  const firstResults = results.filter(
    (_, index) => schedule[index].firstPlayer === "player",
  );
  const secondResults = results.filter(
    (_, index) => schedule[index].firstPlayer === "opponent",
  );
  return {
    games: results.length,
    resolvedGames: resolved.length,
    inconclusiveGames: results.length - resolved.length,
    resolutionRate: round6(resolved.length / results.length),
    playerWins,
    opponentWins,
    resolvedWinRate:
      resolved.length > 0 ? round6(playerWins / resolved.length) : null,
    resolvedWinRateCi95:
      resolved.length > 0 ? wilson95Interval(playerWins, resolved.length) : null,
    firstPlayer: summarizeSideSplit(firstResults),
    secondPlayer: summarizeSideSplit(secondResults),
    averageResolvedTurns:
      resolved.length > 0
        ? round2(
            resolved.reduce((sum, result) => sum + result.turns, 0) /
              resolved.length,
          )
        : null,
    outcomes,
    effectCoverage,
    rulesStats,
    ...(traceSamples && traceSamples.length > 0 ? { traceSamples } : {}),
  };
}

export function aggregateRulesPairedOutcomes(
  outcomes: Record<VariantProfile, RulesScheduledOutcome[]>,
): RulesPairedOutcomeAggregation {
  assertEqualOutcomeLengths(outcomes);
  const aggregate: RulesPairedOutcomeAggregation = {
    games: outcomes.recommended.length,
    allThreeResolved: 0,
    anyInconclusive: 0,
    allThreeWin: 0,
    allThreeLose: 0,
    allThreeInconclusive: 0,
    recommendedOnlyWins: 0,
    consistencyOnlyWins: 0,
    specializationOnlyWins: 0,
    twoVariantsWin: 0,
  };

  for (let index = 0; index < aggregate.games; index++) {
    const values = VARIANT_PROFILE_IDS.map((profile) => outcomes[profile][index]);
    if (values.some((outcome) => outcome === "inconclusive")) {
      aggregate.anyInconclusive += 1;
      if (values.every((outcome) => outcome === "inconclusive")) {
        aggregate.allThreeInconclusive += 1;
      }
      continue;
    }
    aggregate.allThreeResolved += 1;
    const wins = values.filter((outcome) => outcome === "win").length;
    if (wins === 3) aggregate.allThreeWin += 1;
    else if (wins === 0) aggregate.allThreeLose += 1;
    else if (wins === 2) aggregate.twoVariantsWin += 1;
    else if (outcomes.recommended[index] === "win") {
      aggregate.recommendedOnlyWins += 1;
    } else if (outcomes.consistency[index] === "win") {
      aggregate.consistencyOnlyWins += 1;
    } else {
      aggregate.specializationOnlyWins += 1;
    }
  }
  return aggregate;
}

export function computeRulesPairwiseComparisons(
  outcomes: Record<VariantProfile, RulesScheduledOutcome[]>,
): RulesPairwiseComparison[] {
  assertEqualOutcomeLengths(outcomes);
  const pairs: Array<[VariantProfile, VariantProfile]> = [
    ["recommended", "consistency"],
    ["recommended", "specialization"],
    ["consistency", "specialization"],
  ];
  return pairs.map(([leftProfile, rightProfile]) => {
    const comparison: RulesPairwiseComparison = {
      leftProfile,
      rightProfile,
      games: outcomes[leftProfile].length,
      bothResolved: 0,
      excludedByInconclusive: 0,
      leftOnlyWins: 0,
      rightOnlyWins: 0,
      bothWin: 0,
      bothLose: 0,
      netResolvedWins: 0,
    };
    for (let index = 0; index < comparison.games; index++) {
      const left = outcomes[leftProfile][index];
      const right = outcomes[rightProfile][index];
      if (left === "inconclusive" || right === "inconclusive") {
        comparison.excludedByInconclusive += 1;
        continue;
      }
      comparison.bothResolved += 1;
      if (left === "win" && right === "win") comparison.bothWin += 1;
      else if (left === "loss" && right === "loss") comparison.bothLose += 1;
      else if (left === "win") comparison.leftOnlyWins += 1;
      else comparison.rightOnlyWins += 1;
    }
    comparison.netResolvedWins =
      comparison.leftOnlyWins - comparison.rightOnlyWins;
    return comparison;
  });
}

export function computeRulesRelativeMetrics(
  variants: Record<VariantProfile, RulesBenchmarkVariantMetrics>,
): RulesRelativeMetrics[] {
  const pairs: Array<[VariantProfile, VariantProfile]> = [
    ["recommended", "consistency"],
    ["recommended", "specialization"],
    ["consistency", "specialization"],
  ];
  return pairs.map(([leftProfile, rightProfile]) => {
    const left = variants[leftProfile];
    const right = variants[rightProfile];
    return {
      leftProfile,
      rightProfile,
      resolvedWinRateDelta:
        left.resolvedWinRate === null || right.resolvedWinRate === null
          ? null
          : round6(left.resolvedWinRate - right.resolvedWinRate),
      resolutionRateDelta: round6(left.resolutionRate - right.resolutionRate),
      averageResolvedTurnsDelta:
        left.averageResolvedTurns === null || right.averageResolvedTurns === null
          ? null
          : round2(left.averageResolvedTurns - right.averageResolvedTurns),
    };
  });
}

function runRulesDeckOnSchedule(
  options: {
    deck: PracticeDeck;
    opponentDeck: PracticeDeck;
    cards: CardListItem[];
    schedule: BenchmarkScheduleEntry[];
    environment: HeadlessBattleEnvironment;
    replaySampleSize: number;
  },
  run: typeof runHeadlessBattle,
): ScheduledRulesResult {
  const results = options.schedule.map((scheduled) =>
    run({
      playerDeck: options.deck,
      opponentDeck: options.opponentDeck,
      cards: options.cards,
      seed: scheduled.seed,
      firstPlayer: scheduled.firstPlayer,
      playerPolicy: createAutoBattlePolicy("level4"),
      opponentSkill: scheduled.cpuSkill,
      maxTurns: scheduled.maxTurns,
      traceMode: "none",
      environment: options.environment,
    }),
  );
  const traceSamples = options.replaySampleSize > 0
    ? options.schedule.slice(0, Math.min(1, options.replaySampleSize)).map((scheduled) =>
        run({
          playerDeck: options.deck,
          opponentDeck: options.opponentDeck,
          cards: options.cards,
          seed: scheduled.seed,
          firstPlayer: scheduled.firstPlayer,
          playerPolicy: createAutoBattlePolicy("level4"),
          opponentSkill: scheduled.cpuSkill,
          maxTurns: scheduled.maxTurns,
          traceMode: "full",
          environment: options.environment,
        }).trace ?? [],
      )
    : undefined;
  return {
    metrics: summarizeRulesScheduledResults(
      results,
      options.schedule,
      options.environment.playerCoverage,
      traceSamples,
    ),
    outcomes: results.map(toScheduledOutcome),
  };
}

function summarizeSideSplit(results: HeadlessBattleResult[]): RulesBenchmarkSideSplit {
  const resolved = results.filter((result) => result.outcome !== "inconclusive");
  const playerWins = resolved.filter((result) => result.outcome === "player").length;
  return {
    games: results.length,
    resolvedGames: resolved.length,
    inconclusiveGames: results.length - resolved.length,
    playerWins,
    opponentWins: resolved.length - playerWins,
    resolutionRate: results.length > 0 ? round6(resolved.length / results.length) : 0,
    resolvedWinRate:
      resolved.length > 0 ? round6(playerWins / resolved.length) : null,
  };
}

function toScheduledOutcome(result: HeadlessBattleResult): RulesScheduledOutcome {
  if (result.outcome === "player") return "win";
  if (result.outcome === "opponent") return "loss";
  return "inconclusive";
}

function buildRulesInterpretations(
  relatives: RulesRelativeMetrics[],
  variants: Record<VariantProfile, RulesBenchmarkVariantMetrics>,
): string[] {
  return relatives.map((relative) => {
    const left = variants[relative.leftProfile];
    const right = variants[relative.rightProfile];
    const labels = `${VARIANT_PROFILE_LABELS[relative.leftProfile]}と${VARIANT_PROFILE_LABELS[relative.rightProfile]}`;
    const coverageDiffers =
      left.effectCoverage.complete !== right.effectCoverage.complete ||
      Math.abs(left.effectCoverage.supportedRatio - right.effectCoverage.supportedRatio) >= 0.1 ||
      left.effectCoverage.leaderStatus !== right.effectCoverage.leaderStatus;
    if (
      left.resolutionRate < 0.7 ||
      right.resolutionRate < 0.7 ||
      coverageDiffers ||
      relative.resolvedWinRateDelta === null
    ) {
      return `${labels}は未決着率または効果coverageに差があるため、現時点では決着試合勝率だけで優劣を判断できません。`;
    }
    const leftInterval = left.resolvedWinRateCi95;
    const rightInterval = right.resolvedWinRateCi95;
    const overlap =
      leftInterval &&
      rightInterval &&
      leftInterval.lower <= rightInterval.upper &&
      rightInterval.lower <= leftInterval.upper;
    return `${labels}のRules Kernel内の決着試合勝率差は${formatSignedPoints(relative.resolvedWinRateDelta)}です。95% CIは${overlap ? "重なっており、明確な差は確認できません" : "重なっていませんが、大会環境の優劣を示すものではありません"}。`;
  });
}

function emptyRulesStats(): RulesBenchmarkStats {
  return {
    cardsPlayed: 0,
    attacksDeclared: 0,
    leaderAttacks: 0,
    characterAttacks: 0,
    damageDealt: 0,
    blockersUsed: 0,
    counterCardsUsed: 0,
    counterPowerUsed: 0,
    triggersRevealed: 0,
    triggersActivated: 0,
    triggersDeclined: 0,
    searchesResolved: 0,
    donAttached: 0,
    donSpent: 0,
    supportedEffectsResolved: 0,
    partialEffectsEncountered: 0,
    unsupportedEffectsEncountered: 0,
  };
}

function addRulesStats(target: RulesBenchmarkStats, source: RulesBattleStats): void {
  for (const key of Object.keys(target) as Array<keyof RulesBenchmarkStats>) {
    target[key] += source[key];
  }
}

function emptyRulesOutcomes(): RulesBenchmarkOutcomes {
  return {
    leaderDamageWins: 0,
    deckOutWins: 0,
    effectWins: 0,
    turnLimit: 0,
    engineGuard: 0,
  };
}

function emptyOutcomeMap(): Record<VariantProfile, RulesScheduledOutcome[]> {
  return { recommended: [], consistency: [], specialization: [] };
}

function assertEqualOutcomeLengths(
  outcomes: Record<VariantProfile, RulesScheduledOutcome[]>,
): void {
  const lengths = VARIANT_PROFILE_IDS.map((profile) => outcomes[profile].length);
  if (!lengths.every((length) => length === lengths[0])) {
    throw new Error("Rules paired outcomes must have equal game counts.");
  }
}

function assertThreeProfiles(variants: BenchmarkVariantInput[]): void {
  if (
    variants.length !== VARIANT_PROFILE_IDS.length ||
    !VARIANT_PROFILE_IDS.every(
      (profile) =>
        variants.filter((variant) => variant.variantProfile === profile).length === 1,
    )
  ) {
    throw new Error(
      "Rules Benchmark requires one recommended, consistency, and specialization deck.",
    );
  }
}

function formatSignedPoints(value: number): string {
  const points = round2(value * 100);
  return `${points > 0 ? "+" : ""}${points.toFixed(2)}pt`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
