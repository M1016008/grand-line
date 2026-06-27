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

import { and, asc, eq, inArray, like, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  cardRestrictionPairs,
  cardRestrictions,
  cardSetMembership,
  cardSets,
  cardTranslations,
  cards,
} from "@/db/schema";
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
  /**
   * Canonical mechanics ids (see `src/lib/mechanics.ts`). Carrying these on
   * the list shape lets the deck builder + evaluator filter and score
   * without doing per-card detail fetches.
   */
  mechanics: string[];
  source: CardTranslationSource;
  verified: boolean;
}

export interface CardSetMembership {
  code: string;
  nameJa: string;
  setType: string;
  /** Whether this is the canonical owning set (matches cards.set_code). */
  canonical: boolean;
}

export interface CardDetail extends CardListItem {
  effectText: string | null;
  triggerText: string | null;
  flavorText: string | null;
  sourceUrl: string | null;
  fetchedAt: Date | null;
  /** All sets this card has appeared in (canonical first, then reprints). */
  memberships: CardSetMembership[];
  /** Active single-card restriction (banned/restricted), if any. */
  restriction: { maxCopies: number; effectiveFrom: string } | null;
  /** Pair bans the card participates in. */
  pairBans: Array<{ partnerId: string; partnerName?: string }>;
}

export interface CardListResult {
  cards: CardListItem[];
  /** Total matching the filter (not paginated). */
  total: number;
  /** Total cards in the DB regardless of filter — used to render
   * "{filtered} / {total}" in the UI header. */
  totalAll: number;
  usingMock: boolean;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface CardListFilters {
  language?: string;
  cardType?: string;
  setCode?: string;
  color?: string;
  feature?: string;
  text?: string; // matches name + features
  cost?: number;
  /** 1-based page number. */
  page?: number;
  pageSize?: number;
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Public API                                                                */
/* ──────────────────────────────────────────────────────────────────────── */

export async function listCards(
  filters: CardListFilters = {},
  /** @deprecated use `filters.pageSize` — kept for callers that just want a slice. */
  limit = 60,
): Promise<CardListResult> {
  const pageSize = filters.pageSize ?? limit;
  const page = Math.max(1, filters.page ?? 1);
  const augmented: CardListFilters = { ...filters, pageSize, page };
  try {
    const live = await listFromDb(augmented);
    if (live.totalAll > 0) return live;
  } catch (err) {
    console.warn("[cards] DB query failed, falling back to mock:", err);
  }
  return listFromMock(augmented);
}

export interface SetSummary {
  code: string;
  nameJa: string;
  setType: string;
  cardCount: number;
}

export interface ActiveRestrictions {
  /** Map of card_id → max_copies (0 = banned, 1-3 = restricted). */
  perCardMax: Map<string, number>;
  /** Banned pairs, normalized so cardIdA < cardIdB. */
  pairBans: Array<{ cardIdA: string; cardIdB: string }>;
}

/**
 * All currently-active card restrictions. Returns empty maps when the
 * regulation table is missing / empty (mock mode).
 */
export async function getActiveRestrictions(): Promise<ActiveRestrictions> {
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
      perCardMax: new Map(singles.map((r) => [r.cardId, r.maxCopies])),
      pairBans: pairs,
    };
  } catch {
    return { perCardMax: new Map(), pairBans: [] };
  }
}

