/**
 * CLI wrapper around the discover-new-sets flow. Used by the
 * `discover-new-sets` GitHub Actions workflow and by humans:
 *
 *   npm run scrape:discover                # check + scrape new sets
 *   npm run scrape:discover -- --dry-run   # only print the diff
 *   npm run scrape:discover -- --no-scrape # persist to scrape_targets but skip the scrape
 *
 * The flow:
 *   1. Read scrape_targets seriesIds already known to the DB so we don't
 *      re-suggest sets we've previously discovered.
 *   2. discover() — fetches the cardlist root, parses the dropdown,
 *      diffs against SERIES_PARAM ∪ scrape_targets, persists newly-
 *      resolvable entries.
 *   3. For each newly persisted set, run the existing per-set scrape
 *      (`fetchSetHtml` + `parseSetHtml` + `upsertScrapedCards`) so the
 *      cards land in the DB without a manual second pass.
 */
import "@/lib/load-env";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { scrapeTargets } from "@/db/schema";

import { discover } from "./discover";
import { fetchSetHtml } from "./fetch";
import { parseSetHtml } from "./parse";
import { upsertScrapedCards } from "./upsert";

interface CliArgs {
  dryRun: boolean;
  noScrape: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, noScrape: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--no-scrape") args.noScrape = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Existing scrape_targets so we don't re-suggest entries we've already
  // discovered (even if they haven't been scraped yet).
  const existing = await db
    .select({
      seriesId: scrapeTargets.seriesId,
      setCode: scrapeTargets.setCode,
    })
    .from(scrapeTargets);
  const knownDb = new Set(existing.map((r) => r.seriesId));

  console.log(`▶ Running discover (${knownDb.size} series already in scrape_targets)…`);
  const report = await discover({ knownDbSeriesIds: knownDb });
  console.log(
    `  dropdown=${report.options.length} new=${report.newOptions.length} unresolved=${report.unresolvedOptions.length}`,
  );

  if (report.newOptions.length === 0 && report.unresolvedOptions.length === 0) {
    console.log("✓ No new sets — already up-to-date.");
    return;
  }

  if (args.dryRun) {
    console.log("✋ --dry-run set — printing diff:");
    if (report.newOptions.length > 0) {
      console.log("  New (resolvable):");
      for (const o of report.newOptions) {
        console.log(`    ${o.setCode}  series=${o.seriesId}  ${o.label}`);
      }
    }
    if (report.unresolvedOptions.length > 0) {
      console.log("  Unresolved (no 【XX-NN】 suffix in label):");
      for (const o of report.unresolvedOptions) {
        console.log(`    series=${o.seriesId}  ${o.label}`);
      }
    }
    return;
  }

  // Persist new entries to scrape_targets. The /api/admin/discover-sets
  // route does the same insert; we duplicate it here so this script is
  // standalone-safe for cron.
  let inserted = 0;
  for (const opt of report.newOptions) {
    if (!opt.setCode) continue;
    const result = await db
      .insert(scrapeTargets)
      .values({
        setCode: opt.setCode,
        seriesId: opt.seriesId,
        nameJa: opt.label,
        source: "discovered",
        lastScrapedAt: null,
      })
      .onConflictDoNothing()
      .returning({ setCode: scrapeTargets.setCode });
    if (result.length > 0) inserted += 1;
  }
  console.log(`✓ Persisted ${inserted} new scrape_target row(s).`);

  if (args.noScrape || inserted === 0) {
    console.log("✋ Skipping per-set scrape.");
    return;
  }

  // Scrape each new set sequentially with a polite delay.
  console.log(`▶ Scraping ${inserted} set(s) sequentially…`);
  const failures: Array<{ setCode: string; error: string }> = [];
  for (const opt of report.newOptions) {
    if (!opt.setCode) continue;
    try {
      const fixture = await fetchSetHtml(opt.setCode);
      const cards = parseSetHtml(fixture, { lenient: true });
      const result = await upsertScrapedCards(cards, {
        scrapedSetCode: opt.setCode,
      });
      await db
        .update(scrapeTargets)
        .set({ lastScrapedAt: new Date() })
        .where(eq(scrapeTargets.setCode, opt.setCode));
      console.log(
        `  ${opt.setCode}  cards=${result.cardsUpserted}  memberships=${result.membershipsAdded}`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`  ✗ ${opt.setCode}: ${msg}`);
      failures.push({ setCode: opt.setCode, error: msg });
    }
    // Polite gap between live fetches.
    await new Promise((r) => setTimeout(r, 5_000));
  }

  if (failures.length > 0) {
    console.error(`✗ ${failures.length} set(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("✓ Discover + scrape complete.");
  }
}

main().catch((err) => {
  console.error("✗ Discover failed:", err);
  process.exit(1);
});
