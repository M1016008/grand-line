/**
 * Persist parsed Bandai cards into the cards / card_translations tables.
 *
 * Insertion is idempotent: re-running the scraper on the same set updates
 * existing rows in place. Effect text is also normalized + run through the
 * mechanics extractor so the resulting `cards.mechanics` array is ready
 * for downstream filters and synergy detection.
 */
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { cardSets, cardTranslations, cards } from "@/db/schema";
import { extractMechanics } from "@/lib/mechanics";
import { normalizeEffectText } from "@/lib/normalize";

import type { ScrapedCard } from "./types";

/** Best-effort set name; refined later when we scrape the set list page. */
function defaultSetName(code: string): { ja: string; en: string | null } {
  const prefix = code.slice(0, 2);
  const num = code.slice(2);
  if (prefix === "OP") return { ja: `第${num}弾 (${code})`, en: `Booster ${num}` };
  if (prefix === "ST") return { ja: `スタートデッキ ${num}`, en: `Starter ${num}` };
  if (prefix === "EB") return { ja: `エクストラ ${num}`, en: `Extra ${num}` };
  return { ja: code, en: code };
}

export async function upsertScrapedCards(scraped: ScrapedCard[]): Promise<{
  setsTouched: number;
  cardsUpserted: number;
  translationsUpserted: number;
}> {
  if (scraped.length === 0) {
    return { setsTouched: 0, cardsUpserted: 0, translationsUpserted: 0 };
  }

  // 1. Ensure every referenced set exists. We only touch sets we've actually
  // scraped; sets without cards stay untouched.
  const setCodes = Array.from(new Set(scraped.map((c) => c.setCode)));
  for (const code of setCodes) {
    const names = defaultSetName(code);
    await db
      .insert(cardSets)
      .values({
        code,
        nameJa: names.ja,
        nameEn: names.en,
        setType: code.startsWith("ST")
          ? "starter"
          : code.startsWith("EB")
            ? "extra"
            : code.startsWith("PR")
              ? "promo"
              : "booster",
      })
      .onConflictDoNothing();
  }

  // 2. Upsert cards. We deliberately avoid bulk insert here because libSQL
  // doesn't support multi-row ON CONFLICT well across remote hops; one row
  // at a time keeps the failure mode obvious.
  let cardsUpserted = 0;
  let translationsUpserted = 0;

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
          updatedAt: sql`(unixepoch())`,
        },
      });
    cardsUpserted += 1;

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
    setsTouched: setCodes.length,
    cardsUpserted,
    translationsUpserted,
  };
}
