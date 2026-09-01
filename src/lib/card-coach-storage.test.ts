import test from "node:test";
import assert from "node:assert/strict";

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import type { CardCoachGuide } from "@/lib/card-coach-schema";
import {
  readStoredCardCoachGuideFromDb,
  readVerifiedCardFactsByIdsFromDb,
  writeStoredCardCoachGuideToDb,
} from "@/lib/card-coach-storage";

interface TestDatabase {
  client: Client;
  database: Database;
}

const SAMPLE_GUIDE: CardCoachGuide = {
  summaryJa: "このカードは攻める準備をしながら、相手のライフをねらうカードです。",
  roles: ["攻めの中心"],
  purposeJa: "リーダーとして攻撃の流れを作ります。",
  timing: ["中盤にDON!!が増えてから使います。"],
  strongSituations: ["場に仲間が残っている時に強いです。"],
  terms: [
    {
      term: "DON!!",
      explanationJa: "カードを出したり攻撃を強くしたりする力です。",
    },
  ],
  compatibleCards: [
    {
      cardId: "OP01-016",
      reasonJa: "必要なカードを探し、攻めにつなげやすいです。",
    },
  ],
  combos: [
    {
      titleJa: "探してから攻める",
      cardIds: ["OP01-001", "OP01-016"],
      stepsJa: ["手札を整えます。", "次の攻撃を強くします。"],
      whyJa: "ほしいカードを先に探せるので、動きが止まりにくいです。",
    },
  ],
  exampleJa: "中盤で攻撃しながら、次の展開も考えます。",
  playRoutes: [
    {
      donCount: 5,
      titleJa: "中盤の攻め",
      stepsJa: ["低コストカードを出します。", "残ったDON!!で攻撃を強くします。"],
    },
  ],
  fallbackPlanJa: "目当てのカードがない時は、手札を守って次のターンに備えます。",
  commonMistakesJa: ["手札が少ない時に無理に攻めすぎないようにします。"],
};

test("Card Coach storage writes and reads guide JSON", async () => {
  const ctx = await createTestDatabase();
  try {
    await seedCards(ctx.database);
    const generatedAt = new Date("2026-09-01T00:00:00.000Z");

    await writeStoredCardCoachGuideToDb(ctx.database, {
      cardId: "OP01-001",
      level: "easy",
      guide: SAMPLE_GUIDE,
      sourceDataHash: "hash-1",
      promptVersion: "card-coach-v1.0.0",
      aiModelVersion: "claude-sonnet-4-6@test",
      generatedAt,
      updatedAt: generatedAt,
    });

    const stored = await readStoredCardCoachGuideFromDb(
      ctx.database,
      "OP01-001",
      "easy",
    );

    assert.ok(stored);
    assert.equal(stored.cardId, "OP01-001");
    assert.equal(stored.guide.summaryJa, SAMPLE_GUIDE.summaryJa);
    assert.deepEqual(stored.guide.compatibleCards, SAMPLE_GUIDE.compatibleCards);
    assert.equal(stored.sourceDataHash, "hash-1");
    assert.equal(stored.generatedAt, "2026-09-01T00:00:00.000Z");
  } finally {
    await cleanup(ctx);
  }
});

test("Card Coach verified fact reader ignores unverified/manual card text", async () => {
  const ctx = await createTestDatabase();
  try {
    await seedCards(ctx.database);

    const facts = await readVerifiedCardFactsByIdsFromDb(ctx.database, [
      "OP01-001",
      "OP01-013",
    ]);

    assert.equal(facts.get("OP01-001")?.name, "モンキー・D・ルフィ");
    assert.equal(facts.has("OP01-013"), false);
  } finally {
    await cleanup(ctx);
  }
});

async function createTestDatabase(): Promise<TestDatabase> {
  const client = createClient({ url: "file::memory:" });
  const database = drizzle(client, {
    schema,
    casing: "snake_case",
  });

  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute(`
    CREATE TABLE card_sets (
      code text PRIMARY KEY NOT NULL,
      name_ja text NOT NULL,
      name_en text,
      release_date text,
      set_type text NOT NULL,
      image_url text,
      created_at integer DEFAULT (unixepoch()) NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE cards (
      id text PRIMARY KEY NOT NULL,
      set_code text NOT NULL REFERENCES card_sets(code) ON DELETE RESTRICT,
      card_type text NOT NULL,
      colors text NOT NULL,
      attributes text NOT NULL,
      features text NOT NULL,
      mechanics text NOT NULL,
      cost integer,
      power integer,
      counter integer,
      life integer,
      rarity text,
      has_trigger integer DEFAULT false NOT NULL,
      image_url_jp text,
      image_url_en text,
      created_at integer DEFAULT (unixepoch()) NOT NULL,
      updated_at integer DEFAULT (unixepoch()) NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE card_translations (
      card_id text NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      language text NOT NULL,
      name text NOT NULL,
      effect_text text,
      effect_normalized text,
      flavor_text text,
      trigger_text text,
      source text NOT NULL,
      verified integer DEFAULT false NOT NULL,
      source_url text,
      fetched_at integer,
      ai_model_version text,
      created_at integer DEFAULT (unixepoch()) NOT NULL,
      updated_at integer DEFAULT (unixepoch()) NOT NULL,
      PRIMARY KEY(card_id, language)
    )
  `);
  await client.execute(`
    CREATE TABLE card_coach_guides (
      card_id text NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      level text NOT NULL,
      guide_json text NOT NULL,
      source_data_hash text NOT NULL,
      prompt_version text NOT NULL,
      ai_model_version text NOT NULL,
      generated_at integer DEFAULT (unixepoch()) NOT NULL,
      updated_at integer DEFAULT (unixepoch()) NOT NULL,
      PRIMARY KEY(card_id, level)
    )
  `);

  return { client, database };
}

async function seedCards(database: Database): Promise<void> {
  await database.insert(schema.cardSets).values({
    code: "OP01",
    nameJa: "ROMANCE DAWN",
    setType: "booster",
  });

  await database.insert(schema.cards).values([
    {
      id: "OP01-001",
      setCode: "OP01",
      cardType: "LEADER",
      colors: ["red"],
      attributes: ["打撃"],
      features: ["麦わらの一味"],
      mechanics: ["OnAttack"],
      cost: null,
      power: 5000,
      counter: null,
      life: 5,
      rarity: "L",
      hasTrigger: false,
      imageUrlJp: null,
      imageUrlEn: null,
    },
    {
      id: "OP01-013",
      setCode: "OP01",
      cardType: "CHARACTER",
      colors: ["red"],
      attributes: ["斬撃"],
      features: ["麦わらの一味"],
      mechanics: [],
      cost: 3,
      power: 5000,
      counter: 1000,
      life: null,
      rarity: "SR",
      hasTrigger: false,
      imageUrlJp: null,
      imageUrlEn: null,
    },
  ]);

  await database.insert(schema.cardTranslations).values([
    {
      cardId: "OP01-001",
      language: "ja",
      name: "モンキー・D・ルフィ",
      effectText: "[アタック時] このリーダーにDON!!を付与する。",
      triggerText: null,
      source: "official_jp",
      verified: true,
    },
    {
      cardId: "OP01-013",
      language: "ja",
      name: "ロロノア・ゾロ",
      effectText: "手入力の未確認テキスト。",
      triggerText: null,
      source: "manual",
      verified: false,
    },
  ]);
}

async function cleanup(ctx: TestDatabase): Promise<void> {
  ctx.client.close();
}
