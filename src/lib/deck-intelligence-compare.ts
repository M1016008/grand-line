import type { VariantProfile } from "@/lib/deck-intelligence-preferences";

export const DECK_INTELLIGENCE_GENERATION_MODES = ["single", "compare"] as const;
export type DeckIntelligenceGenerationMode =
  (typeof DECK_INTELLIGENCE_GENERATION_MODES)[number];

export const DECK_VARIANT_SIMILARITY_THRESHOLD = 0.95;
export const DECK_VARIANT_DIVERSITY_RETRIES = 2;
export const MIN_DIVERSIFIABLE_CANDIDATE_COUNT = 40;

export interface DeckCopyEntry {
  cardId: string;
  count: number;
}

export class DeckCopyResolutionError extends Error {
  constructor(
    message: string,
    readonly code: "missing_card" | "invalid_count" | "invalid_total",
  ) {
    super(message);
    this.name = "DeckCopyResolutionError";
  }
}

export function resolveDeckCopyEntries<T>(
  entries: DeckCopyEntry[],
  poolById: ReadonlyMap<string, T>,
): Array<{ card: T; count: number }> {
  const resolved: Array<{ card: T; count: number }> = [];
  let totalCount = 0;

  for (const entry of entries) {
    const card = poolById.get(entry.cardId);
    if (card === undefined) {
      throw new DeckCopyResolutionError(
        `Proposal card ${entry.cardId} is missing from the current card pool.`,
        "missing_card",
      );
    }
    if (!Number.isInteger(entry.count) || entry.count <= 0) {
      throw new DeckCopyResolutionError(
        `Proposal card ${entry.cardId} has an invalid count: ${entry.count}.`,
        "invalid_count",
      );
    }
    resolved.push({ card, count: entry.count });
    totalCount += entry.count;
  }

  if (totalCount !== 50) {
    throw new DeckCopyResolutionError(
      `Proposal card count must total 50; received ${totalCount}.`,
      "invalid_total",
    );
  }

  return resolved;
}

export function applyDeckCopyEntries<T>(
  entries: DeckCopyEntry[],
  poolById: ReadonlyMap<string, T>,
  replace: (resolved: Array<{ card: T; count: number }>) => void,
): void {
  const resolved = resolveDeckCopyEntries(entries, poolById);
  replace(resolved);
}

export interface DeckCopySimilarity {
  sharedCardCopies: number;
  differentCardCopies: number;
  similarityRatio: number;
}

export interface VariantDeterministicMetrics {
  costCurve: Record<string, number>;
  counterDistribution: Record<string, number>;
  triggerRatio: number;
  evaluationScores: {
    attack: number;
    stability: number;
    expansion: number;
    defense: number;
    meta: number;
    composite: number;
  };
  majorMechanics: Array<{ mechanic: string; count: number }>;
}

export interface ComparableDeckVariant {
  variantProfile: VariantProfile;
  cards: DeckCopyEntry[];
  metrics: VariantDeterministicMetrics;
}

export interface VariantPairSimilarity extends DeckCopySimilarity {
  profiles: [VariantProfile, VariantProfile];
}

export interface VariantCardDelta {
  cardId: string;
  referenceCount: number;
  variantCount: number;
}

export interface VariantCardComparison {
  uniqueCardIds: string[];
  increasedCards: VariantCardDelta[];
  decreasedCards: VariantCardDelta[];
}

export interface VariantMetricSummary {
  attack: number;
  stability: number;
  expansion: number;
  defense: number;
  meta: number;
  composite: number;
  triggerRatio: number;
  counterCards: number;
  counter2000Plus: number;
  averageCost: number;
  majorCostBand: "low" | "mid" | "high";
  costBands: { low: number; mid: number; high: number };
  majorMechanics: Array<{ mechanic: string; count: number }>;
}

export interface DeckVariantsComparison {
  similarities: VariantPairSimilarity[];
  commonCards: Array<{
    cardId: string;
    sharedCopies: number;
    counts: Record<VariantProfile, number>;
  }>;
  cardsByVariant: Record<VariantProfile, VariantCardComparison>;
  metricsByVariant: Record<VariantProfile, VariantMetricSummary>;
}

export function calculateDeckCopySimilarity(
  left: DeckCopyEntry[],
  right: DeckCopyEntry[],
): DeckCopySimilarity {
  const leftCounts = toCountMap(left);
  const rightCounts = toCountMap(right);
  const ids = new Set([...leftCounts.keys(), ...rightCounts.keys()]);
  let sharedCardCopies = 0;
  for (const id of ids) {
    sharedCardCopies += Math.min(
      leftCounts.get(id) ?? 0,
      rightCounts.get(id) ?? 0,
    );
  }
  const leftTotal = totalCopies(leftCounts);
  const rightTotal = totalCopies(rightCounts);
  const comparisonSize = Math.max(leftTotal, rightTotal);
  return {
    sharedCardCopies,
    differentCardCopies: comparisonSize - sharedCardCopies,
    similarityRatio:
      comparisonSize === 0 ? 1 : round6(sharedCardCopies / comparisonSize),
  };
}

