import type { CardListItem } from "@/lib/cards";
import {
  BENCHMARK_SEED_STEP,
  BENCHMARK_SERVER_MAX_TURNS,
  BenchmarkDeckValidationError,
  buildPairedBenchmarkSchedule,
  runDeckOnBenchmarkSchedule,
  strictDeckIntelligencePracticeDeck,
  type BenchmarkDeckMetrics,
  type BenchmarkDependencies,
  type BenchmarkOpponentDescriptor,
  type BenchmarkScheduleEntry,
} from "@/lib/deck-battle-benchmark";
import { buildDeckCoachMetrics } from "@/lib/deck-coach-metrics";
import {
  applyDeckCopyEntries,
  DeckCopyResolutionError,
  type DeckCopyEntry,
} from "@/lib/deck-intelligence-compare";
import {
  isVerifiedOfficialCard,
  prepareDeckCandidateRanking,
  rankDeckCandidates,
  resolveDeckPreferences,
  type DeckCandidateScore,
  type FeatureTag,
  type MainStyle,
  type VariantProfile,
} from "@/lib/deck-intelligence-preferences";
import type { DeckRegulations } from "@/lib/deck-rules";
import type { CpuSkill } from "@/lib/practice-log";
import type { PracticeDeck, PracticeDeckEntry } from "@/lib/practice-sim";
import type { RuleSynergy } from "@/lib/synergy-rules";

export const OPTIMIZER_SIZE_OPTIONS = [
  { id: "quick", labelJa: "Quick", games: 100 },
  { id: "standard", labelJa: "Standard", games: 300 },
  { id: "deep", labelJa: "Deep", games: 500 },
] as const;

export type OptimizerGames = (typeof OPTIMIZER_SIZE_OPTIONS)[number]["games"];
export const OPTIMIZER_DEFAULT_GAMES: OptimizerGames = 300;
export const OPTIMIZER_DEFAULT_CANDIDATE_LIMIT = 8;
export const OPTIMIZER_MAX_CANDIDATE_LIMIT = 20;
export const OPTIMIZER_MAX_SIMULATION_BUDGET = 10_500;
export const OPTIMIZER_REPLAY_SAMPLE_SIZE = 1;
export const OPTIMIZER_DISCLAIMER_JA =
  "改善候補はGrand Lineの現在のPractice engineによる比較結果です。公式環境での強さや大会勝率の改善を保証するものではありません。";

export type OptimizerEvidenceStatus =
  | "improvement_signal"
  | "small_difference"
  | "no_improvement";

export interface OptimizerRemovalEvidence {
  cardId: string;
  contributionImpact: number;
  appearances: number;
  uses: number;
  averageTurn: number | null;
  retentionScore: number;
}

export interface OptimizerAdditionEvidence {
  cardId: string;
  rank: number;
  score: DeckCandidateScore;
}

export interface OptimizerPairedOutcomes {
  games: number;
  bothWin: number;
  bothLose: number;
  gainedWins: number;
  lostWins: number;
  netPairedWins: number;
  discordantGames: number;
  /**
   * Signed share of all paired games that flipped in the candidate's favor:
   * (candidate-only wins - baseline-only wins) / total paired games.
   */
  pairedImprovementRate: number;
}

export interface OptimizerBenchmarkDeltas {
  heuristicWinRate: number;
  firstPlayerWinRate: number;
  secondPlayerWinRate: number;
  avgTurns: number;
  averageDonEfficiency: number;
  triggerRevealRate: number;
  triggerSuccessRate: number;
  counterOverflowOnLoss: number;
}

export interface OptimizerStructuralDelta {
  counter2000Plus: number;
  triggerRatio: number;
  highCostCards: number;
  costBands: { low: number; mid: number; high: number };
  evaluationScores: {
    attack: number;
    stability: number;
    expansion: number;
    defense: number;
    meta: number;
    composite: number;
  };
  mechanics: Array<{ mechanic: string; delta: number }>;
}

