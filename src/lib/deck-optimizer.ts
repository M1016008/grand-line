import type { CardListItem } from "@/lib/cards";
import {
  BENCHMARK_SERVER_MAX_TURNS,
  BenchmarkDeckValidationError,
  buildPairedBenchmarkSchedule,
  strictDeckIntelligencePracticeDeck,
  type BenchmarkOpponentDescriptor,
  type BenchmarkScheduleEntry,
} from "@/lib/deck-battle-benchmark";
import type { BattleTraceEvent } from "@/lib/battle-engine/battle-trace";
import { calculateDeckCoverage, type DeckEffectCoverage } from "@/lib/battle-engine/coverage";
import { BattleEffectRegistry } from "@/lib/battle-engine/effect-registry";
import type { EffectCoverageStatus } from "@/lib/battle-engine/effects";
import {
  runHeadlessBattle,
  type HeadlessBattleEnvironment,
} from "@/lib/battle-engine/headless-runner";
import {
  runRulesDeckOnBenchmarkSchedule,
  type RulesBenchmarkDeckMetrics,
  type RulesBenchmarkDependencies,
  type RulesScheduledOutcome,
} from "@/lib/deck-rules-benchmark";
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
export const OPTIMIZER_DISCLAIMER_JA =
  "改善候補はGrand Line Rules Kernelで現在再現可能なverified officialカード効果の範囲内で、baselineと候補を同一scheduleで比較した結果です。partial / unsupported効果は推測実行していません。大会環境での強さ・勝率・最適構築を保証するものではありません。";

export type OptimizerEvidenceStatus =
  | "improvement_signal"
  | "small_difference"
  | "no_improvement"
  | "insufficient_evidence";

export interface OptimizerCardObservation {
  cardId: string;
  plays: number;
  attacks: number;
  counters: number;
  triggerChoices: number;
  triggerActivations: number;
  searches: number;
  effectTargets: number;
  observedActions: number;
  averageObservedTurn: number | null;
}

export interface OptimizerRemovalEvidence {
  cardId: string;
  observation: OptimizerCardObservation;
  structuralRoleScore: number;
  sharedLeaderFeatures: number;
  coverageStatus: EffectCoverageStatus;
  retentionScore: number;
}

export interface OptimizerAdditionEvidence {
  cardId: string;
  rank: number;
  score: DeckCandidateScore;
}

export interface OptimizerPairedOutcomes {
  games: number;
  bothResolved: number;
  excludedByInconclusive: number;
  bothWin: number;
  bothLose: number;
  candidateOnlyWins: number;
  baselineOnlyWins: number;
  netResolvedWins: number;
  discordantResolvedGames: number;
  netResolvedWinShare: number | null;
}

export interface OptimizerRulesDeltas {
  resolvedWinRate: number | null;
  resolutionRate: number;
  firstPlayerResolvedWinRate: number | null;
  secondPlayerResolvedWinRate: number | null;
  averageResolvedTurns: number | null;
  attacksPerGame: number;
  blockersPerGame: number;
  counterCardsPerGame: number;
  triggerActivationsPerGame: number;
  supportedEffectsPerGame: number;
}

export interface OptimizerCoverageDelta {
  supportedCards: number;
  partialCards: number;
  unsupportedCards: number;
  supportedRatio: number;
  baselineComplete: boolean;
  candidateComplete: boolean;
  baselineLeaderStatus: EffectCoverageStatus;
  candidateLeaderStatus: EffectCoverageStatus;
  worsened: boolean;
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
  baselineMetrics: RulesBenchmarkDeckMetrics;
  candidateMetrics: RulesBenchmarkDeckMetrics;
  deltas: OptimizerRulesDeltas;
  coverageDelta: OptimizerCoverageDelta;
  pairedOutcomes: OptimizerPairedOutcomes;
  structuralDelta: OptimizerStructuralDelta;
  removalEvidence: OptimizerRemovalEvidence;
  additionEvidence: OptimizerAdditionEvidence;
  evidenceStatus: OptimizerEvidenceStatus;
  reasonJa: string;
  resultingDeck: { cards: DeckCopyEntry[] };
}

