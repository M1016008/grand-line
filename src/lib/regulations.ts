import "server-only";

import { asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  cardRestrictionPairs,
  cardRestrictions,
  cardTranslations,
  cards,
} from "@/db/schema";

export interface RegulationRow {
  cardId: string;
  name: string;
  cardType: string;
  setCode: string;
  maxCopies: number;
  effectiveFrom: string;
  imageUrlJp: string | null;
}

export interface RegulationPair {
  cardA: { id: string; name: string; imageUrlJp: string | null };
  cardB: { id: string; name: string; imageUrlJp: string | null };
  effectiveFrom: string;
}

export interface RegulationsView {
  banned: RegulationRow[];
  restricted: RegulationRow[];
  pairs: RegulationPair[];
  /** ISO date of the most recent fetched_at value across both tables. */
  lastFetchedAt: string | null;
}

export async function getRegulationsView(): Promise<RegulationsView> {
  try {
    const [singleRows, pairRows, lastSingle, lastPair] = await Promise.all([
      db
        .select({
          cardId: cardRestrictions.cardId,
          maxCopies: cardRestrictions.maxCopies,
          effectiveFrom: cardRestrictions.effectiveFrom,
          name: cardTranslations.name,
          cardType: cards.cardType,
          setCode: cards.setCode,
          imageUrlJp: cards.imageUrlJp,
        })
        .from(cardRestrictions)
        .innerJoin(cards, eq(cards.id, cardRestrictions.cardId))
        .leftJoin(
          cardTranslations,
          sql`${cardTranslations.cardId} = ${cardRestrictions.cardId} AND ${cardTranslations.language} = 'ja'`,
        )
        .where(isNull(cardRestrictions.effectiveUntil))
        .orderBy(asc(cardRestrictions.cardId)),
      db
        .select({
          cardIdA: cardRestrictionPairs.cardIdA,
          cardIdB: cardRestrictionPairs.cardIdB,
          effectiveFrom: cardRestrictionPairs.effectiveFrom,
        })
        .from(cardRestrictionPairs)
        .where(isNull(cardRestrictionPairs.effectiveUntil))
        .orderBy(asc(cardRestrictionPairs.cardIdA), asc(cardRestrictionPairs.cardIdB)),
      db
        .select({ ts: sql<number>`MAX(${cardRestrictions.fetchedAt})` })
        .from(cardRestrictions),
      db
        .select({ ts: sql<number>`MAX(${cardRestrictionPairs.fetchedAt})` })
        .from(cardRestrictionPairs),
    ]);

    const banned: RegulationRow[] = [];
    const restricted: RegulationRow[] = [];
    for (const r of singleRows) {
      const row: RegulationRow = {
        cardId: r.cardId,
        name: r.name ?? r.cardId,
        cardType: r.cardType,
        setCode: r.setCode,
        maxCopies: r.maxCopies,
        effectiveFrom: r.effectiveFrom,
        imageUrlJp: r.imageUrlJp,
      };
      if (r.maxCopies === 0) banned.push(row);
      else restricted.push(row);
    }

    // Hydrate pair card details (need names + images) — one extra query.
    const pairCardIds = Array.from(
      new Set(pairRows.flatMap((p) => [p.cardIdA, p.cardIdB])),
    );
    const cardLookup = new Map<
      string,
      { name: string; imageUrlJp: string | null }
    >();
    if (pairCardIds.length > 0) {
      const detailRows = await db
        .select({
          id: cards.id,
          name: cardTranslations.name,
          imageUrlJp: cards.imageUrlJp,
        })
        .from(cards)
        .leftJoin(
          cardTranslations,
          sql`${cardTranslations.cardId} = ${cards.id} AND ${cardTranslations.language} = 'ja'`,
        )
        .where(sql`${cards.id} IN ${pairCardIds}`);
      for (const d of detailRows) {
        cardLookup.set(d.id, { name: d.name ?? d.id, imageUrlJp: d.imageUrlJp });
      }
    }

    const pairs: RegulationPair[] = pairRows.map((p) => ({
      cardA: {
        id: p.cardIdA,
        name: cardLookup.get(p.cardIdA)?.name ?? p.cardIdA,
        imageUrlJp: cardLookup.get(p.cardIdA)?.imageUrlJp ?? null,
      },
      cardB: {
        id: p.cardIdB,
        name: cardLookup.get(p.cardIdB)?.name ?? p.cardIdB,
        imageUrlJp: cardLookup.get(p.cardIdB)?.imageUrlJp ?? null,
      },
      effectiveFrom: p.effectiveFrom,
    }));

    const ts = Math.max(
      Number(lastSingle[0]?.ts ?? 0),
      Number(lastPair[0]?.ts ?? 0),
    );
    const lastFetchedAt =
      ts > 0 ? new Date(ts * 1000).toISOString().slice(0, 10) : null;

    return { banned, restricted, pairs, lastFetchedAt };
  } catch {
    return { banned: [], restricted: [], pairs: [], lastFetchedAt: null };
  }
}
