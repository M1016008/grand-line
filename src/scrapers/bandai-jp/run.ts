/**
 * Entry point for the Bandai JP scraper.
 *
 * Usage examples:
 *   npm run scrape:bandai-jp -- --set OP01 --dry-run
 *   npm run scrape:bandai-jp -- --set OP01 --from-fixture
 *   npm run scrape:bandai-jp -- --set OP01           # network fetch + DB upsert
 *
 * Flags:
 *   --set <code>    (required) e.g. OP01, ST01
 *   --from-fixture  parse the saved data/raw/bandai-jp/<set>.html instead of fetching
 *   --dry-run       parse only; print summary, don't touch the DB
 */
import "@/lib/load-env";

import { fetchSetHtml, loadFixture } from "./fetch";
import { parseSetHtml } from "./parse";
import type { ScrapeRunOptions } from "./types";

interface CliArgs extends ScrapeRunOptions {}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = { fromFixture: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--set") {
      args.setCode = argv[++i];
    } else if (arg === "--from-fixture") {
      args.fromFixture = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  if (!args.setCode) {
    printUsage();
    throw new Error("Missing required --set <code>");
  }
  return args as CliArgs;
}

function printUsage() {
  console.log(`Usage:
  npm run scrape:bandai-jp -- --set <code> [--from-fixture] [--dry-run]

Examples:
  npm run scrape:bandai-jp -- --set OP01 --dry-run
  npm run scrape:bandai-jp -- --set OP01 --from-fixture
  npm run scrape:bandai-jp -- --set OP01
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const fixture = args.fromFixture
    ? await loadFixture(args.setCode)
    : await fetchSetHtml(args.setCode);

  console.log(
    `▶ Parsing ${args.setCode} (${(fixture.html.length / 1024).toFixed(1)} KiB) — fetched ${fixture.fetchedAt.toISOString()}`,
  );

  const cards = parseSetHtml(fixture, { lenient: true });
  console.log(`✓ Parsed ${cards.length} cards`);

  // Quick visibility check before we hit the DB.
  const summary = {
    leaders: cards.filter((c) => c.cardType === "LEADER").length,
    characters: cards.filter((c) => c.cardType === "CHARACTER").length,
    events: cards.filter((c) => c.cardType === "EVENT").length,
    stages: cards.filter((c) => c.cardType === "STAGE").length,
    withTrigger: cards.filter((c) => c.hasTrigger).length,
  };
  console.log("  ", summary);

  if (args.dryRun) {
    console.log("✋ --dry-run set — printing first 3 cards as JSON for inspection:");
    console.log(JSON.stringify(cards.slice(0, 3), null, 2));
    return;
  }

  const { upsertScrapedCards } = await import("./upsert");
  const result = await upsertScrapedCards(cards, { scrapedSetCode: args.setCode });
  console.log(
    `✓ DB upsert: sets=${result.setsTouched} cards=${result.cardsUpserted} translations=${result.translationsUpserted} memberships=${result.membershipsAdded}`,
  );
}

main().catch((err) => {
  console.error("✗ Scrape failed:", err);
  process.exit(1);
});