export interface DeckOptimizerCandidate {
  candidateId: string;
  removeCardId: string;
  addCardId: string;
  swapCount: 1 | 2;
  baselineMetrics: BenchmarkDeckMetrics;
  candidateMetrics: BenchmarkDeckMetrics;
  deltas: OptimizerBenchmarkDeltas;
  pairedOutcomes: OptimizerPairedOutcomes;
  structuralDelta: OptimizerStructuralDelta;
  removalEvidence: OptimizerRemovalEvidence;
  additionEvidence: OptimizerAdditionEvidence;
  evidenceStatus: OptimizerEvidenceStatus;
  reasonJa: string;
  resultingDeck: { cards: DeckCopyEntry[] };
}

export interface DeckOptimizerResult {
  schemaVersion: 1;
  optimizerLabel: "Optimizer candidate / 改善候補";
  disclaimerJa: string;
  baseline: {
    cards: DeckCopyEntry[];
    metrics: BenchmarkDeckMetrics;
  };
  candidates: DeckOptimizerCandidate[];
  schedule: {
    gamesPerDeck: number;
    baseSeed: number;
    seedStep: number;
    cpuSkill: CpuSkill;
    maxTurns: number;
    sample: BenchmarkScheduleEntry[];
    totalSimulations: number;
  };
  opponent: BenchmarkOpponentDescriptor;
  selectedVariant: {
    variantProfile: VariantProfile;
    selectedStyle: MainStyle;
    selectedTags: FeatureTag[];
  };
}

export interface DeckOptimizerInput {
  leader: CardListItem;
  targetCards: DeckCopyEntry[];
  variantProfile: VariantProfile;
  selectedStyle: MainStyle;
  selectedTags: FeatureTag[];
  pool: CardListItem[];
  regulations: DeckRegulations;
  persistedSynergies: RuleSynergy[];
  opponentDeck: PracticeDeck;
  opponent: BenchmarkOpponentDescriptor;
  cpuSkill: CpuSkill;
  maxTurns: number;
  optimizerGames: OptimizerGames;
  candidateLimit: number;
}

export class DeckOptimizerError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_optimizer_request"
      | "unverified_target"
      | "no_legal_candidates",
  ) {
    super(message);
    this.name = "DeckOptimizerError";
  }
}

interface PreparedOptimizerCandidate {
  candidateId: string;
  removeCardId: string;
  addCardId: string;
  swapCount: 1 | 2;
  deck: PracticeDeck;
  cards: DeckCopyEntry[];
  removalEvidence: OptimizerRemovalEvidence;
  additionEvidence: OptimizerAdditionEvidence;
  preRankScore: number;
}

