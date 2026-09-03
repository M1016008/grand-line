import type { CardListItem } from "@/lib/cards";
import {
  buildStrictSyntheticBenchmarkOpponent,
  strictDeckIntelligencePracticeDeck,
} from "@/lib/deck-battle-benchmark";
import { isVerifiedOfficialCard } from "@/lib/deck-intelligence-preferences";
import type { DeckRegulations } from "@/lib/deck-rules";
import type { PracticeDeck } from "@/lib/practice-sim";

export interface RulesPracticeDeckRequest {
  leaderId: string;
  mode: "draft" | "generated";
  cards?: Array<{ cardId: string; count: number }>;
}

export interface RulesPracticeDeckSummary {
  leaderId: string;
  leaderName: string;
  source: "draft" | "generated";
  totalCards: number;
  cards: Array<{ cardId: string; count: number }>;
}

export class RulesPracticeDeckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RulesPracticeDeckError";
  }
}

export function verifiedOfficialPracticePool(cards: CardListItem[]): CardListItem[] {
  return cards.filter(isVerifiedOfficialCard);
}

export function resolveRulesPracticePlayerDeck(input: {
  request: RulesPracticeDeckRequest;
  pool: CardListItem[];
  regulations: DeckRegulations;
}): PracticeDeck {
  const verifiedPool = verifiedOfficialPracticePool(input.pool);
  const poolById = new Map(verifiedPool.map((card) => [card.id, card]));
  const leader = poolById.get(input.request.leaderId);
  if (!leader || leader.cardType !== "LEADER") {
    throw new RulesPracticeDeckError("verified official Leaderを解決できません。");
  }

  if (input.request.mode === "generated") {
    return buildStrictSyntheticBenchmarkOpponent({
      leader,
      pool: verifiedPool,
      regulations: input.regulations,
    });
  }
  if (!input.request.cards) {
    throw new RulesPracticeDeckError("下書きのカード一覧が必要です。");
  }
  for (const entry of input.request.cards) {
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      throw new RulesPracticeDeckError(`不正な枚数です: ${entry.cardId}`);
    }
    if (!poolById.has(entry.cardId)) {
      throw new RulesPracticeDeckError(
        `verified official poolに存在しないカードです: ${entry.cardId}`,
      );
    }
  }
  return strictDeckIntelligencePracticeDeck({
    id: `practice:draft:${leader.id}`,
    name: `Practice draft — ${leader.name}`,
    leader,
    cards: input.request.cards,
    poolById,
    regulations: input.regulations,
    source: "draft",
  });
}

export function resolveRulesPracticeOpponentDeck(input: {
  leaderId: string;
  pool: CardListItem[];
  regulations: DeckRegulations;
}): PracticeDeck {
  return resolveRulesPracticePlayerDeck({
    request: { leaderId: input.leaderId, mode: "generated" },
    pool: input.pool,
    regulations: input.regulations,
  });
}

export function summarizeRulesPracticeDeck(
  deck: PracticeDeck,
): RulesPracticeDeckSummary {
  return {
    leaderId: deck.leader.id,
    leaderName: deck.leader.name,
    source: deck.source,
    totalCards: deck.totalCards,
    cards: deck.entries.map((entry) => ({
      cardId: entry.card.id,
      count: entry.count,
    })),
  };
}