export function buildDeckVariantsComparison(
  variants: ComparableDeckVariant[],
): DeckVariantsComparison {
  const byProfile = new Map(
    variants.map((variant) => [variant.variantProfile, variant]),
  );
  const profiles: VariantProfile[] = [
    "recommended",
    "consistency",
    "specialization",
  ];
  const countMaps = new Map(
    variants.map((variant) => [variant.variantProfile, toCountMap(variant.cards)]),
  );
  const allIds = new Set(
    variants.flatMap((variant) => variant.cards.map((card) => card.cardId)),
  );

  const commonCards = [...allIds]
    .filter((cardId) =>
      profiles.every((profile) => (countMaps.get(profile)?.get(cardId) ?? 0) > 0),
    )
    .map((cardId) => {
      const counts = Object.fromEntries(
        profiles.map((profile) => [
          profile,
          countMaps.get(profile)?.get(cardId) ?? 0,
        ]),
      ) as Record<VariantProfile, number>;
      return {
        cardId,
        sharedCopies: Math.min(...Object.values(counts)),
        counts,
      };
    })
    .sort(
      (a, b) => b.sharedCopies - a.sharedCopies || a.cardId.localeCompare(b.cardId),
    );

  const recommendedCounts = countMaps.get("recommended") ?? new Map();
  const cardsByVariant = Object.fromEntries(
    profiles.map((profile) => {
      const counts = countMaps.get(profile) ?? new Map<string, number>();
      const otherProfiles = profiles.filter((candidate) => candidate !== profile);
      const uniqueCardIds = [...counts.entries()]
        .filter(
          ([cardId, count]) =>
            count > 0 &&
            otherProfiles.every(
              (other) => (countMaps.get(other)?.get(cardId) ?? 0) === 0,
            ),
        )
        .map(([cardId]) => cardId)
        .sort();
      const reference =
        profile === "recommended"
          ? mergeReferenceCounts(
              countMaps.get("consistency"),
              countMaps.get("specialization"),
            )
          : recommendedCounts;
      const deltaIds = new Set([...counts.keys(), ...reference.keys()]);
      const increasedCards: VariantCardDelta[] = [];
      const decreasedCards: VariantCardDelta[] = [];
      for (const cardId of deltaIds) {
        const variantCount = counts.get(cardId) ?? 0;
        const referenceCount = reference.get(cardId) ?? 0;
        if (variantCount > referenceCount) {
          increasedCards.push({ cardId, referenceCount, variantCount });
        } else if (variantCount < referenceCount) {
          decreasedCards.push({ cardId, referenceCount, variantCount });
        }
      }
      const sortDeltas = (a: VariantCardDelta, b: VariantCardDelta) =>
        Math.abs(b.variantCount - b.referenceCount) -
          Math.abs(a.variantCount - a.referenceCount) ||
        a.cardId.localeCompare(b.cardId);
      increasedCards.sort(sortDeltas);
      decreasedCards.sort(sortDeltas);
      return [
        profile,
        { uniqueCardIds, increasedCards, decreasedCards },
      ];
    }),
  ) as Record<VariantProfile, VariantCardComparison>;

  const metricsByVariant = Object.fromEntries(
    profiles.map((profile) => {
      const variant = byProfile.get(profile);
      if (!variant) {
        throw new Error(`Missing variant profile: ${profile}`);
      }
      return [profile, summarizeMetrics(variant.metrics)];
    }),
  ) as Record<VariantProfile, VariantMetricSummary>;

  const pairProfiles: Array<[VariantProfile, VariantProfile]> = [
    ["recommended", "consistency"],
    ["recommended", "specialization"],
    ["consistency", "specialization"],
  ];
  const similarities = pairProfiles.map(([leftProfile, rightProfile]) => {
    const left = byProfile.get(leftProfile);
    const right = byProfile.get(rightProfile);
    if (!left || !right) {
      throw new Error(`Missing variants for ${leftProfile}/${rightProfile}`);
    }
    return {
      profiles: [leftProfile, rightProfile] as [VariantProfile, VariantProfile],
      ...calculateDeckCopySimilarity(left.cards, right.cards),
    };
  });

  return { similarities, commonCards, cardsByVariant, metricsByVariant };
}

export interface VariantGenerationResult<T> {
  variantProfile: VariantProfile;
  proposal: T;
  lowDiversityWarning: string | null;
  diversityRetries: number;
}

