import { hashSourceData } from "@/lib/card-coach-source-data";

export interface DeckCoachCurrentHashes {
  deckHash: string;
  sourceDataHash: string;
}

export function hashDeckCoachDeck(value: unknown): string {
  return hashSourceData(value);
}

export function hashDeckCoachSourceData(value: unknown): string {
  return hashSourceData(value);
}

export function deckCoachStaleState(
  stored: DeckCoachCurrentHashes,
  current: DeckCoachCurrentHashes | null,
): {
  deckDataStale: boolean;
  sourceDataStale: boolean;
  stale: boolean;
} {
  if (!current) {
    return {
      deckDataStale: true,
      sourceDataStale: true,
      stale: true,
    };
  }
  const deckDataStale = stored.deckHash !== current.deckHash;
  const sourceDataStale = stored.sourceDataHash !== current.sourceDataHash;
  return {
    deckDataStale,
    sourceDataStale,
    stale: deckDataStale || sourceDataStale,
  };
}
