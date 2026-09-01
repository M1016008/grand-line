import type { CardListItem } from "@/lib/cards";
import {
  resolveDeckCopyEntries,
  type DeckCopyEntry,
} from "@/lib/deck-intelligence-compare";
import {
  VARIANT_PROFILE_IDS,
  VARIANT_PROFILE_LABELS,
  type VariantProfile,
} from "@/lib/deck-intelligence-preferences";
import {
  validateDeck,
  type DeckRegulations,
  type RuleViolation,
} from "@/lib/deck-rules";
import type {
  CpuSkill,
  GameReplayLog,
  PracticeSide,
  WinReason,
} from "@/lib/practice-log";
import {
  simulateMatch,
  summarizePracticeMatches,
  type Contribution,
  type PracticeDeck,
} from "@/lib/practice-sim";

export const BENCHMARK_SIZE_OPTIONS = [
  { id: "quick", labelJa: "Quick", games: 100 },
  { id: "standard", labelJa: "Standard", games: 500 },
  { id: "deep", labelJa: "Deep", games: 2_000 },
] as const;

export const BENCHMARK_SERVER_MAX_GAMES = 10_000;
export const BENCHMARK_DEFAULT_BASE_SEED = 1_001;
export const BENCHMARK_SEED_STEP = 97;
export const BENCHMARK_DEFAULT_MAX_TURNS = 10;
export const BENCHMARK_REPLAY_SAMPLE_SIZE = 1;

export const BENCHMARK_DISCLOSURE_JA =
  "この結果はGrand Lineの現在のPractice engineによる比較ベンチマークです。公式カード効果・裁定を完全再現した実戦勝率ではありません。";

export interface StrictPracticeDeckInput {
  id: string;
  name: string;
  leader: CardListItem;
  cards: DeckCopyEntry[];
  poolById: ReadonlyMap<string, CardListItem>;
  regulations: DeckRegulations;
}

export class BenchmarkDeckValidationError extends Error {
  constructor(
    message: string,
    readonly violations: RuleViolation[],
  ) {
    super(message);
    this.name = "BenchmarkDeckValidationError";
  }
}

/**
 * Strict adapter for an already-generated Deck Intelligence proposal.
 * It never fills, trims, or drops cards. Counts are merged only to validate
 * duplicate ids as one construction-rule entry while preserving copy totals.
 */
export function strictDeckIntelligencePracticeDeck(
  input: StrictPracticeDeckInput,
): PracticeDeck {
  if (input.leader.cardType !== "LEADER") {
    throw new BenchmarkDeckValidationError(
      `${input.leader.id} is not a leader card.`,
      [
        {
          code: "not_a_leader",
          severity: "error",
          message: `${input.leader.id} is not a leader card.`,
          cardIds: [input.leader.id],
        },
      ],
    );
  }

  const resolved = resolveDeckCopyEntries(input.cards, input.poolById);
  const merged = new Map<string, { card: CardListItem; count: number }>();
  for (const entry of resolved) {
    const existing = merged.get(entry.card.id);
    merged.set(entry.card.id, {
      card: entry.card,
      count: (existing?.count ?? 0) + entry.count,
    });
  }
  const entries = [...merged.values()].sort((left, right) =>
    left.card.id.localeCompare(right.card.id),
  );
  const report = validateDeck(
    {
      id: input.leader.id,
      name: input.leader.name,
      colors: input.leader.colors,
    },
    entries.map(({ card, count }) => ({
      id: card.id,
      cardType: card.cardType,
      colors: card.colors,
      count,
    })),
    input.regulations,
  );
  if (!report.legal) {
    throw new BenchmarkDeckValidationError(
      `Deck ${input.id} is not legal for the current benchmark.`,
      report.violations,
    );
  }

  return {
    id: input.id,
    name: input.name,
    leader: input.leader,
    entries,
    source: "draft",
    totalCards: report.totalCount,
  };
}

export interface BenchmarkScheduleEntry {
  gameIndex: number;
  seed: number;
  firstPlayer: PracticeSide;
  cpuSkill: CpuSkill;
  maxTurns: number;
}

