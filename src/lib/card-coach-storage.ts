import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "@/db/client";
import {
  cardCoachGuides,
  cardTranslations,
  cards,
} from "@/db/schema";
import type { CardTranslationSource } from "@/db/schema";
import type { CardCoachFactInput } from "@/ai/card-coach";
import {
  cardCoachGuideSchema,
  type CardCoachCardRef,
  type CardCoachGuide,
  type CardCoachLevel,
  type StoredCardCoachGuide,
} from "@/lib/card-coach-schema";

const OFFICIAL_FACT_SOURCES = [
  "official_jp",
  "official_en",
] as const satisfies readonly CardTranslationSource[];

export interface WriteStoredCardCoachGuideInput {
  cardId: string;
  level: CardCoachLevel;
  guide: CardCoachGuide;
  sourceDataHash: string;
  promptVersion: string;
  aiModelVersion: string;
  generatedAt: Date;
  updatedAt: Date;
}

export async function readStoredCardCoachGuideFromDb(
  database: Database,
  cardId: string,
  level: CardCoachLevel,
): Promise<StoredCardCoachGuide | null> {
  const rows = await database
    .select({
      cardId: cardCoachGuides.cardId,
      level: cardCoachGuides.level,
      guideJson: cardCoachGuides.guideJson,
      sourceDataHash: cardCoachGuides.sourceDataHash,
      promptVersion: cardCoachGuides.promptVersion,
      aiModelVersion: cardCoachGuides.aiModelVersion,
      generatedAt: cardCoachGuides.generatedAt,
      updatedAt: cardCoachGuides.updatedAt,
    })
    .from(cardCoachGuides)
    .where(
      and(
        eq(cardCoachGuides.cardId, cardId),
        eq(cardCoachGuides.level, level),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    cardId: row.cardId,
    level: row.level,
    guide: parseGuideJson(row.guideJson),
    sourceDataHash: row.sourceDataHash,
    promptVersion: row.promptVersion,
    aiModelVersion: row.aiModelVersion,
    generatedAt: serializeDate(row.generatedAt),
    updatedAt: serializeDate(row.updatedAt),
  };
}

export async function writeStoredCardCoachGuideToDb(
  database: Database,
  input: WriteStoredCardCoachGuideInput,
): Promise<void> {
  await database
    .insert(cardCoachGuides)
    .values({
      cardId: input.cardId,
      level: input.level,
      guideJson: input.guide,
      sourceDataHash: input.sourceDataHash,
      promptVersion: input.promptVersion,
      aiModelVersion: input.aiModelVersion,
      generatedAt: input.generatedAt,
      updatedAt: input.updatedAt,
    })
    .onConflictDoUpdate({
      target: [cardCoachGuides.cardId, cardCoachGuides.level],
      set: {
        guideJson: input.guide,
        sourceDataHash: input.sourceDataHash,
        promptVersion: input.promptVersion,
        aiModelVersion: input.aiModelVersion,
        updatedAt: input.updatedAt,
      },
    });
}

export async function cardExistsInDb(
  database: Database,
  cardId: string,
): Promise<boolean> {
  const rows = await database
    .select({ id: cards.id })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  return rows.length > 0;
}

export async function readVerifiedCardFactsByIdsFromDb(
  database: Database,
  cardIds: Iterable<string>,
  language = "ja",
): Promise<Map<string, CardCoachFactInput>> {
  const uniqueIds = [...new Set(cardIds)].filter((id) => id.length > 0);
  if (uniqueIds.length === 0) return new Map();

  const rows = await database
    .select({
      id: cards.id,
      setCode: cards.setCode,
      cardType: cards.cardType,
      colors: cards.colors,
      attributes: cards.attributes,
      features: cards.features,
      mechanics: cards.mechanics,
      cost: cards.cost,
      power: cards.power,
      counter: cards.counter,
      life: cards.life,
      rarity: cards.rarity,
      hasTrigger: cards.hasTrigger,
      imageUrlJp: cards.imageUrlJp,
      name: cardTranslations.name,
      effectText: cardTranslations.effectText,
      triggerText: cardTranslations.triggerText,
      source: cardTranslations.source,
      verified: cardTranslations.verified,
    })
    .from(cards)
    .innerJoin(
      cardTranslations,
      and(
        eq(cardTranslations.cardId, cards.id),
        eq(cardTranslations.language, language),
        eq(cardTranslations.verified, true),
        inArray(cardTranslations.source, OFFICIAL_FACT_SOURCES),
      ),
    )
    .where(inArray(cards.id, uniqueIds));

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        setCode: row.setCode,
        cardType: row.cardType,
        name: row.name,
        colors: row.colors ?? [],
        attributes: row.attributes ?? [],
        features: row.features ?? [],
        mechanics: row.mechanics ?? [],
        cost: row.cost,
        power: row.power,
        counter: row.counter,
        life: row.life,
        rarity: row.rarity,
        hasTrigger: row.hasTrigger,
        imageUrlJp: row.imageUrlJp,
        effectText: row.effectText,
        triggerText: row.triggerText,
        source: row.source,
        verified: row.verified,
      },
    ]),
  );
}

export async function readCardRefsByIdsFromDb(
  database: Database,
  cardIds: Iterable<string>,
  language = "ja",
): Promise<Record<string, CardCoachCardRef>> {
  const facts = await readVerifiedCardFactsByIdsFromDb(database, cardIds, language);
  return Object.fromEntries(
    [...facts.values()].map((card) => [
      card.id,
      {
        id: card.id,
        name: card.name,
        cardType: card.cardType,
        colors: card.colors,
        imageUrlJp: card.imageUrlJp,
      },
    ]),
  );
}

function parseGuideJson(raw: unknown): CardCoachGuide {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return cardCoachGuideSchema.parse(value);
}

function serializeDate(value: Date | number | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  return value;
}
