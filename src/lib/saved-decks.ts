import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  cardRestrictionPairs,
  cardRestrictions,
  cardTranslations,
  cards,
  deckCards,
  decks,
} from "@/db/schema";
import type { CardTranslationSource } from "@/db/schema";
import { evaluateDeck, type EvalCard } from "@/lib/deck-evaluation";
import {
  validateDeck,
  type DeckLeader,
  type DeckRegulations,
  type DeckRuleReport,
} from "@/lib/deck-rules";

export interface SaveDeckEntryInput {
  cardId: string;
  count: number;
}

export interface SaveDeckInput {
  leaderCardId: string;
  name: string;
  notes?: string | null;
  format?: string;
  entries: SaveDeckEntryInput[];
}

export interface SavedDeckCard {
  id: string;
  setCode: string;
  cardType: string;
  name: string;
  colors: string[];
  features: string[];
  attributes: string[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  life: number | null;
  rarity: string | null;
  hasTrigger: boolean;
  imageUrlJp: string | null;
  mechanics: string[];
  source: CardTranslationSource;
  verified: boolean;
}

export interface SavedDeckEntry {
  card: SavedDeckCard;
  count: number;
}

export interface SavedDeckSummary {
  id: string;
  name: string;
  format: string;
  notes: string | null;
  leader: SavedDeckCard;
  totalCards: number;
  createdAt: Date | number | string;
  updatedAt: Date | number | string;
}

export interface SavedDeckDetail extends SavedDeckSummary {
  entries: SavedDeckEntry[];
  evaluationScores: Record<string, number>;
  ruleReport: DeckRuleReport;
}

export class SavedDeckError extends Error {
  constructor(
    public readonly code:
      | "card_not_found"
      | "duplicate_entry"
      | "invalid_count"
      | "invalid_name"
      | "illegal_deck"
      | "not_a_leader",
    message: string,
    public readonly status = 400,
    public readonly violations: DeckRuleReport["violations"] = [],
  ) {
    super(message);
    this.name = "SavedDeckError";
  }
}

export class DeckRegulationsUnavailableError extends Error {
  constructor(
    message = "Active card restrictions could not be loaded.",
  ) {
    super(message);
    this.name = "DeckRegulationsUnavailableError";
  }
}

const LANGUAGE = "ja";

interface CardRow {
  id: string;
  setCode: string;
  cardType: string;
  colors: string[] | null;
  attributes: string[] | null;
  features: string[] | null;
  mechanics: string[] | null;
  cost: number | null;
  power: number | null;
  counter: number | null;
  life: number | null;
  rarity: string | null;
  hasTrigger: boolean;
  imageUrlJp: string | null;
  name: string | null;
  source: CardTranslationSource | null;
  verified: boolean | null;
}

export async function listSavedDecks(limit = 50): Promise<SavedDeckSummary[]> {
  const cappedLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows = await db
    .select({
      id: decks.id,
      name: decks.name,
      format: decks.format,
      notes: decks.notes,
      leaderCardId: decks.leaderCardId,
      createdAt: decks.createdAt,
      updatedAt: decks.updatedAt,
    })
    .from(decks)
    .orderBy(desc(decks.updatedAt))
    .limit(cappedLimit);

  if (rows.length === 0) return [];

  const deckIds = rows.map((row) => row.id);
  const leaders = await fetchCardsById(rows.map((row) => row.leaderCardId));
  const totals = await db
    .select({
      deckId: deckCards.deckId,
      total: sql<number>`sum(${deckCards.count})`,
    })
    .from(deckCards)
    .where(inArray(deckCards.deckId, deckIds))
    .groupBy(deckCards.deckId);
  const totalByDeck = new Map(
    totals.map((row) => [row.deckId, Number(row.total ?? 0)]),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    format: row.format,
    notes: row.notes,
    leader: leaders.get(row.leaderCardId) ?? missingCard(row.leaderCardId),
    totalCards: totalByDeck.get(row.id) ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function getSavedDeck(id: string): Promise<SavedDeckDetail | null> {
  const deckRows = await db
    .select({
      id: decks.id,
      name: decks.name,
      format: decks.format,
      notes: decks.notes,
      leaderCardId: decks.leaderCardId,
      evaluationScores: decks.evaluationScores,
      createdAt: decks.createdAt,
      updatedAt: decks.updatedAt,
    })
    .from(decks)
    .where(eq(decks.id, id))
    .limit(1);

  const row = deckRows[0];
  if (!row) return null;

  const entryRows = await db
    .select({
      count: deckCards.count,
      cardId: deckCards.cardId,
    })
    .from(deckCards)
    .where(eq(deckCards.deckId, id))
    .orderBy(asc(deckCards.cardId));

  const cardsById = await fetchCardsById([
    row.leaderCardId,
    ...entryRows.map((entry) => entry.cardId),
  ]);
  const leader = cardsById.get(row.leaderCardId) ?? missingCard(row.leaderCardId);
  const entries = entryRows.map<SavedDeckEntry>((entry) => ({
    card: cardsById.get(entry.cardId) ?? missingCard(entry.cardId),
    count: entry.count,
  })).sort((a, b) => {
    const aCost = a.card.cost ?? 99;
    const bCost = b.card.cost ?? 99;
    return aCost - bCost || a.card.id.localeCompare(b.card.id);
  });
  const ruleReport = await validateSavedDeckForCurrentRules({
    leader,
    entries,
  });

  return {
    id: row.id,
    name: row.name,
    format: row.format,
    notes: row.notes,
    leader,
    entries,
    totalCards: entries.reduce((sum, entry) => sum + entry.count, 0),
    evaluationScores: normalizeScores(row.evaluationScores),
    ruleReport,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function validateSavedDeckForCurrentRules(
  deck: Pick<SavedDeckDetail, "leader" | "entries">,
): Promise<DeckRuleReport> {
  return validateDeck(
    {
      id: deck.leader.id,
      name: deck.leader.name,
      colors: deck.leader.colors,
    },
    deck.entries.map(({ card, count }) => ({
      id: card.id,
      cardType: card.cardType,
      colors: card.colors,
      count,
    })),
    await activeRegulations(),
  );
}

export async function createSavedDeck(
  input: SaveDeckInput,
): Promise<SavedDeckDetail> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    throw new SavedDeckError(
      "invalid_name",
      "Deck name must be between 1 and 80 characters.",
    );
  }

  const entries = normalizeEntries(input.entries);
  const ids = [...new Set([input.leaderCardId, ...entries.map((e) => e.cardId)])];
  const cardMap = await fetchCardsById(ids);
  const missing = ids.filter((id) => !cardMap.has(id));
  if (missing.length > 0) {
    throw new SavedDeckError(
      "card_not_found",
      `Unknown card id(s): ${missing.join(", ")}`,
      404,
    );
  }

  const leader = cardMap.get(input.leaderCardId)!;
  if (leader.cardType !== "LEADER") {
    throw new SavedDeckError(
      "not_a_leader",
      `${input.leaderCardId} is not a leader card.`,
      400,
    );
  }

  const ruleCards = entries.map((entry) => {
    const card = cardMap.get(entry.cardId)!;
    return {
      id: card.id,
      cardType: card.cardType,
      colors: card.colors,
      count: entry.count,
    };
  });
  const leaderShape: DeckLeader = {
    id: leader.id,
    name: leader.name,
    colors: leader.colors,
  };
  const ruleReport = validateDeck(
    leaderShape,
    ruleCards,
    await activeRegulations(),
  );

  if (!ruleReport.legal) {
    throw new SavedDeckError(
      "illegal_deck",
      "Deck failed One Piece TCG construction rules.",
      422,
      ruleReport.violations,
    );
  }

  const evaluation = evaluateDeck(
    entries.map<EvalCard>((entry) => {
      const card = cardMap.get(entry.cardId)!;
      return {
        id: card.id,
        cardType: card.cardType,
        colors: card.colors,
        features: card.features,
        cost: card.cost,
        power: card.power,
        counter: card.counter,
        hasTrigger: card.hasTrigger,
        mechanics: card.mechanics,
        count: entry.count,
      };
    }),
  );
  const evaluationScores = {
    attack: evaluation.attack.score,
    stability: evaluation.stability.score,
    expansion: evaluation.expansion.score,
    defense: evaluation.defense.score,
    meta: evaluation.meta.score,
  };
  const deckId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(decks).values({
      id: deckId,
      leaderCardId: leader.id,
      name,
      format: input.format ?? "standard",
      notes: input.notes?.trim() ? input.notes.trim() : null,
      evaluationScores,
      isPublic: false,
    });
    await tx.insert(deckCards).values(
      entries.map((entry) => ({
        deckId,
        cardId: entry.cardId,
        count: entry.count,
      })),
    );
  });

  const saved = await getSavedDeck(deckId);
  if (!saved) throw new Error(`Saved deck ${deckId} could not be reloaded.`);
  return saved;
}

function normalizeEntries(entries: SaveDeckEntryInput[]): SaveDeckEntryInput[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const cardId = entry.cardId.trim();
    if (!cardId) {
      throw new SavedDeckError("card_not_found", "Card id cannot be blank.");
    }
    if (!Number.isInteger(entry.count) || entry.count < 1 || entry.count > 4) {
      throw new SavedDeckError(
        "invalid_count",
        `Invalid count for ${cardId}: ${entry.count}`,
      );
    }
    counts.set(cardId, (counts.get(cardId) ?? 0) + entry.count);
  }

