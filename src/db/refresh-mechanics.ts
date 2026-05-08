/**
 * One-shot maintenance script: re-extract `cards.mechanics` for every
 * card from the JA effect text already in the DB.
 *
 * Use when the mechanics extractor's regex set has been extended (e.g.
 * adding [メイン] / [ドン!!×N] support) and you want the change to
 * apply to existing rows without re-scraping every set.
 *
 *     npm run db:refresh-mechanics
 */
import "@/lib/load-env";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { cards, cardTranslations } from "@/db/schema";
import { extractMechanics } from "@/lib/mechanics";

async function main() {
  const rows = await db
    .select({
      id: cards.id,
      currentMechanics: cards.mechanics,
      effectText: cardTranslations.effectText,
      triggerText: cardTranslations.triggerText,
    })
    .from(cards)
    .leftJoin(
      cardTranslations,
      eq(cardTranslations.cardId, cards.id),
    );

  console.log(`▶ Re-extracting mechanics for ${rows.length} cards…`);

  let changed = 0;
  let unchanged = 0;
  for (const r of rows) {
    const fresh = extractMechanics(r.effectText, r.triggerText);
    const current = (r.currentMechanics ?? []) as string[];
    const same =
      current.length === fresh.length &&
      current.every((m, i) => m === fresh[i]);
    if (same) {
      unchanged += 1;
      continue;
    }
    await db
      .update(cards)
      .set({ mechanics: fresh })
      .where(eq(cards.id, r.id));
    changed += 1;
  }

  console.log(`✓ Done. changed=${changed} unchanged=${unchanged}`);
}

main().catch((err) => {
  console.error("✗ refresh-mechanics failed:", err);
  process.exit(1);
});
