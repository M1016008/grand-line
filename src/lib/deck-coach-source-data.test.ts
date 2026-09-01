import test from "node:test";
import assert from "node:assert/strict";

import {
  deckCoachStaleState,
  hashDeckCoachDeck,
  hashDeckCoachSourceData,
} from "@/lib/deck-coach-source-data";

test("Deck Coach hashes are stable across object key order", () => {
  assert.equal(
    hashDeckCoachDeck({ leaderId: "OP01-001", cards: [{ cardId: "A", count: 4 }] }),
    hashDeckCoachDeck({ cards: [{ count: 4, cardId: "A" }], leaderId: "OP01-001" }),
  );
  assert.equal(
    hashDeckCoachSourceData({ prompt: "v1", metrics: { attack: 50 } }),
    hashDeckCoachSourceData({ metrics: { attack: 50 }, prompt: "v1" }),
  );
});

test("Deck Coach stale detection distinguishes deck and source changes", () => {
  assert.deepEqual(
    deckCoachStaleState(
      { deckHash: "deck-1", sourceDataHash: "source-1" },
      { deckHash: "deck-2", sourceDataHash: "source-1" },
    ),
    { deckDataStale: true, sourceDataStale: false, stale: true },
  );
  assert.deepEqual(
    deckCoachStaleState(
      { deckHash: "deck-1", sourceDataHash: "source-1" },
      { deckHash: "deck-1", sourceDataHash: "source-2" },
    ),
    { deckDataStale: false, sourceDataStale: true, stale: true },
  );
  assert.equal(
    deckCoachStaleState(
      { deckHash: "deck-1", sourceDataHash: "source-1" },
      { deckHash: "deck-1", sourceDataHash: "source-1" },
    ).stale,
    false,
  );
});

test("Deck Coach marks a stored guide stale when current sources cannot be validated", () => {
  assert.deepEqual(
    deckCoachStaleState(
      { deckHash: "deck-1", sourceDataHash: "source-1" },
      null,
    ),
    { deckDataStale: true, sourceDataStale: true, stale: true },
  );
});