export function runDeckOptimizer(
  input: DeckOptimizerInput,
  dependencies?: BenchmarkDependencies,
): DeckOptimizerResult {
  validateOptimizerBounds(input);
  const poolById = new Map(input.pool.map((card) => [card.id, card]));
  const baselineDeck = strictDeckIntelligencePracticeDeck({
    id: `optimizer:${input.leader.id}:${input.variantProfile}:baseline`,
    name: `${input.leader.name} optimizer baseline`,
    leader: input.leader,
    cards: input.targetCards,
    poolById,
    regulations: input.regulations,
  });
  const unverified = baselineDeck.entries.find(
    (entry) => !isVerifiedOfficialCard(entry.card),
  );
  if (!isVerifiedOfficialCard(input.leader)) {
    throw new DeckOptimizerError(
      `Leader ${input.leader.id} is not a verified official card.`,
      "unverified_target",
    );
  }
  if (unverified) {
    throw new DeckOptimizerError(
      `Target card ${unverified.card.id} is not a verified official card.`,
      "unverified_target",
    );
  }

  const schedule = buildPairedBenchmarkSchedule(input.optimizerGames, {
    cpuSkill: input.cpuSkill,
    maxTurns: input.maxTurns,
  });
  const baselineRun = runDeckOnBenchmarkSchedule(
    {
      deck: baselineDeck,
      opponentDeck: input.opponentDeck,
      schedule,
      replaySampleSize: OPTIMIZER_REPLAY_SAMPLE_SIZE,
    },
    dependencies,
  );
  const selection = resolveDeckPreferences(
    input.selectedStyle,
    input.selectedTags,
  );
  const preparedRanking = prepareDeckCandidateRanking(
    input.leader,
    input.pool,
    selection,
    input.regulations,
    input.persistedSynergies,
  );
  const rankedAdditions = rankDeckCandidates(
    input.leader,
    preparedRanking.analysisPool,
    preparedRanking.effectiveSelection,
    preparedRanking.rankingContext,
    input.variantProfile,
  );
  const removalEvidence = rankRemovalEvidence(baselineDeck, baselineRun.evidence);
  const preparedCandidates = prepareCandidates({
    baselineDeck,
    poolById,
    regulations: input.regulations,
    rankedAdditions,
    removalEvidence,
    candidateLimit: input.candidateLimit,
  });
  if (preparedCandidates.length === 0) {
    throw new DeckOptimizerError(
      "No legal 1-copy or 2-copy optimizer candidates were available.",
      "no_legal_candidates",
    );
  }

  const baselineStructure = structuralSnapshot(input.leader, baselineDeck.entries);
  const repeatedBaselineMetrics = {
    ...baselineRun.metrics,
    replaySamples: [],
  };
  const candidates = preparedCandidates.map((candidate) => {
    const candidateRun = runDeckOnBenchmarkSchedule(
      {
        deck: candidate.deck,
        opponentDeck: input.opponentDeck,
        schedule,
        replaySampleSize: OPTIMIZER_REPLAY_SAMPLE_SIZE,
      },
      dependencies,
    );
    const pairedOutcomes = aggregateOptimizerPairedOutcomes(
      baselineRun.outcomes,
      candidateRun.outcomes,
    );
    const deltas = benchmarkDeltas(
      baselineRun.metrics,
      candidateRun.metrics,
    );
    const structuralDelta = compareStructures(
      baselineStructure,
      structuralSnapshot(input.leader, candidate.deck.entries),
    );
    const evidenceStatus = classifyEvidence(
      pairedOutcomes,
      deltas.heuristicWinRate,
    );
    return {
      candidateId: candidate.candidateId,
      removeCardId: candidate.removeCardId,
      addCardId: candidate.addCardId,
      swapCount: candidate.swapCount,
      baselineMetrics: repeatedBaselineMetrics,
      candidateMetrics: candidateRun.metrics,
      deltas,
      pairedOutcomes,
      structuralDelta,
      removalEvidence: candidate.removalEvidence,
      additionEvidence: candidate.additionEvidence,
      evidenceStatus,
      reasonJa: buildCandidateReason(
        candidate,
        structuralDelta,
        pairedOutcomes,
        input.optimizerGames,
      ),
      resultingDeck: { cards: candidate.cards },
    } satisfies DeckOptimizerCandidate;
  });
  candidates.sort(
    (left, right) =>
      right.pairedOutcomes.netPairedWins -
        left.pairedOutcomes.netPairedWins ||
      right.deltas.heuristicWinRate - left.deltas.heuristicWinRate ||
      right.structuralDelta.evaluationScores.stability -
        left.structuralDelta.evaluationScores.stability ||
      left.candidateId.localeCompare(right.candidateId),
  );

  return {
    schemaVersion: 1,
    optimizerLabel: "Optimizer candidate / 改善候補",
    disclaimerJa: OPTIMIZER_DISCLAIMER_JA,
    baseline: {
      cards: toDeckCopyEntries(baselineDeck.entries),
      metrics: baselineRun.metrics,
    },
    candidates,
    schedule: {
      gamesPerDeck: schedule.length,
      baseSeed: schedule[0].seed,
      seedStep:
        schedule.length > 1
          ? schedule[1].seed - schedule[0].seed
          : BENCHMARK_SEED_STEP,
      cpuSkill: schedule[0].cpuSkill,
      maxTurns: schedule[0].maxTurns,
      sample: schedule.slice(0, 6),
      totalSimulations: (candidates.length + 1) * schedule.length,
    },
    opponent: input.opponent,
    selectedVariant: {
      variantProfile: input.variantProfile,
      selectedStyle: selection.selectedStyle,
      selectedTags: selection.selectedTags,
    },
  };
}