/** Sets currently in the DB, ordered by their code. Used by the filter UI. */
export async function listSets(): Promise<SetSummary[]> {
  try {
    const rows = await db
      .select({
        code: cardSets.code,
        nameJa: cardSets.nameJa,
        setType: cardSets.setType,
        cardCount: sql<number>`(SELECT COUNT(*) FROM cards WHERE cards.set_code = card_sets.code)`,
      })
      .from(cardSets)
      .orderBy(asc(cardSets.code));
    return rows.map((r) => ({
      code: r.code,
      nameJa: r.nameJa,
      setType: r.setType,
      cardCount: Number(r.cardCount ?? 0),
    }));
  } catch {
    return [];
  }
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

async function listFromDb(filters: CardListFilters): Promise<CardListResult> {
  const language = filters.language ?? "ja";
  const pageSize = filters.pageSize ?? 60;
  const page = Math.max(1, filters.page ?? 1);
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];
  if (filters.cardType) {
    // The column has an enum constraint; cast to the unioned literal so
    // the user-facing string type satisfies Drizzle's narrow signature.
    conditions.push(eq(cards.cardType, filters.cardType as "LEADER"));
  }
  if (typeof filters.cost === "number") conditions.push(eq(cards.cost, filters.cost));

  // colors / features / mechanics are JSON arrays stored as TEXT. Until the
  // SQLite JSON1 path is wired through Drizzle for typed queries, a quoted
  // LIKE works ("red" appears as `"red"` inside the JSON literal).
  if (filters.color) {
    conditions.push(like(cards.colors as unknown as SQL, `%"${filters.color}"%`));
  }
  if (filters.feature) {
    conditions.push(
      like(cards.features as unknown as SQL, `%${filters.feature}%`),
    );
  }
  if (filters.text) {
    conditions.push(
      or(
        like(cardTranslations.name, `%${filters.text}%`),
        like(cards.features as unknown as SQL, `%${filters.text}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const listColumns = {
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

  // Count of all cards in the DB regardless of filter — for the header.
  const totalAllRow = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(cards);
  const totalAll = Number(totalAllRow[0]?.n ?? 0);
  if (totalAll === 0) {
    return {
      cards: [],
      total: 0,
      totalAll: 0,
      usingMock: false,
      page,
      pageSize,
      pageCount: 0,
    };
  }

  let total: number;
  let rows: Array<{
    id: string;
    setCode: string;
    cardType: string;
    colors: string[];
    attributes: string[];
    features: string[];
    mechanics: string[];
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
  }>;

  if (filters.setCode) {
    // Read from the set membership index first. This captures reprints without
    // scanning every card, which matters as daily scraping adds more sets.
    const setWhere = and(eq(cardSetMembership.setCode, filters.setCode), where ?? sql`1=1`);
    const totalRow = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(cardSetMembership)
      .innerJoin(cards, eq(cardSetMembership.cardId, cards.id))
      .leftJoin(
        cardTranslations,
        sql`${cardTranslations.cardId} = ${cards.id} AND ${cardTranslations.language} = ${language}`,
      )
      .where(setWhere);
    total = Number(totalRow[0]?.n ?? 0);

    rows = await db
      .select(listColumns)
      .from(cardSetMembership)
      .innerJoin(cards, eq(cardSetMembership.cardId, cards.id))
      .leftJoin(
        cardTranslations,
        sql`${cardTranslations.cardId} = ${cards.id} AND ${cardTranslations.language} = ${language}`,
      )
      .where(setWhere)
      .orderBy(asc(cardSetMembership.cardId))
      .limit(pageSize)
      .offset(offset);
  } else {
    const totalRow = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(cards)
      .leftJoin(
        cardTranslations,
        sql`${cardTranslations.cardId} = ${cards.id} AND ${cardTranslations.language} = ${language}`,
      )
      .where(where ?? sql`1=1`);
    total = Number(totalRow[0]?.n ?? 0);

    rows = await db
      .select(listColumns)
      .from(cards)
      .leftJoin(
        cardTranslations,
        sql`${cardTranslations.cardId} = ${cards.id} AND ${cardTranslations.language} = ${language}`,
      )
      .where(where ?? sql`1=1`)
      .orderBy(asc(cards.setCode), asc(cards.id))
      .limit(pageSize)
      .offset(offset);
  }

  return {
    cards: rows.map<CardListItem>((r) => ({
      id: r.id,
      setCode: r.setCode,
      cardType: r.cardType,
      name: r.name ?? r.id,
      colors: (r.colors ?? []) as string[],
      attributes: (r.attributes ?? []) as string[],
      features: (r.features ?? []) as string[],
      mechanics: (r.mechanics ?? []) as string[],
      cost: r.cost,
      power: r.power,
      counter: r.counter,
      life: r.life,
      rarity: r.rarity,
      hasTrigger: r.hasTrigger,
      imageUrlJp: r.imageUrlJp,
      source: (r.source ?? "manual") as CardTranslationSource,
      verified: Boolean(r.verified),
    })),
    total,
    totalAll,
    usingMock: false,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
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

  // Fetch every set this card has appeared in (canonical + reprints) plus
  // any active restriction / pair-ban rows. Run in parallel — none of the
  // three depend on each other.
  const [memberRows, restrictionRows, pairRows] = await Promise.all([
    db
      .select({
        code: cardSets.code,
        nameJa: cardSets.nameJa,
        setType: cardSets.setType,
      })
      .from(cardSetMembership)
      .innerJoin(cardSets, eq(cardSetMembership.setCode, cardSets.code))
      .where(eq(cardSetMembership.cardId, id))
      .orderBy(asc(cardSets.code)),
    db
      .select({
        maxCopies: cardRestrictions.maxCopies,
        effectiveFrom: cardRestrictions.effectiveFrom,
      })
      .from(cardRestrictions)
      .where(
        sql`${cardRestrictions.cardId} = ${id} AND ${cardRestrictions.effectiveUntil} IS NULL`,
      )
      .limit(1)
      .catch(() => []),
    db
      .select({
        cardIdA: cardRestrictionPairs.cardIdA,
        cardIdB: cardRestrictionPairs.cardIdB,
      })
      .from(cardRestrictionPairs)
      .where(
        sql`(${cardRestrictionPairs.cardIdA} = ${id} OR ${cardRestrictionPairs.cardIdB} = ${id}) AND ${cardRestrictionPairs.effectiveUntil} IS NULL`,
      )
      .catch(() => []),
  ]);

  const canonical = r.setCode;
  const memberships: CardSetMembership[] = memberRows
    .map((m) => ({ ...m, canonical: m.code === canonical }))
    .sort((a, b) => Number(b.canonical) - Number(a.canonical) || a.code.localeCompare(b.code));
  // Make sure the canonical set is always present even if the membership
  // table hasn't been populated yet (mock-mode or pre-migration data).
  if (!memberships.some((m) => m.code === canonical)) {
    memberships.unshift({
      code: canonical,
      nameJa: canonical,
      setType: "booster",
      canonical: true,
    });
  }

  const restriction = restrictionRows[0]
    ? {
        maxCopies: restrictionRows[0].maxCopies,
        effectiveFrom: restrictionRows[0].effectiveFrom,
      }
    : null;

  // Look up partner card names so the pair-ban badge tooltip can read
  // "ロロノア・ゾロ と..." instead of "OP01-001 と...". One small
  // batched query rather than a per-pair join.
  const partnerIds = pairRows.map((p) =>
    p.cardIdA === id ? p.cardIdB : p.cardIdA,
  );
  const partnerNameRows =
    partnerIds.length > 0
      ? await db
          .select({
            cardId: cardTranslations.cardId,
            name: cardTranslations.name,
          })
          .from(cardTranslations)
          .where(
            and(
              inArray(cardTranslations.cardId, partnerIds),
              eq(cardTranslations.language, "ja"),
            ),
          )
      : [];
  const partnerNameById = new Map(
    partnerNameRows.map((row) => [row.cardId, row.name]),
  );

  const pairBans = pairRows.map((p) => {
    const partnerId = p.cardIdA === id ? p.cardIdB : p.cardIdA;
    return { partnerId, partnerName: partnerNameById.get(partnerId) };
  });

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
    memberships,
    restriction,
    pairBans,
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

function listFromMock(filters: CardListFilters): CardListResult {
  const pageSize = filters.pageSize ?? 60;
  const page = Math.max(1, filters.page ?? 1);
  const all = MOCK_CARDS.map(toListItem);
  const filtered = all.filter((c) => matches(c, filters));
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  return {
    cards: slice,
    total: filtered.length,
    totalAll: all.length,
    usingMock: true,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(filtered.length / pageSize)),
  };
}

function getFromMock(id: string): CardDetail | null {
  const c = MOCK_CARDS.find((x) => x.id === id);
  if (!c) return null;
  return {
    ...toListItem(c),
    effectText: c.effectText,
    triggerText: c.triggerText,
    flavorText: null,
    sourceUrl: null,
    fetchedAt: null,
    memberships: [
      { code: c.setCode, nameJa: c.setCode, setType: "booster", canonical: true },
    ],
    restriction: null,
    pairBans: [],
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
    mechanics: c.mechanics,
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
  if (f.setCode && card.setCode !== f.setCode) return false;
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