export function buildPairedBenchmarkSchedule(
  games: number,
  options: {
    baseSeed?: number;
    seedStep?: number;
    cpuSkill: CpuSkill;
    maxTurns?: number;
  },
): BenchmarkScheduleEntry[] {
  if (!Number.isInteger(games) || games < 1 || games > BENCHMARK_SERVER_MAX_GAMES) {
    throw new RangeError(
      `Benchmark games must be between 1 and ${BENCHMARK_SERVER_MAX_GAMES}.`,
    );
  }
  const baseSeed = options.baseSeed ?? BENCHMARK_DEFAULT_BASE_SEED;
  const seedStep = options.seedStep ?? BENCHMARK_SEED_STEP;
  const maxTurns = options.maxTurns ?? BENCHMARK_DEFAULT_MAX_TURNS;
  return Array.from({ length: games }, (_, gameIndex) => ({
    gameIndex,
    seed: baseSeed + gameIndex * seedStep,
    firstPlayer: gameIndex % 2 === 0 ? "player" : "opponent",
    cpuSkill: options.cpuSkill,
    maxTurns,
  }));
}

export interface WilsonConfidenceInterval {
  level: 0.95;
  lower: number;
  upper: number;
}

export function wilson95Interval(
  wins: number,
  games: number,
): WilsonConfidenceInterval {
  if (
    !Number.isInteger(wins) ||
    !Number.isInteger(games) ||
    games < 1 ||
    wins < 0 ||
    wins > games
  ) {
    throw new RangeError("Wilson interval requires 0 <= wins <= games and games >= 1.");
  }
  const z = 1.959963984540054;
  const proportion = wins / games;
  const denominator = 1 + (z * z) / games;
  const center = (proportion + (z * z) / (2 * games)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt(
      (proportion * (1 - proportion)) / games +
        (z * z) / (4 * games * games),
    );
  return {
    level: 0.95,
    lower: round6(Math.max(0, center - margin)),
    upper: round6(Math.min(1, center + margin)),
  };
}

export interface BenchmarkVariantInput {
  variantProfile: VariantProfile;
  deck: PracticeDeck;
}

export interface BenchmarkOpponentDescriptor {
  kind: "saved" | "synthetic";
  id: string;
  name: string;
  leaderId: string;
  synthetic: boolean;
}

export interface BenchmarkVariantMetrics {
  variantProfile: VariantProfile;
  games: number;
  heuristicWins: number;
  heuristicWinRate: number;
  heuristicWinRateCi95: WilsonConfidenceInterval;
  firstPlayerWinRate: number;
  secondPlayerWinRate: number;
  avgTurns: number;
  averageDonEfficiency: number;
  triggerRevealRate: number;
  triggerSuccessRate: number;
  mulliganKeepWinRate: number | null;
  mulliganRedrawWinRate: number | null;
  counterOverflowOnLoss: number;
  winReasons: Record<WinReason, number>;
  topContributors: Contribution[];
  replaySamples: GameReplayLog[];
}

export interface RelativeBenchmarkMetrics {
  leftProfile: VariantProfile;
  rightProfile: VariantProfile;
  winRateDelta: number;
  avgTurnsDelta: number;
  donEfficiencyDelta: number;
  firstPlayerDelta: number;
  secondPlayerDelta: number;
}

export interface PairedOutcomeAggregation {
  games: number;
  allThreeWin: number;
  allThreeLose: number;
  recommendedOnlyWins: number;
  consistencyOnlyWins: number;
  specializationOnlyWins: number;
  twoVariantsWin: number;
  recommendedAndConsistencyWin: number;
  recommendedAndSpecializationWin: number;
  consistencyAndSpecializationWin: number;
}

export interface DeckBattleBenchmarkResult {
  schemaVersion: 1;
  benchmarkLabel: "Battle Benchmark";
  disclosureJa: string;
  opponent: BenchmarkOpponentDescriptor;
  schedule: {
    gamesPerVariant: number;
    baseSeed: number;
    seedStep: number;
    cpuSkill: CpuSkill;
    maxTurns: number;
    playerFirstGames: number;
    playerSecondGames: number;
    sample: BenchmarkScheduleEntry[];
  };
  variants: Record<VariantProfile, BenchmarkVariantMetrics>;
  relativeMetrics: RelativeBenchmarkMetrics[];
  pairedOutcomes: PairedOutcomeAggregation;
  interpretationsJa: string[];
}

interface BenchmarkRunOptions {
  variants: BenchmarkVariantInput[];
  opponentDeck: PracticeDeck;
  opponent: BenchmarkOpponentDescriptor;
  games: number;
  cpuSkill: CpuSkill;
  baseSeed?: number;
  seedStep?: number;
  maxTurns?: number;
  replaySampleSize?: number;
}

interface BenchmarkDependencies {
  simulate: typeof simulateMatch;
}

export function runPairedDeckBenchmark(
  options: BenchmarkRunOptions,
  dependencies: BenchmarkDependencies = { simulate: simulateMatch },
): DeckBattleBenchmarkResult {
  assertThreeProfiles(options.variants);
  const schedule = buildPairedBenchmarkSchedule(options.games, {
    baseSeed: options.baseSeed,
    seedStep: options.seedStep,
    cpuSkill: options.cpuSkill,
    maxTurns: options.maxTurns,
  });
  const outcomes = emptyOutcomeMap();
  const variantEntries = options.variants.map(({ variantProfile, deck }) => {
    const matches = schedule.map((scheduled) =>
      dependencies.simulate(deck, options.opponentDeck, {
        seed: scheduled.seed,
        cpuSkill: scheduled.cpuSkill,
        firstPlayer: scheduled.firstPlayer,
        maxTurns: scheduled.maxTurns,
      }),
    );
    outcomes[variantProfile] = matches.map(
      (match) => match.winner === "player",
    );
    const summary = summarizePracticeMatches(matches, deck, {
      replaySampleSize:
        options.replaySampleSize ?? BENCHMARK_REPLAY_SAMPLE_SIZE,
      topContributorLimit: Number.MAX_SAFE_INTEGER,
    });
    const winReasons = emptyWinReasons();
    for (const match of matches) {
      if (match.winner === "player") winReasons[match.reason] += 1;
    }
    const metrics: BenchmarkVariantMetrics = {
      variantProfile,
      games: summary.games,
      heuristicWins: summary.playerWins,
      heuristicWinRate: summary.playerWinRate,
      heuristicWinRateCi95: wilson95Interval(
        summary.playerWins,
        summary.games,
      ),
      firstPlayerWinRate: summary.metrics.firstPlayerWinRate,
      secondPlayerWinRate: summary.metrics.secondPlayerWinRate,
      avgTurns: summary.avgTurns,
      averageDonEfficiency: summary.metrics.averageDonEfficiency,
      triggerRevealRate: summary.metrics.triggerRevealRate,
      triggerSuccessRate: summary.metrics.triggerSuccessRate,
      mulliganKeepWinRate: summary.metrics.mulliganKeepWinRate,
      mulliganRedrawWinRate: summary.metrics.mulliganRedrawWinRate,
      counterOverflowOnLoss: summary.metrics.counterOverflowOnLoss,
      winReasons,
      topContributors: summary.topContributors
        .filter((contribution) => contribution.side === "player")
        .slice(0, 5),
      replaySamples: summary.replays ?? [],
    };
    return [variantProfile, metrics] as const;
  });
  const variants = Object.fromEntries(variantEntries) as Record<
    VariantProfile,
    BenchmarkVariantMetrics
  >;
  const relativeMetrics = computeRelativeBenchmarkMetrics(variants);
  const firstPlayerGames = schedule.filter(
    (entry) => entry.firstPlayer === "player",
  ).length;
  return {
    schemaVersion: 1,
    benchmarkLabel: "Battle Benchmark",
    disclosureJa: BENCHMARK_DISCLOSURE_JA,
    opponent: options.opponent,
    schedule: {
      gamesPerVariant: schedule.length,
      baseSeed: schedule[0].seed,
      seedStep:
        schedule.length > 1
          ? schedule[1].seed - schedule[0].seed
          : options.seedStep ?? BENCHMARK_SEED_STEP,
      cpuSkill: schedule[0].cpuSkill,
      maxTurns: schedule[0].maxTurns,
      playerFirstGames: firstPlayerGames,
      playerSecondGames: schedule.length - firstPlayerGames,
      sample: schedule.slice(0, 6),
    },
    variants,
    relativeMetrics,
    pairedOutcomes: aggregatePairedOutcomes(outcomes),
    interpretationsJa: buildBenchmarkInterpretations(
      relativeMetrics,
      variants,
    ),
  };
}

export function computeRelativeBenchmarkMetrics(
  variants: Record<VariantProfile, BenchmarkVariantMetrics>,
): RelativeBenchmarkMetrics[] {
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
      winRateDelta: round6(left.heuristicWinRate - right.heuristicWinRate),
      avgTurnsDelta: round2(left.avgTurns - right.avgTurns),
      donEfficiencyDelta: round6(
        left.averageDonEfficiency - right.averageDonEfficiency,
      ),
      firstPlayerDelta: round6(
        left.firstPlayerWinRate - right.firstPlayerWinRate,
      ),
      secondPlayerDelta: round6(
        left.secondPlayerWinRate - right.secondPlayerWinRate,
      ),
    };
  });
}

