/**
 * One-shot integrity audit. Prints row counts + cross-table sanity checks
 * so we can spot regressions without writing SQL by hand.
 */
import "@/lib/load-env";

import { sql } from "drizzle-orm";

import { db } from "@/db";

async function n(q: ReturnType<typeof sql>): Promise<number> {
  const r = await db.run(q);
  const row = r.rows?.[0] as unknown as { n: number } | undefined;
  return row?.n ?? -1;
}

async function main() {
  console.log("=== Row counts ===");
  for (const [label, q] of [
    ["cards", sql`SELECT COUNT(*) n FROM cards`],
    ["card_translations", sql`SELECT COUNT(*) n FROM card_translations`],
    ["card_sets", sql`SELECT COUNT(*) n FROM card_sets`],
    ["card_set_membership", sql`SELECT COUNT(*) n FROM card_set_membership`],
    [
      "card_restrictions (active)",
      sql`SELECT COUNT(*) n FROM card_restrictions WHERE effective_until IS NULL`,
    ],
    [
      "card_restriction_pairs (active)",
      sql`SELECT COUNT(*) n FROM card_restriction_pairs WHERE effective_until IS NULL`,
    ],
    ["scrape_targets", sql`SELECT COUNT(*) n FROM scrape_targets`],
    ["card_synergies", sql`SELECT COUNT(*) n FROM card_synergies`],
    ["decks", sql`SELECT COUNT(*) n FROM decks`],
    ["deck_cards", sql`SELECT COUNT(*) n FROM deck_cards`],
    ["meta_decks", sql`SELECT COUNT(*) n FROM meta_decks`],
    ["tournaments", sql`SELECT COUNT(*) n FROM tournaments`],
  ] as const) {
    console.log(`  ${label.padEnd(36)} ${(await n(q)).toLocaleString()}`);
  }

  console.log("");
  console.log("=== Integrity (all should be 0) ===");
  for (const [label, q] of [
    [
      "orphan memberships (card missing)",
      sql`SELECT COUNT(*) n FROM card_set_membership m LEFT JOIN cards c ON c.id=m.card_id WHERE c.id IS NULL`,
    ],
    [
      "orphan memberships (set missing)",
      sql`SELECT COUNT(*) n FROM card_set_membership m LEFT JOIN card_sets s ON s.code=m.set_code WHERE s.code IS NULL`,
    ],
    [
      "orphan restrictions",
      sql`SELECT COUNT(*) n FROM card_restrictions r LEFT JOIN cards c ON c.id=r.card_id WHERE c.id IS NULL`,
    ],
    [
      "orphan pair-bans",
      sql`SELECT COUNT(*) n FROM card_restriction_pairs p LEFT JOIN cards a ON a.id=p.card_id_a LEFT JOIN cards b ON b.id=p.card_id_b WHERE a.id IS NULL OR b.id IS NULL`,
    ],
    [
      "cards w/ set_code != id prefix",
      sql`SELECT COUNT(*) n FROM cards WHERE set_code != substr(id,1,instr(id,'-')-1)`,
    ],
    [
      "cards w/o ja translation",
      sql`SELECT COUNT(*) n FROM cards c LEFT JOIN card_translations t ON c.id=t.card_id AND t.language='ja' WHERE t.card_id IS NULL`,
    ],
    [
      "image URLs still containing '?'",
      sql`SELECT COUNT(*) n FROM cards WHERE image_url_jp LIKE '%?%'`,
    ],
    [
      "EVENT cards with power/life",
      sql`SELECT COUNT(*) n FROM cards WHERE card_type='EVENT' AND (power IS NOT NULL OR life IS NOT NULL)`,
    ],
    [
      "LEADER cards w/o life",
      sql`SELECT COUNT(*) n FROM cards WHERE card_type='LEADER' AND life IS NULL`,
    ],
  ] as const) {
    console.log(`  ${label.padEnd(36)} ${await n(q)}`);
  }

  console.log("");
  console.log("=== Coverage (informational) ===");
  console.log(
    `  cards w/o image_url_jp:               ${await n(sql`SELECT COUNT(*) n FROM cards WHERE image_url_jp IS NULL`)}`,
  );
  console.log(
    `  cards with empty mechanics:           ${await n(sql`SELECT COUNT(*) n FROM cards WHERE mechanics='[]'`)}`,
  );
  console.log(
    `    of those, with real effect text:    ${await n(sql`SELECT COUNT(*) n FROM cards c JOIN card_translations t ON c.id=t.card_id AND t.language='ja' WHERE c.mechanics='[]' AND t.effect_text != '-' AND t.effect_text IS NOT NULL`)} (false negatives)`,
  );
  const breakdown = await db.run(
    sql`SELECT card_type, COUNT(*) c FROM cards GROUP BY card_type ORDER BY card_type`,
  );
  const summary = breakdown.rows
    ?.map((r) => {
      const row = r as unknown as { card_type: string; c: number };
      return `${row.card_type}=${row.c}`;
    })
    .join(", ");
  console.log(`  card types breakdown: ${summary}`);
}

main().catch((err) => {
  console.error("✗ audit failed:", err);
  process.exit(1);
});
