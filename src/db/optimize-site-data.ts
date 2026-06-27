/**
 * Refresh SQLite statistics and compact the local site database.
 *
 * Use after scraping or large practice-log pruning. This is intentionally
 * read/write because ANALYZE, FTS optimize, and VACUUM persist optimizer and
 * storage changes to the SSD-backed database.
 */
import "@/lib/load-env";

import { mkdir } from "node:fs/promises";
import path from "node:path";

import { createDatabaseClient, resolveDatabaseConfig } from "@/db/config";

async function scalar(client: ReturnType<typeof createDatabaseClient>, sql: string) {
  const result = await client.execute(sql);
  return Number(result.rows[0]?.value ?? result.rows[0]?.n ?? 0);
}

async function tableExists(
  client: ReturnType<typeof createDatabaseClient>,
  tableName: string,
): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = ?",
    args: [tableName],
  });
  return Number(result.rows[0]?.n ?? 0) > 0;
}

async function main() {
  const config = resolveDatabaseConfig();
  if (config.kind === "local") {
    await mkdir(path.dirname(config.localPath), { recursive: true });
  }

  const client = createDatabaseClient(config);
  try {
    console.log(`▶ Site data optimize target: ${config.label}`);
    const beforePages = await scalar(client, "SELECT page_count AS value FROM pragma_page_count()");
    const beforeFree = await scalar(client, "SELECT freelist_count AS value FROM pragma_freelist_count()");

    await client.execute("ANALYZE");

    if (await tableExists(client, "card_translations_fts")) {
      await client.execute("INSERT INTO card_translations_fts(card_translations_fts) VALUES('optimize')");
    }

    await client.execute("PRAGMA optimize");
    await client.execute("VACUUM");

    const afterPages = await scalar(client, "SELECT page_count AS value FROM pragma_page_count()");
    const afterFree = await scalar(client, "SELECT freelist_count AS value FROM pragma_freelist_count()");
    const cards = await scalar(client, "SELECT COUNT(*) AS value FROM cards");
    const sets = await scalar(client, "SELECT COUNT(*) AS value FROM card_sets");

    console.log(`  pages: ${beforePages.toLocaleString()} -> ${afterPages.toLocaleString()}`);
    console.log(`  free pages: ${beforeFree.toLocaleString()} -> ${afterFree.toLocaleString()}`);
    console.log(`  cards=${cards.toLocaleString()} sets=${sets.toLocaleString()}`);
    console.log("✓ Site data optimized.");
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("✗ Site data optimize failed:", err);
  process.exit(1);
});