export function aggregateOptimizerPairedOutcomes(
  baselineOutcomes: boolean[],
  candidateOutcomes: boolean[],
): OptimizerPairedOutcomes {
  if (
    baselineOutcomes.length === 0 ||
    baselineOutcomes.length !== candidateOutcomes.length
  ) {
    throw new RangeError(
      "Optimizer paired outcomes require equal, non-empty schedules.",
    );
  }
  let bothWin = 0;
  let bothLose = 0;
  let gainedWins = 0;
  let lostWins = 0;
  for (let index = 0; index < baselineOutcomes.length; index++) {
    const baseline = baselineOutcomes[index];
    const candidate = candidateOutcomes[index];
    if (baseline && candidate) bothWin += 1;
    else if (!baseline && !candidate) bothLose += 1;
    else if (!baseline && candidate) gainedWins += 1;
    else lostWins += 1;
  }
  const netPairedWins = gainedWins - lostWins;
  return {
    games: baselineOutcomes.length,
    bothWin,
    bothLose,
    gainedWins,
    lostWins,
    netPairedWins,
    discordantGames: gainedWins + lostWins,
    pairedImprovementRate: round6(netPairedWins / baselineOutcomes.length),
  };
}

export function applyOptimizerCandidate<T>(
  candidate: Pick<DeckOptimizerCandidate, "resultingDeck">,
  poolById: ReadonlyMap<string, T>,
  replace: (entries: Array<{ card: T; count: number }>) => void,
): void {
  applyDeckCopyEntries(candidate.resultingDeck.cards, poolById, replace);
}

function validateOptimizerBounds(input: DeckOptimizerInput): void {
  if (!OPTIMIZER_SIZE_OPTIONS.some((option) => option.games === input.optimizerGames)) {
    throw new DeckOptimizerError(
      `Unsupported optimizer game count: ${input.optimizerGames}.`,
      "invalid_optimizer_request",
    );
  }
  if (
    !Number.isInteger(input.candidateLimit) ||
    input.candidateLimit < 1 ||
    input.candidateLimit > OPTIMIZER_MAX_CANDIDATE_LIMIT
  ) {
    throw new DeckOptimizerError(
      `candidateLimit must be between 1 and ${OPTIMIZER_MAX_CANDIDATE_LIMIT}.`,
      "invalid_optimizer_request",
    );
  }
  if (
    !Number.isInteger(input.maxTurns) ||
    input.maxTurns < 1 ||
    input.maxTurns > BENCHMARK_SERVER_MAX_TURNS
  ) {
    throw new DeckOptimizerError(
      `maxTurns must be between 1 and ${BENCHMARK_SERVER_MAX_TURNS}.`,
      "invalid_optimizer_request",
    );
  }
  const requestedBudget =
    (input.candidateLimit + 1) * input.optimizerGames;
  if (requestedBudget > OPTIMIZER_MAX_SIMULATION_BUDGET) {
    throw new DeckOptimizerError(
      `Optimizer simulation budget ${requestedBudget} exceeds ${OPTIMIZER_MAX_SIMULATION_BUDGET}.`,
      "invalid_optimizer_request",
    );
  }
}

function rankRemovalEvidence(
  deck: PracticeDeck,
  evidence: ReturnType<typeof runDeckOnBenchmarkSchedule>["evidence"],
): OptimizerRemovalEvidence[] {
  const contributions = new Map(
    evidence.playerContributions.map((item) => [item.cardId, item]),
  );
  const timings = new Map(evidence.cardTiming.map((item) => [item.cardId, item]));
  const leaderFeatures = new Set(deck.leader.features);
  return deck.entries
    .map((entry) => {
      const contribution = contributions.get(entry.card.id);
      const timing = timings.get(entry.card.id);
      const sharedFeatures = entry.card.features.filter((feature) =>
        leaderFeatures.has(feature),
      ).length;
      const structuralRoles = entry.card.mechanics.filter((mechanic) =>
        ["Search", "Look", "Blocker", "Rush", "OnPlay"].includes(mechanic),
      ).length;
      const contributionImpact = contribution?.impact ?? 0;
      const appearances = contribution?.appearances ?? 0;
      const uses = timing?.uses ?? 0;
      return {
        cardId: entry.card.id,
        contributionImpact,
        appearances,
        uses,
        averageTurn: timing?.averageTurn ?? null,
        retentionScore: round6(
          contributionImpact * 3 +
            appearances * 1.5 +
            uses * 2 +
            sharedFeatures * 4 +
            structuralRoles * 2,
        ),
      };
    })
    .sort(
      (left, right) =>
        left.retentionScore - right.retentionScore ||
        left.contributionImpact - right.contributionImpact ||
        left.uses - right.uses ||
        left.cardId.localeCompare(right.cardId),
    );
}