export async function orchestrateVariantProfiles<T extends { cards: DeckCopyEntry[] }>(
  generate: (
    profile: VariantProfile,
    accepted: ReadonlyArray<VariantGenerationResult<T>>,
    diversityAttempt: number,
  ) => Promise<T>,
  options: {
    candidatePoolSize: number;
    similarityThreshold?: number;
    maxDiversityRetries?: number;
  },
): Promise<Array<VariantGenerationResult<T>>> {
  const threshold =
    options.similarityThreshold ?? DECK_VARIANT_SIMILARITY_THRESHOLD;
  const maxRetries =
    options.maxDiversityRetries ?? DECK_VARIANT_DIVERSITY_RETRIES;
  const canDiversify =
    options.candidatePoolSize >= MIN_DIVERSIFIABLE_CANDIDATE_COUNT;
  const accepted: Array<VariantGenerationResult<T>> = [];

  for (const profile of [
    "recommended",
    "consistency",
    "specialization",
  ] as const) {
    let diversityAttempt = 0;
    let proposal = await generate(profile, accepted, diversityAttempt);
    let tooSimilar = mostSimilarAccepted(proposal.cards, accepted);

    while (
      canDiversify &&
      tooSimilar !== null &&
      tooSimilar.similarityRatio >= threshold &&
      diversityAttempt < maxRetries
    ) {
      diversityAttempt += 1;
      proposal = await generate(profile, accepted, diversityAttempt);
      tooSimilar = mostSimilarAccepted(proposal.cards, accepted);
    }

    const lowDiversity =
      tooSimilar !== null && tooSimilar.similarityRatio >= threshold;
    accepted.push({
      variantProfile: profile,
      proposal,
      diversityRetries: diversityAttempt,
      lowDiversityWarning: lowDiversity && tooSimilar
        ? `比較案の差が小さめです（共有${tooSimilar.sharedCardCopies}枚・類似度${Math.round(tooSimilar.similarityRatio * 100)}%）。候補プールと合法性を優先しました。`
        : null,
    });
  }

  return accepted;
}

function mostSimilarAccepted<T extends { cards: DeckCopyEntry[] }>(
  cards: DeckCopyEntry[],
  accepted: ReadonlyArray<VariantGenerationResult<T>>,
): DeckCopySimilarity | null {
  let mostSimilar: DeckCopySimilarity | null = null;
  for (const previous of accepted) {
    const similarity = calculateDeckCopySimilarity(cards, previous.proposal.cards);
    if (!mostSimilar || similarity.similarityRatio > mostSimilar.similarityRatio) {
      mostSimilar = similarity;
    }
  }
  return mostSimilar;
}

function summarizeMetrics(
  metrics: VariantDeterministicMetrics,
): VariantMetricSummary {
  const costBands = { low: 0, mid: 0, high: 0 };
  let costCopies = 0;
  let weightedCost = 0;
  for (const [rawCost, count] of Object.entries(metrics.costCurve)) {
    const cost = Number(rawCost);
    if (!Number.isFinite(cost)) continue;
    costCopies += count;
    weightedCost += cost * count;
    if (cost <= 3) costBands.low += count;
    else if (cost <= 6) costBands.mid += count;
    else costBands.high += count;
  }
  const majorCostBand = (["low", "mid", "high"] as const).reduce(
    (best, band) => (costBands[band] > costBands[best] ? band : best),
    "low",
  );
  const none = metrics.counterDistribution.none ?? 0;
  const totalCounterDistribution = Object.values(
    metrics.counterDistribution,
  ).reduce((sum, count) => sum + count, 0);
  return {
    ...metrics.evaluationScores,
    triggerRatio: metrics.triggerRatio,
    counterCards: totalCounterDistribution - none,
    counter2000Plus:
      (metrics.counterDistribution["2000"] ?? 0) +
      (metrics.counterDistribution.other ?? 0),
    averageCost: costCopies === 0 ? 0 : round2(weightedCost / costCopies),
    majorCostBand,
    costBands,
    majorMechanics: metrics.majorMechanics,
  };
}

function mergeReferenceCounts(
  first: ReadonlyMap<string, number> | undefined,
  second: ReadonlyMap<string, number> | undefined,
): Map<string, number> {
  const merged = new Map<string, number>();
  const ids = new Set([...(first?.keys() ?? []), ...(second?.keys() ?? [])]);
  for (const id of ids) {
    merged.set(
      id,
      Math.round(((first?.get(id) ?? 0) + (second?.get(id) ?? 0)) / 2),
    );
  }
  return merged;
}

function toCountMap(entries: DeckCopyEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.cardId, (counts.get(entry.cardId) ?? 0) + entry.count);
  }
  return counts;
}

function totalCopies(counts: ReadonlyMap<string, number>): number {
  return [...counts.values()].reduce((sum, count) => sum + count, 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
