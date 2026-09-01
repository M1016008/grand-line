import type { CardListItem } from "@/lib/cards";
import {
  buildStrictSyntheticBenchmarkOpponent,
  strictDeckIntelligencePracticeDeck,
  type BenchmarkOpponentDescriptor,
} from "@/lib/deck-battle-benchmark";
import type { DeckRegulations } from "@/lib/deck-rules";
import type { PracticeDeck } from "@/lib/practice-sim";
import type { SavedDeckDetail } from "@/lib/saved-decks";

export type BenchmarkOpponentRequest =
  | { kind: "saved"; deckId: string }
  | { kind: "synthetic"; leaderId: string };

export interface ResolvedBenchmarkOpponent {
  deck: PracticeDeck;
  descriptor: BenchmarkOpponentDescriptor;
}

export class BenchmarkOpponentResolutionError extends Error {
  constructor(
    message: string,
    readonly code: "opponent_not_found" | "opponent_leader_not_found",
  ) {
    super(message);
    this.name = "BenchmarkOpponentResolutionError";
  }
}

/** Shared, fail-closed saved/synthetic opponent resolution for server routes. */
export function resolveBenchmarkOpponent({
  requested,
  savedOpponent,
  poolById,
  pool,
  regulations,
}: {
  requested: BenchmarkOpponentRequest;
  savedOpponent: SavedDeckDetail | null;
  poolById: ReadonlyMap<string, CardListItem>;
  pool: CardListItem[];
  regulations: DeckRegulations;
}): ResolvedBenchmarkOpponent {
  if (requested.kind === "saved") {
    if (!savedOpponent) {
      throw new BenchmarkOpponentResolutionError(
        "Saved opponent was not found.",
        "opponent_not_found",
      );
    }
    const savedPool = new Map(
      savedOpponent.entries.map((entry) => [entry.card.id, entry.card]),
    );
    const deck = strictDeckIntelligencePracticeDeck({
      id: `saved:${savedOpponent.id}`,
      name: savedOpponent.name,
      leader: savedOpponent.leader,
      cards: savedOpponent.entries.map((entry) => ({
        cardId: entry.card.id,
        count: entry.count,
      })),
      poolById: savedPool,
      regulations,
    });
    return {
      deck,
      descriptor: {
        kind: "saved",
        id: savedOpponent.id,
        name: savedOpponent.name,
        leaderId: savedOpponent.leader.id,
        synthetic: false,
      },
    };
  }

  const syntheticLeader = poolById.get(requested.leaderId);
  if (!syntheticLeader || syntheticLeader.cardType !== "LEADER") {
    throw new BenchmarkOpponentResolutionError(
      `${requested.leaderId} is not an available leader.`,
      "opponent_leader_not_found",
    );
  }
  return {
    deck: buildStrictSyntheticBenchmarkOpponent({
      leader: syntheticLeader,
      pool,
      regulations,
    }),
    descriptor: {
      kind: "synthetic",
      id: `synthetic:${syntheticLeader.id}`,
      name: `Synthetic benchmark opponent — ${syntheticLeader.name}`,
      leaderId: syntheticLeader.id,
      synthetic: true,
    },
  };
}