function prepareCandidates({
  baselineDeck,
  poolById,
  regulations,
  rankedAdditions,
  removalEvidence,
  candidateLimit,
}: {
  baselineDeck: PracticeDeck;
  poolById: ReadonlyMap<string, CardListItem>;
  regulations: DeckRegulations;
  rankedAdditions: ReturnType<typeof rankDeckCandidates>;
  removalEvidence: OptimizerRemovalEvidence[];
  candidateLimit: number;
}): PreparedOptimizerCandidate[] {
  const baselineCounts = new Map(
    baselineDeck.entries.map((entry) => [entry.card.id, entry.count]),
  );
  const additions = rankedAdditions.slice(
    0,
    Math.min(rankedAdditions.length, Math.max(16, candidateLimit * 4)),
  );
  const removals = removalEvidence.slice(0, 12);
  const prepared: PreparedOptimizerCandidate[] = [];

  for (const removal of removals) {
    const removeCount = baselineCounts.get(removal.cardId) ?? 0;
    for (let additionIndex = 0; additionIndex < additions.length; additionIndex++) {
      const addition = additions[additionIndex];
      if (addition.card.id === removal.cardId) continue;
      const currentAddCount = baselineCounts.get(addition.card.id) ?? 0;
      const activeMax = Math.min(
        4,
        regulations.perCardMax?.get(addition.card.id) ?? 4,
      );
      for (const swapCount of [1, 2] as const) {
        if (
          removeCount < swapCount ||
          activeMax - currentAddCount < swapCount
        ) {
          continue;
        }
        const cards = swapDeckCards(
          baselineDeck.entries,
          removal.cardId,
          addition.card.id,
          swapCount,
        );
        let deck: PracticeDeck;
        try {
          deck = strictDeckIntelligencePracticeDeck({
            id: `${baselineDeck.id}:${removal.cardId}:${addition.card.id}:x${swapCount}`,
            name: `${baselineDeck.name} optimizer candidate`,
            leader: baselineDeck.leader,
            cards,
            poolById,
            regulations,
            source: "generated",
          });
        } catch (error) {
          if (
            error instanceof BenchmarkDeckValidationError ||
            error instanceof DeckCopyResolutionError
          ) {
            continue;
          }
          throw error;
        }
        prepared.push({
          candidateId: `${removal.cardId}->${addition.card.id}:x${swapCount}`,
          removeCardId: removal.cardId,
          addCardId: addition.card.id,
          swapCount,
          deck,
          cards: toDeckCopyEntries(deck.entries),
          removalEvidence: removal,
          additionEvidence: {
            cardId: addition.card.id,
            rank: additionIndex + 1,
            score: addition.score,
          },
          preRankScore: round6(
            addition.score.total * 100 - removal.retentionScore * 10 + swapCount,
          ),
        });
      }
    }
  }
  prepared.sort(
    (left, right) =>
      right.preRankScore - left.preRankScore ||
      right.additionEvidence.score.total - left.additionEvidence.score.total ||
      left.removalEvidence.retentionScore -
        right.removalEvidence.retentionScore ||
      left.candidateId.localeCompare(right.candidateId),
  );

  const bySwapCount = {
    1: prepared.filter((candidate) => candidate.swapCount === 1),
    2: prepared.filter((candidate) => candidate.swapCount === 2),
  };
  const selected: PreparedOptimizerCandidate[] = [];
  for (let index = 0; selected.length < candidateLimit; index++) {
    let added = false;
    for (const swapCount of [1, 2] as const) {
      const candidate = bySwapCount[swapCount][index];
      if (!candidate || selected.length >= candidateLimit) continue;
      selected.push(candidate);
      added = true;
    }
    if (!added) break;
  }
  return selected;
}

