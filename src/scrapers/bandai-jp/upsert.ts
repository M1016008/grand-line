/**
 * Persist parsed Bandai cards into the cards / card_translations tables
 * and record their (card, set) memberships in card_set_membership.
 *
 * Insertion is idempotent: re-running the scraper on the same set updates
 * existing rows in place. Effect text is also normalized + run through the
 * mechanics extractor so the resulting `cards.mechanics` array is ready
 * for downstream filters and synergy detection.
 *
 * `cards.set_code` is treated as the canonical owning set (derived from
 * the id prefix — `OP01-001` always belongs to `OP01`). On conflict we
 * deliberately do *not* overwrite it: a reprint in PRB02 should not
 * relocate the OG OP01-001 to PRB02. Reprints surface via the
 * card_set_membership join table instead.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import {
  cardSets,
  cardSetMembership,
  cardTranslations,
  cards,
} from "@/db/schema";
import { extractMechanics } from "@/lib/mechanics";
import { normalizeEffectText } from "@/lib/normalize";

import { SET_NAMES_JP } from "./fetch";
import type { ScrapedCard } from "./types";

/** Set name lookup. Falls back to a synthetic label when unknown. */
function setName(code: string): { ja: string; en: string | null } {
  const known = SET_NAMES_JP[code];
  if (known) return { ja: known, en: null };
  const prefix = code.slice(0, 2);
  const num = code.slice(2);
  if (prefix === "OP") return { ja: `第${num}弾 (${code})`, en: `Booster ${num}` };
  if (prefix === "ST") return { ja: `スタートデッキ ${num}`, en: `Starter ${num}` };
  if (prefix === "EB") return { ja: `エクストラ ${num}`, en: `Extra ${num}` };
  if (code === "P") return { ja: "プロモーションカード", en: "Promo" };
  return { ja: code, en: code };
}

function setTypeFor(code: string): "booster" | "starter" | "extra" | "promo" {
  if (code.startsWith("ST")) return "starter";
  if (code.startsWith("EB")) return "extra";
  if (code.startsWith("PR") || code === "P") return "promo";
  return "booster";
}

export interface UpsertOptions {
  /**
   * The set code being scraped (e.g. "PRB02"). When provided, every card
   * upserted in this batch is also recorded as a member of this set in
   * `card_set_membership`. This lets a PRB02 best-of pack list every card
   * it reprints, even if those cards' canonical id prefixes point at OP01,
   * OP05, etc.
   */
  scrapedSetCode?: string;
}

export async function upsertScrapedCards(
  scraped: ScrapedCard[],
  opts: UpsertOptions = {},
): Promise<{
  setsTouched: number;
  cardsUpserted: number;
  translationsUpserted: number;
  membershipsAdded: number;
}> {
  if (scraped.length === 0) {
    return {
      setsTouched: 0,
      cardsUpserted: 0,
      translationsUpserted: 0,
      membershipsAdded: 0,
    };
  }

  // Sets to ensure exist: the canonical sets derived from card ids, plus
  // the explicit scraped set if it was passed in. Deduped.
  const allSetCodes = new Set<string>(scraped.map((c) => c.setCode));
  if (opts.scrapedSetCode) allSetCodes.add(opts.scrapedSetCode);

  for (const code of allSetCodes) {
    const names = setName(code);
    await db
      .insert(cardSets)
      .values({
        code,
        nameJa: names.ja,
        nameEn: names.en,
        setType: setTypeFor(code),
      })
      .onConflictDoNothing();
  }

  let cardsUpserted = 0;
  let translationsUpserted = 0;
  let membershipsAdded = 0;

  for (const c of scraped) {
    const effectNormalized = normalizeEffectText(c.effectText);
    const mechanics = extractMechanics(c.effectText, c.triggerText);

    await db
      .insert(cards)
      .values({
        id: c.id,
        setCode: c.setCode,
        cardType: c.cardType,
        colors: c.colors,
        attributes: c.attributes,
        features: c.features,
        mechanics,
        cost: c.cost,
        power: c.power,
        counter: c.counter,
        life: c.life,
        rarity: c.rarity as never,
        hasTrigger: c.hasTrigger,
        imageUrlJp: c.imageUrlJp,
      })
      .onConflictDoUpdate({
        target: cards.id,
        set: {
          // NOTE: setCode intentionally omitted — preserve the canonical
          // owning set on conflict. Reprint membership is tracked
          // separately via cardSetMembership below.
          cardType: c.cardType,
          colors: c.colors,
          attributes: c.attributes,
          features: c.features,
          mechanics,
          cost: c.cost,
          power: c.power,
          counter: c.counter,
          life: c.life,
          rarity: c.rarity as never,
          hasTrigger: c.hasTrigger,
          imageUrlJp: c.imageUrlJp,
          updatedAt: sql`(unixepoch())`,
        },
      });
    cardsUpserted += 1;

    // Membership: canonical set + (if different) the set we're scraping.
    const memberSets = new Set<string>([c.setCode]);
    if (opts.scrapedSetCode && opts.scrapedSetCode !== c.setCode) {
      memberSets.add(opts.scrapedSetCode);
    }
    for (const setCode of memberSets) {
      const result = await db
        .insert(cardSetMembership)
        .values({ cardId: c.id, setCode })
        .onConflictDoNothing()
        .returning({ cardId: cardSetMembership.cardId });
      if (result.length > 0) membershipsAdded += 1;
    }

    await db
      .insert(cardTranslations)
      .values({
        cardId: c.id,
        language: "ja",
        name: c.name,
        effectText: c.effectText,
        effectNormalized: effectNormalized || null,
        flavorText: c.flavorText,
        triggerText: c.triggerText,
        source: "official_jp",
        verified: true,
        sourceUrl: c.sourceUrl,
        fetchedAt: c.fetchedAt,
      })
      .onConflictDoUpdate({
        target: [cardTranslations.cardId, cardTranslations.language],
        set: {
          name: c.name,
          effectText: c.effectText,
          effectNormalized: effectNormalized || null,
          flavorText: c.flavorText,
          triggerText: c.triggerText,
          source: "official_jp",
          verified: true,
          sourceUrl: c.sourceUrl,
          fetchedAt: c.fetchedAt,
          updatedAt: sql`(unixepoch())`,
        },
      });
    translationsUpserted += 1;
  }

  return {
    setsTouched: allSetCodes.size,
    cardsUpserted,
    translationsUpserted,
    membershipsAdded,
  };
}