export interface DeckOptimizerResult {
  schemaVersion: 2;
  optimizerLabel: "Rules Kernel Optimizer v2";
  disclaimerJa: string;
  baseline: {
    cards: DeckCopyEntry[];
    metrics: RulesBenchmarkDeckMetrics;
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
  opponentCoverage: DeckEffectCoverage;
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
  baseSeed: number;
  seedStep: number;
  cpuSkill: CpuSkill;
  maxTurns: number;
  optimizerGames: OptimizerGames;
  candidateLimit: number;
}

export type OptimizerRulesDependencies = RulesBenchmarkDependencies;

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
  dependencies: OptimizerRulesDependencies = {
    run: runHeadlessBattle,
    buildRegistry: (cards) => new BattleEffectRegistry(cards),
  },
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
    baseSeed: input.baseSeed,
    seedStep: input.seedStep,
    cpuSkill: input.cpuSkill,
    maxTurns: input.maxTurns,
  });
  const registry = dependencies.buildRegistry(input.pool);
  const opponentCoverage = calculateDeckCoverage(input.opponentDeck, registry);
  const baselineCoverage = calculateDeckCoverage(baselineDeck, registry);
  const baselineEnvironment = buildOptimizerEnvironment(
    registry,
    baselineCoverage,
    opponentCoverage,
  );
  const observationCollector = createOptimizerCardObservationCollector(
    baselineDeck.entries.map((entry) => entry.card.id),
  );
  const baselineRun = runRulesDeckOnBenchmarkSchedule(
    {
      deck: baselineDeck,
      opponentDeck: input.opponentDeck,
      cards: input.pool,
      schedule,
      environment: baselineEnvironment,
      replaySampleSize: 0,
      traceMode: "compact",
      onResult: (result) => observationCollector.observe(result.trace ?? []),
    },
    dependencies.run,
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
  const removalEvidence = rankRemovalEvidence(
    baselineDeck,
    observationCollector.finish(),
    baselineCoverage,
  );
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
  const preparedById = new Map(
    preparedCandidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const candidates = preparedCandidates.map((candidate) => {
    const candidateCoverage = calculateDeckCoverage(candidate.deck, registry);
    const candidateRun = runRulesDeckOnBenchmarkSchedule(
      {
        deck: candidate.deck,
        opponentDeck: input.opponentDeck,
        cards: input.pool,
        schedule,
        environment: buildOptimizerEnvironment(
          registry,
          candidateCoverage,
          opponentCoverage,
        ),
        replaySampleSize: 0,
        traceMode: "none",
      },
      dependencies.run,
    );
    const pairedOutcomes = aggregateOptimizerPairedOutcomes(
      baselineRun.outcomes,
      candidateRun.outcomes,
    );
    const deltas = rulesBenchmarkDeltas(
      baselineRun.metrics,
      candidateRun.metrics,
    );
    const coverageDelta = compareCoverage(baselineCoverage, candidateCoverage);
    const structuralDelta = compareStructures(
      baselineStructure,
      structuralSnapshot(input.leader, candidate.deck.entries),
    );
    const evidenceStatus = classifyOptimizerEvidence(
      pairedOutcomes,
      deltas,
      coverageDelta,
      baselineRun.metrics,
      candidateRun.metrics,
    );
    return {
      candidateId: candidate.candidateId,
      removeCardId: candidate.removeCardId,
      addCardId: candidate.addCardId,
      swapCount: candidate.swapCount,
      baselineMetrics: baselineRun.metrics,
      candidateMetrics: candidateRun.metrics,
      deltas,
      coverageDelta,
      pairedOutcomes,
      structuralDelta,
      removalEvidence: candidate.removalEvidence,
      additionEvidence: candidate.additionEvidence,
      evidenceStatus,
      reasonJa: buildCandidateReason(
        candidate,
        structuralDelta,
        pairedOutcomes,
        coverageDelta,
      ),
      resultingDeck: { cards: candidate.cards },
    } satisfies DeckOptimizerCandidate;
  });
  candidates.sort(
    (left, right) =>
      evidencePriority(left.evidenceStatus) - evidencePriority(right.evidenceStatus) ||
      right.pairedOutcomes.netResolvedWins - left.pairedOutcomes.netResolvedWins ||
      compareNullableDescending(
        left.deltas.resolvedWinRate,
        right.deltas.resolvedWinRate,
      ) ||
      right.deltas.resolutionRate - left.deltas.resolutionRate ||
      (preparedById.get(right.candidateId)?.preRankScore ?? 0) -
        (preparedById.get(left.candidateId)?.preRankScore ?? 0) ||
      left.candidateId.localeCompare(right.candidateId),
  );

  return {
    schemaVersion: 2,
    optimizerLabel: "Rules Kernel Optimizer v2",
    disclaimerJa: OPTIMIZER_DISCLAIMER_JA,
    baseline: {
      cards: toDeckCopyEntries(baselineDeck.entries),
      metrics: baselineRun.metrics,
    },
    candidates,
    schedule: {
      gamesPerDeck: schedule.length,
      baseSeed: schedule[0].seed,
      seedStep: input.seedStep,
      cpuSkill: schedule[0].cpuSkill,
      maxTurns: schedule[0].maxTurns,
      sample: schedule.slice(0, 6),
      totalSimulations: (candidates.length + 1) * schedule.length,
    },
    opponent: input.opponent,
    opponentCoverage,
    selectedVariant: {
      variantProfile: input.variantProfile,
      selectedStyle: selection.selectedStyle,
      selectedTags: selection.selectedTags,
    },
  };
}

export function aggregateOptimizerPairedOutcomes(
  baselineOutcomes: RulesScheduledOutcome[],
  candidateOutcomes: RulesScheduledOutcome[],
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
  let bothResolved = 0;
  let excludedByInconclusive = 0;
  let candidateOnlyWins = 0;
  let baselineOnlyWins = 0;
  for (let index = 0; index < baselineOutcomes.length; index++) {
    const baseline = baselineOutcomes[index];
    const candidate = candidateOutcomes[index];
    if (baseline === "inconclusive" || candidate === "inconclusive") {
      excludedByInconclusive += 1;
      continue;
    }
    bothResolved += 1;
    if (baseline === "win" && candidate === "win") bothWin += 1;
    else if (baseline === "loss" && candidate === "loss") bothLose += 1;
    else if (baseline === "loss" && candidate === "win") {
      candidateOnlyWins += 1;
    } else {
      baselineOnlyWins += 1;
    }
  }
  const netResolvedWins = candidateOnlyWins - baselineOnlyWins;
  return {
    games: baselineOutcomes.length,
    bothResolved,
    excludedByInconclusive,
    bothWin,
    bothLose,
    candidateOnlyWins,
    baselineOnlyWins,
    netResolvedWins,
    discordantResolvedGames: candidateOnlyWins + baselineOnlyWins,
    netResolvedWinShare:
      bothResolved > 0 ? round6(netResolvedWins / bothResolved) : null,
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
  if (!Number.isInteger(input.baseSeed)) {
    throw new DeckOptimizerError(
      "baseSeed must be an integer.",
      "invalid_optimizer_request",
    );
  }
  if (!Number.isInteger(input.seedStep) || input.seedStep < 1) {
    throw new DeckOptimizerError(
      "seedStep must be a positive integer.",
      "invalid_optimizer_request",
    );
  }
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

export function createOptimizerCardObservationCollector(
  cardIds: string[],
): {
  observe: (events: readonly BattleTraceEvent[]) => void;
  finish: () => OptimizerCardObservation[];
} {
  const accumulators = new Map(
    [...new Set(cardIds)].sort().map((cardId) => [
      cardId,
      {
        cardId,
        plays: 0,
        attacks: 0,
        counters: 0,
        triggerChoices: 0,
        triggerActivations: 0,
        searches: 0,
        effectTargets: 0,
        observedActions: 0,
        observedTurnTotal: 0,
      },
    ]),
  );
  return {
    observe(events) {
      for (const event of events) {
        if (event.actor !== "player" || !event.cardId) continue;
        const accumulator = accumulators.get(event.cardId);
        if (!accumulator || !OBSERVED_EVENT_TYPES.has(event.type)) continue;
        if (event.type === "play_card") accumulator.plays += 1;
        else if (event.type === "attack_declared") accumulator.attacks += 1;
        else if (event.type === "counter_used") accumulator.counters += 1;
        else if (event.type === "trigger_choice") {
          accumulator.triggerChoices += 1;
          if (event.details?.activated === true) {
            accumulator.triggerActivations += 1;
          }
        } else if (event.type === "search_choice") accumulator.searches += 1;
        else if (event.type === "effect_target") accumulator.effectTargets += 1;
        accumulator.observedActions += 1;
        accumulator.observedTurnTotal += event.turn;
      }
    },
    finish() {
      return [...accumulators.values()].map(
        ({ observedTurnTotal, ...observation }) => ({
          ...observation,
          averageObservedTurn:
            observation.observedActions > 0
              ? round6(observedTurnTotal / observation.observedActions)
              : null,
        }),
      );
    },
  };
}

const OBSERVED_EVENT_TYPES = new Set<BattleTraceEvent["type"]>([
  "play_card",
  "attack_declared",
  "counter_used",
  "trigger_choice",
  "search_choice",
  "effect_target",
]);

function buildOptimizerEnvironment(
  registry: BattleEffectRegistry,
  playerCoverage: DeckEffectCoverage,
  opponentCoverage: DeckEffectCoverage,
): HeadlessBattleEnvironment {
  return Object.freeze({ registry, playerCoverage, opponentCoverage });
}

function rankRemovalEvidence(
  deck: PracticeDeck,
  observations: OptimizerCardObservation[],
  coverage: DeckEffectCoverage,
): OptimizerRemovalEvidence[] {
  const observationById = new Map(
    observations.map((observation) => [observation.cardId, observation]),
  );
  const coverageById = new Map(
    coverage.entries.map((entry) => [entry.cardId, entry.status]),
  );
  const leaderFeatures = new Set(deck.leader.features);
  return deck.entries
    .map((entry) => {
      const observation = observationById.get(entry.card.id) ??
        emptyCardObservation(entry.card.id);
      const sharedLeaderFeatures = entry.card.features.filter((feature) =>
        leaderFeatures.has(feature),
      ).length;
      const structuralRoleScore = entry.card.mechanics.filter((mechanic) =>
        ["Search", "Look", "Blocker", "Rush", "OnPlay"].includes(mechanic),
      ).length * 2;
      return {
        cardId: entry.card.id,
        observation,
        structuralRoleScore,
        sharedLeaderFeatures,
        coverageStatus: coverageById.get(entry.card.id) ?? "unsupported",
        retentionScore: round6(
          observation.observedActions * 2 +
            sharedLeaderFeatures * 4 +
            structuralRoleScore,
        ),
      };
    })
    .sort(
      (left, right) =>
        left.retentionScore - right.retentionScore ||
        left.observation.observedActions - right.observation.observedActions ||
        left.cardId.localeCompare(right.cardId),
    );
}

function emptyCardObservation(cardId: string): OptimizerCardObservation {
  return {
    cardId,
    plays: 0,
    attacks: 0,
    counters: 0,
    triggerChoices: 0,
    triggerActivations: 0,
    searches: 0,
    effectTargets: 0,
    observedActions: 0,
    averageObservedTurn: null,
  };
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

export function rulesBenchmarkDeltas(
  baseline: RulesBenchmarkDeckMetrics,
  candidate: RulesBenchmarkDeckMetrics,
): OptimizerRulesDeltas {
  return {
    resolvedWinRate: subtractNullable(
      candidate.resolvedWinRate,
      baseline.resolvedWinRate,
    ),
    resolutionRate: round6(candidate.resolutionRate - baseline.resolutionRate),
    firstPlayerResolvedWinRate: subtractNullable(
      candidate.firstPlayer.resolvedWinRate,
      baseline.firstPlayer.resolvedWinRate,
    ),
    secondPlayerResolvedWinRate: subtractNullable(
      candidate.secondPlayer.resolvedWinRate,
      baseline.secondPlayer.resolvedWinRate,
    ),
    averageResolvedTurns: subtractNullable(
      candidate.averageResolvedTurns,
      baseline.averageResolvedTurns,
    ),
    attacksPerGame: perGameDelta(
      baseline.rulesStats.attacksDeclared,
      baseline.games,
      candidate.rulesStats.attacksDeclared,
      candidate.games,
    ),
    blockersPerGame: perGameDelta(
      baseline.rulesStats.blockersUsed,
      baseline.games,
      candidate.rulesStats.blockersUsed,
      candidate.games,
    ),
    counterCardsPerGame: perGameDelta(
      baseline.rulesStats.counterCardsUsed,
      baseline.games,
      candidate.rulesStats.counterCardsUsed,
      candidate.games,
    ),
    triggerActivationsPerGame: perGameDelta(
      baseline.rulesStats.triggersActivated,
      baseline.games,
      candidate.rulesStats.triggersActivated,
      candidate.games,
    ),
    supportedEffectsPerGame: perGameDelta(
      baseline.rulesStats.supportedEffectsResolved,
      baseline.games,
      candidate.rulesStats.supportedEffectsResolved,
      candidate.games,
    ),
  };
}

export function compareCoverage(
  baseline: DeckEffectCoverage,
  candidate: DeckEffectCoverage,
): OptimizerCoverageDelta {
  const supportedCards = candidate.supportedCards - baseline.supportedCards;
  const partialCards = candidate.partialCards - baseline.partialCards;
  const unsupportedCards = candidate.unsupportedCards - baseline.unsupportedCards;
  return {
    supportedCards,
    partialCards,
    unsupportedCards,
    supportedRatio: round6(candidate.supportedRatio - baseline.supportedRatio),
    baselineComplete: baseline.complete,
    candidateComplete: candidate.complete,
    baselineLeaderStatus: baseline.leaderStatus,
    candidateLeaderStatus: candidate.leaderStatus,
    worsened:
      supportedCards < 0 || partialCards > 0 || unsupportedCards > 0,
  };
}

export function classifyOptimizerEvidence(
  paired: OptimizerPairedOutcomes,
  deltas: OptimizerRulesDeltas,
  coverage: OptimizerCoverageDelta,
  baseline: Pick<RulesBenchmarkDeckMetrics, "outcomes" | "resolvedWinRate">,
  candidate: Pick<RulesBenchmarkDeckMetrics, "outcomes" | "resolvedWinRate">,
): OptimizerEvidenceStatus {
  const minimumResolvedPairs = Math.max(20, Math.ceil(paired.games * 0.4));
  if (
    paired.bothResolved < minimumResolvedPairs ||
    baseline.outcomes.engineGuard > 0 ||
    candidate.outcomes.engineGuard > 0 ||
    baseline.resolvedWinRate === null ||
    candidate.resolvedWinRate === null ||
    deltas.resolvedWinRate === null ||
    coverage.worsened
  ) {
    return "insufficient_evidence";
  }
  const materialFlip = Math.max(2, Math.ceil(paired.bothResolved * 0.01));
  if (
    paired.candidateOnlyWins > paired.baselineOnlyWins &&
    paired.netResolvedWins >= materialFlip &&
    deltas.resolvedWinRate > 0 &&
    deltas.resolutionRate >= -0.05
  ) {
    return "improvement_signal";
  }
  if (Math.abs(paired.netResolvedWins) < materialFlip) {
    return "small_difference";
  }
  return "no_improvement";
}

function buildCandidateReason(
  candidate: PreparedOptimizerCandidate,
  structure: OptimizerStructuralDelta,
  paired: OptimizerPairedOutcomes,
  coverage: OptimizerCoverageDelta,
): string {
  const score = candidate.additionEvidence.score;
  const structural = describeStructuralDelta(structure);
  const observation = candidate.removalEvidence.observation;
  const averageTurn =
    observation.averageObservedTurn === null
      ? "記録なし"
      : observation.averageObservedTurn.toFixed(1);
  const coverageWarning = coverage.worsened
    ? "入替後はRules Kernel coverageが低下するため、この差を改善シグナルとして扱っていません。"
    : "入替後のRules Kernel coverageはbaselineから悪化していません。";
  return `${candidate.removeCardId}を${candidate.swapCount}枚減らし、${candidate.addCardId}を${candidate.swapCount}枚追加。OUT候補はRules Kernel自動対戦でplay ${observation.plays}回、attack ${observation.attacks}回、counter ${observation.counters}回、その他を含む計${observation.observedActions}回（平均turn ${averageTurn}）観測されました。この観測はカード自体の強弱を示すものではありません。IN候補は既存のdeterministic rankingでLeader適性${score.leaderAffinity}、Main Style${score.mainStyle}、Feature Tags${score.featureTags}、relationship${score.relationships}から候補化しています。${structural}同一seedで両方決着した${paired.bothResolved}試合では、候補のみ勝利${paired.candidateOnlyWins}回、baselineのみ勝利${paired.baselineOnlyWins}回。未決着を含む${paired.excludedByInconclusive}試合はpaired勝敗比較から除外しています。${coverageWarning}`;
}

function subtractNullable(
  candidate: number | null,
  baseline: number | null,
): number | null {
  return candidate === null || baseline === null
    ? null
    : round6(candidate - baseline);
}

function perGameDelta(
  baselineTotal: number,
  baselineGames: number,
  candidateTotal: number,
  candidateGames: number,
): number {
  return round6(
    (candidateGames > 0 ? candidateTotal / candidateGames : 0) -
      (baselineGames > 0 ? baselineTotal / baselineGames : 0),
  );
}

function evidencePriority(status: OptimizerEvidenceStatus): number {
  return {
    improvement_signal: 0,
    small_difference: 1,
    no_improvement: 2,
    insufficient_evidence: 3,
  }[status];
}

function compareNullableDescending(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
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
