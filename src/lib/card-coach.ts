import "server-only";

import { createHash } from "node:crypto";

import {
  analyzeCardCoach,
  CARD_COACH_PROMPT_VERSION,
  UnverifiedCardFactError,
  type CardCoachAnalysisInput,
  type CardCoachCompatibleInput,
} from "@/ai/card-coach";
import { db } from "@/db";
import { getCompatibleCards } from "@/lib/card-compat";
import {
  cardExistsInDb,
  readCardRefsByIdsFromDb,
  readStoredCardCoachGuideFromDb,
  readVerifiedCardFactsByIdsFromDb,
  writeStoredCardCoachGuideToDb,
} from "@/lib/card-coach-storage";
import {
  type CardCoachGuide,
  type CardCoachGuideView,
  type CardCoachLevel,
  type StoredCardCoachGuide,
} from "@/lib/card-coach-schema";
import { getCardPlaystyle } from "@/lib/playstyle";

export class CardCoachCardNotFoundError extends Error {
  constructor(cardId: string) {
    super(`${cardId} was not found.`);
    this.name = "CardCoachCardNotFoundError";
  }
}

export class CardCoachUnverifiedFactsError extends Error {
  constructor(cardId: string) {
    super(
      `${cardId} does not have verified official facts. Card Coach can only use source=official_jp/official_en and verified=1.`,
    );
    this.name = "CardCoachUnverifiedFactsError";
  }
}

export interface PreparedCardCoachGeneration {
  input: CardCoachAnalysisInput;
  sourceDataHash: string;
}

export async function getCardCoachGuideForPage(
  cardId: string,
  level: CardCoachLevel = "easy",
): Promise<CardCoachGuideView | null> {
  try {
    const stored = await readStoredCardCoachGuideFromDb(db, cardId, level);
    if (stored) return toGuideView(stored, "card_coach");
  } catch {
    /* New table may not be migrated in local dev yet. Fall through. */
  }

  return getPlaystyleFallbackGuide(cardId, level);
}

export async function prepareCardCoachGeneration(
  cardId: string,
  level: CardCoachLevel = "easy",
): Promise<PreparedCardCoachGeneration> {
  const facts = await readVerifiedCardFactsByIdsFromDb(db, [cardId]);
  const card = facts.get(cardId);
  if (!card) {
    const exists = await cardExistsInDb(db, cardId);
    if (!exists) throw new CardCoachCardNotFoundError(cardId);
    throw new CardCoachUnverifiedFactsError(cardId);
  }

  const compatible = await getCompatibleCards(cardId, 8);
  const compatibleById = new Map(
    compatible.map((candidate) => [candidate.card.id, candidate]),
  );
  const compatibleFacts = await readVerifiedCardFactsByIdsFromDb(
    db,
    compatible.map((candidate) => candidate.card.id),
  );

  const compatibleCards: CardCoachCompatibleInput[] = [];
  for (const candidate of compatible) {
    const fact = compatibleFacts.get(candidate.card.id);
    if (!fact) continue;
    compatibleCards.push({
      card: fact,
      relationType: candidate.relationType,
      strength: candidate.strength,
      reasoningJa: candidate.reasoningJa,
      source: candidate.source,
    });
  }

  const input: CardCoachAnalysisInput = {
    card,
    level,
    compatibleCards,
  };

  const sourceDataHash = hashSourceData({
    promptVersion: CARD_COACH_PROMPT_VERSION,
    card,
    compatibleCards: compatibleCards.map((candidate) => {
      const sourceCandidate = compatibleById.get(candidate.card.id);
      return {
        card: candidate.card,
        relationType: candidate.relationType,
        strength: candidate.strength,
        reasoningJa: candidate.reasoningJa,
        source: candidate.source,
        rank: sourceCandidate ? compatible.indexOf(sourceCandidate) + 1 : null,
      };
    }),
  });

  return { input, sourceDataHash };
}

