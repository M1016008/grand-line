import { seedGroups } from "@/lib/auto-groups";
import type { CardListItem } from "@/lib/cards";
import { evaluateDeck, type DeckEvaluation } from "@/lib/deck-evaluation";
import { costCurve } from "@/lib/deck-rules";
import { exactTurnProbabilities } from "@/lib/probability";
import { detectRuleSynergies } from "@/lib/synergy-rules";

export const DECK_COACH_METRICS_VERSION = "deck-coach-metrics-v1.0.0";

export interface DeckCoachMetricEntry {
  card: CardListItem;
  count: number;
}

export interface DeckCoachDeterministicMetrics {
  version: string;
  costCurve: Record<string, number>;
  cardTypeDistribution: Record<string, number>;
  counterDistribution: Record<string, number>;
  trigger: { count: number; ratio: number };
  evaluation: DeckEvaluation;
  majorMechanics: Array<{ mechanic: string; count: number }>;
  autoGroups: Array<{
    id: string;
    label: string;
    cardIds: string[];
    totalCopies: number;
  }>;
  exactProbabilities: Array<{
    turn: number;
    drawn: number;
    probabilities: Record<string, number>;
  }>;
  ruleSynergies: Array<{
    fromCardId: string;
    toCardId: string;
    relationType: string;
    strength: number;
    reasoningJa: string;
  }>;
}

export function buildDeckCoachMetrics(
  leader: CardListItem,
  entries: DeckCoachMetricEntry[],
): DeckCoachDeterministicMetrics {
  const counts = new Map(entries.map((entry) => [entry.card.id, entry.count]));
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const curve = costCurve(
    entries.map(({ card, count }) => ({
      id: card.id,
      cardType: card.cardType,
      colors: card.colors,
      count,
      cost: card.cost,
    })),
  );

  const cardTypeDistribution: Record<string, number> = {};
  const counterDistribution: Record<string, number> = {
    none: 0,
    "1000": 0,
    "2000": 0,
    other: 0,
  };
  const mechanicCounts = new Map<string, number>();
  let triggerCount = 0;

  for (const { card, count } of entries) {
    cardTypeDistribution[card.cardType] =
      (cardTypeDistribution[card.cardType] ?? 0) + count;
    if (card.counter === null || card.counter === 0) counterDistribution.none += count;
    else if (card.counter === 1000) counterDistribution["1000"] += count;
    else if (card.counter === 2000) counterDistribution["2000"] += count;
    else counterDistribution.other += count;
    if (card.hasTrigger) triggerCount += count;
    for (const mechanic of card.mechanics) {
      mechanicCounts.set(mechanic, (mechanicCounts.get(mechanic) ?? 0) + count);
    }
  }

  const evaluation = evaluateDeck(
    entries.map(({ card, count }) => ({
      id: card.id,
      cardType: card.cardType,
      colors: card.colors,
      features: card.features,
      cost: card.cost,
      power: card.power,
      counter: card.counter,
      hasTrigger: card.hasTrigger,
      mechanics: card.mechanics,
      count,
    })),
  );

  const groups = seedGroups(entries).map((group) => ({
    id: group.id,
    label: group.label,
    cardIds: group.cardIds,
    totalCopies: group.cardIds.reduce(
      (sum, id) => sum + (counts.get(id) ?? 0),
      0,
    ),
  }));
  const exactProbabilities = exactTurnProbabilities(
    total,
    groups.map((group) => ({ id: group.id, size: group.totalCopies })),
    7,
  );
  const ruleSynergies = detectRuleSynergies(
    leader,
    entries.map((entry) => entry.card),
  )
    .slice(0, 40)
    .map((edge) => ({
      fromCardId: edge.fromCardId,
      toCardId: edge.toCardId,
      relationType: edge.relationType,
      strength: edge.strength,
      reasoningJa: edge.reasoningJa,
    }));

  return {
    version: DECK_COACH_METRICS_VERSION,
    costCurve: Object.fromEntries(
      Object.entries(curve).map(([cost, count]) => [cost, count]),
    ),
    cardTypeDistribution,
    counterDistribution,
    trigger: {
      count: triggerCount,
      ratio: total === 0 ? 0 : round6(triggerCount / total),
    },
    evaluation,
    majorMechanics: [...mechanicCounts.entries()]
      .map(([mechanic, count]) => ({ mechanic, count }))
      .sort(
        (a, b) => b.count - a.count || a.mechanic.localeCompare(b.mechanic),
      )
      .slice(0, 15),
    autoGroups: groups,
    exactProbabilities,
    ruleSynergies,
  };
}

export function selectDeckCoachReferenceCardIds(
  metrics: DeckCoachDeterministicMetrics,
  max = 3,
): string[] {
  const orderedGroups = ["key", "resource", "finisher", "defense", "removal"];
  const ids = new Set<string>();
  for (const groupId of orderedGroups) {
    const group = metrics.autoGroups.find((candidate) => candidate.id === groupId);
    for (const id of group?.cardIds ?? []) {
      ids.add(id);
      if (ids.size >= max) return [...ids];
    }
  }
  return [...ids];
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
