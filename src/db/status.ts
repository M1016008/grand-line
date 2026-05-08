/**
 * Diagnostic: print which database the app is currently pointed at,
 * along with row counts and last-fetched timestamps for every populated
 * table. Useful before/after a Turso migration to confirm the swap.
 *
 *   npm run db:status
 */
import "dotenv/config";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import {
  cardRestrictionPairs,
  cardRestrictions,
  cardSetMembership,
  cardSets,
  cardTranslations,
  cards,
  scrapeTargets,
} from "@/db/schema";

interface Row {
  table: string;
  rows: number;
  notes?: string;
}

async function safeCount(label: string, fn: () => Promise<number>): Promise<Row> {
  try {
    return { table: label, rows: await fn() };
  } catch (err) {
    return { table: label, rows: -1, notes: `(error: ${(err as Error).message})` };
  }
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const local = process.env.LOCAL_DB_PATH ?? "./data/grand-line.db";
  const target = url ? `Turso · ${url}` : `local file · ${local}`;
  console.log(`▶ Connected to: ${target}`);
  console.log("");

  const counts = await Promise.all([
    safeCount("cards", async () =>
      Number(
        (await db.select({ n: sql<number>`COUNT(*)` }).from(cards))[0]?.n ?? 0,
      ),
    ),
    safeCount("card_translations", async () =>
      Number(
        (await db.select({ n: sql<number>`COUNT(*)` }).from(cardTranslations))[0]?.n ?? 0,
      ),
    ),
    safeCount("card_sets", async () =>
      Number(
        (await db.select({ n: sql<number>`COUNT(*)` }).from(cardSets))[0]?.n ?? 0,
      ),
    ),
    safeCount("card_set_membership", async () =>
      Number(
        (await db.select({ n: sql<number>`COUNT(*)` }).from(cardSetMembership))[0]?.n ?? 0,
      ),
    ),
    safeCount("card_restrictions (active)", async () =>
      Number(
        (
          await db
            .select({ n: sql<number>`COUNT(*)` })
            .from(cardRestrictions)
            .where(sql`${cardRestrictions.effectiveUntil} IS NULL`)
        )[0]?.n ?? 0,
      ),
    ),
    safeCount("card_restriction_pairs (active)", async () =>
      Number(
        (
          await db
            .select({ n: sql<number>`COUNT(*)` })
            .from(cardRestrictionPairs)
            .where(sql`${cardRestrictionPairs.effectiveUntil} IS NULL`)
        )[0]?.n ?? 0,
      ),
    ),
    safeCount("scrape_targets", async () =>
      Number(
        (await db.select({ n: sql<number>`COUNT(*)` }).from(scrapeTargets))[0]?.n ?? 0,
      ),
    ),
  ]);

  for (const r of counts) {
    const pad = r.table.padEnd(34);
    const n = r.rows < 0 ? r.notes : r.rows.toLocaleString();
    console.log(`  ${pad}  ${n}`);
  }

  // Last-fetched timestamps from translations / restrictions.
  const lastTranslation = await db
    .select({ ts: sql<number>`MAX(${cardTranslations.fetchedAt})` })
    .from(cardTranslations)
    .catch(() => [{ ts: null as number | null }]);
  const lastRegulation = await db
    .select({ ts: sql<number>`MAX(${cardRestrictions.fetchedAt})` })
    .from(cardRestrictions)
    .catch(() => [{ ts: null as number | null }]);

  function fmt(ts: number | null | undefined): string {
    if (!ts) return "(never)";
    return new Date(Number(ts) * 1000).toISOString();
  }

  console.log("");
  console.log(`  last card translation fetch:  ${fmt(lastTranslation[0]?.ts)}`);
  console.log(`  last regulation fetch:        ${fmt(lastRegulation[0]?.ts)}`);

  console.log("");
  if (counts.every((c) => c.rows === 0)) {
    console.log("✋ DB is empty. Run `npm run db:bootstrap` to seed from fixtures.");
  } else if (counts.some((c) => c.rows < 0)) {
    console.log("⚠ Some tables errored — migrations may be missing. Run `npm run db:migrate`.");
  } else {
    console.log("✓ DB looks populated.");
  }
}

main().catch((err) => {
  console.error("✗ db:status failed:", err);
  process.exit(1);
});
