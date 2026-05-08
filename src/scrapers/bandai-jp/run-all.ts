/**
 * Scrape every set known to `SERIES_PARAM`, one at a time, with a
 * configurable delay between requests so we don't hammer the Bandai
 * cardlist endpoint.
 *
 * Defaults: 8 second delay between sets, 1 retry on transient failure.
 * Failures don't abort the run — they're collected and printed at the
 * end so a single broken set doesn't waste the work of the others.
 *
 * Usage:
 *   npm run scrape:bandai-jp:all
 *   npm run scrape:bandai-jp:all -- --skip OP01,OP02   # don't refetch
 *   npm run scrape:bandai-jp:all -- --only ST29        # one set only
 *   npm run scrape:bandai-jp:all -- --delay-ms 2000    # speed up dev
 *   npm run scrape:bandai-jp:all -- --from-fixture     # use saved HTML
 *
 * Already-saved fixtures (`data/raw/bandai-jp/<set>.html`) take precedence
 * over a network fetch when --from-fixture is on, so re-running is cheap
 * during parser iteration.
 */
import "dotenv/config";

import { ALL_SET_CODES, fetchSetHtml, loadFixture } from "./fetch";
import { parseSetHtml } from "./parse";
import { upsertScrapedCards } from "./upsert";

interface CliArgs {
  skip: Set<string>;
  only: string[] | null;
  delayMs: number;
  fromFixture: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    skip: new Set(),
    only: null,
    delayMs: 8_000,
    fromFixture: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skip") args.skip = new Set(argv[++i].split(","));
    else if (arg === "--only") args.only = argv[++i].split(",");
    else if (arg === "--delay-ms") args.delayMs = Number(argv[++i]);
    else if (arg === "--from-fixture") args.fromFixture = true;
    else if (arg === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const targets = (args.only ?? ALL_SET_CODES).filter(
    (code) => !args.skip.has(code),
  );

  console.log(
    `▶ Scraping ${targets.length} set(s) ${args.fromFixture ? "(from fixture)" : "(live fetch)"}, delay ${args.delayMs}ms${args.dryRun ? ", DRY-RUN" : ""}`,
  );

  const summary: Array<{
    setCode: string;
    cards: number;
    error?: string;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const setCode = targets[i];
    const prefix = `[${i + 1}/${targets.length}] ${setCode}`;
    try {
      const fixture = args.fromFixture
        ? await loadFixture(setCode)
        : await fetchSetHtml(setCode);

      const cards = parseSetHtml(fixture, { lenient: true });
      if (args.dryRun) {
        console.log(`${prefix}  parsed=${cards.length} (dry-run, no DB write)`);
      } else {
        const r = await upsertScrapedCards(cards);
        console.log(
          `${prefix}  parsed=${cards.length} upserted=${r.cardsUpserted} translations=${r.translationsUpserted}`,
        );
      }
      summary.push({ setCode, cards: cards.length });
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`${prefix}  ✗ ${msg}`);
      summary.push({ setCode, cards: 0, error: msg });
    }

    // Polite delay between live fetches (no need when reading fixtures).
    const isLast = i === targets.length - 1;
    if (!isLast && !args.fromFixture) {
      await sleep(args.delayMs);
    }
  }

  // Final report.
  const totalCards = summary.reduce((acc, s) => acc + s.cards, 0);
  const failed = summary.filter((s) => s.error);
  console.log("");
  console.log(`▶ Done. ${totalCards} cards across ${summary.length - failed.length} set(s).`);
  if (failed.length > 0) {
    console.log(`✗ ${failed.length} set(s) failed:`);
    for (const f of failed) {
      console.log(`   ${f.setCode}: ${f.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("✗ Fatal:", err);
  process.exit(1);
});