export function aggregatePairedOutcomes(
  outcomes: Record<VariantProfile, boolean[]>,
): PairedOutcomeAggregation {
  const lengths = VARIANT_PROFILE_IDS.map((profile) => outcomes[profile].length);
  if (!lengths.every((length) => length === lengths[0])) {
    throw new Error("Paired benchmark outcomes must have equal game counts.");
  }
  const aggregate: PairedOutcomeAggregation = {
    games: lengths[0],
    allThreeWin: 0,
    allThreeLose: 0,
    recommendedOnlyWins: 0,
    consistencyOnlyWins: 0,
    specializationOnlyWins: 0,
    twoVariantsWin: 0,
    recommendedAndConsistencyWin: 0,
    recommendedAndSpecializationWin: 0,
    consistencyAndSpecializationWin: 0,
  };

  for (let gameIndex = 0; gameIndex < aggregate.games; gameIndex++) {
    const recommended = outcomes.recommended[gameIndex];
    const consistency = outcomes.consistency[gameIndex];
    const specialization = outcomes.specialization[gameIndex];
    const wins = Number(recommended) + Number(consistency) + Number(specialization);
    if (wins === 3) aggregate.allThreeWin += 1;
    else if (wins === 0) aggregate.allThreeLose += 1;
    else if (wins === 1 && recommended) aggregate.recommendedOnlyWins += 1;
    else if (wins === 1 && consistency) aggregate.consistencyOnlyWins += 1;
    else if (wins === 1 && specialization) aggregate.specializationOnlyWins += 1;
    else if (wins === 2) {
      aggregate.twoVariantsWin += 1;
      if (recommended && consistency) aggregate.recommendedAndConsistencyWin += 1;
      else if (recommended && specialization) {
        aggregate.recommendedAndSpecializationWin += 1;
      } else {
        aggregate.consistencyAndSpecializationWin += 1;
      }
    }
  }
  return aggregate;
}

