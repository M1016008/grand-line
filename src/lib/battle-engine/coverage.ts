import type { PracticeDeck } from "@/lib/practice-sim";
import type { BattleEffectRegistry } from "./effect-registry";
import type { EffectCoverageStatus } from "./effects";

export interface DeckCoverageEntry {
  cardId: string;
  name: string;
  copies: number;
  status: EffectCoverageStatus;
  reasons: string[];
}

export interface DeckEffectCoverage {
  totalCards: number;
  supportedCards: number;
  partialCards: number;
  unsupportedCards: number;
  supportedRatio: number;
  complete: boolean;
  entries: DeckCoverageEntry[];
}

export function calculateDeckCoverage(
  deck: PracticeDeck,
  registry: BattleEffectRegistry,
): DeckEffectCoverage {
  const entries = deck.entries.map((entry) => {
    const definition = registry.get(entry.card.id);
    return {
      cardId: entry.card.id,
      name: entry.card.name,
      copies: entry.count,
      status: definition.status,
      reasons: definition.unsupportedReasons,
    } satisfies DeckCoverageEntry;
  });
  const count = (status: EffectCoverageStatus) =>
    entries
      .filter((entry) => entry.status === status)
      .reduce((sum, entry) => sum + entry.copies, 0);
  const supportedCards = count("supported");
  const partialCards = count("partial");
  const unsupportedCards = count("unsupported");
  return {
    totalCards: deck.totalCards,
    supportedCards,
    partialCards,
    unsupportedCards,
    supportedRatio:
      deck.totalCards > 0 ? supportedCards / deck.totalCards : 0,
    complete: partialCards === 0 && unsupportedCards === 0,
    entries,
  };
}
