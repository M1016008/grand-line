/**
 * Card query layer.
 *
 * Server-side only. The flow is:
 *   1. Try the database (Turso/local libSQL).
 *   2. If the request fails *or* the cards table is empty, fall back to the
 *      hand-curated mock catalogue so the UI is reviewable end-to-end before
 *      a real scrape has populated the DB.
 *   3. Mark mock-derived results with `usingMock: true` so the UI can show
 *      a banner instead of pretending the data is real.
 */
import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { cardTranslations, cards } from "@/db/schema";
import type { CardTranslationSource } from "@/db/schema";
import { MOCK_CARDS, type MockCard } from "@/lib/mock-cards";

export interface CardListItem {
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
  source: CardTranslationSource;
  verified: boolean;
}

export interface CardDetail extends CardListItem {
  effectText: string | null;
  triggerText: string | null;
  flavorText: string | null;
  sourceUrl: string | null;
  fetchedAt: Date | null;
  mechanics: string[];
}

export interface CardListResult {
  cards: CardListItem[];
  total: number;
  usingMock: boolean;
}

export interface CardListFilters {
  language?: string;
  cardType?: string;
  color?: string;
  feature?: string;
  text?: string; // free-text query against card_translations FTS
  cost?: number;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Public API                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

export async function listCards(
  filters: CardListFilters = {},
  limit = 60,
): Promise<CardListResult> {
  try {
    const live = await listFromDb(filters, limit);
    if (live.cards.length > 0) return live;
  } catch (err) {
    console.warn("[cards] DB query failed, falling back to mock:", err);
  }
  return listFromMock(filters, limit);
}

export async function getCard(id: string, language = "ja"): Promise<CardDetail | null> {
  try {
    const live = await getFromDb(id, language);
    if (live) return live;
  } catch (err) {
    console.warn(`[cards] getCard(${id}) DB query failed, falling back to mock:`, err);
  }
  return getFromMock(id);
}

/* ──────────────────────────────────────────────────────────────────────── */
/* DB-backed implementations                                                 */
/* ──────────────────────────────────────────────────────────────────────── */

async function listFromDb(
  filters: CardListFilters,
  limit: number,
): Promise<CardListResult> {
  const language = filters.language ?? "ja";

  const rows = await db
    .select({
      id: cards.id,
      setCode: cards.setCode,
      cardType: cards.cardType,
      colors: cards.colors,
      attributes: cards.attributes,
      features: cards.features,
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
    })
    .from(cards)
    .leftJoin(
      cardTranslations,
      sql`${cardTranslations.cardId} = ${cards.id} AND ${cardTranslations.language} = ${language}`,
    )
    .limit(limit);

  const filtered = rows
    .map<CardListItem>((r) => ({
      id: r.id,
      setCode: r.setCode,
      cardType: r.cardType,
      name: r.name ?? r.id,
      colors: (r.colors ?? []) as string[],
      attributes: (r.attributes ?? []) as string[],
      features: (r.features ?? []) as string[],
      cost: r.cost,
      power: r.power,
      counter: r.counter,
      life: r.life,
      rarity: r.rarity,
      hasTrigger: r.hasTrigger,
      imageUrlJp: r.imageUrlJp,
      source: (r.source ?? "manual") as CardTranslationSource,
      verified: Boolean(r.verified),
    }))
    .filter((c) => matches(c, filters));

  return { cards: filtered, total: filtered.length, usingMock: false };
}

async function getFromDb(id: string, language: string): Promise<CardDetail | null> {
  const row = await db
    .select({
      id: cards.id,
      setCode: cards.setCode,
      cardType: cards.cardType,
      colors: cards.colors,
      attributes: cards.attributes,
      features: cards.features,
      cost: cards.cost,
      power: cards.power,
      counter: cards.counter,
      life: cards.life,
      rarity: cards.rarity,
      hasTrigger: cards.hasTrigger,
      imageUrlJp: cards.imageUrlJp,
      mechanics: cards.mechanics,
      name: cardTranslations.name,
      effectText: cardTranslations.effectText,
      triggerText: cardTranslations.triggerText,
      flavorText: cardTranslations.flavorText,
      sourceUrl: cardTranslations.sourceUrl,
      fetchedAt: cardTranslations.fetchedAt,
      source: cardTranslations.source,
      verified: cardTranslations.verified,
    })
    .from(cards)
    .leftJoin(
      cardTranslations,
      sql`${cardTranslations.cardId} = ${cards.id} AND ${cardTranslations.language} = ${language}`,
    )
    .where(eq(cards.id, id))
    .limit(1);

  if (row.length === 0) return null;
  const r = row[0];
  return {
    id: r.id,
    setCode: r.setCode,
    cardType: r.cardType,
    name: r.name ?? r.id,
    colors: (r.colors ?? []) as string[],
    attributes: (r.attributes ?? []) as string[],
    features: (r.features ?? []) as string[],
    cost: r.cost,
    power: r.power,
    counter: r.counter,
    life: r.life,
    rarity: r.rarity,
    hasTrigger: r.hasTrigger,
    imageUrlJp: r.imageUrlJp,
    mechanics: (r.mechanics ?? []) as string[],
    effectText: r.effectText,
    triggerText: r.triggerText,
    flavorText: r.flavorText,
    sourceUrl: r.sourceUrl,
    fetchedAt: r.fetchedAt,
    source: (r.source ?? "manual") as CardTranslationSource,
    verified: Boolean(r.verified),
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Mock-backed fallback                                                      */
/* ──────────────────────────────────────────────────────────────────────── */

function listFromMock(filters: CardListFilters, limit: number): CardListResult {
  const filtered = MOCK_CARDS.filter((c) => matches(toListItem(c), filters)).slice(0, limit);
  return {
    cards: filtered.map(toListItem),
    total: filtered.length,
    usingMock: true,
  };
}

function getFromMock(id: string): CardDetail | null {
  const c = MOCK_CARDS.find((x) => x.id === id);
  if (!c) return null;
  return {
    ...toListItem(c),
    mechanics: c.mechanics,
    effectText: c.effectText,
    triggerText: c.triggerText,
    flavorText: null,
    sourceUrl: null,
    fetchedAt: null,
  };
}

function toListItem(c: MockCard): CardListItem {
  return {
    id: c.id,
    setCode: c.setCode,
    cardType: c.cardType,
    name: c.name,
    colors: c.colors,
    attributes: c.attributes,
    features: c.features,
    cost: c.cost,
    power: c.power,
    counter: c.counter,
    life: c.life,
    rarity: c.rarity,
    hasTrigger: c.hasTrigger,
    imageUrlJp: c.imageUrlJp,
    source: c.source,
    verified: c.verified,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Filter logic (in-memory, identical for DB and mock paths)                */
/* ──────────────────────────────────────────────────────────────────────── */

function matches(card: CardListItem, f: CardListFilters): boolean {
  if (f.cardType && card.cardType !== f.cardType) return false;
  if (f.color && !card.colors.includes(f.color)) return false;
  if (f.feature && !card.features.some((x) => x.includes(f.feature!))) return false;
  if (typeof f.cost === "number" && card.cost !== f.cost) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    if (
      !card.name.toLowerCase().includes(q) &&
      !card.features.some((feat) => feat.toLowerCase().includes(q))
    ) {
      return false;
    }
  }
  return true;
}