  const normalized = [...counts.entries()].map(([cardId, count]) => {
    if (count > 4) {
      throw new SavedDeckError(
        "duplicate_entry",
        `${cardId} appears more than 4 times after merging duplicates.`,
      );
    }
    return { cardId, count };
  });
  normalized.sort((a, b) => a.cardId.localeCompare(b.cardId));
  return normalized;
}

async function fetchCardsById(ids: string[]): Promise<Map<string, SavedDeckCard>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select({
      card: cardSelection(),
    })
    .from(cards)
    .leftJoin(
      cardTranslations,
      and(
        eq(cardTranslations.cardId, cards.id),
        eq(cardTranslations.language, LANGUAGE),
      ),
    )
    .where(inArray(cards.id, ids));

  return new Map(
    rows.map((row) => {
      const card = toSavedDeckCard(row.card);
      return [card.id, card];
    }),
  );
}

function cardSelection() {
  return {
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
    source: cardTranslations.source,
    verified: cardTranslations.verified,
  };
}

function toSavedDeckCard(row: CardRow): SavedDeckCard {
  return {
    id: row.id,
    setCode: row.setCode,
    cardType: row.cardType,
    name: row.name ?? row.id,
    colors: (row.colors ?? []) as string[],
    attributes: (row.attributes ?? []) as string[],
    features: (row.features ?? []) as string[],
    mechanics: (row.mechanics ?? []) as string[],
    cost: row.cost,
    power: row.power,
    counter: row.counter,
    life: row.life,
    rarity: row.rarity,
    hasTrigger: Boolean(row.hasTrigger),
    imageUrlJp: row.imageUrlJp,
    source: (row.source ?? "manual") as CardTranslationSource,
    verified: Boolean(row.verified),
  };
}