export async function generateAndStoreCardCoachGuide(
  cardId: string,
  level: CardCoachLevel = "easy",
): Promise<CardCoachGuideView> {
  const prepared = await prepareCardCoachGeneration(cardId, level);
  const result = await analyzeCardCoach(prepared.input);
  const generatedAt = new Date();

  await writeStoredCardCoachGuideToDb(db, {
    cardId,
    level,
    guide: result.guide,
    sourceDataHash: prepared.sourceDataHash,
    promptVersion: CARD_COACH_PROMPT_VERSION,
    aiModelVersion: result.modelVersion,
    generatedAt,
    updatedAt: generatedAt,
  });

  return toGuideView(
    {
      cardId,
      level,
      guide: result.guide,
      sourceDataHash: prepared.sourceDataHash,
      promptVersion: CARD_COACH_PROMPT_VERSION,
      aiModelVersion: result.modelVersion,
      generatedAt: generatedAt.toISOString(),
      updatedAt: generatedAt.toISOString(),
    },
    "card_coach",
  );
}

async function getPlaystyleFallbackGuide(
  cardId: string,
  level: CardCoachLevel,
): Promise<CardCoachGuideView | null> {
  const playstyle = await getCardPlaystyle(cardId);
  if (!playstyle) return null;

  const compatible = await getCompatibleCards(cardId, 5);
  const verifiedRefs = await readCardRefsByIdsFromDb(
    db,
    compatible.map((candidate) => candidate.card.id),
  );

  const guide: CardCoachGuide = {
    summaryJa:
      "このカードの詳しい Card Coach はまだありません。先に、既存の使い方ガイドから大事なポイントを表示しています。",
    roles: ["基本の使い方"],
    purposeJa: playstyle.vsOpponentJa,
    timing: [playstyle.whenToPlayJa],
    strongSituations: [playstyle.shinesInJa],
    terms: [],
    compatibleCards: compatible
      .filter((candidate) => verifiedRefs[candidate.card.id])
      .map((candidate) => ({
        cardId: candidate.card.id,
        reasonJa: candidate.reasoningJa,
      })),
    combos: [],
    exampleJa: playstyle.vsOpponentJa,
    playRoutes: [],
    fallbackPlanJa:
      "目当ての動きができない時は、無理に使わず手札と場を整えて、次に強く使えるタイミングを待ちます。",
    commonMistakesJa: [
      "強い場面を待ちすぎて、使うタイミングを逃さないようにします。",
    ],
  };

  return {
    cardId,
    level,
    guide,
    sourceDataHash: `card_playstyles:${cardId}:${playstyle.generatedAt ?? "unknown"}`,
    promptVersion: "card-playstyle-fallback",
    aiModelVersion: playstyle.aiModelVersion,
    generatedAt: playstyle.generatedAt,
    updatedAt: playstyle.generatedAt,
    source: "playstyle_fallback",
    cardRefs: verifiedRefs,
  };
}

async function toGuideView(
  stored: StoredCardCoachGuide,
  source: CardCoachGuideView["source"],
): Promise<CardCoachGuideView> {
  const ids = collectGuideCardIds(stored.cardId, stored.guide);
  const cardRefs = await readCardRefsByIdsFromDb(db, ids);
  return {
    ...stored,
    source,
    cardRefs,
  };
}

function collectGuideCardIds(cardId: string, guide: CardCoachGuide): string[] {
  const ids = new Set<string>([cardId]);
  for (const candidate of guide.compatibleCards) ids.add(candidate.cardId);
  for (const combo of guide.combos) {
    for (const comboCardId of combo.cardIds) ids.add(comboCardId);
  }
  return [...ids];
}

function hashSourceData(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

export const _cardCoachLibTestInternals = {
  collectGuideCardIds,
  hashSourceData,
  stableStringify,
  UnverifiedCardFactError,
};
