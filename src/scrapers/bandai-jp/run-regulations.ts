/**
 * CLI: scrape Bandai's regulation page and reconcile with the
 * card_restrictions / card_restriction_pairs tables.
 *
 *   npm run scrape:regulations              # live fetch + upsert
 *   npm run scrape:regulations -- --dry-run # parse only, print summary
 *   npm run scrape:regulations -- --from-fixture
 *
 * Reconciliation strategy: every active row that's no longer in the
 * scraped set is ended (effective_until = today). New rows get effective
 * _from = today. This preserves history without ever deleting a row.
 */
import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq, isNull } from "drizzle-orm";
import { chromium } from "playwright";

import { db } from "@/db";
import {
  cardRestrictionPairs,
  cardRestrictions,
} from "@/db/schema";

import { parseRestrictionsHtml } from "./regulations";

const URL = "https://www.onepiece-cardgame.com/news/restriction.html";
const FIXTURE_PATH = path.resolve("data/raw/bandai-jp/regulations.html");

interface CliArgs {
  fromFixture: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { fromFixture: false, dryRun: false };
  for (const a of argv) {
    if (a === "--from-fixture") args.fromFixture = true;
    else if (a === "--dry-run") args.dryRun = true;
  }
  return args;
}

async function fetchLive(): Promise<string> {
  console.log(`▶ Fetching ${URL}`);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      locale: "ja-JP",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(1500);
    const html = await page.content();
    await mkdir(path.dirname(FIXTURE_PATH), { recursive: true });
    await writeFile(FIXTURE_PATH, html, "utf-8");
    return html;
  } finally {
    await browser.close();
  }
}

async function loadFixture(): Promise<string> {
  return readFile(FIXTURE_PATH, "utf-8");
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const html = args.fromFixture ? await loadFixture() : await fetchLive();
  const parsed = parseRestrictionsHtml(html);
  const today = todayIso();

  console.log(
    `▶ Parsed bans=${parsed.bans.length} restricted=${parsed.restricted.length} pairs=${parsed.pairs.length}`,
  );

  if (args.dryRun) {
    console.log("✋ --dry-run set — printing parsed data:");
    console.log(JSON.stringify(parsed, null, 2));
    return;
  }

  // ---- Single-card restrictions ------------------------------------------
  const desiredSingles = new Map<string, number>();
  for (const b of parsed.bans) desiredSingles.set(b.cardId, 0);
  for (const r of parsed.restricted) desiredSingles.set(r.cardId, r.maxCopies);

  const activeSingles = await db
    .select()
    .from(cardRestrictions)
    .where(isNull(cardRestrictions.effectiveUntil));

  let added = 0;
  let ended = 0;
  let unchanged = 0;

  // Add new + carry-forward unchanged.
  for (const [cardId, maxCopies] of desiredSingles) {
    const prior = activeSingles.find((r) => r.cardId === cardId);
    if (prior && prior.maxCopies === maxCopies) {
      unchanged += 1;
      continue;
    }
    if (prior) {
      // Restriction tightened/loosened — close the old row and open a new one.
      await db
        .update(cardRestrictions)
        .set({ effectiveUntil: today })
        .where(
          and(
            eq(cardRestrictions.cardId, cardId),
            eq(cardRestrictions.effectiveFrom, prior.effectiveFrom),
          ),
        );
    }
    await db.insert(cardRestrictions).values({
      cardId,
      effectiveFrom: today,
      effectiveUntil: null,
      maxCopies,
      reason: null,
      sourceUrl: URL,
      fetchedAt: new Date(),
    });
    added += 1;
  }

  // End restrictions that are no longer present.
  for (const r of activeSingles) {
    if (!desiredSingles.has(r.cardId)) {
      await db
        .update(cardRestrictions)
        .set({ effectiveUntil: today })
        .where(
          and(
            eq(cardRestrictions.cardId, r.cardId),
            eq(cardRestrictions.effectiveFrom, r.effectiveFrom),
          ),
        );
      ended += 1;
    }
  }
  console.log(
    `✓ Singles: added=${added} ended=${ended} unchanged=${unchanged}`,
  );

  // ---- Pair restrictions -------------------------------------------------
  const desiredPairKeys = new Set(parsed.pairs.map((p) => `${p.cardIdA}__${p.cardIdB}`));
  const activePairs = await db
    .select()
    .from(cardRestrictionPairs)
    .where(isNull(cardRestrictionPairs.effectiveUntil));

  let pairsAdded = 0;
  let pairsEnded = 0;
  let pairsUnchanged = 0;

  for (const p of parsed.pairs) {
    const key = `${p.cardIdA}__${p.cardIdB}`;
    const prior = activePairs.find(
      (a) => a.cardIdA === p.cardIdA && a.cardIdB === p.cardIdB,
    );
    if (prior) {
      pairsUnchanged += 1;
      continue;
    }
    await db.insert(cardRestrictionPairs).values({
      cardIdA: p.cardIdA,
      cardIdB: p.cardIdB,
      effectiveFrom: today,
      effectiveUntil: null,
      sourceUrl: URL,
      fetchedAt: new Date(),
    });
    pairsAdded += 1;
    void key;
  }

  for (const a of activePairs) {
    const key = `${a.cardIdA}__${a.cardIdB}`;
    if (!desiredPairKeys.has(key)) {
      await db
        .update(cardRestrictionPairs)
        .set({ effectiveUntil: today })
        .where(
          and(
            eq(cardRestrictionPairs.cardIdA, a.cardIdA),
            eq(cardRestrictionPairs.cardIdB, a.cardIdB),
            eq(cardRestrictionPairs.effectiveFrom, a.effectiveFrom),
          ),
        );
      pairsEnded += 1;
    }
  }
  console.log(
    `✓ Pairs: added=${pairsAdded} ended=${pairsEnded} unchanged=${pairsUnchanged}`,
  );
}

main().catch((err) => {
  console.error("✗ regulations scrape failed:", err);
  process.exit(1);
});