function missingCard(id: string): SavedDeckCard {
  return {
    id,
    setCode: "",
    cardType: "UNKNOWN",
    name: id,
    colors: [],
    attributes: [],
    features: [],
    mechanics: [],
    cost: null,
    power: null,
    counter: null,
    life: null,
    rarity: null,
    hasTrigger: false,
    imageUrlJp: null,
    source: "manual",
    verified: false,
  };
}

function normalizeScores(
  scores: Record<string, number> | null,
): Record<string, number> {
  return scores ?? {};
}

export async function activeRegulations(): Promise<DeckRegulations> {
  try {
    const [singles, pairs] = await Promise.all([
      db
        .select({
          cardId: cardRestrictions.cardId,
          maxCopies: cardRestrictions.maxCopies,
        })
        .from(cardRestrictions)
        .where(sql`${cardRestrictions.effectiveUntil} IS NULL`),
      db
        .select({
          cardIdA: cardRestrictionPairs.cardIdA,
          cardIdB: cardRestrictionPairs.cardIdB,
        })
        .from(cardRestrictionPairs)
        .where(sql`${cardRestrictionPairs.effectiveUntil} IS NULL`),
    ]);

    return {
      perCardMax: new Map(singles.map((row) => [row.cardId, row.maxCopies])),
      pairBans: pairs,
    };
  } catch {
    throw new DeckRegulationsUnavailableError(
      "Active card restrictions could not be loaded; refusing to validate a saved deck without current regulations.",
    );
  }
}
