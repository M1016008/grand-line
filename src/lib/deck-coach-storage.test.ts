import test from "node:test";
import assert from "node:assert/strict";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import type { DeckCoachGuide } from "@/lib/deck-coach-schema";
import {
  isMissingDeckCoachGuidesTableError,
  readStoredDeckCoachGuideFromDb,
  writeStoredDeckCoachGuideToDb,
} from "@/lib/deck-coach-storage";

const GUIDE: DeckCoachGuide = {
  level: "easy",
  deckSummaryJa: "小さいキャラを出しながら、毎ターン攻めるデッキです。",
  archetypeJa: "赤・テンポ",
  winConditionsJa: ["場のキャラを残して、攻撃回数を増やします。"],
  keyCards: [{ cardId: "OP01-002", roleJa: "序盤の動きを作ります。" }],
  mulligan: {
    keepCardIds: ["OP01-002"],
    flexibleCardIds: [],
    returnCardIds: [],
    explanationJa: "最初のターンから使えるカードを残します。",
  },
  idealOpeningJa: ["1コストのカードを1枚持ちます。"],
  firstPlayerPlan: ["先に場を作ります。"],
  secondPlayerPlan: ["手札を増やしながら場を作ります。"],
  donPlan: [
    {
      donCount: 1,
      actionJa: "OP01-002を使います。",
      referencedCardIds: ["OP01-002"],
    },
  ],
  combos: [],
  plans: {
    planAJa: "場を広げます。",
    planBJa: "手札を守ります。",
    planCJa: "リーダーで少しずつ攻めます。",
  },
  finishMethodsJa: ["攻撃回数を増やします。"],
  weakBoardsJa: ["大きなキャラが多い盤面です。"],
  weakMatchupsJa: ["守りを固めるデッキです。"],
  commonMistakesJa: ["手札を全部使い切らないようにします。"],
};

test("Deck Coach storage writes, updates, and reads guide JSON", async () => {
  const client = createClient({ url: "file::memory:" });
  const database = drizzle(client, { schema, casing: "snake_case" }) as Database;
  try {
    await client.execute(`
      CREATE TABLE deck_coach_guides (
        deck_id text NOT NULL,
        level text NOT NULL,
        deck_hash text NOT NULL,
        source_data_hash text NOT NULL,
        guide_json text NOT NULL,
        prompt_version text NOT NULL,
        ai_model_version text NOT NULL,
        generated_at integer NOT NULL,
        updated_at integer NOT NULL,
        PRIMARY KEY(deck_id, level)
      )
    `);
    const first = new Date("2026-09-01T00:00:00.000Z");
    await writeStoredDeckCoachGuideToDb(database, {
      deckId: "deck-1",
      level: "easy",
      guide: GUIDE,
      deckHash: "deck-hash-1",
      sourceDataHash: "source-hash-1",
      promptVersion: "deck-coach-v1.0.0",
      aiModelVersion: "claude-sonnet-4-6@test",
      generatedAt: first,
      updatedAt: first,
    });
    const second = new Date("2026-09-01T01:00:00.000Z");
    await writeStoredDeckCoachGuideToDb(database, {
      deckId: "deck-1",
      level: "easy",
      guide: { ...GUIDE, archetypeJa: "赤・アグロ" },
      deckHash: "deck-hash-2",
      sourceDataHash: "source-hash-2",
      promptVersion: "deck-coach-v1.0.0",
      aiModelVersion: "claude-sonnet-4-6@test",
      generatedAt: second,
      updatedAt: second,
    });

    const stored = await readStoredDeckCoachGuideFromDb(
      database,
      "deck-1",
      "easy",
    );
    assert.ok(stored);
    assert.equal(stored.guide.archetypeJa, "赤・アグロ");
    assert.equal(stored.deckHash, "deck-hash-2");
    assert.equal(stored.sourceDataHash, "source-hash-2");
    assert.equal(stored.generatedAt, second.toISOString());
  } finally {
    client.close();
  }
});

test("Deck Coach storage recognizes only the missing Deck Coach table", () => {
  assert.equal(
    isMissingDeckCoachGuidesTableError(
      new Error("SQLITE_ERROR: no such table: deck_coach_guides"),
    ),
    true,
  );
  assert.equal(
    isMissingDeckCoachGuidesTableError(
      new Error("SQLITE_ERROR: no such table: card_coach_guides"),
    ),
    false,
  );
});