function swapDeckCards(
  entries: PracticeDeckEntry[],
  removeCardId: string,
  addCardId: string,
  swapCount: 1 | 2,
): DeckCopyEntry[] {
  const counts = new Map(entries.map((entry) => [entry.card.id, entry.count]));
  counts.set(removeCardId, (counts.get(removeCardId) ?? 0) - swapCount);
  counts.set(addCardId, (counts.get(addCardId) ?? 0) + swapCount);
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([cardId, count]) => ({ cardId, count }))
    .sort((left, right) => left.cardId.localeCompare(right.cardId));
}

interface StructuralSnapshot {
  counter2000Plus: number;
  triggerRatio: number;
  highCostCards: number;
  costBands: { low: number; mid: number; high: number };
  evaluationScores: OptimizerStructuralDelta["evaluationScores"];
  mechanics: Map<string, number>;
}

function structuralSnapshot(
  leader: CardListItem,
  entries: PracticeDeckEntry[],
): StructuralSnapshot {
  const metrics = buildDeckCoachMetrics(leader, entries);
  const costBands = { low: 0, mid: 0, high: 0 };
  let highCostCards = 0;
  for (const entry of entries) {
    const cost = entry.card.cost ?? 0;
    if (cost <= 3) costBands.low += entry.count;
    else if (cost <= 6) costBands.mid += entry.count;
    else costBands.high += entry.count;
    if (cost >= 7) highCostCards += entry.count;
  }
  return {
    counter2000Plus:
      (metrics.counterDistribution["2000"] ?? 0) +
      (metrics.counterDistribution.other ?? 0),
    triggerRatio: metrics.trigger.ratio,
    highCostCards,
    costBands,
    evaluationScores: {
      attack: metrics.evaluation.attack.score,
      stability: metrics.evaluation.stability.score,
      expansion: metrics.evaluation.expansion.score,
      defense: metrics.evaluation.defense.score,
      meta: metrics.evaluation.meta.score,
      composite: metrics.evaluation.composite,
    },
    mechanics: entries.reduce((counts, entry) => {
      for (const mechanic of entry.card.mechanics) {
        counts.set(mechanic, (counts.get(mechanic) ?? 0) + entry.count);
      }
      return counts;
    }, new Map<string, number>()),
  };
}

function compareStructures(
  baseline: StructuralSnapshot,
  candidate: StructuralSnapshot,
): OptimizerStructuralDelta {
  const mechanicIds = new Set([
    ...baseline.mechanics.keys(),
    ...candidate.mechanics.keys(),
  ]);
  return {
    counter2000Plus: candidate.counter2000Plus - baseline.counter2000Plus,
    triggerRatio: round6(candidate.triggerRatio - baseline.triggerRatio),
    highCostCards: candidate.highCostCards - baseline.highCostCards,
    costBands: {
      low: candidate.costBands.low - baseline.costBands.low,
      mid: candidate.costBands.mid - baseline.costBands.mid,
      high: candidate.costBands.high - baseline.costBands.high,
    },
    evaluationScores: {
      attack:
        candidate.evaluationScores.attack - baseline.evaluationScores.attack,
      stability:
        candidate.evaluationScores.stability -
        baseline.evaluationScores.stability,
      expansion:
        candidate.evaluationScores.expansion -
        baseline.evaluationScores.expansion,
      defense:
        candidate.evaluationScores.defense - baseline.evaluationScores.defense,
      meta: candidate.evaluationScores.meta - baseline.evaluationScores.meta,
      composite: round6(
        candidate.evaluationScores.composite -
          baseline.evaluationScores.composite,
      ),
    },
    mechanics: [...mechanicIds]
      .map((mechanic) => ({
        mechanic,
        delta:
          (candidate.mechanics.get(mechanic) ?? 0) -
          (baseline.mechanics.get(mechanic) ?? 0),
      }))
      .filter((item) => item.delta !== 0)
      .sort(
        (left, right) =>
          Math.abs(right.delta) - Math.abs(left.delta) ||
          left.mechanic.localeCompare(right.mechanic),
      ),
  };
}

