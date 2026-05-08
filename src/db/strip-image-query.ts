/**
 * One-shot maintenance: strip the `?<cache-buster>` query string from
 * `cards.image_url_jp`. Required after the Next.js 16 image-proxy
 * change (which now requires explicit `search` allow-list and rejects
 * any query string by default).
 *
 *   npx tsx src/db/strip-image-query.ts
 */
import "@/lib/load-env";

import { sql } from "drizzle-orm";

import { db } from "@/db";

async function main() {
  const result = await db.run(sql`
    UPDATE cards
    SET image_url_jp = SUBSTR(image_url_jp, 1, INSTR(image_url_jp, '?') - 1),
        updated_at = unixepoch()
    WHERE image_url_jp LIKE '%?%'
  `);
  console.log(`✓ Stripped query string from ${result.rowsAffected} card image URLs.`);
}

main().catch((err) => {
  console.error("✗ strip-image-query failed:", err);
  process.exit(1);
});