function assertThreeProfiles(variants: BenchmarkVariantInput[]): void {
  const profiles = variants.map((variant) => variant.variantProfile);
  if (
    variants.length !== VARIANT_PROFILE_IDS.length ||
    !VARIANT_PROFILE_IDS.every(
      (profile) => profiles.filter((candidate) => candidate === profile).length === 1,
    )
  ) {
    throw new Error(
      "Paired benchmark requires exactly one recommended, consistency, and specialization deck.",
    );
  }
}

function emptyOutcomeMap(): Record<VariantProfile, boolean[]> {
  return {
    recommended: [],
    consistency: [],
    specialization: [],
  };
}

function emptyWinReasons(): Record<WinReason, number> {
  return {
    leader_damage: 0,
    deck_out: 0,
    effect_win: 0,
    score_at_limit: 0,
  };
}

function buildBenchmarkInterpretations(
  relatives: RelativeBenchmarkMetrics[],
  variants: Record<VariantProfile, BenchmarkVariantMetrics>,
): string[] {
  return relatives.map((relative) => {
    const left = variants[relative.leftProfile];
    const right = variants[relative.rightProfile];
    const intervalsOverlap =
      left.heuristicWinRateCi95.lower <= right.heuristicWinRateCi95.upper &&
      right.heuristicWinRateCi95.lower <= left.heuristicWinRateCi95.upper;
    const turnContext =
      Math.abs(relative.firstPlayerDelta) >= Math.abs(relative.secondPlayerDelta)
        ? "先攻時"
        : "後攻時";
    return `${VARIANT_PROFILE_LABELS[relative.leftProfile]}と${VARIANT_PROFILE_LABELS[relative.rightProfile]}の試行内Heuristic win rate差は${formatSignedPoints(relative.winRateDelta)}です。95%区間は${intervalsOverlap ? "重なっており、明確な優劣ではありません" : "重なっていませんが、Practice engine内の結果に限られます"}。${turnContext}の挙動差は${formatSignedPoints(
      Math.abs(relative.firstPlayerDelta) >= Math.abs(relative.secondPlayerDelta)
        ? relative.firstPlayerDelta
        : relative.secondPlayerDelta,
    )}です。`;
  });
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