function benchmarkDeltas(
  baseline: BenchmarkDeckMetrics,
  candidate: BenchmarkDeckMetrics,
): OptimizerBenchmarkDeltas {
  return {
    heuristicWinRate: round6(
      candidate.heuristicWinRate - baseline.heuristicWinRate,
    ),
    firstPlayerWinRate: round6(
      candidate.firstPlayerWinRate - baseline.firstPlayerWinRate,
    ),
    secondPlayerWinRate: round6(
      candidate.secondPlayerWinRate - baseline.secondPlayerWinRate,
    ),
    avgTurns: round6(candidate.avgTurns - baseline.avgTurns),
    averageDonEfficiency: round6(
      candidate.averageDonEfficiency - baseline.averageDonEfficiency,
    ),
    triggerRevealRate: round6(
      candidate.triggerRevealRate - baseline.triggerRevealRate,
    ),
    triggerSuccessRate: round6(
      candidate.triggerSuccessRate - baseline.triggerSuccessRate,
    ),
    counterOverflowOnLoss: round6(
      candidate.counterOverflowOnLoss - baseline.counterOverflowOnLoss,
    ),
  };
}

function classifyEvidence(
  paired: OptimizerPairedOutcomes,
  heuristicWinRateDelta: number,
): OptimizerEvidenceStatus {
  const materialFlip = Math.max(2, Math.ceil(paired.games * 0.01));
  if (
    paired.netPairedWins >= materialFlip &&
    heuristicWinRateDelta > 0
  ) {
    return "improvement_signal";
  }
  if (Math.abs(paired.netPairedWins) < materialFlip) {
    return "small_difference";
  }
  return "no_improvement";
}

function buildCandidateReason(
  candidate: PreparedOptimizerCandidate,
  structure: OptimizerStructuralDelta,
  paired: OptimizerPairedOutcomes,
  games: number,
): string {
  const score = candidate.additionEvidence.score;
  const structural = describeStructuralDelta(structure);
  const averageTurn =
    candidate.removalEvidence.averageTurn === null
      ? "記録なし"
      : candidate.removalEvidence.averageTurn.toFixed(1);
  return `${candidate.removeCardId}を${candidate.swapCount}枚減らし、${candidate.addCardId}を${candidate.swapCount}枚追加。OUTはcontribution impact ${candidate.removalEvidence.contributionImpact.toFixed(1)}・appearance ${candidate.removalEvidence.appearances}・use ${candidate.removalEvidence.uses}・average turn ${averageTurn}から改善余地を検証する枠として抽出しました（使われなかったことだけで弱いとは断定しません）。INは既存rankingでLeader適性${score.leaderAffinity}、Main Style${score.mainStyle}、Feature Tags${score.featureTags}、relationship${score.relationships}。${structural}${games}回の同一schedule比較ではcandidate-only win ${paired.gainedWins}回、baseline-only win ${paired.lostWins}回でした。`;
}

function describeStructuralDelta(delta: OptimizerStructuralDelta): string {
  const parts: string[] = [];
  if (delta.counter2000Plus !== 0) {
    parts.push(`2000+ counter ${signed(delta.counter2000Plus)}枚`);
  }
  if (delta.triggerRatio !== 0) {
    parts.push(`trigger ratio ${signedPoints(delta.triggerRatio)}`);
  }
  if (delta.highCostCards !== 0) {
    parts.push(`high-cost ${signed(delta.highCostCards)}枚`);
  }
  for (const mechanic of delta.mechanics.slice(0, 2)) {
    parts.push(`${mechanic} ${signed(mechanic.delta)}枚`);
  }
  return parts.length > 0
    ? `構造差は${parts.join("、")}。`
    : "主要な構造指標の差は小さめです。";
}

function toDeckCopyEntries(entries: PracticeDeckEntry[]): DeckCopyEntry[] {
  return entries
    .map((entry) => ({ cardId: entry.card.id, count: entry.count }))
    .sort((left, right) => left.cardId.localeCompare(right.cardId));
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

function signedPoints(value: number): string {
  const points = Math.round(value * 10_000) / 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}pt`;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
